import { Logger, LogLevel } from '../logger/logger';

/**
 * GrowingBuffer: High-performance, memory-efficient buffer for streaming and chunked data.
 *
 * This buffer is designed for scenarios where data arrives in many small or variably-sized chunks,
 * such as network streams, file uploads, or real-time feeds. It avoids the O(n^2) cost of repeated
 * array concatenation by maintaining an internal array of Uint8Array chunks and a read cursor.
 *
 * Key Features:
 * - Amortised O(1) append: Chunks are appended to a pre-allocated array; occasional growth is linear 
 *   in the number of slots already used.
 * - O(k) extraction: Where k is the number of physical chunks actually copied, ≤ ⌈size / min-chunk-size⌉.
 * - Automatic compaction: When the number of chunks grows too large or the buffer exceeds a threshold,
 *   the buffer compacts itself to reduce fragmentation and improve memory locality.
 * - Shared ArrayBuffer support: For very large buffers, compaction uses a single backing ArrayBuffer
 *   to minimize memory usage and improve performance.
 * - Zero-copy iteration: Exposes a generator for zero-copy iteration over logical chunks; O(k) copy extraction.
 *
 * When to use:
 * - Ideal for high-throughput, low-latency streaming, such as WebTransport, WebSockets, or file uploads.
 * - Especially effective when handling many small chunks, as it avoids performance cliffs of naive approaches.
 * - Suitable for both browser and server environments.
 *
 * Usage Example:
 *   const buffer = new GrowingBuffer();
 *   buffer.append(new Uint8Array([1,2,3]));
 *   ...
 *   const chunk = buffer.takeChunk(1024);
 */
export class GrowingBuffer {
  // Internal state: chunk storage and read/write pointers
  private chunks: Uint8Array[] = new Array(1024); // Pre-allocated chunk array for amortised O(1) append
  private writePtr = 0;                           // Next free slot for appending
  private readIdx  = 0;                           // Index of first logical chunk to read
  private readOff  = 0;                           // Byte offset within the first chunk
  private totalLen = 0;                           // Total bytes available in buffer

  // Configuration: controls compaction and memory thresholds
  private readonly highWaterMark: number;         // Max chunk count before compaction
  private readonly sharedBufferThreshold: number; // Min size for shared ArrayBuffer compaction
  private readonly logger: Logger;

  // Floating point precision threshold (anything below this is likely accumulated error)
  private readonly FLOAT_PRECISION_THRESHOLD = 1e-6;

  /**
   * Create a new GrowingBuffer.
   * 
   * @param opts.highWaterMark - Number of chunks before compaction is triggered (default: 2048)
   * @param opts.sharedBufferThreshold - Size in bytes to use shared ArrayBuffer compaction (default: 16MB)
   */
  constructor(opts?: {
    highWaterMark?: number;
    sharedBufferThreshold?: number;
  }) {
    this.highWaterMark = opts?.highWaterMark ?? 2048;
    this.sharedBufferThreshold = opts?.sharedBufferThreshold ?? 16 * 1024 * 1024;
    this.logger = new Logger('GrowingBuffer', LogLevel.WARN);
  }

  /**
   * Append a chunk to the buffer. O(1) operation amortised.
   * 
   * @param chunk - The Uint8Array to append. Empty chunks are ignored.
   */
  append(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    // Grow the chunk array if needed
    if (this.writePtr === this.chunks.length) this.growArray();
    this.chunks[this.writePtr++] = chunk;
    this.totalLen += chunk.length;
    // Trigger compaction if too many chunks are present
    if (this.writePtr - this.readIdx > this.highWaterMark) this.compact();
  }

  /**
   * Extract exactly `size` bytes from the buffer, or null if insufficient data.
   * Efficiently copies from as many physical chunks as needed.
   * 
   * @param size - Number of bytes to extract
   * @returns Uint8Array of requested size, or null if not enough data
   */
  takeChunk(size: number): Uint8Array | null {
    if (this.totalLen < size) return null;
    if (size === 0) return new Uint8Array(0);

    // Detect floating point precision errors before they cause problems
    if (this.hasFloatingPointError()) {
      this.logger.warn('Floating point error detected in buffer state', {
        totalLen: this.totalLen,
        readOff: this.readOff,
        readIdx: this.readIdx,
        writePtr: this.writePtr,
        requestedSize: size
      });
    }

    const out = new Uint8Array(size);
    let outOff = 0;
    let rem = size;

    // Copy from chunks until requested size is fulfilled
    while (rem > 0) {
      // Bounds check: ensure readIdx is within valid range
      if (this.readIdx >= this.writePtr) {
        this.logger.error('Buffer read index exceeded write pointer', {
          readIdx: this.readIdx,
          writePtr: this.writePtr,
          totalLen: this.totalLen,
          requestedSize: size,
          remainingBytes: rem,
          copiedBytes: outOff
        });
        throw new Error(`offset is out of bounds: 
          readIdx(${this.readIdx}) >= writePtr(${this.writePtr}), requested ${size} bytes, copied ${outOff}/${size}`);
      }

      const cur = this.chunks[this.readIdx];
      
      // Validate chunk exists
      if (!cur || cur.length === 0) {
        this.logger.error('Invalid chunk encountered during read', {
          readIdx: this.readIdx,
          chunkExists: !!cur,
          chunkLength: cur?.length ?? 0,
          totalLen: this.totalLen,
          requestedSize: size
        });
        throw new Error(`offset is out of bounds: invalid chunk at readIdx(${this.readIdx})`);
      }

      const avail = cur.length - this.readOff;
      const take = Math.min(avail, rem);

      try {
        out.set(cur.subarray(this.readOff, this.readOff + take), outOff);
      } catch (error) {
        this.logger.error('Failed to copy chunk data', {
          readIdx: this.readIdx,
          readOff: this.readOff,
          chunkLength: cur.length,
          substringStart: this.readOff,
          substringEnd: this.readOff + take,
          outOffset: outOff,
          error: error instanceof Error ? error.message : String(error)
        });
        throw new Error(`offset is out of bounds: 
          failed to copy data from chunk at readIdx(${this.readIdx}), readOff(${this.readOff})`);
      }
      
      outOff += take;
      rem -= take;
      this.totalLen -= take;

      if (take === avail) {                             // Consumed whole chunk
        this.chunks[this.readIdx++] = undefined as any; // Allow GC
        this.readOff = 0;
      } else {
        this.readOff += take;
      }
    }
    
    return out;
  }

