/**
 * @file This file contains the core client-side encryption logic using `libsodium-wrappers`.
 * @module Encryption
 *
 * @description
 * This module provides a comprehensive suite of functions for client-side encryption,
 * designed for use in a modern ES Module environment. It supports two primary
 * encryption patterns:
 *
 * 1.  **One-Shot Encryption (`encryptData`):** Ideal for smaller files or data
 *     blobs that can be comfortably held in memory. It performs a single
 *     encryption operation.
 *
 * 2.  **Streaming Encryption (`initStreamingEncrypt`, `encryptStreamChunk`):**
 *     Designed for large files to minimize memory consumption. It processes the
 *     file in chunks, never requiring the entire file to be loaded into memory.
 *
 * All cryptographic operations rely on the `libsodium-wrappers` library, which must be
 * initialized by calling `initializeSodium()` before any other function in this
 * module is used.
 *
 * @see {@link https://github.com/jedisct1/libsodium.js} for the underlying cryptographic library.
 */

import sodium from 'libsodium-wrappers';

/**
 * A module-level flag to ensure that the asynchronous initialization of libsodium
 * is performed only once per application lifecycle.
 * @private
 * @type {boolean}
 */
let isSodiumInitialized = false;

/**
 * Initializes the libsodium library. This function MUST be called and awaited
 * before any other cryptographic function in this module is used.
 *
 * @description This function is idempotent; subsequent calls after the first successful
 * initialization will return immediately. The `sodium.ready` promise resolves when
 * the underlying WebAssembly module has been downloaded, compiled, and is ready for use.
 * @returns {Promise<void>} A promise that resolves when the library is ready.
 */
export const initializeSodium = async (): Promise<void> => {
  if (isSodiumInitialized) {
    return;
  }
  await sodium.ready;
  isSodiumInitialized = true;
};

/**
 * Reads a `File` object and returns its content as a `Uint8Array`. This utility
 * function promisifies the browser's callback-based `FileReader` API for use
 * with modern async/await syntax.
 *
 * @param {File} file The `File` object to read from the user's system.
 * @returns {Promise<Uint8Array>} A promise that resolves with the file content as a Uint8Array.
 * @throws {Error} If the file cannot be read as an ArrayBuffer.
 */
export const readFileAsUint8Array = (file: File): Promise<Uint8Array> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(event.target.result));
      } else {
        reject(new Error('Failed to read file as ArrayBuffer.'));
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Encrypts a `Uint8Array` in a single operation using the XChaCha20-Poly1305 AEAD
 * (Authenticated Encryption with Associated Data) construction.
 *
 * @description
 * This function is designed for "one-shot" encryption of data that fits in memory.
 * It generates a new key and nonce, encrypts the data, and bundles all necessary
 * decryption information (except the key) into a single binary blob.
 *
 * The structure of the output `combinedData` is as follows:
 * `[fingerprint_length (1 byte) | fingerprint (UTF-8) | nonce | ciphertext]`
 *
 * @param {Uint8Array} plaintext The data to be encrypted.
 * @param {string} keyFingerprint An identifier for the key, which will be embedded in the
 *   encrypted data. This helps in identifying which key to use for decryption.
 * @param {Uint8Array} [additionalData] Optional data to be authenticated but not encrypted.
 *   Any tampering with this data during transit will cause decryption to fail.
 * @returns {object} An object containing the final data blob and the keys for out-of-band storage.
 * @property {Uint8Array} combinedData A single `Uint8Array` containing all data required for decryption, except for the key.
 * @property {string} hexKey The secret key, encoded in hexadecimal for the user to store securely.
 * @property {string} base64Nonce The nonce, encoded in Base64.
 * @throws {Error} If libsodium is not initialized or if the fingerprint is too long (> 255 bytes).
 * @throws {TypeError} If `plaintext` is not a `Uint8Array`.
 */
export const encryptData = (plaintext: Uint8Array, keyFingerprint: string, additionalData?: Uint8Array): {
  combinedData: Uint8Array;
  hexKey: string;
  base64Nonce: string;
} => {
  if (!isSodiumInitialized) {
    throw new Error('libsodium is not initialized. Call and await initializeSodium() before using this function.');
  }

  if (!(plaintext instanceof Uint8Array)) {
    throw new TypeError('Plaintext must be a Uint8Array.');
  }

  // 1. Generate a new, cryptographically secure random key and nonce for this specific encryption.
  const key = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);

  // 2. Encrypt the plaintext using the AEAD construction, which ensures confidentiality and integrity.
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    additionalData || null, // Authenticate additional data if provided.
    null,                   // nsec (not used in this context, must be null).
    nonce,
    key
  );

  // 3. Prepare the key fingerprint to be embedded in the final blob.
  const encodedFingerprint = new TextEncoder().encode(keyFingerprint);
  if (encodedFingerprint.length > 255) {
    // A single byte is used for the length prefix, limiting the fingerprint size.
    throw new Error("Fingerprint is too long. Must be 255 bytes or less when UTF-8 encoded.");
  }
  const fingerprintLen = new Uint8Array([encodedFingerprint.length]);

  // 4. Concatenate all parts into a single Uint8Array for simplified transport and storage.
  // Format: [fingerprint_length | fingerprint | nonce | ciphertext]
  const combinedData = new Uint8Array(
    fingerprintLen.length + encodedFingerprint.length + nonce.length + ciphertext.length
  );
  combinedData.set(fingerprintLen, 0);
  combinedData.set(encodedFingerprint, fingerprintLen.length);
  combinedData.set(nonce, fingerprintLen.length + encodedFingerprint.length);
  combinedData.set(ciphertext, fingerprintLen.length + encodedFingerprint.length + nonce.length);

  // 5. Encode the secret key to hex and nonce to Base64.
  const hexKey = sodium.to_hex(key);  
  const base64Nonce = sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL);

  return { combinedData, hexKey, base64Nonce };
};

