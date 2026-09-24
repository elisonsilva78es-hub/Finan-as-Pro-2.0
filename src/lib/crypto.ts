/**
 * End-to-End Encryption (E2EE) Module
 * Implements Web Crypto API standards:
 * - PBKDF2 with SHA-256 and 100,000 iterations for key derivation
 * - AES-GCM 256-bit with random 96-bit (12-byte) IV for symmetric encryption
 * - Base64 marshaling for reliable cloud storage & WhatsApp transfer
 * - Zero-knowledge cloud storage: The encryption key never leaves the client device
 */

// Helper to convert ArrayBuffer to Base64 string
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Helper to convert Base64 string to Uint8Array safely with padding & cleanups
export function base64ToBuffer(base64: string): Uint8Array {
  if (!base64 || typeof base64 !== 'string') {
    throw new Error('Base64 string vazia ou inválida');
  }

  // Remove any colons, spaces, newlines, zero-width characters
  let clean = base64.trim().replace(/[^A-Za-z0-9+/=_-]/g, '').replace(/-/g, '+').replace(/_/g, '/');

  // Ensure correct Base64 padding
  while (clean.length % 4 !== 0) {
    clean += '=';
  }

  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Clean passphrase from mobile artifacts (zero-width spaces, soft hyphens, non-breaking spaces)
export function cleanPassphrase(input: string): string {
  if (!input || typeof input !== 'string') return '';
  return input
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ') // convert zero-width & non-breaking spaces
    .trim();
}

// Generate smart variations to handle mobile auto-capitalization and trailing spaces
export function generateCandidatePassphrases(rawInput: string): string[] {
  const candidates: string[] = [];
  const cleaned = cleanPassphrase(rawInput);

  if (cleaned) {
    candidates.push(cleaned);
  }

  if (rawInput && rawInput !== cleaned) {
    candidates.push(rawInput);
  }

  // Invert case of first character (mobile keyboards often auto-capitalize the first letter)
  if (cleaned.length > 0) {
    const firstChar = cleaned[0];
    const invertedFirst =
      firstChar === firstChar.toUpperCase()
        ? firstChar.toLowerCase() + cleaned.slice(1)
        : firstChar.toUpperCase() + cleaned.slice(1);

    if (!candidates.includes(invertedFirst)) {
      candidates.push(invertedFirst);
    }

    const lower = cleaned.toLowerCase();
    if (!candidates.includes(lower)) {
      candidates.push(lower);
    }
  }

  return candidates;
}

// Generate random cryptographic salt
export function generateRandomSalt(length = 16): string {
  const salt = crypto.getRandomValues(new Uint8Array(length));
  return bufferToBase64(salt.buffer);
}

// Derive AES-GCM 256 key from user passphrase and salt using PBKDF2
export async function deriveKeyFromPassphrase(passphrase: string, saltBase64: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passphraseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const saltBuffer = base64ToBuffer(saltBase64);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer as unknown as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    passphraseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedPayload {
  ciphertext: string; // Base64 encoded
  iv: string;         // Base64 encoded (12 bytes)
}

// Encrypt plaintext data object with derived key
export async function encryptData(key: CryptoKey, data: any): Promise<EncryptedPayload> {
  const encoder = new TextEncoder();
  const jsonString = JSON.stringify(data);
  const encodedData = encoder.encode(jsonString);

  // Generate 12 bytes IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
    },
    key,
    encodedData
  );

  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv.buffer),
  };
}

// Decrypt ciphertext with derived key
export async function decryptData(key: CryptoKey, payload: EncryptedPayload): Promise<any> {
  const ivBuffer = base64ToBuffer(payload.iv);
  const ciphertextBuffer = base64ToBuffer(payload.ciphertext);

  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBuffer as unknown as BufferSource,
    },
    key,
    ciphertextBuffer as unknown as BufferSource
  );

  const decoder = new TextDecoder();
  const jsonString = decoder.decode(decryptedBuffer);
  return JSON.parse(jsonString);
}

// Known verification challenge phrase to verify master key accuracy on local client
export const VERIFICATION_PHRASE = 'FINANCAS_PRO_ZERO_KNOWLEDGE_VERIFIED_2026';

// SHA-256 string hashing for user account isolation
export async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// PBKDF2 password hash verification helper
export async function hashPasswordWithSalt(password: string, saltBase64: string): Promise<string> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const saltBuffer = base64ToBuffer(saltBase64);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer as unknown as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    passwordKey,
    256
  );

  return bufferToBase64(derivedBits);
}
