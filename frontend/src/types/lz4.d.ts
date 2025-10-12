/**
 * Type definitions for LZ4 WASM module
 * 
 * Provides TypeScript type safety for the LZ4 compression library
 * compiled to WebAssembly.
 * 
 * @module lz4_wasm_nodejs
 */

/**
 * LZ4 WASM module interface providing compression and decompression.
 * 
 * The module must be initialized by calling the default export function
 * before using compress/decompress methods.
 */
export interface LZ4Module {
  /**
   * Compresses data using LZ4 algorithm.
   * 
   * @param data Input data to compress
   * @returns Compressed data as Uint8Array
   * @throws Error if compression fails or module not initialized
   */
  compress(data: Uint8Array): Uint8Array;
  
  /**
   * Decompresses LZ4-compressed data.
   * 
   * @param data Compressed data to decompress
   * @returns Decompressed data as Uint8Array
   * @throws Error if decompression fails or data is corrupted
   */
  decompress(data: Uint8Array): Uint8Array;
}

declare module '../pkg/lz4_wasm_nodejs.js' {
  import type { LZ4Module } from './lz4';
  
  /**
   * Initializes the LZ4 WASM module.
   * 
   * Must be called and awaited before using compress/decompress methods.
   * Loads and initializes the WebAssembly binary.
   * 
   * @returns Promise that resolves when module is ready
   * @throws Error if WASM initialization fails
   * 
   * @example
   * ```typescript
   * import lz4Init from '../pkg/lz4_wasm_nodejs.js';
   * 
   * const lz4 = await lz4Init();
   * const compressed = lz4.compress(data);
   * const decompressed = lz4.decompress(compressed);
   * ```
   */
  export default function init(): Promise<LZ4Module>;
}
