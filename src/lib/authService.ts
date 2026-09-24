export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  provider: 'google' | 'email';
}

const ACTIVE_SESSION_KEY = 'fin_active_user_session';
const AUTH_TOKEN_KEY = 'fin_auth_token';

// Auth subscribers list
type AuthSubscriber = (user: AppUser | null) => void;
const subscribers: Set<AuthSubscriber> = new Set();

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // ignore
  }
}

function notifySubscribers(user: AppUser | null) {
  subscribers.forEach((cb) => {
    try {
      cb(user);
    } catch (e) {
      console.error('Subscriber callback error:', e);
    }
  });
}

// Get current active session
export function getActiveUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Set active user session
function setActiveUser(user: AppUser | null, token?: string | null) {
  if (user) {
    localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
  }

  if (token !== undefined) {
    setAuthToken(token);
  }

  notifySubscribers(user);
}

// Helper for native Cloud API calls with automatic Bearer Token header
export async function cloudFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T | null> {
  try {
    const token = getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(endpoint, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      // Session expired or invalidated on backend
      console.warn('Session expired or unauthorized for:', endpoint);
      // Only clear if not an auth endpoint (e.g. login attempt)
      if (!endpoint.startsWith('/api/auth/login') && !endpoint.startsWith('/api/auth/register')) {
        setActiveUser(null, null);
      }
      return null;
    }

    if (!res.ok) {
      let errMessage = 'Erro na requisição';
      try {
        const errorData = await res.json();
        if (errorData?.error) errMessage = errorData.error;
      } catch {
        // ignore
      }
      throw new Error(errMessage);
    }

    return await res.json();
  } catch (err: any) {
    if (err.message && err.message !== 'Failed to fetch') {
      throw err;
    }
    console.warn(`Native Cloud API ${endpoint} unreachable:`, err);
    return null;
  }
}

// Subscribe to auth state changes
export function subscribeToAuth(callback: AuthSubscriber): () => void {
  subscribers.add(callback);

  // Check backend validity of stored session on initial load
  const token = getAuthToken();
  const cachedUser = getActiveUser();

  if (token && cachedUser) {
    // Validate session with server
    cloudFetch<{ success: boolean; user: AppUser }>('/api/auth/me')
      .then((res) => {
        if (res && res.user) {
          callback(res.user);
        } else {
          setActiveUser(null, null);
          callback(null);
        }
      })
      .catch(() => {
        // If server is unreachable but we have cached session, emit cachedUser temporarily
        callback(cachedUser);
      });
  } else {
    callback(null);
  }

  return () => {
    subscribers.delete(callback);
  };
}

// Google Sign In (Direct native cloud authentication)
export async function signInGoogle(providedEmail?: string, providedName?: string): Promise<AppUser> {
  if (!providedEmail || !providedEmail.trim()) {
    throw new Error('Por favor, informe o seu e-mail do Google.');
  }

  const normalizedEmail = providedEmail.trim().toLowerCase();
  const displayName = providedName || normalizedEmail.split('@')[0] || 'Usuário Google';

  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: normalizedEmail,
      displayName,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Falha ao autenticar com e-mail Google.');
  }

  const appUser: AppUser = {
    uid: data.user.uid,
    email: data.user.email,
    displayName: data.user.displayName,
    provider: 'google',
  };

  setActiveUser(appUser, data.token);
  return appUser;
}

// Register with Email & Password
export async function registerWithEmail(
  email: string,
  password: string,
  displayName?: string
): Promise<{ user: AppUser; recoveryPin: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('Informe um endereço de e-mail válido.');
  }

  if (password.length < 6) {
    throw new Error('A senha deve conter no mínimo 6 caracteres.');
  }

  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: normalizedEmail,
      password,
      displayName: displayName?.trim() || normalizedEmail.split('@')[0],
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Falha ao realizar cadastro.');
  }

  const appUser: AppUser = {
    uid: data.user.uid,
    email: data.user.email,
    displayName: data.user.displayName,
    provider: 'email',
  };

  setActiveUser(appUser, data.token);
  return { user: appUser, recoveryPin: data.recoveryPin };
}

// Sign In with Email & Password
export async function loginWithEmail(email: string, password: string): Promise<AppUser> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    throw new Error('Por favor, informe seu e-mail.');
  }
  if (!password) {
    throw new Error('Por favor, digite sua senha.');
  }

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: normalizedEmail,
      password,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'E-mail ou senha incorretos.');
  }

  const appUser: AppUser = {
    uid: data.user.uid,
    email: data.user.email,
    displayName: data.user.displayName,
    provider: data.user.provider || 'email',
  };

  setActiveUser(appUser, data.token);
  return appUser;
}

// Password Reset Check
export async function checkAccountForReset(email: string): Promise<{
  exists: boolean;
  pinHint: string;
  displayName: string;
}> {
  const normalizedEmail = email.trim().toLowerCase();

  const res = await fetch('/api/auth/check-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: normalizedEmail }),
  });

  const data = await res.json();
  if (!res.ok || !data.exists) {
    throw new Error(data.error || 'Nenhuma conta cadastrada com este e-mail.');
  }

  return {
    exists: true,
    pinHint: data.pinHint,
    displayName: data.displayName,
  };
}

// Reset Password with Recovery PIN
export async function resetPasswordWithPin(
  email: string,
  recoveryPin: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  if (newPassword.length < 6) {
    throw new Error('A nova senha deve ter no mínimo 6 caracteres.');
  }

  const res = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: normalizedEmail,
      recoveryPin: recoveryPin.trim(),
      newPassword,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Falha ao redefinir a senha.');
  }

  return {
    success: true,
    message: data.message || 'Senha redefinida com sucesso!',
  };
}

// Logout
export async function logoutUser(): Promise<void> {
  try {
    await cloudFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // ignore
  } finally {
    setActiveUser(null, null);
  }
}
