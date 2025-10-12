/**
 * @file fileArchive.ts
 * @description Memory-efficient file archiving utilities designed for use in Web Workers.
 * Provides streaming archive generation that can be integrated into encryption/upload pipelines.
 * 
 * This module is designed to be imported by Web Workers that handle encryption and upload.
 * It provides streaming APIs that generate archive data in chunks, allowing workers to:
 * 1. Generate archive chunks on-demand
 * 2. Encrypt each chunk immediately
 * 3. Upload encrypted chunks
 * All without holding the full archive in memory.
 * 
 * Key Design Principles:
 * - Generator-based APIs for true streaming
 * - No file accumulation in memory
 * - Progress callbacks for UI feedback
 * - Cancellation support via AbortSignal
 * - Back-pressure through iterator protocol
 * 
 * @example Worker Usage
 * import { streamArchiveChunks } from './fileArchive';
 * 
 * async function processFolder(files, uploadFn) {
 *   for await (const chunk of streamArchiveChunks(files, { chunkSize: 5MB })) {
 *     const encryptedChunk = await encrypt(chunk);
 *     await uploadFn(encryptedChunk);
 *   }
 * }
 */

import type { FileItem } from '../../components/upload/types';
import { getOptimalThresholds } from './deviceCapabilities';

/**
 * Size in bytes of the length header that precedes both the manifest and each file.
 * 
 * Uses 4 bytes (uint32) to store length values, allowing for:
 * - Maximum manifest size: 4,294,967,295 bytes (~4.29GB)
 * - Maximum individual file size: 4,294,967,295 bytes (~4.29GB)
 * 
 * This is stored in little-endian format for consistency with JavaScript
 * TypedArray default behavior and modern CPU architectures.
 * 
 * @const {number}
 * @default 4
 * @readonly
 */
const HEADER_SIZE_BYTES = 4;

/**
 * Archive format version string.
 * 
 * Stored in the manifest to enable forward/backward compatibility checking.
 * If archive format changes in the future, this version allows readers to
 * determine which parsing logic to use.
 * 
 * Format: 'major.minor' (semantic versioning)
 * 
 * @const {string}
 * @default '1.0'
 * @readonly
 */
const ARCHIVE_VERSION = '1.0';

/**
 * Maximum safe blob size in bytes (2GB).
 * 
 * Browser blob size limits vary by implementation:
 * - Chrome/Edge: ~2GB (varies by available memory)
 * - Firefox: ~2GB
 * - Safari: ~600MB-1GB (more conservative)
 * 
 * This conservative limit prevents allocation failures and out-of-memory errors
 * when creating in-memory archive blobs. For larger folders, use streaming APIs
 * (streamArchiveChunks) instead of createArchiveFile.
 * 
 * @const {number}
 * @default 2147483648
 * @readonly
 * 
 * @warning Safari may fail below this limit. Consider reducing to 1GB for Safari.
 * @see {@link validateArchiveSize} for enforcement
 */
const MAX_SAFE_BLOB_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

/**
 * Configuration options for archive streaming operations.
 * 
 * These options control the behavior of streaming archive generators,
 * enabling progress tracking, performance tuning, and cancellation support.
 * 
 * @interface ArchiveStreamOptions
 * 
 * @property {Function} [onProgress] - Optional progress callback function
 *   Called after each chunk is processed to report progress to the main thread.
 *   Signature: (fileIndex, totalFiles, fileName, bytesInFile, fileSize) => void
 *   - fileIndex: 1-based index of current file being processed
 *   - totalFiles: Total number of files in the archive
 *   - fileName: Relative path of the current file
 *   - bytesInFile: Number of bytes processed in current file
 *   - fileSize: Total size of current file in bytes
 * 
 * @property {number} [chunkSize] - Size in bytes of each chunk to yield
 *   Default: Device-optimized (1MB-10MB based on device capabilities)
 *   Range: 64KB (minimum) to 50MB (maximum practical)
 *   Trade-offs:
 *   - Smaller chunks: Lower memory, more overhead, slower overall
 *   - Larger chunks: Higher memory, less overhead, faster overall
 *   Recommended: 2-5MB for most use cases
 * 
 * @property {AbortSignal} [signal] - Optional AbortSignal for cancellation
 *   Pass an AbortController's signal to enable mid-stream cancellation.
 *   When aborted, the generator throws an AbortError and stops processing.
 *   Example: const controller = new AbortController(); signal: controller.signal
 * 
 * @example
 * const options: ArchiveStreamOptions = {
 *   chunkSize: 5 * 1024 * 1024, // 5MB chunks
 *   onProgress: (idx, total, name, bytes, size) => {
 *     console.log(`File ${idx}/${total}: ${name} - ${bytes}/${size} bytes`);
 *   },
 *   signal: abortController.signal
 * };
 */