  /**
   * Return all remaining data as a single Uint8Array (one final copy).
   * Buffer is cleared after this call.
   * 
   * @returns Uint8Array containing all remaining data
   */
  getRemainder(): Uint8Array {
    if (this.totalLen === 0) return new Uint8Array(0);

    // Detect floating point precision errors 
    if (Math.abs(this.totalLen - Math.round(this.totalLen)) > this.FLOAT_PRECISION_THRESHOLD) {
      this.logger.error('Floating point error detected in totalLen', {
        totalLen: this.totalLen,
        expectedInteger: Math.round(this.totalLen),
        fractionalPart: this.totalLen - Math.round(this.totalLen),
        readIdx: this.readIdx,
        writePtr: this.writePtr,
        readOff: this.readOff
      });
      throw new Error(`Floating point error in buffer state: totalLen=${this.totalLen} is not an integer`);
    }

    const out = new Uint8Array(this.totalLen);
    let off = 0;

    try {
      for (const v of this.chunksIter()) {
        // Check for potential overflow before copying
        if (off + v.length > out.length) {
          this.logger.error('Buffer overflow detected in getRemainder', {
            outLength: out.length,
            currentOffset: off,
            chunkLength: v.length,
            wouldOverflowBy: (off + v.length) - out.length,
            totalLen: this.totalLen,
            readIdx: this.readIdx,
            writePtr: this.writePtr
          });
          throw new Error(`getRemainder: offset overflow detected (off=${off}, chunkLen=${v.length}, outLen=${out.length})`);
        }
        
        out.set(v, off);
        off += v.length;
      }
    } catch (error) {
      this.logger.error('Failed to copy data in getRemainder', {
        error: error instanceof Error ? error.message : String(error),
        outLength: out.length,
        currentOffset: off,
        totalLen: this.totalLen
      });
      throw error;
    }

    this.clear(); 
    return out;
  }

  /**
   * Get the total number of bytes currently in the buffer.
   * 
   * @returns Number of bytes available
   */
  size(): number { return this.totalLen; }

  /**
   * Clear the buffer, releasing all memory.
   */
  clear(): void {
    this.chunks.fill(undefined as any);
    this.writePtr = this.readIdx = this.readOff = this.totalLen = 0;
  }

  /**
   * Iterate over all logical chunks in the buffer (zero-copy).
   * Useful for advanced consumers who want to avoid copying.
   */
  *chunksIter(): Generator<Uint8Array, void> {
    let i = this.readIdx;
    let off = this.readOff;
    while (i < this.writePtr) {
      const c = this.chunks[i]!;
      yield i === this.readIdx && off ? c.subarray(off) : c;
      ++i;
      off = 0;
    }
  }

  /* ---------- Internal helpers ---------- */

  /**
   * Check if there's a floating point precision error in buffer state.
   * This can happen when totalLen or readOff accumulates fractional values.
   */
  private hasFloatingPointError(): boolean {
    const totalLenFraction = Math.abs(this.totalLen - Math.round(this.totalLen));
    const readOffFraction = Math.abs(this.readOff - Math.round(this.readOff));
    
    return totalLenFraction > this.FLOAT_PRECISION_THRESHOLD || 
           readOffFraction > this.FLOAT_PRECISION_THRESHOLD;
  }

  /**
   * Grow the internal chunk array when capacity is reached.
   * Uses direct assignment to avoid stack overflows with large arrays.
   */
  private growArray(): void {
    const bigger = new Array<Uint8Array>(this.chunks.length * 2);
    for (let i = 0; i < this.writePtr; i++) bigger[i] = this.chunks[i]!;
    this.chunks.length = 0;
    this.chunks.push(...bigger);
  }

  /**
   * Compact the buffer to reduce fragmentation and improve memory locality.
   * Uses a single ArrayBuffer for very large buffers.
   */
  private compact(): void {
    if (this.readIdx === 0 && this.readOff === 0) return;

    if (this.totalLen >= this.sharedBufferThreshold) {
      this.compactWithSharedBuffer();
    } else {
      this.compactClassic();
    }
  }

  /**
   * Classic compaction: flatten all data into a single Uint8Array.
   */
  private compactClassic(): void {
    const flat = this.getRemainder();
    this.clear();
    this.chunks[0] = flat;
    this.writePtr = 1;
    this.totalLen = flat.length;
  }

  /**
   * Shared-ArrayBuffer compaction: flatten all data into a single ArrayBuffer-backed chunk.
   * This is more memory-efficient for very large buffers.
   */
  private compactWithSharedBuffer(): void {
    const buffer = new ArrayBuffer(this.totalLen);
    let off = 0;
    for (const v of this.chunksIter()) {
      new Uint8Array(buffer, off, v.length).set(v);
      off += v.length;
    }
    this.clear();
    this.chunks[0] = new Uint8Array(buffer);
    this.writePtr = 1;
    this.totalLen = buffer.byteLength;
  }
}