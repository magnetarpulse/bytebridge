/**
 * @file keyEncryption.ts
 * @description Password-based encryption for recovery key files.
 * Uses Web Crypto API with PBKDF2 + AES-GCM for secure key file protection.
 * 
 * @security
 * - PBKDF2 with 100,000 iterations (OWASP recommended minimum)
 * - AES-256-GCM for authenticated encryption
 * - Random salt per encryption prevents rainbow table attacks
 * - Random IV per encryption ensures semantic security
 */

/**
 * Configuration for password-based key derivation.
 */
const PBKDF2_CONFIG = {
  ITERATIONS: 100000,       // OWASP minimum recommendation
  HASH: 'SHA-256' as const,
  KEY_LENGTH: 256,          // AES-256
  SALT_LENGTH: 16,          // 128 bits
} as const;

const AES_GCM_CONFIG = {
  IV_LENGTH: 12,            // 96 bits (recommended for GCM)
  TAG_LENGTH: 128,          // 128 bits
} as const;

/**
 * Encrypted key file format (JSON serializable).
 */
export interface EncryptedKeyFile {
  version: number;
  encrypted: true;
  keyFingerprint: string;
  encryptedData: string; // Base64-encoded ciphertext
  salt: string;          // Base64-encoded salt for PBKDF2
  iv: string;            // Base64-encoded IV for AES-GCM
  comment: string;
}

/**
 * Plaintext key file format.
 */
export interface PlaintextKeyFile {
  version: number;
  encrypted: false;
  keyFingerprint: string;
  secretKey: string;
  nonce: string;
  comment: string;
}

/**
 * Derives a CryptoKey from a password using PBKDF2.
 * 
 * @param password - User's password
 * @param salt - Cryptographic salt (must be random for each encryption)
 * @returns Promise resolving to AES-GCM CryptoKey
 */
async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  
  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  );
  
  // Derive AES-GCM key
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_CONFIG.ITERATIONS,
      hash: PBKDF2_CONFIG.HASH,
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: PBKDF2_CONFIG.KEY_LENGTH,
    },
    false, // Not extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts recovery key data with a password.
 * 
 * @param keyData - Object containing secretKey and nonce
 * @param password - Password to encrypt with
 * @returns Encrypted data structure with all necessary decryption parameters
 */
export async function encryptKeyFile(
  keyData: { secretKey: string; nonce: string },
  password: string
): Promise<Omit<EncryptedKeyFile, 'keyFingerprint' | 'comment'>> {
  // Generate random salt and IV
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_CONFIG.SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_CONFIG.IV_LENGTH));
  
  // Derive encryption key from password
  const key = await deriveKeyFromPassword(password, salt);
  
  // Serialize key data to JSON
  const plaintext = JSON.stringify(keyData);
  const encoder = new TextEncoder();
  const plaintextBuffer = encoder.encode(plaintext);
  
  // Encrypt with AES-GCM
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: AES_GCM_CONFIG.TAG_LENGTH,
    },
    key,
    plaintextBuffer
  );
  
  // Convert to base64 for JSON serialization
  return {
    version: 1,
    encrypted: true,
    encryptedData: bufferToBase64(ciphertext),
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
  };
}

/**
 * Decrypts a password-protected recovery key file.
 * 
 * @param encryptedFile - Encrypted key file data
 * @param password - Password used during encryption
 * @returns Decrypted key data
 * @throws Error if password is incorrect or data is corrupted
 */
export async function decryptKeyFile(
  encryptedFile: Omit<EncryptedKeyFile, 'keyFingerprint' | 'comment'>,
  password: string
): Promise<{ secretKey: string; nonce: string }> {
  // Convert from base64
  const salt = base64ToBuffer(encryptedFile.salt);
  const iv = base64ToBuffer(encryptedFile.iv);
  const ciphertext = base64ToBuffer(encryptedFile.encryptedData);
  
  // Derive decryption key
  const key = await deriveKeyFromPassword(password, salt);
  
  // Decrypt
  try {
    const plaintextBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        tagLength: AES_GCM_CONFIG.TAG_LENGTH,
      },
      key,
      ciphertext
    );
    
    const decoder = new TextDecoder();
    const plaintext = decoder.decode(plaintextBuffer);
    return JSON.parse(plaintext);
  } catch (error) {
    throw new Error('Decryption failed: Invalid password or corrupted data');
  }
}

/**
 * Converts ArrayBuffer or Uint8Array to Base64 string.
 */
function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts Base64 string to Uint8Array.
 */
function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