export interface ArchiveStreamOptions {
  onProgress?: (
    fileIndex: number,
    totalFiles: number,
    fileName: string,
    bytesInFile: number,
    fileSize: number
  ) => void;
  chunkSize?: number;
  signal?: AbortSignal;
}

/**
 * Archive manifest structure containing metadata for all archived files.
 * 
 * The manifest is serialized as JSON and stored at the beginning of the archive,
 * allowing readers to understand the archive structure without scanning all data.
 * 
 * @interface ArchiveManifest
 * 
 * @property {string} version - Archive format version (semantic versioning: 'major.minor')
 *   Used for compatibility checking during extraction.
 *   Current version: '1.0'
 * 
 * @property {Array<Object>} files - Array of file metadata entries
 *   Each entry describes one file in the archive with the following properties:
 *   
 *   @property {string} path - Relative path of the file within the archive
 *     Preserves directory structure (e.g., "docs/readme.md")
 *     Used to reconstruct folder hierarchy during extraction
 *   
 *   @property {number} size - File size in bytes
 *     Used for validation and progress calculation
 *     Must match the actual data length in the archive
 *   
 *   @property {number} lastModified - Last modified timestamp in milliseconds (epoch)
 *     Preserves file modification time for accurate reconstruction
 *     Compatible with File.lastModified and Date.getTime()
 * 
 * @example
 * const manifest: ArchiveManifest = {
 *   version: '1.0',
 *   files: [
 *     {
 *       path: 'README.md',
 *       size: 1234,
 *       lastModified: 1609459200000
 *     },
 *     {
 *       path: 'src/index.ts',
 *       size: 5678,
 *       lastModified: 1609459200000
 *     }
 *   ]
 * };
 */
export interface ArchiveManifest {
  version: string;
  files: Array<{
    path: string;
    size: number;
    lastModified: number;
  }>;
}

/**
 * A chunk of archive data yielded by the streaming generator.
 * 
 * Each chunk represents a discrete unit of archive data with associated metadata
 * to identify its type and position within the archive structure.
 * 
 * @interface ArchiveChunk
 * 
 * @property {Uint8Array} data - The raw binary data for this chunk
 *   Size varies by chunk type:
 *   - manifest: 4 bytes (header) + JSON size (typically 1KB-1MB)
 *   - file-header: 4 bytes (fixed)
 *   - file-data: Variable (up to chunkSize, typically 1-10MB)
 *   Memory is released after processing, enabling constant memory usage.
 * 
 * @property {'manifest' | 'file-header' | 'file-data'} type - Chunk type identifier
 *   Determines how the chunk should be processed:
 *   - 'manifest': Archive metadata (always first chunk)
 *   - 'file-header': File size header (precedes each file's data)
 *   - 'file-data': Actual file content (may span multiple chunks per file)
 * 
 * @property {number} [fileIndex] - Zero-based index of the file (undefined for manifest chunks)
 *   Range: 0 to (files.length - 1)
 *   Used for progress tracking and chunk association.
 * 
 * @property {string} [fileName] - Relative path of the file (undefined for manifest chunks)
 *   Example: "documents/report.pdf"
 *   Useful for progress displays and logging.
 * 
 * @property {number} [fileOffset] - Byte offset within the current file (only for file-data chunks)
 *   Range: 0 to (file.size - 1)
 *   Indicates which portion of the file this chunk represents.
 *   Used for progress calculation: (fileOffset + data.length) / file.size
 * 
 * @example
 * // Manifest chunk
 * {
 *   data: Uint8Array([...]),
 *   type: 'manifest'
 * }
 * 
 * // File header chunk
 * {
 *   data: Uint8Array([0x00, 0x10, 0x00, 0x00]), // 4096 bytes
 *   type: 'file-header',
 *   fileIndex: 0,
 *   fileName: 'document.pdf'
 * }
 * 
 * // File data chunk
 * {
 *   data: Uint8Array([...]), // 5MB of file content
 *   type: 'file-data',
 *   fileIndex: 0,
 *   fileName: 'document.pdf',
 *   fileOffset: 0
 * }
 */
