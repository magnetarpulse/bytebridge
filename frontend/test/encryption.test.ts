/**
 * @file This is an test suite for the client-side encryption module.
 * It is designed to provide a very high degree of confidence in the implementation's
 * security and correctness by verifying its adherence to the principles of modern
 * authenticated encryption (AEAD) for both one-shot and streaming modes.
 *
 * The tests are structured around five core verification suites:
 * 1. Confidentiality: The data is secret.
 * 2. Integrity & Authenticity (Standard): The data has not been tampered with or forged.
 * 3. Integrity & Authenticity (with AAD): Associated data is correctly authenticated.
 * 4. Structural Validation: The output format is correct and consistent.
 * 5. Cryptographic Hygiene & Robustness: The implementation follows best practices
 *    and is resistant to misuse.
 */
import sodium from 'libsodium-wrappers';
import {
  initializeSodium,
  encryptData,
  initStreamingEncrypt,
  encryptStreamChunk,
} from '../src/lib/encryption';

// A dummy fingerprint to use across all tests for consistency.
const FINGERPRINT = 'test-key-v1';

// ===================================================================================
//
//                               DECRYPTION HELPERS
//
// These functions simulate the decryption process that a recipient would perform.
// This keeps our tests clean, DRY, and focused on verifying the encryption output.
//
// ===================================================================================

/**
 * Decrypts data encrypted in one shot with `encryptData`.
 * It correctly parses the custom format: [fingerprint_len | fingerprint | nonce | ciphertext].
 * @param combinedData The Uint8Array containing the full encrypted payload.
 * @param hexKey The base64-encoded secret key.
 * @param additionalData Optional AAD that was used during encryption.
 * @returns An object containing the decrypted data and the extracted fingerprint.
 */
const decryptOneShotData = (combinedData: Uint8Array, hexKey: string, additionalData?: Uint8Array): {
  decrypted: Uint8Array,
  fingerprint: string
} => {
  // Accept hexKey as hex string, decode to Uint8Array
  let keyBytes: Uint8Array;
  if (hexKey.length === 64) {
    // Hex encoding (32 bytes * 2)
    keyBytes = sodium.from_hex(hexKey);
  } else if (hexKey.length === 44) {
    // Base64 encoding (32 bytes)
    keyBytes = sodium.from_base64(hexKey, sodium.base64_variants.ORIGINAL);
  } else {
    throw new Error('Invalid key encoding or length');
  }

  // 1. Parse the custom header
  const fingerprintLen = combinedData[0];
  let offset = 1;
  const fingerprintBytes = combinedData.slice(offset, offset + fingerprintLen);
  offset += fingerprintLen;
  const fingerprint = new TextDecoder().decode(fingerprintBytes);

  // 2. Extract nonce and ciphertext
  const nonceBytes = combinedData.slice(
    offset,
    offset + sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
  );
  offset += sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
  const ciphertextBytes = combinedData.slice(offset);

  // 3. Decrypt, providing AAD if it exists
  const decrypted = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,                    // nsec (not used)
    ciphertextBytes,
    additionalData || null,  // Pass AAD to the decrypt function
    nonceBytes,
    keyBytes
  );

  return { decrypted, fingerprint };
};

/**
 * Decrypts a stream of data encrypted with the streaming functions.
 * It initializes a decryption stream and processes each chunk sequentially.
 * @param header The extended header from `initStreamingEncrypt`.
 * @param encryptedChunks An array of objects, each containing a chunk and optional AAD.
 * @param hexKey The base64-encoded secret key for the stream.
 * @returns An object containing the fully reassembled decrypted data and the extracted fingerprint.
 */
