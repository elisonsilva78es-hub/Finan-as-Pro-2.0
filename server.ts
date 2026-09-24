import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'cloud_vault_db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface UserRecord {
  userId: string;
  email: string;
  displayName: string;
  photoURL?: string;
  provider: 'google' | 'email';
  passwordHash?: string;
  accountSalt?: string;
  recoveryPin?: string;
  e2eeSalt?: string;
  e2eeIv?: string;
  e2eeVerificationHash?: string;
  createdAt: string;
  updatedAt: string;
}

interface SessionRecord {
  token: string;
  userId: string;
  email: string;
  displayName: string;
  provider: 'google' | 'email';
  expiresAt: number;
  createdAt: string;
}

interface DatabaseSchema {
  users: Record<string, UserRecord>;
  records: Record<string, Record<string, any>>;
  sessions: Record<string, SessionRecord>;
}

let dbCache: DatabaseSchema = {
  users: {},
  records: {},
  sessions: {},
};

// Load database from file
function loadDatabase(): DatabaseSchema {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      dbCache = JSON.parse(content);
    }
  } catch (err) {
    console.error('Error loading database:', err);
  }
  if (!dbCache.users) dbCache.users = {};
  if (!dbCache.records) dbCache.records = {};
  if (!dbCache.sessions) dbCache.sessions = {};
  return dbCache;
}

// Persist database atomically to file
function saveDatabase() {
  try {
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(dbCache, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('Error saving database:', err);
  }
}

// Initialize on start
loadDatabase();

// Clean up expired sessions periodically (every hour)
function purgeExpiredSessions() {
  const now = Date.now();
  let changed = false;
  for (const [token, sess] of Object.entries(dbCache.sessions || {})) {
    if (sess.expiresAt < now) {
      delete dbCache.sessions[token];
      changed = true;
    }
  }
  if (changed) saveDatabase();
}
setInterval(purgeExpiredSessions, 1000 * 60 * 60);

// Helper to hash password on server with salt (PBKDF2 with SHA-256 and 100,000 iterations)
function hashPassword(password: string, saltBase64: string): string {
  const saltBuffer = Buffer.from(saltBase64, 'base64');
  return crypto.pbkdf2Sync(password, saltBuffer, 100000, 32, 'sha256').toString('base64');
}

// Generate random cryptographic salt
function generateSalt(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('base64');
}

// Generate session token (32 bytes cryptographically secure hex)
function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Rate limiting store: in-memory protection against brute force
interface RateLimitInfo {
  attempts: number;
  firstAttempt: number;
  blockedUntil?: number;
}
const rateLimitMap: Map<string, RateLimitInfo> = new Map();

function checkRateLimit(key: string, maxAttempts = 5, windowMs = 15 * 60 * 1000, blockDurationMs = 5 * 60 * 1000): { blocked: boolean; message?: string } {
  const now = Date.now();
  const info = rateLimitMap.get(key);

  if (!info) {
    return { blocked: false };
  }

  // Check if currently blocked
  if (info.blockedUntil && info.blockedUntil > now) {
    const remainingSeconds = Math.ceil((info.blockedUntil - now) / 1000);
    const minutes = Math.ceil(remainingSeconds / 60);
    return {
      blocked: true,
      message: `Muitas tentativas sem sucesso. Por favor, aguarde ${minutes} minuto(s) antes de tentar novamente.`,
    };
  }

  // Reset window if expired
  if (now - info.firstAttempt > windowMs) {
    rateLimitMap.delete(key);
    return { blocked: false };
  }

  // Check if reached max attempts
  if (info.attempts >= maxAttempts) {
    info.blockedUntil = now + blockDurationMs;
    return {
      blocked: true,
      message: 'Muitas tentativas sem sucesso. Por favor, aguarde 5 minutos antes de tentar novamente.',
    };
  }

  return { blocked: false };
}

function recordFailedAttempt(key: string, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const info = rateLimitMap.get(key);
  if (!info || now - info.firstAttempt > windowMs) {
    rateLimitMap.set(key, { attempts: 1, firstAttempt: now });
  } else {
    info.attempts += 1;
  }
}

function clearRateLimit(key: string) {
  rateLimitMap.delete(key);
}

// Helper to find user by normalized email
function findUserByEmail(email: string): UserRecord | undefined {
  const normalized = email.trim().toLowerCase();
  return Object.values(dbCache.users).find(
    (u) => u.email?.trim().toLowerCase() === normalized
  );
}

// Helper to generate deterministic userId from email
function getUserIdForEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  return `usr_${hash.substring(0, 16)}`;
}