export interface ArchiveChunk {
  data: Uint8Array;
  type: 'manifest' | 'file-header' | 'file-data';
  fileIndex?: number;
  fileName?: string;
  fileOffset?: number;
}

/**
 * Error thrown when estimated archive size would exceed browser blob size limits.
 * 
 * Browsers have maximum blob allocation sizes that vary by implementation.
 * This error is thrown preemptively during validation to prevent allocation
 * failures and provide a better user experience.
 * 
 * Recovery strategies:
 * - Use streaming APIs (streamArchiveChunks) instead of in-memory (createArchiveFile)
 * - Split large folders into smaller batches
 * - Process files individually without archiving
 * - Compress files before archiving (future feature)
 * 
 * @class ArchiveSizeError
 * @extends Error
 * 
 * @param {number} estimatedSize - The estimated archive size in bytes
 * @param {number} limit - The maximum safe blob size in bytes (typically 2GB)
 * 
 * @property {string} name - Error name: 'ArchiveSizeError'
 * @property {string} message - User-friendly error message with size formatting
 * 
 * @example
 * try {
 *   validateArchiveSize(files);
 * } catch (error) {
 *   if (error instanceof ArchiveSizeError) {
 *     console.error('Archive too large:', error.message);
 *     // Fallback: use streaming or split into batches
 *     useStreamingApproach(files);
 *   }
 * }
 */
export class ArchiveSizeError extends Error {
  constructor(estimatedSize: number, limit: number) {
    super(
      `Archive size (${formatBytes(estimatedSize)}) would exceed limit (${formatBytes(limit)}). ` +
      `Consider processing files individually.`
    );
    this.name = 'ArchiveSizeError';
  }
}

/**
 * Error thrown when browser storage quota is exceeded during archive operations.
 * 
 * This can occur during:
 * - File.arrayBuffer() calls when reading large files
 * - Blob/File construction when creating archives
 * - Any operation requiring temporary storage allocation
 * 
 * Common causes:
 * - Browser storage quota nearly full
 * - Insufficient device disk space
 * - Browser-imposed memory limits reached
 * 
 * Recovery strategies:
 * - Free up browser storage (clear cache, delete files)
 * - Use smaller chunk sizes to reduce memory pressure
 * - Close other tabs/applications to free system memory
 * - Retry with streaming APIs instead of in-memory operations
 * 
 * @class QuotaError
 * @extends Error
 * 
 * @param {string} message - Specific error message describing the quota violation
 * 
 * @property {string} name - Error name: 'QuotaExceededError'
 * @property {string} message - User-friendly error message
 * 
 * @example
 * try {
 *   const arrayBuffer = await file.arrayBuffer();
 * } catch (error) {
 *   if (error instanceof DOMException && error.name === 'QuotaExceededError') {
 *     throw new QuotaError(`Quota exceeded reading file: ${file.name}`);
 *   }
 * }
 */
export class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

/**
 * Streams archive data as async generator of chunks.
 * 
 * This is the primary function workers should use. It yields archive data
 * chunk-by-chunk, allowing the worker to process (encrypt/upload) each chunk
 * immediately without accumulating data.
 * 
 * Archive Format:
 * ```
 * [4 bytes: manifest_length]
 * [manifest_length bytes: JSON manifest]
 * [4 bytes: file1_length]
 * [file1_length bytes: file1_data]
 * [4 bytes: file2_length]
 * [file2_length bytes: file2_data]
 * ...
 * ```
 * 
 * Memory Usage: O(chunkSize), only one chunk in memory at a time
 * 
 * @param {FileItem[]} files - Files to archive
 * @param {ArchiveStreamOptions} [options] - Configuration
 * @yields {ArchiveChunk} Chunks of archive data
 * 
 * @example
 * // In a Web Worker:
 * import { streamArchiveChunks } from './fileArchive';
 * 
 * self.onmessage = async (event) => {
 *   const { files, uploadId } = event.data;
 *   
 *   for await (const chunk of streamArchiveChunks(files, { 
 *     chunkSize: 5 * 1024 * 1024,
 *     onProgress: (idx, total, name) => {
 *       self.postMessage({ type: 'progress', fileIndex: idx, totalFiles: total });
 *     }
 *   })) {
 *     // Encrypt the chunk
 *     const encrypted = await encryptChunk(chunk.data);
 *     
 *     // Upload immediately
 *     await uploadChunk(uploadId, encrypted);
 *   }
 * };
 */