/**
 * Initializes a stateful, streaming encryption session using `crypto_secretstream`.
 * This is the first step for encrypting large files that cannot be held in memory.
 *
 * @description
 * This function generates a master key for the entire stream and an initial header.
 * A custom "extended header" is created by prepending the key fingerprint to the
 * libsodium-generated header. This extended header must be sent as the very first
 * piece of data in the stream.
 *
 * The structure of the returned `header` is:
 * `[fingerprint_length (1 byte) | fingerprint (UTF-8) | original_libsodium_header]`
 *
 * @param {string} keyFingerprint An identifier for the key, used to associate the
 *   encrypted stream with its corresponding decryption key.
 * @returns {object} An object containing the necessary components to start a stream.
 * @property {any} state An opaque state object that must be passed to subsequent calls of `encryptStreamChunk`.
 * @property {Uint8Array} header The extended header blob, which must be sent as the first chunk of the stream.
 * @property {string} hexKey The master secret key for the entire stream, encoded in hexadecimal for secure user storage.
 * @property {string} base64Nonce The libsodium header, encoded in Base64. This serves as the nonce for the entire stream.
 * @throws {Error} If libsodium is not initialized or if the fingerprint is too long.
 */
export const initStreamingEncrypt = (keyFingerprint: string): {
  state: any;
  header: Uint8Array;
  hexKey: string; 
  base64Nonce: string;
} => {
  if (!isSodiumInitialized) {
    throw new Error('libsodium is not initialized. Call and await initializeSodium() first.');
  }

  // 1. Generate a master key and initialize the secret stream for encryption ("push" mode).
  const key = sodium.randombytes_buf(sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES);
  const res = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);

  // 2. Prepare the key fingerprint for embedding in the custom header.
  const encodedFingerprint = new TextEncoder().encode(keyFingerprint);
  if (encodedFingerprint.length > 255) {
    throw new Error("Fingerprint is too long. Must be 255 bytes or less when UTF-8 encoded.");
  }
  const fingerprintLen = new Uint8Array([encodedFingerprint.length]);

  // 3. Construct the extended header by prepending the fingerprint info to the libsodium header.
  const extendedHeader = new Uint8Array(fingerprintLen.length + encodedFingerprint.length + res.header.length);
  extendedHeader.set(fingerprintLen, 0);
  extendedHeader.set(encodedFingerprint, fingerprintLen.length);
  extendedHeader.set(res.header, fingerprintLen.length + encodedFingerprint.length);
  
  // 4. Return the stream state and the custom header.
  return {
    state: res.state,
    header: extendedHeader,
    hexKey: sodium.to_hex(key),  // Using hex instead of Base64 for keys
    // The original libsodium header acts as the nonce for the entire stream.
    // It's provided here for reference or potential future use.
    base64Nonce: sodium.to_base64(res.header, sodium.base64_variants.ORIGINAL),
  };
};

/**
 * Encrypts a single chunk of data within an active encryption stream.
 * This function must be called for each subsequent chunk of a file after `initStreamingEncrypt`.
 *
 * @param {any} state The opaque state object returned by `initStreamingEncrypt`.
 * @param {Uint8Array} chunk The plaintext data chunk to encrypt.
 * @param {boolean} isFinalChunk Must be `true` if this is the last chunk in the stream, `false` otherwise.
 * @param {Uint8Array} [additionalData] Optional data to authenticate with this specific chunk.
 * @returns {Uint8Array} The encrypted chunk, ready for transmission.
 * @throws {Error} If libsodium is not initialized.
 */
export const encryptStreamChunk = (state: any, chunk: Uint8Array, isFinalChunk: boolean, additionalData?: Uint8Array): Uint8Array => {
  if (!isSodiumInitialized) {
    throw new Error('libsodium is not initialized.');
  }
  // Each message in a secret stream must be accompanied by a tag. A special tag is
  // used to mark the final message, which securely closes the stream.
  const tag = isFinalChunk
    ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
    : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;

  // Encrypt the chunk using the provided state and tag.
  return sodium.crypto_secretstream_xchacha20poly1305_push(state, chunk, additionalData || null, tag);
};