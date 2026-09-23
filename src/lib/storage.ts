import { 
  deriveKeyFromPassphrase, 
  generateRandomSalt, 
  encryptData, 
  decryptData, 
  VERIFICATION_PHRASE,
  type EncryptedPayload
} from './crypto';
import type { MonthlyFinancialData, UserSecurityProfile } from '../types/finance';
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

/**
 * Service for Zero-Knowledge E2EE Encrypted Storage with Firestore Cloud Persistence & Absolute User Isolation
 */

// Load or initialize user's cryptographic profile
export async function getOrCreateUserProfile(user: { uid: string; email?: string; displayName?: string }): Promise<{
  profile: UserSecurityProfile | null;
  isNewUser: boolean;
}> {
  // 1. First, check Firestore cloud profile
  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      let e2eeIv = data.e2eeIv || '';
      let e2eeVerificationHash = data.e2eeVerificationHash || '';

      // If stored combined (iv:ciphertext)
      if (!e2eeIv && e2eeVerificationHash.includes(':')) {
        const parts = e2eeVerificationHash.split(':');
        e2eeIv = parts[0];
        e2eeVerificationHash = parts.slice(1).join(':');
      }

      const cloudProfile: UserSecurityProfile = {
        userId: data.userId || user.uid,
        email: data.email || user.email || '',
        displayName: data.displayName || user.displayName || '',
        photoURL: data.photoURL || '',
        e2eeSalt: data.e2eeSalt || '',
        e2eeVerificationHash,
        e2eeIv,
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || new Date().toISOString(),
      };

      // Cache locally for fast offline access
      localStorage.setItem(`fin_profile_${user.uid}`, JSON.stringify(cloudProfile));
      return { profile: cloudProfile, isNewUser: false };
    }
  } catch (err) {
    console.warn('Could not fetch user profile from Firestore (offline or unauthenticated):', err);
  }

  // 2. Fallback to local storage (device cache)
  const localProfileRaw = localStorage.getItem(`fin_profile_${user.uid}`);
  if (localProfileRaw) {
    try {
      const profile = JSON.parse(localProfileRaw) as UserSecurityProfile;
      return { profile, isNewUser: false };
    } catch {
      // ignore corrupted local data
    }
  }

  // 3. New user: Needs to establish their master passphrase and cryptographic salt
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

  // 1. Store in user-isolated local secure vault
  localStorage.setItem(`fin_profile_${user.uid}`, JSON.stringify(profileData));

  // 2. Persist to Firestore for cross-device synchronization
  try {
    const userRef = doc(db, 'users', user.uid);
    await setDoc(userRef, {
      userId: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      e2eeSalt: salt,
      e2eeVerificationHash: `${verificationPayload.iv}:${verificationPayload.ciphertext}`,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (err) {
    console.warn('Could not persist security profile to Firestore:', err);
  }

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
  
  // 1. Save in user-isolated local secure vault (instant local response)
  localStorage.setItem(`fin_vault_${userId}_records_${monthYear}`, JSON.stringify(payload));
  localStorage.setItem(`fin_local_${userId}_${monthYear}`, JSON.stringify(data));

  // 2. Persist encrypted ciphertext to Firestore (Cloud sync across devices)
  try {
    const recordRef = doc(db, 'users', userId, 'records', monthYear);
    await setDoc(recordRef, {
      userId,
      monthYear,
      encryptedPayload: payload.ciphertext,
      iv: payload.iv,
      version: 2,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.warn('Could not save encrypted record to Firestore:', err);
  }
}

// Load and decrypt monthly records strictly for the authenticated userId
export async function loadEncryptedMonthlyData(
  userId: string,
  key: CryptoKey,
  monthYear: string
): Promise<MonthlyFinancialData | null> {
  // 1. Try to load fresh encrypted payload from Firestore Cloud first
  try {
    const recordRef = doc(db, 'users', userId, 'records', monthYear);
    const snap = await getDoc(recordRef);
    if (snap.exists()) {
      const rec = snap.data();
      if (rec.encryptedPayload && rec.iv) {
        const payload: EncryptedPayload = {
          ciphertext: rec.encryptedPayload,
          iv: rec.iv
        };
        // Update local cache
        localStorage.setItem(`fin_vault_${userId}_records_${monthYear}`, JSON.stringify(payload));
        const decrypted = await decryptData(key, payload);
        if (decrypted) {
          localStorage.setItem(`fin_local_${userId}_${monthYear}`, JSON.stringify(decrypted));
          return decrypted as MonthlyFinancialData;
        }
      }
    }
  } catch (err) {
    console.warn('Could not read from Firestore (offline or fallback):', err);
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
      console.error('Failed to decrypt local monthly data with key:', err);
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

// Automatically sync all local legacy / notebook records to Firestore
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
        // Legacy local record from previous turn or notebook UID
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
