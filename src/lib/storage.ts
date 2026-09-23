import { 
  deriveKeyFromPassphrase, 
  generateRandomSalt, 
  encryptData, 
  decryptData, 
  VERIFICATION_PHRASE,
  type EncryptedPayload
} from './crypto';
import type { MonthlyFinancialData, UserSecurityProfile } from '../types/finance';

/**
 * Service for Zero-Knowledge E2EE Encrypted Storage with Absolute User Isolation
 */

// Load or initialize user's cryptographic profile
export async function getOrCreateUserProfile(user: { uid: string; email?: string; displayName?: string }): Promise<{
  profile: UserSecurityProfile | null;
  isNewUser: boolean;
}> {
  const localProfileRaw = localStorage.getItem(`fin_profile_${user.uid}`);
  if (localProfileRaw) {
    try {
      const profile = JSON.parse(localProfileRaw) as UserSecurityProfile;
      return { profile, isNewUser: false };
    } catch {
      // ignore corrupted data
    }
  }

  // New user: Needs to establish their master passphrase and cryptographic salt
  return { profile: null, isNewUser: true };
}

// Initialize user security profile with salt and encrypted verification challenge
export async function initializeUserSecurity(
  user: { uid: string; email?: string; displayName?: string; photoURL?: string }, 
  passphrase: string
): Promise<{ key: CryptoKey; salt: string }> {
  const salt = generateRandomSalt(16);
  const key = await deriveKeyFromPassphrase(passphrase, salt);

  // Encrypt verification challenge with the user's master key
  const verificationPayload = await encryptData(key, { check: VERIFICATION_PHRASE });

  const profileData: UserSecurityProfile = {
    userId: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
    photoURL: user.photoURL || '',
    e2eeSalt: salt,
    e2eeVerificationHash: verificationPayload.ciphertext,
    e2eeIv: verificationPayload.iv,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Store in user-isolated security storage
  localStorage.setItem(`fin_profile_${user.uid}`, JSON.stringify(profileData));

  return { key, salt };
}

// Unlock existing user's vault by verifying master passphrase
export async function unlockUserVault(
  _user: { uid: string },
  profile: UserSecurityProfile,
  passphrase: string
): Promise<CryptoKey | null> {
  try {
    const key = await deriveKeyFromPassphrase(passphrase, profile.e2eeSalt);
    
    // Verify by decrypting verification challenge
    const decrypted = await decryptData(key, {
      ciphertext: profile.e2eeVerificationHash,
      iv: profile.e2eeIv,
    });

    if (decrypted && decrypted.check === VERIFICATION_PHRASE) {
      return key;
    }
    return null;
  } catch (err) {
    console.error('Failed to unlock vault:', err);
    return null;
  }
}

// Save encrypted monthly records (AES-GCM-256) strictly isolated by userId
export async function saveEncryptedMonthlyData(
  userId: string,
  key: CryptoKey,
  monthYear: string,
  data: MonthlyFinancialData
): Promise<void> {
  // Encrypt with client master key (Zero-Knowledge)
  const payload = await encryptData(key, data);
  
  // Save in user-isolated local secure vault
  localStorage.setItem(`fin_vault_${userId}_records_${monthYear}`, JSON.stringify(payload));
}

// Load and decrypt monthly records strictly for the authenticated userId
export async function loadEncryptedMonthlyData(
  userId: string,
  key: CryptoKey,
  monthYear: string
): Promise<MonthlyFinancialData | null> {
  const raw = localStorage.getItem(`fin_vault_${userId}_records_${monthYear}`);
  if (!raw) {
    return null;
  }

  try {
    const payload = JSON.parse(raw) as EncryptedPayload;
    const decrypted = await decryptData(key, payload);
    return decrypted as MonthlyFinancialData;
  } catch (err) {
    console.error('Failed to decrypt monthly data with key:', err);
    return null;
  }
}
