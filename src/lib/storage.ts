import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  addDoc 
} from 'firebase/firestore';
import { db } from './firebase';
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
 * Service for Firestore and Local Encrypted Storage with Zero-Knowledge E2EE
 */

// Load or initialize user's cryptographic profile
export async function getOrCreateUserProfile(user: any): Promise<{
  profile: UserSecurityProfile | null;
  isNewUser: boolean;
}> {
  // Check local profile store first for instant zero-latency access
  const localProfileRaw = localStorage.getItem(`fin_profile_${user.uid}`);
  if (localProfileRaw) {
    try {
      const profile = JSON.parse(localProfileRaw) as UserSecurityProfile;
      return { profile, isNewUser: false };
    } catch {
      // ignore
    }
  }

  // If user is from Firebase Auth (Google Auth), check Firestore
  if (!user.isE2EELocal && !user.uid.startsWith('e2ee_')) {
    try {
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);

      if (snap.exists()) {
        const data = snap.data() as UserSecurityProfile;
        localStorage.setItem(`fin_profile_${user.uid}`, JSON.stringify(data));
        return { profile: data, isNewUser: false };
      }
    } catch (err) {
      console.warn('Could not reach Firestore for user profile, checking local fallback:', err);
    }
  }

  // New user: Needs to set up their passphrase and salt
  return { profile: null, isNewUser: true };
}

// Initialize user security profile with salt and encrypted verification challenge
export async function initializeUserSecurity(
  user: any, 
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

  // Always store in user-isolated local security store
  localStorage.setItem(`fin_profile_${user.uid}`, JSON.stringify(profileData));

  // Sync to Firestore if user has a cloud auth session
  if (!user.isE2EELocal && !user.uid.startsWith('e2ee_')) {
    try {
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, profileData);
      await logSecurityEvent(user.uid, 'KEY_UNLOCKED');
    } catch (err) {
      console.warn('Firestore profile write skipped or restricted:', err);
    }
  }

  return { key, salt };
}

// Unlock existing user's vault by verifying passphrase
export async function unlockUserVault(
  user: any,
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
      if (!user.isE2EELocal && !user.uid.startsWith('e2ee_')) {
        await logSecurityEvent(user.uid, 'KEY_UNLOCKED');
      }
      return key;
    }
    return null;
  } catch (err) {
    console.error('Failed to unlock vault:', err);
    return null;
  }
}

// Save encrypted monthly records to Storage & Firestore
export async function saveEncryptedMonthlyData(
  userId: string,
  key: CryptoKey,
  monthYear: string,
  data: MonthlyFinancialData
): Promise<void> {
  // Encrypt with client master key (Zero-Knowledge)
  const payload = await encryptData(key, data);
  
  // 1. Always save in user-isolated local secure vault
  localStorage.setItem(`fin_vault_${userId}_records_${monthYear}`, JSON.stringify(payload));

  // 2. If user is authenticated in cloud (e.g. Google), replicate ciphertext to Firestore
  if (!userId.startsWith('e2ee_')) {
    try {
      const recordRef = doc(db, 'users', userId, 'records', monthYear);
      await setDoc(recordRef, {
        userId,
        monthYear,
        encryptedPayload: payload.ciphertext,
        iv: payload.iv,
        version: 2,
        summary: {
          itemsCount: data.rendas.length + data.despesas.length + data.economias.length,
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('Firestore cloud sync skipped or restricted (data remains encrypted in local vault):', err);
    }
  }
}

// Load and decrypt monthly records
export async function loadEncryptedMonthlyData(
  userId: string,
  key: CryptoKey,
  monthYear: string
): Promise<MonthlyFinancialData | null> {
  let payload: EncryptedPayload | null = null;

  // 1. Try cloud Firestore if cloud user
  if (!userId.startsWith('e2ee_')) {
    try {
      const recordRef = doc(db, 'users', userId, 'records', monthYear);
      const snap = await getDoc(recordRef);

      if (snap.exists()) {
        const record = snap.data();
        if (record.encryptedPayload && record.iv) {
          payload = {
            ciphertext: record.encryptedPayload,
            iv: record.iv,
          };
        }
      }
    } catch (err) {
      console.warn('Firestore read error, falling back to local vault:', err);
    }
  }

  // 2. Check local encrypted vault if not found in Firestore
  if (!payload) {
    const raw = localStorage.getItem(`fin_vault_${userId}_records_${monthYear}`);
    if (raw) {
      try {
        payload = JSON.parse(raw) as EncryptedPayload;
      } catch {
        // ignore
      }
    }
  }

  if (!payload) {
    return null;
  }

  try {
    const decrypted = await decryptData(key, payload);
    return decrypted as MonthlyFinancialData;
  } catch (err) {
    console.error('Failed to decrypt monthly data with key:', err);
    return null;
  }
}

// Private audit logger
export async function logSecurityEvent(userId: string, eventType: string): Promise<void> {
  if (userId.startsWith('e2ee_')) return;
  try {
    const auditRef = collection(db, 'users', userId, 'auditLogs');
    await addDoc(auditRef, {
      userId,
      eventType,
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.substring(0, 200) : 'unknown',
    });
  } catch {
    // Audit logs non-critical
  }
}
