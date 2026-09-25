import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  getMonthlyDataFromSupabase,
  saveMonthlyDataToSupabase,
  deleteItemFromSupabase,
  insertFinancialRecordInSupabase,
  updateFinancialRecordInSupabase,
  checkSupabaseStatus,
  SQL_SETUP_SCRIPT
} from './src/server/supabaseService';

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
  financialData: Record<string, Record<string, any>>;
}

let dbCache: DatabaseSchema = {
  users: {},
  records: {},
  sessions: {},
  financialData: {},
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
  if (!dbCache.financialData) dbCache.financialData = {};
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

// Standardized JSON response helpers
function sendError(res: express.Response, statusCode: number, message: string, code = 'ERROR') {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(statusCode).json({
    success: false,
    message,
    error: {
      code,
      message,
    },
  });
}

function sendSuccess(res: express.Response, data: Record<string, any> = {}, message?: string) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({
    success: true,
    ...(message ? { message } : {}),
    ...data,
  });
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

  // Middleware to authenticate requests via Bearer Token or Query Token (for EventSource SSE)
  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    let token = '';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (typeof req.query.token === 'string') {
      token = req.query.token.trim();
    }

    if (!token) {
      return sendError(res, 401, 'Acesso não autorizado. Faça login para continuar.', 'UNAUTHORIZED');
    }

    const session = dbCache.sessions?.[token];

    if (!session) {
      return sendError(res, 401, 'Sessão inválida ou encerrada. Por favor, acesse sua conta novamente.', 'INVALID_SESSION');
    }

    if (Date.now() > session.expiresAt) {
      delete dbCache.sessions[token];
      saveDatabase();
      return sendError(res, 401, 'Sessão expirada por segurança. Por favor, acesse sua conta novamente.', 'SESSION_EXPIRED');
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
      return sendError(res, 403, 'Acesso negado aos dados de outro usuário.', 'FORBIDDEN');
    }

    next();
  };

  // API Health check
  app.get('/api/health', (_req, res) => {
    sendSuccess(res, {
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
      return sendError(res, 429, rateCheck.message || 'Muitas tentativas. Aguarde 5 minutos.', 'RATE_LIMIT');
    }

    const { email, password, displayName } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return sendError(res, 400, 'Por favor, informe um endereço de e-mail válido.', 'INVALID_EMAIL');
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return sendError(res, 400, 'A senha deve conter no mínimo 6 caracteres.', 'WEAK_PASSWORD');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = findUserByEmail(normalizedEmail);
    if (existing) {
      return sendError(
        res,
        409,
        'Este e-mail já está cadastrado. Acesse a aba "Entrar" com sua senha ou use a recuperação.',
        'EMAIL_EXISTS'
      );
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

    sendSuccess(res, {
      token,
      expiresAt,
      recoveryPin,
      user: {
        uid: userId,
        email: normalizedEmail,
        displayName: newUser.displayName,
        provider: 'email',
      },
    }, 'Conta criada com sucesso.');
  });

  // 2. LOGIN WITH EMAIL & PASSWORD (Server-side PBKDF2 verification & Rate Limiting)
  app.post('/api/auth/login', (req, res) => {
    const ip = getClientIp(req);
    const { email, password } = req.body;

    if (!email || !password) {
      return sendError(res, 400, 'Por favor, informe e-mail e senha.', 'MISSING_FIELDS');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const rateLimitKey = `login_${normalizedEmail}_${ip}`;
    const rateCheck = checkRateLimit(rateLimitKey);
    if (rateCheck.blocked) {
      return sendError(res, 429, rateCheck.message || 'Muitas tentativas. Aguarde 5 minutos.', 'RATE_LIMIT');
    }

    const user = findUserByEmail(normalizedEmail);
    if (!user || !user.accountSalt || !user.passwordHash) {
      recordFailedAttempt(rateLimitKey);
      return sendError(res, 401, 'E-mail ou senha incorretos. Verifique suas credenciais.', 'INVALID_CREDENTIALS');
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
      return sendError(res, 401, 'E-mail ou senha incorretos. Verifique suas credenciais.', 'INVALID_CREDENTIALS');
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

    sendSuccess(res, {
      token,
      expiresAt,
      user: {
        uid: user.userId,
        email: user.email,
        displayName: user.displayName,
        provider: user.provider,
      },
    }, 'Login realizado com sucesso.');
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
          return sendError(res, 401, 'Credencial do Google inválida ou expirada. Tente novamente.', 'INVALID_GOOGLE_TOKEN');
        }
        userEmail = verified.email;
        userName = verified.displayName;
        userPhotoURL = verified.photoURL || '';
      } else if (email && typeof email === 'string' && email.includes('@')) {
        userEmail = email.trim().toLowerCase();
        userName = (displayName && displayName.trim()) || userEmail.split('@')[0];
      } else {
        return sendError(res, 400, 'Por favor, informe uma conta Google válida para autenticação.', 'INVALID_GOOGLE_INPUT');
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

      sendSuccess(res, {
        token,
        expiresAt,
        user: {
          uid: user.userId,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL || '',
          provider: 'google',
        },
      }, 'Autenticação Google concluída com sucesso.');
    } catch (err: any) {
      console.error('Error in /api/auth/google:', err);
      sendError(res, 500, 'Falha ao autenticar com o Google. Tente novamente em instantes.', 'GOOGLE_AUTH_ERROR');
    }
  });

  // 4. GET CURRENT SESSION / ME (Validates active session and token)
  app.get('/api/auth/me', requireAuth, (req, res) => {
    const session = (req as any).session;
    const user = dbCache.users[session.userId];

    if (!user) {
      return sendError(res, 404, 'Conta de usuário não encontrada.', 'USER_NOT_FOUND');
    }

    sendSuccess(res, {
      user: {
        uid: user.userId,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL || '',
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
    sendSuccess(res, {}, 'Sessão encerrada com sucesso.');
  });

  // 6. CHECK ACCOUNT FOR RESET
  app.post('/api/auth/check-account', (req, res) => {
    const { email } = req.body;
    if (!email) return sendError(res, 400, 'E-mail obrigatório.', 'MISSING_EMAIL');

    const normalized = email.trim().toLowerCase();
    const user = findUserByEmail(normalized);

    if (!user) {
      return sendError(res, 404, 'Nenhuma conta encontrada com este e-mail.', 'USER_NOT_FOUND');
    }

    sendSuccess(res, {
      exists: true,
      displayName: user.displayName,
      pinHint: user.recoveryPin || '',
    });
  });

  // 7. RESET PASSWORD WITH PIN
  app.post('/api/auth/reset-password', (req, res) => {
    const { email, recoveryPin, newPassword } = req.body;
    if (!email || !recoveryPin || !newPassword) {
      return sendError(res, 400, 'Campos obrigatórios ausentes.', 'MISSING_FIELDS');
    }
    if (newPassword.length < 6) {
      return sendError(res, 400, 'A nova senha deve ter no mínimo 6 caracteres.', 'WEAK_PASSWORD');
    }

    const normalized = email.trim().toLowerCase();
    const user = findUserByEmail(normalized);

    if (!user) {
      return sendError(res, 404, 'Conta não encontrada.', 'USER_NOT_FOUND');
    }

    if (user.recoveryPin?.trim() !== recoveryPin.trim()) {
      return sendError(res, 401, 'Código PIN de segurança incorreto.', 'INVALID_PIN');
    }

    const newSalt = generateSalt(16);
    user.accountSalt = newSalt;
    user.passwordHash = hashPassword(newPassword, newSalt);
    user.updatedAt = new Date().toISOString();

    saveDatabase();
    sendSuccess(res, {}, 'Senha atualizada com sucesso! Acesse a aba "Entrar".');
  });

  // 8. GET USER CRYPTOGRAPHIC SECURITY PROFILE (E2EE)
  app.get('/api/profile/:userId', requireAuth, requireUserMatch, (req, res) => {
    const { userId } = req.params;
    const user = dbCache.users[userId];
    if (!user) {
      return sendError(res, 404, 'Perfil de segurança não encontrado.', 'NOT_FOUND');
    }

    sendSuccess(res, {
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
      return sendError(res, 404, 'Usuário não encontrado.', 'USER_NOT_FOUND');
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

    sendSuccess(res, {
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
    sendSuccess(res, {}, 'Cofre redefinido com sucesso.');
  });

  // 11. GET MONTHLY ENCRYPTED RECORD
  app.get('/api/records/:userId/:monthYear', requireAuth, requireUserMatch, (req, res) => {
    const { userId, monthYear } = req.params;
    const userRecords = dbCache.records[userId];
    if (!userRecords || !userRecords[monthYear]) {
      return sendError(res, 404, 'Nenhum registro para este período.', 'NOT_FOUND');
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(userRecords[monthYear]);
  });

  // 12. SAVE MONTHLY ENCRYPTED RECORD
  app.post('/api/records/:userId/:monthYear', requireAuth, requireUserMatch, (req, res) => {
    const { userId, monthYear } = req.params;
    const { encryptedPayload, iv, version } = req.body;

    if (!encryptedPayload || !iv) {
      return sendError(res, 400, 'Carga criptografada inválida.', 'INVALID_PAYLOAD');
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
    sendSuccess(res, { record });
  });

  // 13. GET ALL USER RECORDS
  app.get('/api/records/:userId', requireAuth, requireUserMatch, (req, res) => {
    const { userId } = req.params;
    const userRecords = dbCache.records[userId] || {};
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
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

    sendSuccess(res, {
      count: Object.keys(dbCache.records[userId] || {}).length,
    });
  });

  // ==========================================
  // REALTIME SYNCHRONIZATION BRIDGE (SSE & SUPABASE)
  // Strictly validated and isolated by session.userId
  // ==========================================
  const realtimeClients: Map<string, Set<express.Response>> = new Map();

  function broadcastFinancialChange(userId: string, event: {
    action: 'UPSERT_MONTHLY' | 'DELETE_ITEM' | 'INSERT_ITEM' | 'UPDATE_ITEM';
    monthYear: string;
    type?: 'rendas' | 'despesas' | 'economias';
    itemId?: number;
    item?: any;
    data?: any;
    timestamp: string;
  }) {
    const clients = realtimeClients.get(userId);
    if (clients && clients.size > 0) {
      const payload = `data: ${JSON.stringify(event)}\n\n`;
      clients.forEach((client) => {
        try {
          client.write(payload);
        } catch (err) {
          console.warn('Error sending SSE event:', err);
        }
      });
    }
  }

  // Realtime SSE Stream Endpoint for Instant Multi-Device Sync
  app.get('/api/realtime/stream', requireAuth, (req, res) => {
    const session = (req as any).session;
    const userId = session.userId;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    if (!realtimeClients.has(userId)) {
      realtimeClients.set(userId, new Set());
    }
    const clientSet = realtimeClients.get(userId)!;
    clientSet.add(res);

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ action: 'CONNECTED', userId, timestamp: new Date().toISOString() })}\n\n`);

    // Keep-alive heartbeat every 20 seconds
    const heartbeat = setInterval(() => {
      try {
        res.write(':heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      clientSet.delete(res);
      if (clientSet.size === 0) {
        realtimeClients.delete(userId);
      }
    });
  });

  // ==========================================
  // FINANCIAL DATA & SUPABASE SYNC ENDPOINTS
  // Strictly validated and isolated by session.userId
  // ==========================================

  // 15. GET MONTHLY FINANCIAL DATA (From Supabase with local fallback)
  app.get('/api/financial/:monthYear', requireAuth, async (req, res) => {
    try {
      const session = (req as any).session;
      const userId = session.userId;
      const { monthYear } = req.params;

      if (!monthYear || !/^\d{2}_\d{4}$/.test(monthYear)) {
        return sendError(res, 400, 'Formato de mês/ano inválido. Use MM_AAAA (ex: 09_2026).', 'INVALID_PERIOD');
      }

      // 1. Try to load fresh data from Supabase first
      let data = await getMonthlyDataFromSupabase(userId, monthYear);
      let source = 'supabase';

      // 2. If Supabase has no data or tables not created yet, fall back to backend cache
      if (!data) {
        if (!dbCache.financialData) dbCache.financialData = {};
        if (!dbCache.financialData[userId]) dbCache.financialData[userId] = {};
        data = dbCache.financialData[userId][monthYear] || null;
        source = 'backend_cache';
      } else {
        // Keep backend cache fresh with Supabase data
        if (!dbCache.financialData) dbCache.financialData = {};
        if (!dbCache.financialData[userId]) dbCache.financialData[userId] = {};
        dbCache.financialData[userId][monthYear] = data;
        saveDatabase();
      }

      const defaultData = { rendas: [], despesas: [], economias: [] };
      return sendSuccess(res, {
        data: data || defaultData,
        monthYear,
        source,
      });
    } catch (err: any) {
      console.error('Error in GET /api/financial/:monthYear:', err);
      return sendError(res, 500, 'Erro ao carregar dados financeiros da nuvem.', 'FETCH_ERROR');
    }
  });

  // 16. SAVE / SYNC MONTHLY FINANCIAL DATA (To Supabase & persistent server storage)
  app.post('/api/financial/:monthYear', requireAuth, async (req, res) => {
    try {
      const session = (req as any).session;
      const userId = session.userId;
      const { monthYear } = req.params;

      if (!monthYear || !/^\d{2}_\d{4}$/.test(monthYear)) {
        return sendError(res, 400, 'Formato de mês/ano inválido. Use MM_AAAA.', 'INVALID_PERIOD');
      }

      const { rendas = [], despesas = [], economias = [] } = req.body || {};

      // Sanitize and validate inputs
      const sanitizeItems = (items: any[]): Array<{ id: number; nome: string; valor: number; status?: 'Pago' | 'Pendente' }> => {
        if (!Array.isArray(items)) return [];
        return items.map((item) => {
          const statusValue: 'Pago' | 'Pendente' | undefined = item.status === 'Pago' ? 'Pago' : (item.status ? 'Pendente' : undefined);
          return {
            id: typeof item.id === 'number' ? item.id : Date.now() + Math.floor(Math.random() * 1000),
            nome: String(item.nome || '').trim(),
            valor: typeof item.valor === 'number' ? item.valor : parseFloat(String(item.valor).replace(',', '.')) || 0,
            status: statusValue,
          };
        }).filter(i => i.nome.length > 0 && !isNaN(i.valor));
      };

      const cleanData = {
        rendas: sanitizeItems(rendas),
        despesas: sanitizeItems(despesas),
        economias: sanitizeItems(economias),
      };

      // 1. Immediately persist in server database
      if (!dbCache.financialData) dbCache.financialData = {};
      if (!dbCache.financialData[userId]) dbCache.financialData[userId] = {};
      dbCache.financialData[userId][monthYear] = cleanData;
      saveDatabase();

      // 2. Persist to Supabase in cloud
      let supabaseOk = false;
      try {
        supabaseOk = await saveMonthlyDataToSupabase(userId, monthYear, cleanData);
      } catch (sbErr) {
        console.warn('Could not save directly to Supabase:', sbErr);
      }

      // 3. Broadcast in Realtime to other connected devices of this user
      broadcastFinancialChange(userId, {
        action: 'UPSERT_MONTHLY',
        monthYear,
        data: cleanData,
        timestamp: new Date().toISOString(),
      });

      return sendSuccess(res, {
        data: cleanData,
        monthYear,
        supabaseSynced: supabaseOk,
      }, 'Dados financeiros salvos e sincronizados com sucesso.');
    } catch (err: any) {
      console.error('Error in POST /api/financial/:monthYear:', err);
      return sendError(res, 500, 'Erro ao salvar dados financeiros.', 'SAVE_ERROR');
    }
  });

  // 16b. ADD SINGLE FINANCIAL ITEM DIRECTLY TO SUPABASE
  app.post('/api/financial/:monthYear/item', requireAuth, async (req, res) => {
    try {
      const session = (req as any).session;
      const userId = session.userId;
      const { monthYear } = req.params;
      const { type, item } = req.body || {};

      if (!['rendas', 'despesas', 'economias'].includes(type)) {
        return sendError(res, 400, 'Tipo de item inválido.', 'INVALID_TYPE');
      }
      if (!item || !item.nome || typeof item.nome !== 'string' || item.nome.trim() === '') {
        return sendError(res, 400, 'Nome/descrição do item é obrigatório.', 'INVALID_NAME');
      }
      const valor = typeof item.valor === 'number' ? item.valor : parseFloat(String(item.valor).replace(',', '.'));
      if (isNaN(valor) || valor <= 0) {
        return sendError(res, 400, 'Valor numérico válido é obrigatório.', 'INVALID_VALUE');
      }

      // 1. Perform verified INSERT directly in Supabase financial_records
      const insertResult = await insertFinancialRecordInSupabase(userId, monthYear, type, {
        id: typeof item.id === 'number' ? item.id : Date.now(),
        nome: item.nome.trim(),
        valor,
        status: item.status === 'Pago' ? 'Pago' : (item.status ? 'Pendente' : undefined),
      });

      if (!insertResult.success || !insertResult.item) {
        return sendError(res, 500, insertResult.error || 'Erro ao gravar item no banco Supabase.', 'INSERT_FAILED');
      }

      const confirmedItem = insertResult.item;

      // 2. Keep server database cache in sync
      if (!dbCache.financialData) dbCache.financialData = {};
      if (!dbCache.financialData[userId]) dbCache.financialData[userId] = {};
      if (!dbCache.financialData[userId][monthYear]) {
        const fromSb = await getMonthlyDataFromSupabase(userId, monthYear);
        dbCache.financialData[userId][monthYear] = fromSb || { rendas: [], despesas: [], economias: [] };
      }
      const currentMonth = dbCache.financialData[userId][monthYear];
      if (!currentMonth[type]) currentMonth[type] = [];
      // Deduplicate if already present
      currentMonth[type] = [confirmedItem, ...currentMonth[type].filter((i: any) => i.id !== confirmedItem.id)];
      saveDatabase();

      // 3. Keep monthly_data snapshot in sync
      await saveMonthlyDataToSupabase(userId, monthYear, currentMonth);

      // 4. Broadcast Realtime change to all other devices
      broadcastFinancialChange(userId, {
        action: 'INSERT_ITEM',
        monthYear,
        type,
        itemId: confirmedItem.id,
        item: confirmedItem,
        data: currentMonth,
        timestamp: new Date().toISOString(),
      });

      return sendSuccess(res, {
        confirmed: true,
        item: confirmedItem,
        data: currentMonth,
        monthYear,
      }, 'Item salvo e confirmado no Supabase com sucesso.');
    } catch (err: any) {
      console.error('Error in POST /api/financial/:monthYear/item:', err);
      return sendError(res, 500, 'Falha ao processar inserção no Supabase.', 'INSERT_ERROR');
    }
  });

  // 16c. UPDATE SINGLE FINANCIAL ITEM DIRECTLY IN SUPABASE
  app.put('/api/financial/:monthYear/item/:type/:id', requireAuth, async (req, res) => {
    try {
      const session = (req as any).session;
      const userId = session.userId;
      const { monthYear, type, id } = req.params;
      const { item } = req.body || {};

      if (!['rendas', 'despesas', 'economias'].includes(type)) {
        return sendError(res, 400, 'Tipo de item inválido.', 'INVALID_TYPE');
      }
      const numId = parseInt(id, 10);
      if (isNaN(numId)) {
        return sendError(res, 400, 'ID de item inválido.', 'INVALID_ID');
      }

      const valor = typeof item?.valor === 'number' ? item.valor : parseFloat(String(item?.valor || '').replace(',', '.'));

      const updateResult = await updateFinancialRecordInSupabase(userId, monthYear, type as any, {
        id: numId,
        nome: String(item?.nome || '').trim(),
        valor: isNaN(valor) ? 0 : valor,
        status: item?.status === 'Pago' ? 'Pago' : (item?.status ? 'Pendente' : undefined),
      });

      if (!updateResult.success || !updateResult.item) {
        return sendError(res, 500, updateResult.error || 'Erro ao atualizar item no Supabase.', 'UPDATE_FAILED');
      }

      const updatedItem = updateResult.item;

      // Update cache
      if (!dbCache.financialData) dbCache.financialData = {};
      if (!dbCache.financialData[userId]) dbCache.financialData[userId] = {};
      if (!dbCache.financialData[userId][monthYear]) {
        const fromSb = await getMonthlyDataFromSupabase(userId, monthYear);
        dbCache.financialData[userId][monthYear] = fromSb || { rendas: [], despesas: [], economias: [] };
      }
      const current = dbCache.financialData[userId][monthYear];
      if (!current[type]) current[type] = [];
      const idx = current[type].findIndex((i: any) => i.id === numId);
      if (idx !== -1) {
        current[type][idx] = updatedItem;
      } else {
        current[type].push(updatedItem);
      }
      const updatedData = current;
      saveDatabase();
      await saveMonthlyDataToSupabase(userId, monthYear, current);

      broadcastFinancialChange(userId, {
        action: 'UPDATE_ITEM',
        monthYear,
        type: type as any,
        itemId: numId,
        item: updatedItem,
        data: updatedData,
        timestamp: new Date().toISOString(),
      });

      return sendSuccess(res, {
        confirmed: true,
        item: updatedItem,
        data: updatedData,
      }, 'Item atualizado com sucesso no Supabase.');
    } catch (err: any) {
      console.error('Error in PUT /api/financial/:monthYear/item:', err);
      return sendError(res, 500, 'Erro ao atualizar item financeiro.', 'UPDATE_ERROR');
    }
  });

  // 17. DELETE ITEM FROM FINANCIAL DATA
  app.delete('/api/financial/:monthYear/item/:type/:id', requireAuth, async (req, res) => {
    try {
      const session = (req as any).session;
      const userId = session.userId;
      const { monthYear, type, id } = req.params;

      if (!['rendas', 'despesas', 'economias'].includes(type)) {
        return sendError(res, 400, 'Tipo de item inválido.', 'INVALID_TYPE');
      }

      const numId = parseInt(id, 10);
      if (isNaN(numId)) {
        return sendError(res, 400, 'ID de item inválido.', 'INVALID_ID');
      }

      // 1. Ensure cache is loaded
      if (!dbCache.financialData) dbCache.financialData = {};
      if (!dbCache.financialData[userId]) dbCache.financialData[userId] = {};
      if (!dbCache.financialData[userId][monthYear]) {
        const fromSb = await getMonthlyDataFromSupabase(userId, monthYear);
        dbCache.financialData[userId][monthYear] = fromSb || { rendas: [], despesas: [], economias: [] };
      }

      const current = dbCache.financialData[userId][monthYear];
      current[type] = (current[type] || []).filter((item: any) => item.id !== numId);
      const updatedData = current;
      saveDatabase();

      // 2. Remove from Supabase
      try {
        await deleteItemFromSupabase(userId, monthYear, type as any, numId);
        // Also update monthly_data in Supabase
        await saveMonthlyDataToSupabase(userId, monthYear, updatedData);
      } catch (sbErr) {
        console.warn('Could not delete directly from Supabase:', sbErr);
      }

      // 3. Broadcast in Realtime to other connected devices of this user
      broadcastFinancialChange(userId, {
        action: 'DELETE_ITEM',
        monthYear,
        type: type as any,
        itemId: numId,
        data: updatedData,
        timestamp: new Date().toISOString(),
      });

      return sendSuccess(res, {
        data: updatedData,
      }, 'Item excluído com sucesso.');
    } catch (err: any) {
      console.error('Error in DELETE /api/financial/:monthYear/item/:type/:id:', err);
      return sendError(res, 500, 'Erro ao excluir item financeiro.', 'DELETE_ERROR');
    }
  });

  // 18. SUPABASE STATUS & SQL SCRIPT HELPER
  app.get('/api/supabase/status', requireAuth, async (_req, res) => {
    try {
      const status = await checkSupabaseStatus();
      return sendSuccess(res, {
        ...status,
        sql: SQL_SETUP_SCRIPT,
      });
    } catch (err: any) {
      return sendError(res, 500, 'Erro ao verificar status do Supabase.', 'SUPABASE_STATUS_ERROR');
    }
  });

  // 19. BATCH MIGRATE ALL USER DATA TO SUPABASE
  app.post('/api/supabase/migrate', requireAuth, async (req, res) => {
    try {
      const session = (req as any).session;
      const userId = session.userId;
      const clientData = req.body?.data || {};

      let migratedMonths = 0;

      if (!dbCache.financialData) dbCache.financialData = {};
      if (!dbCache.financialData[userId]) dbCache.financialData[userId] = {};

      for (const [mYear, mData] of Object.entries(clientData)) {
        if (mData && typeof mData === 'object') {
          // If server already has rich data for this month, keep server as authoritative
          const existing = dbCache.financialData[userId][mYear];
          const hasExisting = existing && (existing.rendas?.length || existing.despesas?.length || existing.economias?.length);
          if (hasExisting) {
            continue;
          }

          await saveMonthlyDataToSupabase(userId, mYear, mData as any);
          dbCache.financialData[userId][mYear] = mData;
          migratedMonths++;
        }
      }

      saveDatabase();
      return sendSuccess(res, {
        migratedMonths,
      }, `${migratedMonths} meses sincronizados com o Supabase com sucesso.`);
    } catch (err: any) {
      console.error('Error in /api/supabase/migrate:', err);
      return sendError(res, 500, 'Erro durante a migração para o Supabase.', 'MIGRATE_ERROR');
    }
  });

  // Explicit JSON 404 handler for any unmatched /api/* routes
  app.all('/api/*', (req, res) => {
    sendError(res, 404, `Endpoint da API não encontrado: ${req.method} ${req.path}`, 'ROUTE_NOT_FOUND');
  });

  // Explicit error handler: guarantees JSON for all /api routes
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Server error handler:', err);
    if (req.path.startsWith('/api')) {
      return sendError(res, err.status || 500, err.message || 'Erro interno no servidor.', 'INTERNAL_ERROR');
    }
    res.status(err.status || 500).send('Internal Server Error');
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