const decryptStreamData = (
    header: Uint8Array,
    encryptedChunks: Array<{ chunk: Uint8Array, aad?: Uint8Array }>,
    hexKey: string
): { decrypted: Uint8Array, fingerprint: string } => {
    // Accept hexKey as hex string, decode to Uint8Array
    let keyBytes: Uint8Array;
    if (hexKey.length === 64) {
      keyBytes = sodium.from_hex(hexKey);
    } else if (hexKey.length === 44) {
      keyBytes = sodium.from_base64(hexKey, sodium.base64_variants.ORIGINAL);
    } else {
      throw new Error('Invalid key encoding or length');
    }

    // 1. Parse the custom header
    const fingerprintLen = header[0];
    let offset = 1;
    const fingerprintBytes = header.slice(offset, offset + fingerprintLen);
    offset += fingerprintLen;
    const fingerprint = new TextDecoder().decode(fingerprintBytes);
    const libsodiumHeader = header.slice(offset);

    // 2. Initialize the decryption stream ("pull" mode)
    const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(libsodiumHeader, keyBytes);

    // 3. Decrypt each chunk and collect the plaintext
    const decryptedParts: Uint8Array[] = [];
    for (const item of encryptedChunks) {
      const res = sodium.crypto_secretstream_xchacha20poly1305_pull(state, item.chunk, item.aad || null);
      decryptedParts.push(res.message);
    }

    // 4. Concatenate the decrypted parts into a single buffer
    const totalLength = decryptedParts.reduce((sum, part) => sum + part.length, 0);
    const decrypted = new Uint8Array(totalLength);
    let position = 0;
    for (const part of decryptedParts) {
      decrypted.set(part, position);
      position += part.length;
    }

    return { decrypted, fingerprint };
};


// ===================================================================================
//
//                                 MAIN TEST SUITE
//
// ===================================================================================

/**
 * @description The primary test suite for all encryption logic. It sets up the testing
 * environment by initializing the libsodium library before any tests are run.
 */