export async function* streamArchiveChunks(
  files: FileItem[],
  options: ArchiveStreamOptions = {}
): AsyncGenerator<ArchiveChunk, void, unknown> {
  const thresholds = getOptimalThresholds();
  const chunkSize = options.chunkSize || thresholds.chunkSize;

  checkAborted(options.signal);
  validateArchiveSize(files);

  // Yield manifest chunk
  const manifest = buildManifest(files);
  const manifestBytes = serializeManifest(manifest);
  yield {
    data: manifestBytes,
    type: 'manifest'
  };

  // Yield file chunks
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    checkAborted(options.signal);

    const item = files[fileIndex];
    const file = item.file;

    // Yield file header
    const fileHeader = createFileHeader(file.size);
    yield {
      data: fileHeader,
      type: 'file-header',
      fileIndex,
      fileName: item.relativePath
    };

    // Yield file data in chunks
    let fileOffset = 0;
    while (fileOffset < file.size) {
      checkAborted(options.signal);

      const end = Math.min(fileOffset + chunkSize, file.size);
      const chunk = file.slice(fileOffset, end);

      try {
        const arrayBuffer = await chunk.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        yield {
          data: uint8Array,
          type: 'file-data',
          fileIndex,
          fileName: item.relativePath,
          fileOffset
        };

        fileOffset = end;

        // Report progress
        options.onProgress?.(
          fileIndex + 1,
          files.length,
          item.relativePath,
          fileOffset,
          file.size
        );

      } catch (error) {
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
          throw new QuotaError(`Quota exceeded reading file: ${file.name}`);
        }
        throw error;
      }
    }
  }
}

/**
 * Creates a ReadableStream of archive data (alternative API).
 * 
 * Use this when you want to pipe archive data directly to a destination
 * (like fetch body or WritableStream) without manual iteration.
 * 
 * @param {FileItem[]} files - Files to archive
 * @param {ArchiveStreamOptions} [options] - Configuration
 * @returns {ReadableStream<Uint8Array>} Stream of archive bytes
 * 
 * @example
 * // Stream directly to server
 * const archiveStream = createArchiveStream(files);
 * 
 * await fetch('/upload', {
 *   method: 'POST',
 *   body: archiveStream,
 *   duplex: 'half'
 * });
 */
export function createArchiveStream(
  files: FileItem[],
  options: ArchiveStreamOptions = {}
): ReadableStream<Uint8Array> {
  const generator = streamArchiveChunks(files, options);

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await generator.next();
        
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value.data);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    
    async cancel(reason) {
      await generator.return(undefined);
    }
  });
}

/**
 * Creates an archive file in memory.
 * 
 * This accumulates the entire archive in memory before returning.
 * Only use this for files < 100MB or when streaming isn't possible.
 * 
 * Memory Usage: O(total archive size)
 * 
 * @param {FileItem[]} files - Files to archive
 * @param {ArchiveStreamOptions} [options] - Configuration
 * @returns {Promise<File>} Archive file
 * 
 * @example
 * // For small folders only
 * const archive = await createArchiveFile(files, {
 *   onProgress: (idx, total) => updateUI(idx, total)
 * });
 * 
 * // Then process the file
 * await processFile(archive);
 */
