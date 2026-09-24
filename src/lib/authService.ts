import { extractErrorMessage } from './errorHandler';

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

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Universal safe API fetch:
 * - Guarantees headers and Content-Type inspection
 * - Never blindly executes res.json() on HTML or raw text
 * - Eliminates "Unexpected token 'T', The page..." JSON syntax errors
 * - Eliminates "[object Object]" by extracting verified human-friendly strings
 * - Handles 401, 403, 404, 429, 500 cleanly
 */
export async function safeApiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const token = getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(endpoint, {
      ...options,
      headers,
    });

    const contentType = res.headers.get('content-type') || '';
    let parsed: any = null;

    if (contentType.includes('application/json')) {
      try {
        parsed = await res.json();
      } catch (jsonErr) {
        console.warn(`JSON parse error on ${endpoint}:`, jsonErr);
      }
    } else {
      // Non-JSON response (HTML, proxy 502/503 page, or text)
      const rawText = await res.text().catch(() => '');
      console.warn(`Non-JSON response from ${endpoint} (Status ${res.status}):`, rawText.substring(0, 100));
    }

    if (!res.ok) {
      if (res.status === 401) {
        // If unauthorized on protected routes, clear stale session
        if (!endpoint.includes('/login') && !endpoint.includes('/register') && !endpoint.includes('/google')) {
          setActiveUser(null, null);
        }
      }

      const defaultFallback =
        res.status === 404
          ? 'Serviço de autenticação temporariamente indisponível (404).'
          : res.status === 429
          ? 'Muitas tentativas sem sucesso. Aguarde 5 minutos antes de tentar novamente.'
          : res.status >= 500
          ? 'Servidor temporariamente indisponível. Tente novamente em instantes.'
          : `Erro na requisição (${res.status}).`;

      const errorMessage = extractErrorMessage(parsed, defaultFallback);
      return { success: false, error: errorMessage };
    }

    if (!parsed) {
      return {
        success: false,
        error: 'O servidor não retornou dados no formato esperado. Tente novamente.',
      };
    }

    if (parsed.success === false) {
      return {
        success: false,
        error: extractErrorMessage(parsed, 'Falha ao processar solicitação.'),
      };
    }

    return {
      success: true,
      data: parsed as T,
      message: typeof parsed.message === 'string' ? parsed.message : undefined,
    };
  } catch (err: any) {
    console.error(`Fetch failure on ${endpoint}:`, err);
    return {
      success: false,
      error: extractErrorMessage(err, 'Não foi possível conectar ao servidor. Verifique sua conexão com a internet.'),
    };
  }
}

// Helper for native Cloud API calls with automatic Bearer Token header
export async function cloudFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T | null> {
  const result = await safeApiCall<T>(endpoint, options);
  if (!result.success) {
    if (result.error && !endpoint.includes('/me')) {
      console.warn(`API call failed for ${endpoint}:`, result.error);
    }
    return null;
  }
  return result.data ?? null;
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

export interface GoogleAuthOptions {
  credential?: string;
  email?: string;
  displayName?: string;
}

// Google Sign In & Registration (Official Google Identity & Cloud Architecture)
export async function signInGoogle(options: GoogleAuthOptions | string, providedName?: string): Promise<AppUser> {
  let credential = '';
  let email = '';
  let displayName = providedName || '';

  if (typeof options === 'string') {
    email = options;
  } else if (options && typeof options === 'object') {
    credential = options.credential || '';
    email = options.email || '';
    displayName = options.displayName || displayName;
  }

  if (!credential && (!email || !email.trim())) {
    throw new Error('Por favor, informe a conta Google para autenticação.');
  }

  const payload: any = {};
  if (credential) {
    payload.credential = credential;
  }
  if (email) {
    payload.email = email.trim().toLowerCase();
    payload.displayName = displayName || payload.email.split('@')[0];
  }

  const res = await safeApiCall<{
    success: boolean;
    token: string;
    expiresAt: number;
    user: { uid: string; email: string; displayName: string; photoURL?: string; provider: 'google' };
  }>('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.success || !res.data) {
    throw new Error(extractErrorMessage(res.error, 'Falha ao autenticar com a conta Google.'));
  }

  const appUser: AppUser = {
    uid: res.data.user.uid,
    email: res.data.user.email,
    displayName: res.data.user.displayName,
    photoURL: res.data.user.photoURL,
    provider: 'google',
  };

  setActiveUser(appUser, res.data.token);
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

  const res = await safeApiCall<{
    success: boolean;
    token: string;
    recoveryPin: string;
    user: { uid: string; email: string; displayName: string; provider: 'email' };
  }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: normalizedEmail,
      password,
      displayName: displayName?.trim() || normalizedEmail.split('@')[0],
    }),
  });

  if (!res.success || !res.data) {
    throw new Error(extractErrorMessage(res.error, 'Falha ao realizar cadastro. Verifique os dados.'));
  }

  const appUser: AppUser = {
    uid: res.data.user.uid,
    email: res.data.user.email,
    displayName: res.data.user.displayName,
    provider: 'email',
  };

  setActiveUser(appUser, res.data.token);
  return { user: appUser, recoveryPin: res.data.recoveryPin };
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

  const res = await safeApiCall<{
    success: boolean;
    token: string;
    user: { uid: string; email: string; displayName: string; provider: 'email' | 'google' };
  }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: normalizedEmail,
      password,
    }),
  });

  if (!res.success || !res.data) {
    throw new Error(extractErrorMessage(res.error, 'E-mail ou senha incorretos.'));
  }

  const appUser: AppUser = {
    uid: res.data.user.uid,
    email: res.data.user.email,
    displayName: res.data.user.displayName,
    provider: (res.data.user.provider as 'google' | 'email') || 'email',
  };

  setActiveUser(appUser, res.data.token);
  return appUser;
}

// Password Reset Check
export async function checkAccountForReset(email: string): Promise<{
  exists: boolean;
  pinHint: string;
  displayName: string;
}> {
  const normalizedEmail = email.trim().toLowerCase();

  const res = await safeApiCall<{
    exists: boolean;
    pinHint: string;
    displayName: string;
  }>('/api/auth/check-account', {
    method: 'POST',
    body: JSON.stringify({ email: normalizedEmail }),
  });

  if (!res.success || !res.data) {
    throw new Error(extractErrorMessage(res.error, 'Nenhuma conta cadastrada com este e-mail.'));
  }

  return {
    exists: true,
    pinHint: res.data.pinHint,
    displayName: res.data.displayName,
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

  const res = await safeApiCall<{
    success: boolean;
    message: string;
  }>('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({
      email: normalizedEmail,
      recoveryPin: recoveryPin.trim(),
      newPassword,
    }),
  });

  if (!res.success || !res.data) {
    throw new Error(extractErrorMessage(res.error, 'Falha ao redefinir a senha. Verifique o código PIN.'));
  }

  return {
    success: true,
    message: res.data.message || 'Senha redefinida com sucesso!',
  };
}

// Logout
export async function logoutUser(): Promise<void> {
  try {
    await safeApiCall('/api/auth/logout', { method: 'POST' });
  } catch {
    // ignore
  } finally {
    setActiveUser(null, null);
  }
}