describe('Encryption Logic (in Node.js environment)', () => {
  /**
   * @description Ensures the underlying libsodium library is safely initialized and ready
   * before any cryptographic operations are attempted in the tests.
   */
  beforeAll(async () => {
    await initializeSodium();
  });

  /**
   * @description Suite 1: Verifies the fundamental promise of encryption: that data
   * remains confidential and cannot be read without the correct key. It also tests for
   * semantic security, ensuring that encrypting the same data twice yields different
   * ciphertexts.
   */
  describe('Confidentiality: Keeping Data Secret', () => {

    /**
     * @description Tests for the standard one-shot AEAD encryption mode.
     */
    describe('One-Shot Encryption (AEAD)', () => {
      /**
       * @description This is the "happy path" test. It verifies that a typical piece of data
       * can be encrypted and then successfully decrypted back to its original form using the
       * generated key.
       */
      it('should correctly encrypt and decrypt a standard string (the "happy path")', () => {
        const plaintextString = 'This is my super secret data!';
        const plaintext = new TextEncoder().encode(plaintextString);
        const { combinedData, hexKey } = encryptData(plaintext, FINGERPRINT);
        const { decrypted } = decryptOneShotData(combinedData, hexKey);
        expect(new TextDecoder().decode(decrypted)).toEqual(plaintextString);
      });

      /**
       * @description Verifies semantic security. Encrypting the same plaintext multiple times
       * must produce different ciphertexts. This is crucial for preventing attackers from
       * identifying patterns or confirming guesses about the plaintext. This is achieved through
       * the use of a unique nonce for each encryption.
       */
      it('should produce unique ciphertext for identical plaintext (Semantic Security)', () => {
        const plaintext = new TextEncoder().encode('This message is repeated');
        const result1 = encryptData(plaintext, FINGERPRINT);
        const result2 = encryptData(plaintext, FINGERPRINT);

        expect(result1.hexKey).not.toEqual(result2.hexKey);
        expect(result1.combinedData).not.toEqual(result2.combinedData);
      });
    });

    /**
     * @description Tests for the chunked streaming encryption mode.
     */
    describe('Streaming Encryption (SecretStream)', () => {
        /**
         * @description The "happy path" for streaming. It verifies that data broken into multiple
         * chunks can be encrypted sequentially and then decrypted and reassembled into the
         * original complete message.
         */
        it('should correctly encrypt and decrypt a multi-chunk stream', () => {
            const plaintext1 = 'This is the first part of a larger message. ';
            const plaintext2 = 'And this is the concluding part.';
            const fullPlaintext = plaintext1 + plaintext2;

            const { state, header, hexKey } = initStreamingEncrypt(FINGERPRINT);
            const chunk1 = encryptStreamChunk(state, new TextEncoder().encode(plaintext1), false);
            const chunk2 = encryptStreamChunk(state, new TextEncoder().encode(plaintext2), true);

            const { decrypted } = decryptStreamData(header, [{ chunk: chunk1 }, { chunk: chunk2 }], hexKey);

            expect(new TextDecoder().decode(decrypted)).toEqual(fullPlaintext);
        });

        /**
         * @description Verifies semantic security for streams. Initializing two identical streams
         * and encrypting identical content must produce entirely different results (key, header,
         * and ciphertext chunks) due to the random key and nonce generation at the start of each stream.
         */
        it('should produce unique ciphertext for identical stream content', () => {
            const plaintext = new TextEncoder().encode('Identical stream content');

            const stream1 = initStreamingEncrypt(FINGERPRINT);
            const chunk1 = encryptStreamChunk(stream1.state, plaintext, true);

            const stream2 = initStreamingEncrypt(FINGERPRINT);
            const chunk2 = encryptStreamChunk(stream2.state, plaintext, true);

            expect(stream1.hexKey).not.toEqual(stream2.hexKey);
            expect(stream1.header).not.toEqual(stream2.header);
            expect(chunk1).not.toEqual(chunk2);
        });
    });
  });

  /**
   * @description Suite 2: Verifies the "Authenticated" part of AEAD. These tests ensure
   * that any modification, forgery, or restructuring of the encrypted data is detected,
   * causing decryption to fail. This prevents attackers from undetectably altering the
   * message content.
   */
  describe('Integrity & Authenticity: Preventing Tampering and Forgery', () => {

    /**
     * @description Verifies integrity for one-shot AEAD encryption.
     */
    describe('One-Shot Encryption (AEAD)', () => {
      /**
       * @description Ensures that ciphertext encrypted with one key cannot be decrypted by
       * another, even if the second key is a valid, well-formed key. This is a fundamental
       * security property.
       */
      it('should FAIL to decrypt with a different, valid key', () => {
        const { combinedData } = encryptData(new TextEncoder().encode('secret message'), FINGERPRINT);
        const { hexKey: wrongKey } = encryptData(new TextEncoder().encode('a different key'), FINGERPRINT);

        expect(() => decryptOneShotData(combinedData, wrongKey)).toThrow();
      });

      /**
       * @description Simulates a tampering attack where an attacker flips a single bit in the
       * ciphertext. The Poly1305 authenticator should detect this change and cause decryption to fail.
       */
      it('should FAIL to decrypt if a single bit of the ciphertext is flipped', () => {
        const { combinedData, hexKey } = encryptData(new TextEncoder().encode('do not change'), FINGERPRINT);
        combinedData[combinedData.length - 1] ^= 1; // Flip a bit in the ciphertext

        expect(() => decryptOneShotData(combinedData, hexKey)).toThrow();
      });

      /**
       * @description Simulates a tampering attack on the nonce. Since the nonce is part of the
       * data authenticated by the AEAD construction, any change to it must invalidate the
       * ciphertext and cause decryption to fail.
       */
      it('should FAIL to decrypt if a single bit of the nonce is flipped', () => {
        const { combinedData, hexKey } = encryptData(new TextEncoder().encode('tamper the nonce'), FINGERPRINT);
        combinedData[FINGERPRINT.length + 5] ^= 1; // Flip a bit in the nonce (after fingerprint)

        expect(() => decryptOneShotData(combinedData, hexKey)).toThrow();
      });
    });

    /**
     * @description Verifies integrity for streaming encryption, which has more complex
     * requirements like preventing reordering and truncation.
     */
    describe('Streaming Encryption (SecretStream)', () => {
        /**
         * @description Verifies that a stream encrypted with one key cannot be decrypted
         * using a different, valid key.
         */
        it('should FAIL to decrypt with a different key', () => {
            const { state, header } = initStreamingEncrypt(FINGERPRINT);
            const { hexKey: wrongKey } = initStreamingEncrypt(FINGERPRINT);
            const chunk = encryptStreamChunk(state, new Uint8Array([1, 2, 3]), true);

            expect(() => decryptStreamData(header, [{ chunk }], wrongKey)).toThrow();
        });

        /**
         * @description The stream header contains critical information for initializing decryption.
         * This test ensures that any tampering with the header will cause the stream decryption
         * to fail at initialization.
         */
        it('should FAIL to decrypt if the header is tampered with', () => {
            const { state, header, hexKey } = initStreamingEncrypt(FINGERPRINT);
            const chunk = encryptStreamChunk(state, new Uint8Array([1, 2, 3]), true);
            header[header.length - 1] ^= 1; // Flip a bit in the libsodium part of the header

            expect(() => decryptStreamData(header, [{ chunk }], hexKey)).toThrow();
        });

        /**
         * @description Each chunk in the stream is individually authenticated. This test verifies
         * that modifying even a single bit in one chunk will cause its decryption to fail.
         */
        it('should FAIL to decrypt if a data chunk is tampered with', () => {
            const { state, header, hexKey } = initStreamingEncrypt(FINGERPRINT);
            const chunk = encryptStreamChunk(state, new Uint8Array([1, 2, 3]), true);
            chunk[chunk.length - 1] ^= 1; // Flip a bit in the ciphertext

            expect(() => decryptStreamData(header, [{ chunk }], hexKey)).toThrow();
        });

        /**
         * @description Simulates a truncation attack where an attacker drops a chunk from the middle
         * of the stream. The stream cipher is designed to detect this sequencing error, and decryption
         * of a subsequent chunk should fail.
         */
        it('should FAIL to decrypt if a chunk is dropped (truncation)', () => {
            const { state, header, hexKey } = initStreamingEncrypt(FINGERPRINT);
            const chunk1 = encryptStreamChunk(state, new TextEncoder().encode('chunk 1'), false);
            encryptStreamChunk(state, new TextEncoder().encode('chunk 2'), false); // Dropped chunk
            const chunk3 = encryptStreamChunk(state, new TextEncoder().encode('chunk 3'), true);

            expect(() => decryptStreamData(header, [{ chunk: chunk1 }, { chunk: chunk3 }], hexKey)).toThrow();
        });

        /**
         * @description Simulates a reordering attack. The stream cipher authenticates the order
         * of chunks, so attempting to decrypt them in the wrong sequence must fail.
         */
        it('should FAIL to decrypt if chunks are reordered', () => {
            const { state, header, hexKey } = initStreamingEncrypt(FINGERPRINT);
            const chunk1 = encryptStreamChunk(state, new TextEncoder().encode('chunk 1'), false);
            const chunk2 = encryptStreamChunk(state, new TextEncoder().encode('chunk 2'), true);

            expect(() => decryptStreamData(header, [{ chunk: chunk2 }, { chunk: chunk1 }], hexKey)).toThrow();
        });
    });
  });

  /**
   * @description Suite 3: Verifies the correct handling of Additional Associated Data (AAD).
   * AAD is data that is authenticated but not encrypted. It's useful for binding ciphertext
   * to its context (e.g., headers, metadata, version numbers), preventing attacks where a
   * valid ciphertext is replayed in a different, malicious context.
   */
  describe('Integrity & Authenticity with Associated Data (AAD)', () => {
    const plaintext = new TextEncoder().encode('some important data');
    const aad = new TextEncoder().encode('metadata: user=123, file=abc.txt');
    const wrongAad = new TextEncoder().encode('metadata: user=456, file=xyz.dat');

    /**
     * @description Verifies AAD functionality for one-shot encryption.
     */
    describe('One-Shot Encryption (AEAD)', () => {
        /**
         * @description "Happy path" for AAD. Verifies that if data is encrypted with AAD, it can be
         * successfully decrypted when the *exact same* AAD is provided.
         */
        it('should succeed when correct AAD is provided for decryption', () => {
            const { combinedData, hexKey } = encryptData(plaintext, FINGERPRINT, aad);
            const { decrypted } = decryptOneShotData(combinedData, hexKey, aad);
            expect(decrypted).toEqual(plaintext);
        });

        /**
         * @description Verifies that if the AAD is altered in any way between encryption and
         * decryption, the authentication tag check will fail and decryption will be rejected.
         */
        it('should FAIL if AAD is tampered with', () => {
            const { combinedData, hexKey } = encryptData(plaintext, FINGERPRINT, aad);
            expect(() => decryptOneShotData(combinedData, hexKey, wrongAad)).toThrow();
        });

        /**
         * @description Verifies that if AAD was used during encryption, it is *required* during
         * decryption. Omitting it must cause decryption to fail.
         */
        it('should FAIL if AAD is expected but not provided', () => {
            const { combinedData, hexKey } = encryptData(plaintext, FINGERPRINT, aad);
            expect(() => decryptOneShotData(combinedData, hexKey)).toThrow();     // No AAD provided
        });

        /**
         * @description Verifies the inverse: if no AAD was used during encryption, an attacker
         * cannot inject AAD during decryption. This must cause decryption to fail.
         */
        it('should FAIL if AAD is provided but not expected', () => {
            const { combinedData, hexKey } = encryptData(plaintext, FINGERPRINT); // No AAD on encrypt
            expect(() => decryptOneShotData(combinedData, hexKey, aad)).toThrow();
        });
    });

    /**
     * @description Verifies AAD functionality for streaming encryption, where AAD can be
     * applied on a per-chunk basis.
     */
    describe('Streaming Encryption (SecretStream)', () => {
        /**
         * @description "Happy path" for streaming AAD. Verifies that a stream where all chunks
         * are encrypted with AAD can be successfully decrypted when the correct AAD is provided
         * for each corresponding chunk.
         */
        it('should succeed with correct AAD on all chunks', () => {
            const { state, header, hexKey } = initStreamingEncrypt(FINGERPRINT);
            const chunk1 = encryptStreamChunk(state, plaintext, false, aad);
            const chunk2 = encryptStreamChunk(state, plaintext, true, aad);
            
            const { decrypted } = decryptStreamData(header, [{ chunk: chunk1, aad }, { chunk: chunk2, aad }], hexKey);
            const expected = new Uint8Array([...plaintext, ...plaintext]);
            expect(decrypted).toEqual(expected);
        });

        /**
         * @description Verifies that AAD is authenticated on a per-chunk basis. If the AAD for even
         * one chunk is incorrect, decryption of that chunk (and thus the stream) must fail.
         */
        it('should FAIL if AAD is tampered on one chunk', () => {
            const { state, header, hexKey } = initStreamingEncrypt(FINGERPRINT);
            const chunk1 = encryptStreamChunk(state, plaintext, false, aad);
            const chunk2 = encryptStreamChunk(state, plaintext, true, aad);

            const chunks = [{ chunk: chunk1, aad }, { chunk: chunk2, aad: wrongAad }];
            expect(() => decryptStreamData(header, chunks, hexKey)).toThrow();
        });

        /**
         * @description Verifies that the stream implementation correctly handles a mix of chunks,
         * some with AAD and some without. This is a valid use case and must be supported.
         */
        it('should succeed with a mix of AAD and no-AAD chunks', () => {
            const { state, header, hexKey } = initStreamingEncrypt(FINGERPRINT);
            const chunk1 = encryptStreamChunk(state, plaintext, false, aad); // With AAD
            const chunk2 = encryptStreamChunk(state, plaintext, true);       // No AAD
            
            const chunksToDecrypt = [{ chunk: chunk1, aad }, { chunk: chunk2 }];
            const { decrypted } = decryptStreamData(header, chunksToDecrypt, hexKey);
            const expected = new Uint8Array([...plaintext, ...plaintext]);
            expect(decrypted).toEqual(expected);
        });
    });
  });

  /**
   * @description Suite 4: Verifies the structural correctness of the custom output format and
   * the implementation's ability to handle edge cases, such as empty or very large inputs.
   * This ensures the implementation is not just cryptographically sound but also robust
   * and well-behaved in practice.
   */
  describe('Structural Validation & Edge Case Robustness', () => {

    /**
     * @description Validates output structure and edge cases for one-shot AEAD encryption.
     */
    describe('One-Shot Encryption (AEAD)', () => {
      /**
       * @description Verifies that the generated secret key, when hex-encoded, has the expected
       * length (32 bytes = 64 hex characters).
       */
      it('should produce a Hex key of the correct length', () => {
        const KEY_BYTES = sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES;
        const EXPECTED_HEX_LENGTH = KEY_BYTES * 2;
        const { hexKey } = encryptData(new Uint8Array(1), FINGERPRINT);
        expect(hexKey.length).toBe(EXPECTED_HEX_LENGTH);
      });

      /**
       * @description Verifies that the custom header format `[fingerprint_len | fingerprint | ...]`
       * is correctly constructed and parsed. This ensures the fingerprint can be reliably
       * retrieved by the recipient.
       */
      it('should correctly embed and retrieve the key fingerprint', () => {
        const { combinedData, hexKey } = encryptData(new Uint8Array(1), FINGERPRINT);
        const { fingerprint } = decryptOneShotData(combinedData, hexKey);
        expect(fingerprint).toEqual(FINGERPRINT);
      });

      /**
       * @description Tests the edge case of encrypting a zero-length payload. The implementation
       * should handle this gracefully, producing a valid ciphertext that decrypts back to an
       * empty byte array.
       */
      it('should correctly handle empty plaintext', () => {
        const { combinedData, hexKey } = encryptData(new Uint8Array(0), FINGERPRINT);
        const { decrypted } = decryptOneShotData(combinedData, hexKey);
        expect(decrypted.length).toBe(0);
      });

      /**
       * @description A stress test to ensure that the implementation can handle large inputs
       * without running out of memory or failing unexpectedly.
       */
      it('should correctly handle large (10MB) plaintext', () => {
        const largePlaintext = new Uint8Array(10 * 1024 * 1024).fill(1);
        const { combinedData, hexKey } = encryptData(largePlaintext, FINGERPRINT);
        const { decrypted } = decryptOneShotData(combinedData, hexKey);
        expect(decrypted).toEqual(largePlaintext);
      }, 30000); // Increase timeout
    });

    /**
     * @description Validates output structure and edge cases for streaming encryption.
     */
    describe('Streaming Encryption (SecretStream)', () => {
        /**
         * @description Verifies that the generated stream key, when hex-encoded, has the
         * correct length (32 bytes = 64 hex characters).
         */
        it('should produce a Hex key of the correct length', () => {
            const KEY_BYTES = sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES;
            const EXPECTED_HEX_LENGTH = KEY_BYTES * 2;
            const { hexKey } = initStreamingEncrypt(FINGERPRINT);
            expect(hexKey.length).toBe(EXPECTED_HEX_LENGTH);
        });

        /**
         * @description Verifies that the custom stream header correctly prepends the fingerprint
         * information to the libsodium-generated header, and that it can be parsed correctly on the
         * decryption side.
         */
        it('should correctly embed the key fingerprint in the stream header', () => {
            const { state, header, hexKey } = initStreamingEncrypt(FINGERPRINT);
            const chunk = encryptStreamChunk(state, new Uint8Array([1]), true);
            const { fingerprint } = decryptStreamData(header, [{ chunk }], hexKey);
            expect(fingerprint).toEqual(FINGERPRINT);
        });

        /**
         * @description Tests the edge case of an empty stream. This involves creating a stream,
         * encrypting a single, empty final chunk, and ensuring it decrypts correctly to zero bytes.
         */
        it('should correctly handle an empty stream (0 bytes of plaintext)', () => {
            const { state, header, hexKey } = initStreamingEncrypt(FINGERPRINT);
            const chunk = encryptStreamChunk(state, new Uint8Array(0), true);
            const { decrypted } = decryptStreamData(header, [{ chunk }], hexKey);
            expect(decrypted.length).toBe(0);
        });

        /**
         * @description Tests the edge case where a stream consists of only one chunk. This ensures
         * the initialization and finalization steps work correctly even with no intermediate chunks.
         */
        it('should correctly handle a single-chunk stream', () => {
            const plaintext = new TextEncoder().encode('A single chunk message');
            const { state, header, hexKey } = initStreamingEncrypt(FINGERPRINT);
            const chunk = encryptStreamChunk(state, plaintext, true);
            const { decrypted } = decryptStreamData(header, [{ chunk }], hexKey);
            expect(decrypted).toEqual(plaintext);
        });
    });
  });

  /**
   * @description Suite 5: Verifies that the implementation follows cryptographic best practices
   * ("hygiene") and is robust against misuse. This includes proper input validation, ensuring
   * the uniqueness of keys and nonces, and sanity-checking the quality of random data.
   */
  describe('Cryptographic Hygiene & Implementation Robustness', () => {

    /**
     * @description Checks for basic type safety. The encryption functions are designed to work with
     * `Uint8Array`s. Providing other types (like a raw string or null) should result in a
     * controlled failure (a thrown TypeError) rather than undefined behavior.
     */
    it('should fail gracefully when given non-Uint8Array plaintext (One-Shot)', () => {
      // @ts-ignore
      expect(() => encryptData('this is a string', FINGERPRINT)).toThrow(TypeError);
      // @ts-ignore
      expect(() => encryptData(null, FINGERPRINT)).toThrow(TypeError);
    });

    /**
     * @description The custom header format uses a single byte to store the fingerprint length,
     * limiting it to 255 bytes. This test ensures that the implementation enforces this limit
     * to prevent buffer overflows or malformed headers.
     */
    it('should throw an error if the key fingerprint is too long', () => {
        const longFingerprint = 'a'.repeat(300);
        const plaintext = new Uint8Array([1]);
        expect(() => encryptData(plaintext, longFingerprint)).toThrow(/Fingerprint is too long/);
        expect(() => initStreamingEncrypt(longFingerprint)).toThrow(/Fingerprint is too long/);
    });

    /**
     * @description One of the most critical requirements for the underlying cipher (XChaCha20-Poly1305)
     * is nonce uniqueness for a given key. This test runs multiple encryptions and verifies that
     * a fresh, unique nonce was generated each time.
     */
    it('should generate a unique nonce for every one-shot encryption call', () => {
      const iterations = 100;
      const nonces = new Set<string>();
      for (let i = 0; i < iterations; i++) {
        const { base64Nonce } = encryptData(new Uint8Array([i]), FINGERPRINT);
        nonces.add(base64Nonce);
      }
      expect(nonces.size).toBe(iterations);
    });

    /**
     * @description Verifies that every new stream is initialized with a unique key and header.
     * This is fundamental to the security of the streaming protocol, preventing streams from
     * being cryptographically related.
     */
    it('should generate a unique key and header for every new stream', () => {
        const iterations = 100;
        const keys = new Set<string>();
        const headers = new Set<string>();

        for (let i = 0; i < iterations; i++) {
            const { hexKey, header } = initStreamingEncrypt(FINGERPRINT);
            keys.add(hexKey);
            headers.add(sodium.to_base64(header, sodium.base64_variants.ORIGINAL));
        }
        expect(keys.size).toBe(iterations);
        expect(headers.size).toBe(iterations);
    });

    /**
     * @description A sanity check to ensure the random key generation is working correctly. It
     * verifies that the generated keys are not something simple or broken, like all zeros or
     * a repeating pattern.
     */
    it('should generate keys with high entropy (not all zeros or a simple pattern)', () => {
        const { hexKey: oneShotKeyB64 } = encryptData(new Uint8Array([1]), FINGERPRINT);
        const oneShotKey = sodium.from_base64(oneShotKeyB64, sodium.base64_variants.ORIGINAL);
        expect(oneShotKey.every(byte => byte === oneShotKey[0])).toBe(false);

        const { hexKey: streamKeyB64 } = initStreamingEncrypt(FINGERPRINT);
        const streamKey = sodium.from_base64(streamKeyB64, sodium.base64_variants.ORIGINAL);
        expect(streamKey.every(byte => byte === streamKey[0])).toBe(false);
    });
  });
});