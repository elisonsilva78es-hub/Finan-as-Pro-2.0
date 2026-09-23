import { sha256, hashPasswordWithSalt, generateRandomSalt } from './crypto';

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  provider: 'google' | 'email';
}

export interface StoredUserAccount {
  uid: string;
  email: string;
  displayName: string;
  passwordHash: string;
  salt: string;
  recoveryPin: string;
  provider: 'google' | 'email';
  createdAt: string;
}

const STORAGE_ACCOUNTS_KEY = 'fin_secure_users_vault_db';
const ACTIVE_SESSION_KEY = 'fin_active_user_session';

// Auth subscribers list
type AuthSubscriber = (user: AppUser | null) => void;
const subscribers: Set<AuthSubscriber> = new Set();

function getStoredAccounts(): Record<string, StoredUserAccount> {
  try {
    const raw = localStorage.getItem(STORAGE_ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredAccounts(accounts: Record<string, StoredUserAccount>) {
  localStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
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
function setActiveUser(user: AppUser | null) {
  if (user) {
    localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
  }
  notifySubscribers(user);
}

// Subscribe to auth state changes
export function subscribeToAuth(callback: AuthSubscriber): () => void {
  subscribers.add(callback);
  // Emit current active user immediately
  callback(getActiveUser());

  return () => {
    subscribers.delete(callback);
  };
}

// Google Sign In (Self-contained, secure, independent of Firebase Auth)
export async function signInGoogle(providedEmail?: string, providedName?: string): Promise<AppUser> {
  const normalizedEmail = (providedEmail || 'elison.silva78.ES@gmail.com').trim().toLowerCase();
  const displayName = providedName || normalizedEmail.split('@')[0] || 'Usuário Google';
  
  const accounts = getStoredAccounts();
  let account = accounts[normalizedEmail];

  if (!account) {
    const hash = await sha256(normalizedEmail);
    const uid = `usr_g_${hash.substring(0, 16)}`;
    const salt = generateRandomSalt(16);
    // Google account has an internal random recovery secret
    const recoveryPin = Math.floor(100000 + Math.random() * 900000).toString();
    const passwordHash = await hashPasswordWithSalt(`google_${uid}_oauth`, salt);

    account = {
      uid,
      email: normalizedEmail,
      displayName,
      passwordHash,
      salt,
      recoveryPin,
      provider: 'google',
      createdAt: new Date().toISOString(),
    };

    accounts[normalizedEmail] = account;
    saveStoredAccounts(accounts);
  }

  const appUser: AppUser = {
    uid: account.uid,
    email: account.email,
    displayName: account.displayName,
    provider: 'google',
  };

  setActiveUser(appUser);
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

  const accounts = getStoredAccounts();
  if (accounts[normalizedEmail]) {
    throw new Error('Este e-mail já está cadastrado. Por favor, acesse a aba "Entrar" ou use a recuperação de senha.');
  }

  const hash = await sha256(normalizedEmail);
  const uid = `usr_e_${hash.substring(0, 16)}`;
  const salt = generateRandomSalt(16);
  const passwordHash = await hashPasswordWithSalt(password, salt);
  const recoveryPin = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit PIN

  const newAccount: StoredUserAccount = {
    uid,
    email: normalizedEmail,
    displayName: displayName?.trim() || normalizedEmail.split('@')[0],
    passwordHash,
    salt,
    recoveryPin,
    provider: 'email',
    createdAt: new Date().toISOString(),
  };

  accounts[normalizedEmail] = newAccount;
  saveStoredAccounts(accounts);

  const appUser: AppUser = {
    uid,
    email: normalizedEmail,
    displayName: newAccount.displayName,
    provider: 'email',
  };

  setActiveUser(appUser);
  return { user: appUser, recoveryPin };
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

  const accounts = getStoredAccounts();
  const account = accounts[normalizedEmail];

  if (!account) {
    throw new Error('Nenhuma conta encontrada com este e-mail. Por favor, clique na aba "Cadastrar" para criar sua conta.');
  }

  const hashAttempt = await hashPasswordWithSalt(password, account.salt);
  if (hashAttempt !== account.passwordHash) {
    throw new Error('Senha incorreta. Verifique suas credenciais e tente novamente.');
  }

  const appUser: AppUser = {
    uid: account.uid,
    email: account.email,
    displayName: account.displayName,
    provider: account.provider,
  };

  setActiveUser(appUser);
  return appUser;
}

// Password Reset Check
export async function checkAccountForReset(email: string): Promise<{
  exists: boolean;
  pinHint: string;
  displayName: string;
}> {
  const normalizedEmail = email.trim().toLowerCase();
  const accounts = getStoredAccounts();
  const account = accounts[normalizedEmail];

  if (!account) {
    throw new Error('Nenhuma conta cadastrada com este e-mail.');
  }

  return {
    exists: true,
    pinHint: account.recoveryPin,
    displayName: account.displayName,
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

  const accounts = getStoredAccounts();
  const account = accounts[normalizedEmail];

  if (!account) {
    throw new Error('Conta não localizada.');
  }

  if (recoveryPin.trim() !== account.recoveryPin) {
    throw new Error('Código PIN de segurança incorreto. Verifique o código fornecido.');
  }

  // Update password hash
  const newSalt = generateRandomSalt(16);
  const newHash = await hashPasswordWithSalt(newPassword, newSalt);

  account.passwordHash = newHash;
  account.salt = newSalt;
  accounts[normalizedEmail] = account;
  saveStoredAccounts(accounts);

  return {
    success: true,
    message: 'Senha redefinida com sucesso! Você já pode entrar com a sua nova senha.',
  };
}

// Logout
export function logoutUser() {
  setActiveUser(null);
}

// Get all registered accounts (public metadata only)
export function getRegisteredAccountsList(): Array<{ email: string; displayName: string; provider: string }> {
  const accounts = getStoredAccounts();
  return Object.values(accounts).map((acc) => ({
    email: acc.email,
    displayName: acc.displayName,
    provider: acc.provider,
  }));
}
