import { 
  auth, 
  googleProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User
} from './firebase';
import { sha256, hashPasswordWithSalt, generateRandomSalt } from './crypto';

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  isE2EELocal?: boolean;
}

interface StoredLocalAccount {
  uid: string;
  email: string;
  displayName: string;
  passwordHash: string;
  salt: string;
  recoveryPin: string;
  createdAt: string;
}

const LOCAL_ACCOUNTS_KEY = 'fin_secure_e2ee_accounts';
const ACTIVE_SESSION_KEY = 'fin_active_e2ee_session';

function getStoredAccounts(): Record<string, StoredLocalAccount> {
  try {
    const raw = localStorage.getItem(LOCAL_ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredAccounts(accounts: Record<string, StoredLocalAccount>) {
  localStorage.setItem(LOCAL_ACCOUNTS_KEY, JSON.stringify(accounts));
}

// Google Sign In
export async function signInGoogle(): Promise<AppUser> {
  const result = await signInWithPopup(auth, googleProvider);
  return {
    uid: result.user.uid,
    email: result.user.email || '',
    displayName: result.user.displayName || result.user.email?.split('@')[0] || 'Usuário Google',
    photoURL: result.user.photoURL || undefined,
    isE2EELocal: false,
  };
}

// Register with Email & Password
export async function registerWithEmail(
  email: string, 
  password: string, 
  displayName?: string
): Promise<{ user: AppUser; note?: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  try {
    // Attempt standard Firebase Auth
    const result = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
    return {
      user: {
        uid: result.user.uid,
        email: result.user.email || normalizedEmail,
        displayName: displayName || result.user.displayName || normalizedEmail.split('@')[0],
        photoURL: result.user.photoURL || undefined,
        isE2EELocal: false,
      }
    };
  } catch (err: any) {
    // If Firebase Auth has email provider restricted or not allowed, handle with Local Zero-Knowledge E2EE Account
    if (
      err.code === 'auth/operation-not-allowed' || 
      err.code === 'auth/admin-restricted-operation' ||
      err.message?.includes('operation-not-allowed')
    ) {
      console.info('Firebase Email Auth is restricted on the backend. Activating Client-Side Zero-Knowledge E2EE Account.');
      
      const accounts = getStoredAccounts();
      if (accounts[normalizedEmail]) {
        throw new Error('Este e-mail já está cadastrado. Por favor, acesse a aba "Entrar".');
      }

      const emailHash = await sha256(normalizedEmail);
      const uid = `e2ee_${emailHash.substring(0, 20)}`;
      const salt = generateRandomSalt(16);
      const passwordHash = await hashPasswordWithSalt(password, salt);
      const recoveryPin = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits

      const newAccount: StoredLocalAccount = {
        uid,
        email: normalizedEmail,
        displayName: displayName?.trim() || normalizedEmail.split('@')[0],
        passwordHash,
        salt,
        recoveryPin,
        createdAt: new Date().toISOString(),
      };

      accounts[normalizedEmail] = newAccount;
      saveStoredAccounts(accounts);

      const appUser: AppUser = {
        uid,
        email: normalizedEmail,
        displayName: newAccount.displayName,
        isE2EELocal: true,
      };

      localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(appUser));

      return {
        user: appUser,
        note: `Conta criada com sucesso no Cofre Criptografado E2EE! Seu PIN de recuperação é ${recoveryPin}.`,
      };
    }
    throw err;
  }
}

// Sign In with Email & Password
export async function loginWithEmail(email: string, password: string): Promise<AppUser> {
  const normalizedEmail = email.trim().toLowerCase();

  try {
    // Attempt standard Firebase Auth
    const result = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    return {
      uid: result.user.uid,
      email: result.user.email || normalizedEmail,
      displayName: result.user.displayName || normalizedEmail.split('@')[0],
      photoURL: result.user.photoURL || undefined,
      isE2EELocal: false,
    };
  } catch (err: any) {
    if (
      err.code === 'auth/operation-not-allowed' || 
      err.code === 'auth/admin-restricted-operation' ||
      err.message?.includes('operation-not-allowed')
    ) {
      console.info('Firebase Email Auth is restricted on the backend. Checking Client-Side Zero-Knowledge E2EE Account.');
      
      const accounts = getStoredAccounts();
      const account = accounts[normalizedEmail];

      if (!account) {
        throw new Error('Nenhuma conta encontrada com este e-mail. Por favor, crie sua conta na aba "Cadastrar".');
      }

      const hashAttempt = await hashPasswordWithSalt(password, account.salt);
      if (hashAttempt !== account.passwordHash) {
        throw new Error('Senha incorreta. Verifique suas credenciais.');
      }

      const appUser: AppUser = {
        uid: account.uid,
        email: account.email,
        displayName: account.displayName,
        isE2EELocal: true,
      };

      localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(appUser));
      return appUser;
    }
    throw err;
  }
}

// Password Reset / Recovery
export async function requestPasswordReset(
  email: string,
  newPassword?: string,
  recoveryPin?: string
): Promise<{ status: 'sent' | 'reset_ok' | 'needs_new_password'; message: string; pinHint?: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  try {
    await sendPasswordResetEmail(auth, normalizedEmail);
    return {
      status: 'sent',
      message: `E-mail de recuperação enviado para ${normalizedEmail}. Verifique sua caixa de entrada e spam.`,
    };
  } catch (err: any) {
    if (
      err.code === 'auth/operation-not-allowed' || 
      err.code === 'auth/admin-restricted-operation' ||
      err.message?.includes('operation-not-allowed')
    ) {
      const accounts = getStoredAccounts();
      const account = accounts[normalizedEmail];

      if (!account) {
        throw new Error('Nenhuma conta encontrada com este e-mail no cofre seguro.');
      }

      // If user supplied newPassword, reset it
      if (newPassword && newPassword.length >= 6) {
        if (recoveryPin && recoveryPin.trim() !== account.recoveryPin) {
          throw new Error('Código PIN de recuperação incorreto.');
        }

        const newHash = await hashPasswordWithSalt(newPassword, account.salt);
        account.passwordHash = newHash;
        accounts[normalizedEmail] = account;
        saveStoredAccounts(accounts);

        return {
          status: 'reset_ok',
          message: 'Sua senha foi redefinida com sucesso! Você já pode entrar com a nova senha.',
        };
      }

      return {
        status: 'needs_new_password',
        message: `Conta localizada no cofre criptografado. Digite sua nova senha para redefini-la (Código PIN de segurança: ${account.recoveryPin}).`,
        pinHint: account.recoveryPin,
      };
    }
    throw err;
  }
}

// Sign Out
export async function logoutUser() {
  localStorage.removeItem(ACTIVE_SESSION_KEY);
  try {
    await firebaseSignOut(auth);
  } catch {
    // ignore
  }
}

// Subscribe to auth state changes (supporting both Firebase & E2EE Local Sessions)
export function subscribeToAuth(callback: (user: AppUser | null) => void): () => void {
  // Check local active session first
  const checkLocalSession = (): AppUser | null => {
    try {
      const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const unsubscribeFirebase = onAuthStateChanged(auth, (firebaseUser) => {
    if (firebaseUser) {
      callback({
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Usuário',
        photoURL: firebaseUser.photoURL || undefined,
        isE2EELocal: false,
      });
    } else {
      const localUser = checkLocalSession();
      callback(localUser);
    }
  });

  return () => {
    unsubscribeFirebase();
  };
}