export async function createArchiveFile(
  files: FileItem[],
  options: ArchiveStreamOptions = {}
): Promise<File> {
  validateArchiveSize(files);

  const chunks: Uint8Array[] = [];

  // Collect all chunks
  for await (const chunk of streamArchiveChunks(files, options)) {
    chunks.push(chunk.data);
  }

  // Combine into single array
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  // Create file
  const archiveName = files.length === 1 ? files[0].file.name : 'folder-archive';
  
  try {
    return new File([combined], `${archiveName}.archive`, {
      type: 'application/octet-stream'
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      throw new QuotaError('Quota exceeded creating archive file.');
    }
    throw error;
  }
}

/**
 * Estimates the total size of the archive in bytes.
 * 
 * Calculation includes:
 * - All file data (exact sizes)
 * - Manifest overhead (~1KB-1MB, estimated conservatively)
 * - File headers (4 bytes per file)
 * 
 * The estimate is conservative (slightly over-estimates) to ensure
 * validation catches potential issues before processing begins.
 * 
 * Use cases:
 * - Pre-validation against size limits
 * - Progress bar initialization
 * - User confirmation for large uploads
 * - UI display of expected archive size
 * 
 * @param {FileItem[]} files - Array of files to be archived
 * @returns {number} Estimated archive size in bytes
 * 
 * @example
 * const files = processFileList(fileList);
 * const estimatedSize = estimateArchiveSize(files);
 * 
 * if (estimatedSize > 1024 * 1024 * 1024) {
 *   if (!confirm(`Archive will be ~${formatBytes(estimatedSize)}. Continue?`)) {
 *     return;
 *   }
 * }
 * 
 * @performance O(n) where n is the number of files
 */
export function estimateArchiveSize(files: FileItem[]): number {
  const totalFileSize = files.reduce((sum, item) => sum + item.file.size, 0);
  const manifestOverhead = 1024 * 1024; // 1MB conservative estimate for manifest JSON
  const headerOverhead = files.length * HEADER_SIZE_BYTES; // 4 bytes per file
  return totalFileSize + manifestOverhead + headerOverhead;
}

/**
 * Converts a FileList to an array of FileItem objects with preserved relative paths.
 * 
 * Handles both single files and folder selections:
 * - **Single files**: Uses file.name as relativePath
 * - **Folder selections**: Uses file.webkitRelativePath to preserve directory structure
 * 
 * The webkitRelativePath property is automatically populated by browsers when
 * files are selected via `<input webkitdirectory>`. For single files or drag-and-drop,
 * this property is empty, so we fall back to the filename.
 * 
 * @param {FileList} files - FileList from an input element or drag-and-drop event
 *   Typically obtained from:
 *   - event.target.files (file input)
 *   - event.dataTransfer.files (drag-and-drop)
 * 
 * @returns {FileItem[]} Array of structured file items with File objects and relative paths
 *   Each item contains:
 *   - file: The original File object (reference, not copy)
 *   - relativePath: Path for reconstructing folder structure
 * 
 * @example
 * // Handle file input
 * const input = document.querySelector('input[type="file"]');
 * input.addEventListener('change', (event) => {
 *   const files = event.target.files;
 *   const fileItems = processFileList(files);
 *   console.log(fileItems); // [{ file: File, relativePath: 'file.txt' }, ...]
 * });
 * 
 * @example
 * // Handle folder input (preserves structure)
 * const input = document.querySelector('input[webkitdirectory]');
 * input.addEventListener('change', (event) => {
 *   const files = event.target.files;
 *   const fileItems = processFileList(files);
 *   // fileItems = [
 *   //   { file: File, relativePath: 'docs/readme.md' },
 *   //   { file: File, relativePath: 'src/index.ts' },
 *   // ]
 * });
 * 
 * @performance O(n) where n is the number of files
 * @sideeffects None, it creates new array but preserves original File objects
 */
export function processFileList(files: FileList): FileItem[] {
  const items: FileItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relativePath = hasWebkitRelativePath(file)
      ? file.webkitRelativePath
      : file.name;

    items.push({ file, relativePath });
  }

  return items;
}

/**
 * Validates that the estimated archive size does not exceed browser blob size limits.
 * 
 * Browsers have a maximum blob size (typically 2GB) that varies by implementation.
 * This check prevents attempting to create archives that would fail allocation.
 * 
 * Called at the start of archive operations to fail fast and provide
 * actionable error messages before any processing begins.
 * 
 * @param {FileItem[]} files - Files to be archived
 * @returns {void}
 * 
 * @throws {ArchiveSizeError} When estimated size exceeds MAX_SAFE_BLOB_SIZE (2GB)
 *   Error includes formatted sizes and recovery suggestions
 * 
 * @example
 * try {
 *   validateArchiveSize(files);
 *   // Proceed with archiving
 * } catch (error) {
 *   if (error instanceof ArchiveSizeError) {
 *     console.error('Archive too large, using streaming approach');
 *     useStreamingArchive(files);
 *   }
 * }
 * 
 * @internal
 * @performance O(n) where n is the number of files
 */
