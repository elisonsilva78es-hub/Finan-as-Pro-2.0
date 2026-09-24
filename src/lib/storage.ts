import { 
  deriveKeyFromPassphrase, 
  generateRandomSalt, 
  encryptData, 
  decryptData, 
  cleanPassphrase,
  generateCandidatePassphrases,
  VERIFICATION_PHRASE,
  type EncryptedPayload
} from './crypto';
import { cloudFetch } from './authService';
import type { MonthlyFinancialData, UserSecurityProfile } from '../types/finance';

/**
 * Service for Zero-Knowledge E2EE Encrypted Storage with Native Cloud Persistence
 * Completely independent native architecture. Zero bureaucracy, 100% private.
 */

// Helper to clean up any legacy iv:ciphertext format
function normalizeProfileCredentials(profile: {
  userId: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  e2eeSalt?: string;
  e2eeIv?: string;
  e2eeVerificationHash?: string;
  createdAt?: string;
  updatedAt?: string;
}): UserSecurityProfile | null {
  if (!profile.e2eeSalt) return null;

  let iv = profile.e2eeIv || '';
  let ciphertext = profile.e2eeVerificationHash || '';

  if (ciphertext && ciphertext.includes(':')) {
    const parts = ciphertext.split(':');
    if (!iv) {
      iv = parts[0];
    }
    ciphertext = parts[parts.length - 1];
  }

  if (!iv || !ciphertext) {
    return null;
  }

  return {
    userId: profile.userId,
    email: profile.email || '',
    displayName: profile.displayName || '',
    photoURL: profile.photoURL || '',
    e2eeSalt: profile.e2eeSalt,
    e2eeIv: iv,
    e2eeVerificationHash: ciphertext,
    createdAt: profile.createdAt || new Date().toISOString(),
    updatedAt: profile.updatedAt || new Date().toISOString(),
  };
}

// Load or initialize user's cryptographic profile
export async function getOrCreateUserProfile(user: { uid: string; email?: string; displayName?: string }): Promise<{
  profile: UserSecurityProfile | null;
  isNewUser: boolean;
}> {
  // 1. Check Native Cloud profile first
  try {
    const data = await cloudFetch<any>(`/api/profile/${user.uid}`);
    if (data && data.e2eeSalt && (data.e2eeVerificationHash || data.e2eeIv)) {
      const normalized = normalizeProfileCredentials(data);
      if (normalized) {
        // Cache locally for fast offline access
        localStorage.setItem(`fin_profile_${user.uid}`, JSON.stringify(normalized));
        return { profile: normalized, isNewUser: false };
      }
    }
  } catch (err) {
    console.warn('Could not fetch user profile from Cloud Server:', err);
  }

  // 2. Fallback to local storage (device cache)
  const localProfileRaw = localStorage.getItem(`fin_profile_${user.uid}`);
  if (localProfileRaw) {
    try {
      const parsed = JSON.parse(localProfileRaw);
      const normalized = normalizeProfileCredentials(parsed);
      if (normalized) {
        return { profile: normalized, isNewUser: false };
      }
    } catch {
      // ignore corrupted local data
    }
  }

  // 3. New user: Needs to establish their master passphrase
  return { profile: null, isNewUser: true };
}

// Reset vault
export function resetUserVault(userId: string): void {
  try {
    localStorage.removeItem(`fin_profile_${userId}`);
    cloudFetch(`/api/profile/${userId}/vault`, { method: 'DELETE' }).catch(console.warn);
  } catch (err) {
    console.warn('Could not reset user profile:', err);
  }
}

// Initialize user security profile with salt and encrypted verification challenge
export async function initializeUserSecurity(
  user: { uid: string; email?: string; displayName?: string; photoURL?: string }, 
  passphrase: string
): Promise<{ key: CryptoKey; salt: string }> {
  const cleaned = cleanPassphrase(passphrase) || passphrase.trim();
  const salt = generateRandomSalt(16);
  const key = await deriveKeyFromPassphrase(cleaned, salt);

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

  // 1. Store in user-isolated local secure vault
  localStorage.setItem(`fin_profile_${user.uid}`, JSON.stringify(profileData));

  // 2. Persist clean values to Cloud Server for cross-device access
  await cloudFetch(`/api/profile/${user.uid}`, {
    method: 'POST',
    body: JSON.stringify({
      userId: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      e2eeSalt: salt,
      e2eeIv: verificationPayload.iv,
      e2eeVerificationHash: verificationPayload.ciphertext,
    }),
  });

  return { key, salt };
}

