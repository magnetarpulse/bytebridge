/**
 * @file This Web Worker handles in-memory file processing, including optional
 * compression and encryption.
 * @module EncryptionWorker
 *
 * @description
 * This worker is designed for a non-streaming, "one-shot" processing model. It
 * reads an entire file into memory before performing its operations. This approach
 * is simpler and faster for smaller files but is not suitable for very large files
 * due to high memory consumption.
 *
 * The processing pipeline is as follows:
 * 1. Receives a `File` object and configuration from the main thread.
 * 2. Reads the entire file into a `Uint8Array` in memory.
 * 3. If requested, applies Gzip compression to the file data.
 * 4. Encrypts the resulting data using a key derived from a user-provided fingerprint.
 * 5. Posts granular progress updates back to the main thread during the process.
 * 6. Transmits the final encrypted data and the associated keys in a single `success` message.
 *
 * Worker Communication Protocol:
 * ----------------------------
 *
 * --> Messages received from the main thread:
 *   - `{ type: 'init' }` (Implicitly handled by worker creation)
 *   - `{ data: { file, keyFingerprint, options } }`
 *     The primary message to start a processing task.
 *
 * <-- Messages sent to the main thread:
 *   - `{ type: 'ready' }`
 *     Sent once the worker and its crypto library are initialized.
 *   - `{ type: 'progress', payload: { text: string, value: number } }`
 *     Sent at various stages of the pipeline to update UI.
 *   - `{ type: 'success', payload: { processedData: Uint8Array, keys: { ... } } }`
 *     Sent upon successful completion with the final encrypted data.
 *   - `{ type: 'error', payload: string }`
 *     Sent if any part of the process fails.
 *
 * @see {@link https://github.com/jedisct1/libsodium.js} for encryption implementation.
 * @see {@link https://github.com/101Arrowz/fflate} for Gzip implementation.
 */
import { gzip } from 'fflate';
import { type CompressionLevel } from '../types';
import { encryptData, initializeSodium, readFileAsUint8Array } from './encryption';

/**
 * Defines the structure of the message payload required to start a processing task.
 * @interface WorkerInput
 */
interface WorkerInput {
  /** The `File` object to be processed. */
  file: File;
  /**
   * A user-provided string used as input to a Key Derivation Function (KDF)
   * to deterministically generate the actual encryption key.
   */
  keyFingerprint: string;
  /** Configuration options that control the processing pipeline. */
  options: {
    /** Specifies whether to apply Gzip compression before encryption. */
    compress: boolean;
    /**
     * Defines the strength of the Gzip compression (1-9), if enabled.
     * Higher levels offer better compression at the cost of CPU time.
     */
    compressionLevel: CompressionLevel;
  };
}

// Performs a one-time, asynchronous initialization of the cryptographic library.
// This ensures that the expensive setup cost is paid only once when the worker is first loaded.
initializeSodium().then(() => {
  // Signal to the main thread that the worker is fully initialized and ready to accept tasks.
  self.postMessage({ type: 'ready' });
}).catch(err => {
  // If the cryptographic engine fails to initialize, the worker is non-functional.
  // Report a fatal, non-recoverable error to the main thread.
  self.postMessage({ type: 'error', payload: 'Worker failed to initialize encryption engine.' });
});

/**
 * The primary message handler for the worker. This function is triggered when the main
 * thread calls `worker.postMessage()`. It orchestrates the entire
 * read -> compress -> encrypt pipeline for the provided file.
 *
 * @param {MessageEvent<WorkerInput>} event The message event from the main thread,
 * containing the file and processing options.
 */
self.onmessage = async (event: MessageEvent<WorkerInput>) => {
  const { file, keyFingerprint, options } = event.data;

  try {
    // At each major stage of the pipeline, post a progress message to the main thread
    // to allow for real-time UI feedback.
    self.postMessage({ type: 'progress', payload: { text: 'Reading file...', value: 10 } });
    
    // Read the entire file content into an in-memory Uint8Array.
    // WARNING: This operation's memory cost is proportional to the file size, making it
    // unsuitable for very large files.
    const plaintext = await readFileAsUint8Array(file);
    self.postMessage({ type: 'progress', payload: { text: 'File read complete.', value: 25 } });

    let dataToProcess: Uint8Array = plaintext;

    // If compression is enabled, Gzip the plaintext data.
    if (options.compress) {
      self.postMessage({ type: 'progress', payload: { text: 'Compressing...', value: 40 } });
      
      // The `fflate.gzip` function uses a callback pattern. It is wrapped in a Promise
      // to seamlessly integrate with the modern async/await control flow.
      dataToProcess = await new Promise<Uint8Array>((resolve, reject) => {
        const gzipOptions = { level: options.compressionLevel };
        gzip(plaintext, gzipOptions, (err, compressedData) => {
          if (err) {
            return reject(err); // Propagate compression errors to the catch block.
          }
          resolve(compressedData);
        });
      });
      self.postMessage({ type: 'progress', payload: { text: 'Compression complete.', value: 60 } });
    }

    self.postMessage({ type: 'progress', payload: { text: 'Encrypting...', value: 75 } });
    
    // Encrypt the data (either the original plaintext or the compressed version).
    // The `encryptData` utility encapsulates key derivation, encryption, and
    // the bundling of the nonce and ciphertext into a single array.
    const { combinedData, hexKey, base64Nonce } = encryptData(dataToProcess, keyFingerprint);

    self.postMessage({ type: 'progress', payload: { text: 'Encryption complete.', value: 100 } });
    
    // Transmit the final results to the main thread in a single success message.
    self.postMessage({
      type: 'success',
      payload: {
        // The final encrypted payload, ready for transmission or storage.
        processedData: combinedData,
        // The derived key and nonce, which are required for decryption.
        keys: { secretKey: hexKey, nonce: base64Nonce },
      },
    });

  } catch (error) {
    // If an error occurs at any point in the `try` block, this catch block is executed.
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred in the worker.';
    
    // Send a structured error message back to the main thread for proper handling.
    self.postMessage({ type: 'error', payload: errorMessage });
  }
};