function validateArchiveSize(files: FileItem[]): void {
  const estimatedSize = estimateArchiveSize(files);

  if (estimatedSize > MAX_SAFE_BLOB_SIZE) {
    throw new ArchiveSizeError(estimatedSize, MAX_SAFE_BLOB_SIZE);
  }
}

/**
 * Constructs the archive manifest containing metadata for all files.
 * 
 * The manifest is a JSON structure that precedes the file data in the archive format.
 * It provides the metadata necessary for archive extraction:
 * - Relative paths for reconstructing directory structure
 * - File sizes for validation and progress tracking
 * - Last modified timestamps for preserving file attributes
 * 
 * Manifest is kept separate from file data to enable:
 * - Fast metadata scanning without reading entire archive
 * - Validation before extraction
 * - Progress calculation during extraction
 * 
 * @param {FileItem[]} files - Files to include in the archive
 * @returns {ArchiveManifest} Structured manifest with version and file metadata
 * 
 * @example
 * const files = [
 *   { file: new File(['content'], 'readme.md'), relativePath: 'readme.md' },
 *   { file: new File(['code'], 'main.js'), relativePath: 'src/main.js' }
 * ];
 * const manifest = buildManifest(files);
 * // {
 * //   version: '1.0',
 * //   files: [
 * //     { path: 'readme.md', size: 7, lastModified: 1234567890 },
 * //     { path: 'src/main.js', size: 4, lastModified: 1234567890 }
 * //   ]
 * // }
 * 
 * @internal
 * @performance O(n) where n is the number of files
 * @sideeffects None, it is a pure function
 */
function buildManifest(files: FileItem[]): ArchiveManifest {
  return {
    version: ARCHIVE_VERSION,
    files: files.map(item => ({
      path: item.relativePath,
      size: item.file.size,
      lastModified: item.file.lastModified
    }))
  };
}

/**
 * Serializes the archive manifest to binary format with a length-prefixed header.
 * 
 * Binary Format:
 * ```
 * [4 bytes: manifest length (uint32, little-endian)]
 * [N bytes: UTF-8 encoded JSON manifest]
 * ```
 * 
 * The length prefix allows readers to:
 * - Know exactly how many bytes to read for the manifest
 * - Skip directly to file data without parsing JSON
 * - Validate manifest integrity
 * 
 * Uses little-endian byte order for consistency with modern architectures
 * and JavaScript TypedArray default behavior.
 * 
 * @param {ArchiveManifest} manifest - The manifest object to serialize
 * @returns {Uint8Array} Binary data containing [length header][manifest bytes]
 * 
 * @example
 * const manifest = { version: '1.0', files: [...] };
 * const serialized = serializeManifest(manifest);
 * // serialized[0-3]: manifest length in bytes (uint32 LE)
 * // serialized[4+]: UTF-8 JSON string
 * 
 * @internal
 * @performance O(m) where m is the size of the JSON manifest string
 * @sideeffects None, it is a pure function
 */
function serializeManifest(manifest: ArchiveManifest): Uint8Array {
  const manifestStr = JSON.stringify(manifest);
  const manifestBytes = new TextEncoder().encode(manifestStr);
  const manifestHeader = new Uint8Array(HEADER_SIZE_BYTES);
  new DataView(manifestHeader.buffer).setUint32(0, manifestBytes.length, true);

  // Combine header + manifest into single contiguous buffer
  const combined = new Uint8Array(manifestHeader.length + manifestBytes.length);
  combined.set(manifestHeader, 0);
  combined.set(manifestBytes, HEADER_SIZE_BYTES);
  return combined;
}

/**
 * Creates a binary header containing the file size for archive format.
 * 
 * Each file in the archive is preceded by a 4-byte header specifying the
 * exact byte length of the following file data. This enables:
 * - Sequential reading without filename-based boundaries
 * - Validation of complete file transmission
 * - Skip-ahead capability for selective extraction
 * 
 * Binary Format:
 * ```
 * [4 bytes: file size (uint32, little-endian)]
 * ```
 * 
 * Maximum file size: 4,294,967,295 bytes (~4.29GB) due to uint32 limit.
 * 
 * @param {number} fileSize - Size of the file in bytes (must be ≥ 0 and ≤ 4,294,967,295)
 * @returns {Uint8Array} 4-byte header containing the size in little-endian format
 * 
 * @example
 * const header = createFileHeader(1024); // File is 1KB
 * // header = Uint8Array([0x00, 0x04, 0x00, 0x00]) in little-endian
 * 
 * @internal
 * @performance O(1) constant time operation
 * @sideeffects None, it is a pure function
 */
