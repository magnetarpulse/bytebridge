import sodium from 'libsodium-wrappers';

/**
 * Derives a unique, context-specific sub-key from a master key using libsodium's KDF (Key Derivation Function).
 * This is a standard and secure way to generate multiple keys from a single piece of secret material,
 * which is essential for securely creating distinct keys for parallel workers or different cryptographic purposes
 * without needing to manage or transmit multiple independent keys.
 *
 * @param {Uint8Array} masterKey The primary secret key from which to derive the sub-key.
 * @param {string} context A unique string identifying the purpose or owner of the sub-key (e.g., 'worker-0').
 *                         This ensures that different contexts produce different, unpredictable sub-keys.
 * @returns {Uint8Array} A new key of the appropriate length for the secret stream cipher.
 */
function deriveSubKey(masterKey: Uint8Array, context: string): Uint8Array {
  return sodium.crypto_kdf_derive_from_key(
    sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES, // The desired output length for the new key.
    0, // The sub-key ID, can be used to derive multiple keys for the same context.
    context, // The context string.
    masterKey // The master key.
  );
}

/**
 * @description This test suite verifies the core cryptographic operations underpinning a parallel encryption system.
 * It focuses on the integrity of the key derivation and encryption/decryption round-trip process.
 * These tests ensure that sub-keys, derived for different contexts (e.g., parallel workers),
 * are valid and can perform a complete and successful encryption and decryption cycle.
 */
describe('ParallelEncryptionManager crypto round-trip', () => {
  /**
   * @description Ensures the libsodium WebAssembly module is fully loaded and ready
   * before any cryptographic functions are called in the tests.
   */
  beforeAll(async () => {
    await sodium.ready;
  });

  /**
   * @description This test case validates the complete end-to-end cryptographic workflow for multiple,
   * distinct worker contexts derived from a single master key.
   *
   * It verifies that:
   * 1. A unique sub-key can be correctly derived from a master key for each context.
   * 2. This sub-key is valid for initializing a `crypto_secretstream` encryption.
   * 3. A payload encrypted with this sub-key can be successfully decrypted back to its
   *    original form using the same sub-key.
   *
   * By iterating through multiple contexts, this test confirms the reliability and isolation
   * of the key derivation and encryption process for each parallel task.
   */
  it('round-trip encrypt/decrypt for every worker range', () => {
    // 1. Generate a single master key, representing the primary secret.
    const master = sodium.crypto_secretstream_xchacha20poly1305_keygen();
    const contexts = ['worker-0', 'worker-1', 'worker-2', 'worker-3'];

    // 2. For each defined context, perform a full encryption/decryption round-trip.
    contexts.forEach(ctx => {
      // 2a. Derive a unique sub-key for the current worker context.
      const subKey = deriveSubKey(master, ctx);

      // 2b. Encrypt a payload using the derived sub-key.
      const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(subKey);

      const plaintext = new Uint8Array(1024).map((_, i) => i % 256);
      const ciphertext = sodium.crypto_secretstream_xchacha20poly1305_push(
        state,
        plaintext,
        null, // No additional data (AAD)
        sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL // Mark this as the final chunk of the stream.
      );

      // 2c. Decrypt the payload using the same sub-key and the header from the encryption step.
      const pullState = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, subKey);
      const pullRes = sodium.crypto_secretstream_xchacha20poly1305_pull(pullState, ciphertext, null);

      // 2d. Verify the integrity and correctness of the decryption.
      // The tag must indicate this was the final chunk.
      expect(pullRes.tag).toBe(sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL);
      // The decrypted message must exactly match the original plaintext.
      expect(pullRes.message).toEqual(plaintext);
    });
  });
});