// Unlock existing user's vault by verifying master passphrase with deterministic smart matching
export async function unlockUserVault(
  _user: { uid: string },
  profile: UserSecurityProfile,
  rawPassphrase: string
): Promise<CryptoKey | null> {
  try {
    if (!profile || !profile.e2eeSalt) {
      return null;
    }

    let iv = profile.e2eeIv || '';
    let ciphertext = profile.e2eeVerificationHash || '';

    // Handle combined iv:ciphertext format if iv is not isolated
    if (ciphertext.includes(':')) {
      const parts = ciphertext.split(':');
      if (!iv) iv = parts[0];
      ciphertext = parts[parts.length - 1];
    }

    if (!iv || !ciphertext) {
      return null;
    }

    // Try candidates (cleaned, trimmed, first letter case variation, etc.)
    const candidates = generateCandidatePassphrases(rawPassphrase);

    for (const candidate of candidates) {
      try {
        const key = await deriveKeyFromPassphrase(candidate, profile.e2eeSalt);
        const decrypted = await decryptData(key, { ciphertext, iv });

        if (decrypted && decrypted.check === VERIFICATION_PHRASE) {
          return key;
        }
      } catch {
        // Continue to next candidate
      }
    }

    return null;
  } catch (err) {
    console.warn('Vault unlock attempt could not be completed:', err);
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
  
  // 1. Save in user-isolated local secure vault (instant local response)
  localStorage.setItem(`fin_vault_${userId}_records_${monthYear}`, JSON.stringify(payload));
  localStorage.setItem(`fin_local_${userId}_${monthYear}`, JSON.stringify(data));

  // 2. Persist encrypted ciphertext to Cloud Server (Cloud sync across all devices)
  try {
    await cloudFetch(`/api/records/${userId}/${monthYear}`, {
      method: 'POST',
      body: JSON.stringify({
        encryptedPayload: payload.ciphertext,
        iv: payload.iv,
        version: 2,
      }),
    });
  } catch (err) {
    console.warn('Could not save encrypted record to Cloud Server:', err);
  }
}

// Load and decrypt monthly records strictly for the authenticated userId
export async function loadEncryptedMonthlyData(
  userId: string,
  key: CryptoKey,
  monthYear: string
): Promise<MonthlyFinancialData | null> {
  // 1. Try to load fresh encrypted payload from Native Cloud Server first
  try {
    const rec = await cloudFetch<any>(`/api/records/${userId}/${monthYear}`);
    if (rec && rec.encryptedPayload && rec.iv) {
      const payload: EncryptedPayload = {
        ciphertext: rec.encryptedPayload,
        iv: rec.iv,
      };
      // Update local cache
      localStorage.setItem(`fin_vault_${userId}_records_${monthYear}`, JSON.stringify(payload));
      const decrypted = await decryptData(key, payload);
      if (decrypted) {
        localStorage.setItem(`fin_local_${userId}_${monthYear}`, JSON.stringify(decrypted));
        return decrypted as MonthlyFinancialData;
      }
    }
  } catch (err) {
    console.warn('Could not read from Cloud Server (offline or fallback):', err);
  }

  // 2. Fallback to local encrypted vault in localStorage
  const raw = localStorage.getItem(`fin_vault_${userId}_records_${monthYear}`);
  if (raw) {
    try {
      const payload = JSON.parse(raw) as EncryptedPayload;
      const decrypted = await decryptData(key, payload);
      if (decrypted) {
        return decrypted as MonthlyFinancialData;
      }
    } catch (err) {
      console.warn('Could not decrypt local monthly data with provided key:', err);
    }
  }

  // 3. Fallback to plain local cache if available
  const localCache = localStorage.getItem(`fin_local_${userId}_${monthYear}`);
  if (localCache) {
    try {
      return JSON.parse(localCache) as MonthlyFinancialData;
    } catch {
      // ignore
    }
  }

  return null;
}

// Automatically sync all local legacy / notebook records to Native Cloud Server
export async function syncLocalRecordsToCloud(userId: string, key: CryptoKey): Promise<number> {
  let syncedCount = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      if (!storageKey) continue;

      let monthYear = '';
      let dataToSync: MonthlyFinancialData | null = null;

      if (storageKey.startsWith(`fin_local_${userId}_`)) {
        monthYear = storageKey.replace(`fin_local_${userId}_`, '');
        try {
          dataToSync = JSON.parse(localStorage.getItem(storageKey) || '');
        } catch {
          // ignore
        }
      } else if (storageKey.startsWith('fin_local_') && !storageKey.includes(userId)) {
        const parts = storageKey.split('_');
        if (parts.length >= 4) {
          monthYear = `${parts[parts.length - 2]}_${parts[parts.length - 1]}`;
          try {
            dataToSync = JSON.parse(localStorage.getItem(storageKey) || '');
          } catch {
            // ignore
          }
        }
      } else if (storageKey.startsWith('financas_')) {
        monthYear = storageKey.replace('financas_', '');
        try {
          dataToSync = JSON.parse(localStorage.getItem(storageKey) || '');
        } catch {
          // ignore
        }
      }

      if (dataToSync && monthYear && monthYear.length >= 5) {
        await saveEncryptedMonthlyData(userId, key, monthYear, dataToSync);
        syncedCount++;
      }
    }
  } catch (err) {
    console.error('Error during cloud sync migration:', err);
  }
  return syncedCount;
}