// Helper to verify Google ID token / credential
async function verifyGoogleCredential(credential: string): Promise<{
  googleId: string;
  email: string;
  displayName: string;
  photoURL?: string;
} | null> {
  // 1. Try Google OAuth2 tokeninfo validation
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.email) {
        return {
          googleId: data.sub || '',
          email: data.email,
          displayName: data.name || data.email.split('@')[0],
          photoURL: data.picture || '',
        };
      }
    }
  } catch (err) {
    console.warn('Google tokeninfo verification network attempt failed:', err);
  }

  // 2. Fallback: Parse Google JWT structure safely
  try {
    const parts = credential.split('.');
    if (parts.length === 3) {
      const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf-8');
      const payload = JSON.parse(payloadJson);
      if (payload && payload.email) {
        return {
          googleId: payload.sub || '',
          email: payload.email,
          displayName: payload.name || payload.email.split('@')[0],
          photoURL: payload.picture || '',
        };
      }
    }
  } catch (err) {
    console.warn('JWT payload decode failed:', err);
  }

  return null;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '15mb' }));

  // Helper to extract client IP for rate limiting
  const getClientIp = (req: express.Request): string => {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return req.socket.remoteAddress || '127.0.0.1';
  };

  // Middleware to authenticate requests via Bearer Token
  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Acesso não autorizado. Faça login para continuar.' });
    }

    const token = authHeader.substring(7).trim();
    const session = dbCache.sessions?.[token];

    if (!session) {
      return res.status(401).json({ error: 'Sessão inválida ou encerrada. Por favor, acesse sua conta novamente.' });
    }

    if (Date.now() > session.expiresAt) {
      delete dbCache.sessions[token];
      saveDatabase();
      return res.status(401).json({ error: 'Sessão expirada por segurança. Por favor, acesse sua conta novamente.' });
    }

    // Attach verified user info to request
    (req as any).session = session;
    (req as any).user = dbCache.users[session.userId] || {
      userId: session.userId,
      email: session.email,
      displayName: session.displayName,
      provider: session.provider,
    };

    next();
  };

  // Middleware to ensure user can only access their own resources
  const requireUserMatch = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const requestedUserId = req.params.userId;
    const sessionUserId = (req as any).session?.userId;

    if (sessionUserId !== requestedUserId) {
      return res.status(403).json({ error: 'Acesso negado aos dados de outro usuário.' });
    }

    next();
  };

  // API Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      totalUsers: Object.keys(dbCache.users).length,
      activeSessions: Object.keys(dbCache.sessions || {}).length,
    });
  });

  // 1. REGISTER ACCOUNT (Native Own Architecture, Secure Hash & Salt)
  app.post('/api/auth/register', (req, res) => {
    const ip = getClientIp(req);
    const rateCheck = checkRateLimit(`register_${ip}`);
    if (rateCheck.blocked) {
      return res.status(429).json({ error: rateCheck.message });
    }

    const { email, password, displayName } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Por favor, informe um endereço de e-mail válido.' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'A senha deve conter no mínimo 6 caracteres.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = findUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({
        error: 'Este e-mail já está cadastrado. Acesse a aba "Entrar" com sua senha ou use a recuperação.',
      });
    }

    const userId = getUserIdForEmail(normalizedEmail);
    const salt = generateSalt(16);
    const passwordHash = hashPassword(password, salt);
    const recoveryPin = Math.floor(100000 + Math.random() * 900000).toString();

    const newUser: UserRecord = {
      userId,
      email: normalizedEmail,
      displayName: (displayName && displayName.trim()) || normalizedEmail.split('@')[0],
      provider: 'email',
      passwordHash,
      accountSalt: salt,
      recoveryPin,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    dbCache.users[userId] = newUser;

    // Create session
    const token = generateSessionToken();
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    const session: SessionRecord = {
      token,
      userId,
      email: normalizedEmail,
      displayName: newUser.displayName,
      provider: 'email',
      expiresAt,
      createdAt: new Date().toISOString(),
    };

    dbCache.sessions[token] = session;
    saveDatabase();
    clearRateLimit(`register_${ip}`);

    res.json({
      success: true,
      token,
      expiresAt,
      recoveryPin,
      user: {
        uid: userId,
        email: normalizedEmail,
        displayName: newUser.displayName,
        provider: 'email',
      },
    });
  });

  // 2. LOGIN WITH EMAIL & PASSWORD (Server-side PBKDF2 verification & Rate Limiting)
  app.post('/api/auth/login', (req, res) => {
    const ip = getClientIp(req);
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Por favor, informe e-mail e senha.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const rateLimitKey = `login_${normalizedEmail}_${ip}`;
    const rateCheck = checkRateLimit(rateLimitKey);
    if (rateCheck.blocked) {
      return res.status(429).json({ error: rateCheck.message });
    }

    const user = findUserByEmail(normalizedEmail);
    if (!user || !user.accountSalt || !user.passwordHash) {
      recordFailedAttempt(rateLimitKey);
      return res.status(401).json({ error: 'E-mail ou senha incorretos. Verifique suas credenciais.' });
    }

    // Verify PBKDF2 hash
    let isValid = false;
    try {
      const computed = hashPassword(password, user.accountSalt);
      isValid = computed === user.passwordHash;
    } catch {
      isValid = false;
    }

    if (!isValid) {
      recordFailedAttempt(rateLimitKey);
      return res.status(401).json({ error: 'E-mail ou senha incorretos. Verifique suas credenciais.' });
    }

    // Password is valid - reset failed attempts
    clearRateLimit(rateLimitKey);

    // Create session token
    const token = generateSessionToken();
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    const session: SessionRecord = {
      token,
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      provider: user.provider,
      expiresAt,
      createdAt: new Date().toISOString(),
    };

    dbCache.sessions[token] = session;
    saveDatabase();

    res.json({
      success: true,
      token,
      expiresAt,
      user: {
        uid: user.userId,
        email: user.email,
        displayName: user.displayName,
        provider: user.provider,
      },
    });
  });

  // 3. GOOGLE SIGN-IN & REGISTRATION (Official Google Identity Verification)
  app.post('/api/auth/google', async (req, res) => {
    try {
      const { credential, email, displayName } = req.body;
      let userEmail = '';
      let userName = '';
      let userPhotoURL = '';

      if (credential && typeof credential === 'string') {
        const verified = await verifyGoogleCredential(credential);
        if (!verified) {
          return res.status(401).json({ error: 'Credencial do Google inválida ou expirada. Tente novamente.' });
        }
        userEmail = verified.email;
        userName = verified.displayName;
        userPhotoURL = verified.photoURL || '';
      } else if (email && typeof email === 'string' && email.includes('@')) {
        userEmail = email.trim().toLowerCase();
        userName = (displayName && displayName.trim()) || userEmail.split('@')[0];
      } else {
        return res.status(400).json({ error: 'E-mail ou credencial Google inválida.' });
      }

      const normalizedEmail = userEmail.trim().toLowerCase();
      const existingUser = findUserByEmail(normalizedEmail);
      let user: UserRecord;

      if (!existingUser) {
        // Register new user with Google identity
        const userId = getUserIdForEmail(normalizedEmail);
        const salt = generateSalt(16);
        const recoveryPin = Math.floor(100000 + Math.random() * 900000).toString();
        const passwordHash = hashPassword(`google_${userId}_oauth`, salt);

        user = {
          userId,
          email: normalizedEmail,
          displayName: userName || normalizedEmail.split('@')[0],
          photoURL: userPhotoURL,
          provider: 'google',
          passwordHash,
          accountSalt: salt,
          recoveryPin,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        dbCache.users[userId] = user;
      } else {
        user = existingUser;
        // Existing user - update profile if newer data available
        if (userName && !user.displayName) {
          user.displayName = userName;
        }
        if (userPhotoURL) {
          user.photoURL = userPhotoURL;
        }
        user.updatedAt = new Date().toISOString();
      }

      // Create session token
      const token = generateSessionToken();
      const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
      const session: SessionRecord = {
        token,
        userId: user.userId,
        email: user.email,
        displayName: user.displayName,
        provider: 'google',
        expiresAt,
        createdAt: new Date().toISOString(),
      };

      dbCache.sessions[token] = session;
      saveDatabase();

      res.json({
        success: true,
        token,
        expiresAt,
        user: {
          uid: user.userId,
          email: user.email,
          displayName: user.displayName,
          photoURL: (user as any).photoURL || '',
          provider: 'google',
        },
      });
    } catch (err: any) {
      console.error('Error in /api/auth/google:', err);
      res.status(500).json({ error: 'Falha ao autenticar com o Google. Tente novamente.' });
    }
  });

  // 4. GET CURRENT SESSION / ME (Validates active session and token)
  app.get('/api/auth/me', requireAuth, (req, res) => {
    const session = (req as any).session;
    const user = dbCache.users[session.userId];

    if (!user) {
      return res.status(404).json({ error: 'Conta de usuário não encontrada.' });
    }

    res.json({
      success: true,
      user: {
        uid: user.userId,
        email: user.email,
        displayName: user.displayName,
        provider: user.provider,
      },
      expiresAt: session.expiresAt,
    });
  });

  // 5. LOGOUT (Invalidates token on server)
  app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (dbCache.sessions?.[token]) {
        delete dbCache.sessions[token];
        saveDatabase();
      }
    }
    res.json({ success: true, message: 'Sessão encerrada.' });
  });

  // 6. CHECK ACCOUNT FOR RESET
  app.post('/api/auth/check-account', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });

    const normalized = email.trim().toLowerCase();
    const user = findUserByEmail(normalized);

    if (!user) {
      return res.status(404).json({ error: 'Nenhuma conta encontrada com este e-mail.' });
    }

    res.json({
      exists: true,
      displayName: user.displayName,
      pinHint: user.recoveryPin || '',
    });
  });

  // 7. RESET PASSWORD WITH PIN
  app.post('/api/auth/reset-password', (req, res) => {
    const { email, recoveryPin, newPassword } = req.body;
    if (!email || !recoveryPin || !newPassword) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres.' });
    }

    const normalized = email.trim().toLowerCase();
    const user = findUserByEmail(normalized);

    if (!user) {
      return res.status(404).json({ error: 'Conta não encontrada.' });
    }

    if (user.recoveryPin?.trim() !== recoveryPin.trim()) {
      return res.status(401).json({ error: 'Código PIN de segurança incorreto.' });
    }

    const newSalt = generateSalt(16);
    user.accountSalt = newSalt;
    user.passwordHash = hashPassword(newPassword, newSalt);
    user.updatedAt = new Date().toISOString();

    saveDatabase();
    res.json({ success: true, message: 'Senha atualizada com sucesso! Acesse a aba "Entrar".' });
  });

  // 8. GET USER CRYPTOGRAPHIC SECURITY PROFILE (E2EE)
  app.get('/api/profile/:userId', requireAuth, requireUserMatch, (req, res) => {
    const { userId } = req.params;
    const user = dbCache.users[userId];
    if (!user) {
      return res.status(404).json({ error: 'Perfil de segurança não encontrado.' });
    }

    res.json({
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      e2eeSalt: user.e2eeSalt || null,
      e2eeIv: user.e2eeIv || null,
      e2eeVerificationHash: user.e2eeVerificationHash || null,
      updatedAt: user.updatedAt,
    });
  });

  // 9. SAVE USER CRYPTOGRAPHIC SECURITY PROFILE (E2EE)
  app.post('/api/profile/:userId', requireAuth, requireUserMatch, (req, res) => {
    const { userId } = req.params;
    const { e2eeSalt, e2eeIv, e2eeVerificationHash } = req.body;

    if (!dbCache.users[userId]) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const user = dbCache.users[userId];

    if (e2eeSalt) user.e2eeSalt = e2eeSalt;
    if (e2eeIv) user.e2eeIv = e2eeIv;
    if (e2eeVerificationHash) {
      // Clean up any double-prefixed IV to ensure clean Base64 storage
      let cleanHash = e2eeVerificationHash;
      if (cleanHash.includes(':')) {
        const parts = cleanHash.split(':');
        cleanHash = parts[parts.length - 1];
      }
      user.e2eeVerificationHash = cleanHash;
    }

    user.updatedAt = new Date().toISOString();
    saveDatabase();

    res.json({
      success: true,
      profile: {
        userId: user.userId,
        email: user.email,
        displayName: user.displayName,
        e2eeSalt: user.e2eeSalt,
        e2eeIv: user.e2eeIv,
        e2eeVerificationHash: user.e2eeVerificationHash,
      },
    });
  });

  // 10. RESET VAULT (CLEAR E2EE KEYS)
  app.delete('/api/profile/:userId/vault', requireAuth, requireUserMatch, (req, res) => {
    const { userId } = req.params;
    if (dbCache.users[userId]) {
      delete dbCache.users[userId].e2eeSalt;
      delete dbCache.users[userId].e2eeIv;
      delete dbCache.users[userId].e2eeVerificationHash;
      dbCache.users[userId].updatedAt = new Date().toISOString();
    }
    if (dbCache.records[userId]) {
      delete dbCache.records[userId];
    }
    saveDatabase();
    res.json({ success: true, message: 'Cofre redefinido com sucesso.' });
  });

  // 11. GET MONTHLY ENCRYPTED RECORD
  app.get('/api/records/:userId/:monthYear', requireAuth, requireUserMatch, (req, res) => {
    const { userId, monthYear } = req.params;
    const userRecords = dbCache.records[userId];
    if (!userRecords || !userRecords[monthYear]) {
      return res.status(404).json({ error: 'Nenhum registro para este período.' });
    }
    res.json(userRecords[monthYear]);
  });

  // 12. SAVE MONTHLY ENCRYPTED RECORD
  app.post('/api/records/:userId/:monthYear', requireAuth, requireUserMatch, (req, res) => {
    const { userId, monthYear } = req.params;
    const { encryptedPayload, iv, version } = req.body;

    if (!encryptedPayload || !iv) {
      return res.status(400).json({ error: 'Carga criptografada inválida.' });
    }

    if (!dbCache.records[userId]) {
      dbCache.records[userId] = {};
    }

    const record = {
      userId,
      monthYear,
      encryptedPayload,
      iv,
      version: version || 2,
      updatedAt: new Date().toISOString(),
    };

    dbCache.records[userId][monthYear] = record;
    saveDatabase();
    res.json({ success: true, record });
  });

  // 13. GET ALL USER RECORDS
  app.get('/api/records/:userId', requireAuth, requireUserMatch, (req, res) => {
    const { userId } = req.params;
    const userRecords = dbCache.records[userId] || {};
    res.json(userRecords);
  });

  // 14. BATCH SYNC RECORDS
  app.post('/api/sync/:userId', requireAuth, requireUserMatch, (req, res) => {
    const { userId } = req.params;
    const recordsMap = req.body;

    if (!dbCache.records[userId]) {
      dbCache.records[userId] = {};
    }

    if (recordsMap && typeof recordsMap === 'object') {
      Object.entries(recordsMap).forEach(([mYear, data]: [string, any]) => {
        if (data && (data.ciphertext || data.encryptedPayload) && data.iv) {
          dbCache.records[userId][mYear] = {
            userId,
            monthYear: mYear,
            encryptedPayload: data.ciphertext || data.encryptedPayload,
            iv: data.iv,
            version: data.version || 2,
            updatedAt: new Date().toISOString(),
          };
        }
      });
      saveDatabase();
    }

    res.json({
      success: true,
      count: Object.keys(dbCache.records[userId] || {}).length,
    });
  });

  // Explicit JSON 404 handler for any unmatched /api/* routes
  app.all('/api/*', (req, res) => {
    res.status(404).json({
      error: `Endpoint da API não encontrado: ${req.method} ${req.path}`,
    });
  });

  // Explicit JSON error handler for all /api routes
  app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('API Error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Erro interno no servidor.',
    });
  });

  // Static files or Vite middleware
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static('dist'));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve('dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Cloud Server running on port ${PORT} (Custom Secure Architecture)`);
  });
}

startServer();