function createFileHeader(fileSize: number): Uint8Array {
  const header = new Uint8Array(HEADER_SIZE_BYTES);
  new DataView(header.buffer).setUint32(0, fileSize, true);
  return header;
}

/**
 * Checks if the operation has been aborted via AbortSignal and throws if so.
 * 
 * This function should be called at regular checkpoints during long-running
 * operations to enable responsive cancellation. Throwing an AbortError allows
 * the caller to distinguish between user-initiated cancellation and other errors.
 * 
 * Usage pattern:
 * - Call before starting each file
 * - Call before each chunk read
 * - Call in any long loop
 * 
 * @param {AbortSignal} [signal] - Optional abort signal to check (undefined = no cancellation)
 * @returns {void}
 * 
 * @throws {DOMException} With name 'AbortError' if signal.aborted is true
 *   This error can be caught and handled gracefully without treating it as a failure.
 * 
 * @example
 * const controller = new AbortController();
 * 
 * try {
 *   for (const file of files) {
 *     checkAborted(controller.signal);
 *     await processFile(file);
 *   }
 * } catch (error) {
 *   if (error instanceof DOMException && error.name === 'AbortError') {
 *     console.log('User cancelled operation');
 *     return; // Clean exit
 *   }
 *   throw error; // Propagate other errors
 * }
 * 
 * @internal
 * @performance O(1) constant time property check
 * @sideeffects None when signal is not aborted; throws when aborted
 */
function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Archive creation aborted', 'AbortError');
  }
}

/**
 * Formats a byte count into a human-readable string with appropriate units.
 * 
 * Converts raw byte counts to more readable units (KB, MB, GB, TB) using
 * binary multiples (1024-based) as is standard for file sizes.
 * 
 * Rounding:
 * - Rounds to 2 decimal places for readability
 * - Uses Math.round() for standard rounding behavior
 * 
 * Examples:
 * - 0 → "0 Bytes"
 * - 1024 → "1 KB"
 * - 1536 → "1.5 KB"
 * - 1048576 → "1 MB"
 * - 5368709120 → "5 GB"
 * 
 * @param {number} bytes - The number of bytes to format (must be ≥ 0)
 * @returns {string} Formatted string with value and unit (e.g., "5.23 MB")
 * 
 * @example
 * console.log(formatBytes(0));           // "0 Bytes"
 * console.log(formatBytes(1024));        // "1 KB"
 * console.log(formatBytes(1234567));     // "1.18 MB"
 * console.log(formatBytes(1073741824));  // "1 GB"
 * 
 * @internal
 * @performance O(1) constant time operation
 * @sideeffects None, it is a pure function
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Type guard to check if a File object has the webkitRelativePath property.
 * 
 * The webkitRelativePath property is a non-standard extension added by browsers
 * when files are selected via directory picker (webkitdirectory attribute).
 * It contains the full path relative to the selected directory root.
 * 
 * Browser Support:
 * - Chrome/Edge: Fully supported
 * - Firefox: Supported
 * - Safari: Supported
 * - Standard: Not in File API spec, but widely implemented
 * 
 * This type guard enables TypeScript to safely access the property after validation,
 * providing type narrowing so that TypeScript knows the property exists.
 * 
 * @param {File} file - The File object to check
 * @returns {boolean} True if webkitRelativePath exists and is a string, false otherwise
 * 
 * @example
 * const file = fileList[0];
 * 
 * if (hasWebkitRelativePath(file)) {
 *   // TypeScript now knows file.webkitRelativePath is a string
 *   console.log('Path:', file.webkitRelativePath); // "folder/subfolder/file.txt"
 * } else {
 *   // Single file or drag-and-drop, use filename
 *   console.log('Path:', file.name); // "file.txt"
 * }
 * 
 * @internal
 * @performance O(1) constant time property checks
 * @sideeffects None, it is a pure function
 */
function hasWebkitRelativePath(
  file: File
): file is File & { webkitRelativePath: string } {
  return (
    'webkitRelativePath' in file &&
    typeof (file as any).webkitRelativePath === 'string'
  );
}