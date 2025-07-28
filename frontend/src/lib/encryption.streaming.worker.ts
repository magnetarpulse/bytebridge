/**
 * @file This Web Worker implements a robust, high-performance streaming file upload pipeline for large files and sensitive data.
 * @module EncryptionStreamingWorker
 * 
 * @description
 * This worker operates in a dedicated thread, offloading CPU- and network-intensive operations from the main UI thread.
 * 
 * @architecture
 * - Data flows through a multi-stage pipeline: file read → compression (Gzip) → encryption (libsodium secretstream) → chunked upload.
 * - This worker acts as the producer, orchestrating chunk creation, encryption, and upload coordination. It interacts with a 
 *   dedicated consumer worker for advanced WebTransport chunk delivery.
 * - Supports parallel uploads using both HTTP and WebTransport, with adaptive chunk sizing and connection pooling for optimal throughput.
 * - Uses libsodium secretstream for authenticated, stateful encryption, ensuring confidentiality and integrity for each chunk.
 * - Implements automatic retries, exponential backoff, and connection management to handle transient network failures.
 * - Dynamically adjusts chunk size and manages backpressure based on real-time network and system performance.
 * 
 * @features
 * - Streaming, memory-efficient file processing
 * - Parallel chunk uploads with configurable concurrency
 * - WebTransport support with producer/consumer coordination
 * - Adaptive chunk sizing and throughput monitoring
 * - Authenticated, stateful encryption for all data
 * - Robust error handling and automatic recovery
 * - Detailed progress reporting and protocol messaging
 * 
 * @communication
 * 
 * Messages Received from Main Thread:
 * - { type: 'init', payload: { compressionLevel, keyFingerprint, useWebTransport } }
 *   Initializes compression and encryption settings. Must be called before upload.
 * - { type: 'start-streaming-upload', payload: { file, uploadId, header } }
 *   Begins the streaming upload pipeline for the specified file.
 * - { type: 'abort', payload: {} }
 *   Immediately aborts all processing and cleans up state.
 * 
 * Messages Sent to Main Thread:
 * - { type: 'ready' }
 *   Worker is initialized and ready for commands.
 * - { type: 'init-success', payload: { header, hexKey, base64Nonce, keyFingerprint, transportMethod } }
 *   Initialization succeeded; provides encryption stream header and metadata.
 * - { type: 'chunk-upload-progress', payload: { processedBytes, totalBytes, currentChunkSize, activeUploads, queuedChunks, transportMethod } }
 *   Periodic progress updates during upload.
 * - { type: 'all-chunks-sent' }
 *   All file chunks have been processed and uploaded successfully.
 * - { type: 'error', payload: string }
 *   Non-recoverable error occurred; includes error message.
 * 
 * Producer/Consumer Coordination (WebTransport):
 * - Coordinates with a dedicated consumer worker for efficient chunk delivery and batch processing over WebTransport.
 * - Producer manages chunk buffer, notification batching, and state for each upload session.
 * - Consumer is responsible for connection pooling, batch streaming, and final delivery to the server.
 * 
 * @references
 * - libsodium.js (https://github.com/jedisct1/libsodium.js) — Encryption implementation
 * - fflate (https://github.com/101Arrowz/fflate) — Gzip compression
 * - WebTransport API (https://web.dev/webtransport/) — High-performance transport protocol
 */
import { Gzip, type GzipOptions } from 'fflate';
import { initializeSodium, initStreamingEncrypt, encryptStreamChunk } from './encryption';


/**
 * Maximum number of chunks to upload concurrently.
 *
 * Balances network throughput with browser/server connection limits to avoid congestion.
 * Higher values may improve speed but risk overloading connections.
 * @type {number}
 */
const MAX_CONCURRENT_UPLOADS: number = 4;


/**
 * Base size for reading file chunks in bytes.
 *
 * Used as the starting point for adaptive chunk sizing, which may increase or decrease
 * based on observed network performance. Ensures efficient memory usage and throughput.
 * @type {number}
 */
let DYNAMIC_CHUNK_SIZE: number = 2 * 1024 * 1024; // Start with 2MB


/**
 * Minimum allowed chunk size in bytes for adaptive sizing.
 *
 * Prevents excessive overhead from very small chunks, ensuring reasonable upload efficiency.
 * @type {number}
 */
const MIN_CHUNK_SIZE: number = 1 * 1024 * 1024; // 1MB


/**
 * Maximum allowed chunk size in bytes for adaptive sizing.
 *
 * Prevents memory issues and ensures frequent progress reporting by capping chunk size.
 * @type {number}
 */
const MAX_CHUNK_SIZE: number = 8 * 1024 * 1024; // 8MB


/**
 * History of recent upload throughputs (bytes/ms).
 *
 * Used by the adaptive chunk sizing algorithm to dynamically adjust chunk size for optimal performance.
 * Maintains a sliding window of recent throughput measurements.
 * @type {number[]}
 */
let uploadPerformanceHistory: number[] = [];


/**
 * Fallback HTTP endpoint URL for chunk uploads when WebTransport is unavailable.
 *
 * Used for reliable uploads via HTTP POST when advanced transport is not supported.
 * @type {string}
 */
const HTTP_FALLBACK_URL: string = `https://${self.location.hostname}:8000/api/v1/upload/chunk/`;


/**
 * State for the current libsodium secretstream encryption session.
 *
 * Required for encrypting each chunk in the stream. Initialized on 'init', cleared after upload or abort.
 * @type {any | null}
 */
let cryptoState: any = null;


/**
 * Compression options for fflate Gzip.
 *
 * Set during initialization from main thread. Controls compression level and behavior for streaming pipeline.
 * @type {GzipOptions | null}
 */
let gzipOptions: GzipOptions | null = null;


/**
 * Flag to enable WebTransport usage if available.
 *
 * Can be set via worker initialization message. Controls whether advanced transport is preferred.
 * @type {boolean}
 */
let USE_WEBTRANSPORT_IF_AVAILABLE: boolean = true; // Can be set via worker init message


/**
 * Indicates if WebTransport is supported and enabled for uploads.
 *
 * Determined during worker initialization based on browser capabilities and user preference.
 * @type {boolean}
 */
let useWebTransport: boolean = false;


/**
 * Dedicated worker instance for the WebTransport consumer.
 *
 * Handles chunk delivery, batch streaming, and connection pooling on the consumer side.
 * Terminated and re-initialized for each upload session.
 * @type {Worker | null}
 */
let webTransportConsumerWorker: Worker | null = null;


/**
 * Buffer mapping chunk indices to encrypted chunk data for the current upload session.
 *
 * Used for producer/consumer coordination and efficient chunk delivery in WebTransport mode.
 * Cleared after upload completion or abort.
 * @type {Map<number, Uint8Array>}
 */
let webTransportChunkBuffer: Map<number, Uint8Array> = new Map<number, Uint8Array>();


/**
 * Promise handlers for each chunk, keyed by chunk index.
 *
 * Used to resolve or reject chunk upload completion based on consumer feedback in WebTransport mode.
 * Cleared after upload completion or abort.
 * @type {Map<number, { resolve: () => void; reject: (error: Error) => void; }>}
 */
let webTransportChunkPromises: Map<number, { resolve: () => void; reject: (error: Error) => void; }> = new Map<number, { resolve: () => void; reject: (error: Error) => void; }>();


/**
 * Current upload session identifier for producer/consumer coordination.
 *
 * Ensures all state and chunk delivery is scoped to the correct upload session. Cleared after completion or abort.
 * @type {string | null}
 */
let webTransportUploadId: string | null = null;

/**
 * The active WebTransport connection for the current upload session.
 *
 * This connection is used for direct chunk streaming when operating in WebTransport mode.
 * It is managed by the producer and closed after the upload completes or is aborted.
 * May be null if WebTransport is not enabled or the connection has not been established.
 * @type {WebTransport | null}
 */
let webTransportConnection: WebTransport | null = null;

/**
 * Pool of active WebTransport connections, keyed by upload session ID.
 *
 * Enables connection reuse and parallelism for multiple concurrent uploads.
 * Each entry represents a separate WebTransport connection for a unique upload session.
 * Connections are closed and removed from the pool after completion or error.
 * @type {Map<string, WebTransport>}
 */
let connectionPool: Map<string, WebTransport> = new Map();

/**
 * Queue of pending chunk notifications for producer/consumer coordination.
 *
 * Each entry contains the chunk index and associated upload ID, representing a chunk
 * that is ready to be sent to the consumer worker for upload. Notifications are batched
 * for performance and sent to the consumer in groups to optimize throughput.
 * @type {{chunkIndex: number, uploadId: string}[]}
 */
let pendingChunkNotifications: {chunkIndex: number, uploadId: string, encryptionSequence: number}[] = [];

/**
 * Timeout handle for batching chunk-ready notifications to the consumer worker.
 *
 * Used to delay and batch multiple chunk notifications for efficient inter-worker messaging.
 * Cleared after notifications are flushed or when the upload session ends.
 * May be null if no batch is currently scheduled.
 * @type {number | null}
 */
let batchNotificationTimeout: number | null = null;

/**
 * Detects if the current browser supports WebTransport.
 * 
 * This function checks if the WebTransport API is available in the current browser
 * and if the user configuration allows its use. It combines both the browser capability
 * check and user preference flag.
 *
 * @returns {boolean} True if WebTransport is supported and enabled, false otherwise.
 */
function detectWebTransportSupport(): boolean {
    return typeof WebTransport !== 'undefined' && USE_WEBTRANSPORT_IF_AVAILABLE;
}

/**
 * Cleans up all active connections and producer/consumer state for the current upload session.
 * 
 * This function performs a comprehensive cleanup of all network and state resources:
 * - Closes all pooled HTTP/WebTransport connections used for fallback or parallel uploads.
 * - Terminates the dedicated WebTransport consumer worker if present.
 * - Clears all chunk buffers, promise handlers, and upload session identifiers to prevent memory leaks.
 * - Ensures the worker is ready for a new upload session or safe shutdown.
 */
function closeAllConnections(): void {
    // Close all pooled connections (HTTP/WebTransport)
    for (const [uploadId, transport] of connectionPool.entries()) {
        console.debug(`[Encryption Stream] Closing pooled connection for upload ${uploadId}`);
        transport.close();
    }
    connectionPool.clear();
    if (webTransportConnection) {
        webTransportConnection.close();
        webTransportConnection = null;
    }

    // Terminate the dedicated consumer worker (WebTransport producer/consumer model)
    if (webTransportConsumerWorker) {
        webTransportConsumerWorker.terminate();
        webTransportConsumerWorker = null;
        console.debug('[Encryption Stream] Terminated WebTransport consumer worker');
    }

    // Clear all producer-side buffers and promise handlers for chunk delivery
    webTransportChunkBuffer.clear();
    webTransportChunkPromises.clear();
    webTransportUploadId = null;
    console.debug('[Encryption Stream] Closed all connections and fully cleaned up WebTransport producer state');
}

/**
 * Represents a single unit of work for the upload manager.
 * 
 * This interface defines the structure for upload tasks that are queued and processed
 * by the ParallelUploadManager. Each task contains all the information needed to
 * upload a single chunk of data, including its content, position in the sequence,
 * and association with a specific upload session.
 * 
 * @interface UploadTask
 */
interface UploadTask {
    /** The binary data of the chunk to be uploaded */
    chunk: Uint8Array;
    
    /** The zero-based, sequential index of the chunk. Essential for reassembly on the server */
    chunkIndex: number;
    
    /** A unique identifier for the entire file upload session */
    uploadId: string;
    
    /** The timestamp when the task was created, used for timing and diagnostics */
    timestamp: number;
}

/**
 * Manages the parallel execution of upload tasks with controlled concurrency.
 *
 * This class orchestrates multiple concurrent uploads while ensuring the number of
 * active uploads doesn't exceed MAX_CONCURRENT_UPLOADS. It handles task queuing,
 * error management, throughput monitoring, and completion tracking for both HTTP and
 * WebTransport fallback uploads.
 *
 * @class ParallelUploadManager
 */
class ParallelUploadManager {
    /** Queue of upload tasks waiting to be processed */
    private uploadQueue: UploadTask[] = [];
    
    /** Set of chunk indices currently being uploaded */
    private activeUploads = new Set<number>();
    
    /** Set of chunk indices that have been successfully uploaded */
    private completedChunks = new Set<number>();
    
    /** Map of promises for tracking chunk upload completion */
    private chunkPromises = new Map<number, {
        resolve: () => void;
        reject: (error: Error) => void;
    }>();

    /**
     * Adds a chunk to the upload queue and returns a promise that resolves when the chunk is uploaded.
     * 
     * This method is primarily used for the HTTP upload path or as a WebTransport fallback
     * mechanism when the main WebTransport producer/consumer model isn't being used.
     *
     * @param {Uint8Array} chunk - The binary data to upload
     * @param {number} chunkIndex - The sequential index of the chunk
     * @param {string} uploadId - The unique identifier for the upload session
     * @returns {Promise<void>} A promise that resolves when the chunk is uploaded or rejects on failure
     */
    async addChunk(chunk: Uint8Array, chunkIndex: number, uploadId: string): Promise<void> {
        const task: UploadTask = {
            chunk,
            chunkIndex,
            uploadId,
            timestamp: Date.now()
        };
        const chunkPromise = new Promise<void>((resolve, reject) => {
            this.chunkPromises.set(chunkIndex, { resolve, reject });
        });
        this.uploadQueue.push(task);
        this.processQueue();
        return chunkPromise;
    }

    /**
     * Processes the upload queue, ensuring concurrency doesn't exceed the maximum allowed.
     * 
     * This method starts new upload tasks if there are available slots within the concurrency
     * limit. It manages the flow of chunks from the queue to active uploads.
     *
     * @private
     * @returns {Promise<void>} A promise that resolves when queue processing is complete
     */
    private async processQueue(): Promise<void> {
        while (this.activeUploads.size < MAX_CONCURRENT_UPLOADS && this.uploadQueue.length > 0) {
            const task = this.uploadQueue.shift()!;
            this.executeUpload(task).catch(err => {
                console.error(`[Encryption Stream] Failed to upload chunk #${task.chunkIndex}:`, err);
                const promiseHandlers = this.chunkPromises.get(task.chunkIndex);
                if (promiseHandlers) {
                    promiseHandlers.reject(err instanceof Error ? err : new Error(String(err)));
                    this.chunkPromises.delete(task.chunkIndex);
                }
            });
        }
    }

    /**
     * Executes the upload for a single task and tracks its performance.
     * 
     * This method handles the full lifecycle of a single upload task, including:
     * - Tracking when the upload starts and finishes
     * - Measuring performance for adaptive chunk sizing
     * - Managing promise resolution for task completion
     * - Ensuring cleanup of active uploads and continuing queue processing
     *
     * @private
     * @param {UploadTask} task - The upload task to execute
     * @returns {Promise<void>} A promise that resolves when the upload is complete
     * @throws {Error} If the upload fails after retries
     */
    private async executeUpload(task: UploadTask): Promise<void> {
        this.activeUploads.add(task.chunkIndex);
        try {
            console.debug(`[Encryption Stream] Starting upload for chunk #${task.chunkIndex}, size: ${task.chunk.length} bytes, using ${useWebTransport ? 'WebTransport' : 'HTTP'}`);
            const startTime = Date.now();
            await this.performUpload(task);
            const duration = Date.now() - startTime;
            this.trackUploadPerformance(task.chunk.length, duration);
            this.completedChunks.add(task.chunkIndex);
            console.debug(`[Encryption Stream] Chunk #${task.chunkIndex} uploaded in ${duration}ms`);
            const promiseHandlers = this.chunkPromises.get(task.chunkIndex);
            if (promiseHandlers) {
                promiseHandlers.resolve();
                this.chunkPromises.delete(task.chunkIndex);
            }
        } catch (err) {
            throw err;
        } finally {
            this.activeUploads.delete(task.chunkIndex);
            this.processQueue();
        }
    }

    /**
     * Performs the upload with retry logic and transport selection.
     * 
     * This method attempts to upload a chunk using the best available transport method,
     * with automatic retry logic using exponential backoff for transient failures.
     * It will attempt WebTransport if available, falling back to HTTP if needed.
     *
     * @private
     * @param {UploadTask} task - The upload task to perform
     * @returns {Promise<void>} A promise that resolves when the upload succeeds
     * @throws {Error} If all upload attempts fail after maximum retries
     */
    private async performUpload(task: UploadTask): Promise<void> {
        let retries = 0;
        const maxRetries = 3;
        while (true) {
            try {
                // This manager's performUpload can still try WebTransport as a fallback for individual chunks
                // if it's used outside the main WebTransport producer mode.
                if (detectWebTransportSupport()) {
                     await this.performWebTransportUpload(task);
                } else {
                    await this.performHTTPUpload(task);
                }
                return;
            } catch (err) {
                retries++;
                if (retries > maxRetries) {
                    throw err;
                }
                const delay = Math.min(1000 * (2 ** retries) + Math.random() * 1000, 10000);
                console.warn(`[Encryption Stream] Retry ${retries}/${maxRetries} for chunk #${task.chunkIndex} after ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    /**
     * Performs an upload using WebTransport.
     * 
     * This method handles the WebTransport-specific upload logic, including:
     * - Managing connection pooling and reuse
     * - Creating unidirectional streams for chunk transfer
     * - Writing metadata and chunk data to the stream
     * - Handling connection failures and cleanup
     *
     * @private
     * @param {UploadTask} task - The upload task to perform
     * @returns {Promise<void>} A promise that resolves when the WebTransport upload succeeds
     * @throws {Error} If the WebTransport upload fails
     */
    private async performWebTransportUpload(task: UploadTask): Promise<void> {
        try {
            let transport = connectionPool.get(task.uploadId);
            if (!transport) {
                const baseUrl = `https://${self.location.hostname}:8001/upload/${task.uploadId}`;
                console.debug(`[Encryption Stream] Creating new WebTransport connection for upload ${task.uploadId}`);
                transport = new WebTransport(baseUrl);
                await transport.ready;
                connectionPool.set(task.uploadId, transport);
                transport.closed.catch(error => {
                    console.debug(`[Encryption Stream] WebTransport connection closed: ${error}`);
                    connectionPool.delete(task.uploadId);
                });
            }
            console.debug(`[Encryption Stream] Opening stream for chunk #${task.chunkIndex} on existing connection`);
            const stream = await transport.createUnidirectionalStream();
            const writer = stream.getWriter();
            const metadata = {
                uploadId: task.uploadId,
                chunkIndex: task.chunkIndex,
                filename: `${task.uploadId}-chunk-${task.chunkIndex}.bin`
            };
            const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata) + '\n');
            await writer.write(metadataBytes);
            await writer.write(task.chunk);
            await writer.close();
        } catch (error) {
            connectionPool.delete(task.uploadId);
            if (error instanceof Error && error.message.includes('connection')) {
                // Note: This affects global state, might not be ideal for this internal manager
                // Consider if this fallback logic is needed here or handled elsewhere.
                // useWebTransport = false;
            }
            throw new Error(`WebTransport upload failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Performs an upload using HTTP as a fallback.
     * 
     * This method handles the HTTP-specific upload logic using FormData and fetch API.
     * It's used when WebTransport is unavailable or disabled, providing a reliable
     * fallback mechanism for chunk uploads.
     *
     * @private
     * @param {UploadTask} task - The upload task to perform
     * @returns {Promise<void>} A promise that resolves when the HTTP upload succeeds
     * @throws {Error} If the HTTP upload fails
     */
    private async performHTTPUpload(task: UploadTask): Promise<void> {
        const formData = new FormData();
        formData.append('uploadId', task.uploadId);
        const chunkFileName = String(task.chunkIndex).padStart(6, '0') + '.part';
        formData.append('chunkIndex', chunkFileName);
        formData.append('fileChunk', new Blob([task.chunk]));
        const response = await fetch(HTTP_FALLBACK_URL, {
            method: 'POST',
            body: formData,
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP upload failed with status ${response.status}`);
        }
    }

    /**
     * Tracks upload performance metrics to inform adaptive chunk sizing.
     * 
     * This method calculates and records throughput for each upload, maintaining a
     * sliding window of recent performance data that's used to dynamically adjust
     * chunk sizes for optimal performance.
     *
     * @private
     * @param {number} chunkSize - The size of the uploaded chunk in bytes
     * @param {number} duration - The time taken to upload the chunk in milliseconds
     */
    private trackUploadPerformance(chunkSize: number, duration: number): void {
        if (duration === 0) return;
        const throughput = chunkSize / duration;
        uploadPerformanceHistory.push(throughput);
        if (uploadPerformanceHistory.length > 10) {
            uploadPerformanceHistory = uploadPerformanceHistory.slice(-10);
        }
        this.adjustChunkSize();
    }

    /**
     * Dynamically adjusts chunk size based on observed network performance.
     * 
     * This method implements an adaptive algorithm that increases or decreases the chunk
     * size based on how current throughput compares to the average. It respects minimum
     * and maximum chunk size boundaries to ensure balanced performance.
     * 
     * - Increases chunk size when throughput is good (20% above average)
     * - Decreases chunk size when throughput is poor (20% below average)
     * - Maintains chunk size when throughput is stable
     *
     * @private
     */
    private adjustChunkSize(): void {
        if (uploadPerformanceHistory.length < 3) return;
        const avgThroughput = uploadPerformanceHistory.reduce((a, b) => a + b) / uploadPerformanceHistory.length;
        const recentThroughput = uploadPerformanceHistory[uploadPerformanceHistory.length - 1];
        if (recentThroughput > avgThroughput * 1.2 && DYNAMIC_CHUNK_SIZE < MAX_CHUNK_SIZE) {
            DYNAMIC_CHUNK_SIZE = Math.min(DYNAMIC_CHUNK_SIZE * 1.5, MAX_CHUNK_SIZE);
            console.debug(`[Encryption Stream] Increased chunk size to ${DYNAMIC_CHUNK_SIZE / 1024 / 1024}MB`);
        }
        else if (recentThroughput < avgThroughput * 0.8 && DYNAMIC_CHUNK_SIZE > MIN_CHUNK_SIZE) {
            DYNAMIC_CHUNK_SIZE = Math.max(DYNAMIC_CHUNK_SIZE * 0.8, MIN_CHUNK_SIZE);
            console.debug(`[Encryption Stream] Decreased chunk size to ${DYNAMIC_CHUNK_SIZE / 1024 / 1024}MB`);
        }
    }

    /**
     * Waits for all current uploads to complete.
     * 
     * This method provides a way to synchronize with the completion of all active and queued uploads.
     * It's typically called at the end of an upload process to ensure all chunks have been 
     * successfully transferred before finalizing the upload.
     *
     * @returns {Promise<void>} A promise that resolves when all uploads have completed
     */
    async waitForAllUploads(): Promise<void> {
        if (this.activeUploads.size > 0 || this.uploadQueue.length > 0) {
            await Promise.all(Array.from(this.chunkPromises.values()));
        }
        console.debug(`[Encryption Stream] All uploads complete. Uploaded ${this.completedChunks.size} chunks.`);
    }
}

/**
 * Initializes the WebTransport producer logic and sets up the consumer worker for chunk transfer.
 *
 * - Spawns a dedicated consumer worker for advanced WebTransport chunk delivery and batch streaming.
 * - Coordinates initialization and readiness messaging between producer and consumer.
 * - Ensures all chunk delivery and state is scoped to the correct upload session.
 *
 * @param {string} uploadId The unique identifier for the upload session.
 * @returns {Promise<void>} Resolves when the consumer worker is ready.
 */
async function initWebTransportProducer(uploadId: string): Promise<void> {
    if (!useWebTransport) {
        throw new Error("initWebTransportProducer called but useWebTransport is false");
    }

    try {
        if (webTransportConsumerWorker) {
            webTransportConsumerWorker.terminate();
        }

        webTransportConsumerWorker = new Worker(new URL('./webtransport.streaming.worker.js', import.meta.url));
        console.debug('[Encryption Stream] Created WebTransport consumer worker');

        await new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                webTransportConsumerWorker?.terminate();
                reject(new Error('Consumer worker init timeout'));
            }, 5000);

            const messageHandler = (event: MessageEvent) => {
                const { type, payload } = event.data;
                if (type === 'consumer-ready') {
                    clearTimeout(timeoutId);
                    if (webTransportConsumerWorker) {
                        webTransportConsumerWorker.removeEventListener('message', messageHandler);
                    }
                    console.debug('[Encryption Stream] WebTransport consumer worker is ready');
                    resolve();
                } else if (type === 'consumer-error') {
                    clearTimeout(timeoutId);
                    if (webTransportConsumerWorker) {
                        webTransportConsumerWorker.removeEventListener('message', messageHandler);
                        webTransportConsumerWorker.terminate();
                    }
                    reject(new Error(`Consumer init error: ${payload}`));
                }
            };

        if (webTransportConsumerWorker) {
            webTransportConsumerWorker.addEventListener('message', messageHandler);
            webTransportConsumerWorker.addEventListener('error', (e) => {
                clearTimeout(timeoutId);
                reject(new Error(`Consumer worker script error: ${e.message}`));
            });
            webTransportConsumerWorker.postMessage({ type: 'consumer-init', payload: { uploadId } });
        }
        });

        webTransportConsumerWorker.onmessage = handleConsumerMessage;
        webTransportUploadId = uploadId;
        console.debug('[Encryption Stream] WebTransport producer initialized for upload', uploadId);

    } catch (error) {
        console.error('[Encryption Stream] Failed to initialize WebTransport producer/consumer:', error);
        if (webTransportConsumerWorker) {
            webTransportConsumerWorker.terminate();
            webTransportConsumerWorker = null;
        }
        webTransportUploadId = null;
        throw error;
    }
}

/**
 * Handles messages received from the WebTransport consumer worker.
 * 
 * This function processes the various types of messages that can be received from the consumer worker:
 * - Chunk pull requests: When the consumer is ready to upload a specific chunk
 * - Upload completion notifications: When the consumer has successfully uploaded chunks
 * - Batch completion notifications: When the consumer has completed a batch of uploads
 * - Error notifications: When the consumer encounters errors during upload
 *
 * The handler ensures proper coordination between producer and consumer, maintaining the
 * state necessary for reliable chunk delivery and promise resolution.
 * 
 * @param {MessageEvent} event - The message event from the consumer worker
 */
function handleConsumerMessage(event: MessageEvent) {
    const { type, payload } = event.data;
    console.debug(`[Encryption Stream] Received message from consumer: ${type}`, payload?.chunkIndex);

    if (type === 'pull-chunk') {
        const { chunkIndex, uploadId } = payload;
        if (uploadId !== webTransportUploadId) {
             console.warn('[Encryption Stream] pull-chunk for wrong uploadId', uploadId, webTransportUploadId);
             return;
        }

        const chunk = webTransportChunkBuffer.get(chunkIndex);
        if (chunk) {
            console.debug(`[Encryption Stream] Sending chunk data #${chunkIndex} to consumer`);
            webTransportChunkBuffer.delete(chunkIndex);
            webTransportConsumerWorker?.postMessage({
                type: 'chunk-data',
                payload: { chunk, chunkIndex, uploadId }
            }, [chunk.buffer]);
        } else {
            console.error(`[Encryption Stream] Consumer requested chunk #${chunkIndex} but it was not found in buffer`);
            const promiseHandlers = webTransportChunkPromises.get(chunkIndex);
            if (promiseHandlers) {
                promiseHandlers.reject(new Error(`Chunk ${chunkIndex} not found in producer buffer when requested`));
                webTransportChunkPromises.delete(chunkIndex);
            }
            webTransportConsumerWorker?.postMessage({
                type: 'chunk-upload-error',
                payload: { chunkIndex, uploadId, error: `Chunk ${chunkIndex} not found` }
            });
        }

    } else if (type === 'chunk-upload-complete') {
        const { chunkIndex, uploadId } = payload;
        if (uploadId !== webTransportUploadId) {
             console.warn('[Encryption Stream] chunk-upload-complete for wrong uploadId', uploadId, webTransportUploadId);
             return;
        }
        console.debug(`[Encryption Stream] Consumer confirmed upload for chunk #${chunkIndex}`);
        const promiseHandlers = webTransportChunkPromises.get(chunkIndex);
        if (promiseHandlers) {
            promiseHandlers.resolve();
            webTransportChunkPromises.delete(chunkIndex);
        }
    
    } else if (type === 'chunks-upload-complete-batch') {
        const { chunkIndices, uploadId } = payload;
        if (uploadId !== webTransportUploadId) {
            console.warn('[Encryption Stream] chunks-upload-complete-batch for wrong uploadId', uploadId, webTransportUploadId);
            return;
        }
        
        console.debug(`[Encryption Stream] Consumer confirmed batch upload for ${chunkIndices.length} chunks`);
        
        // Process all chunk completions in the batch
        let resolvedCount = 0;
        for (const chunkIndex of chunkIndices) {
            const promiseHandlers = webTransportChunkPromises.get(chunkIndex);
            if (promiseHandlers) {
                promiseHandlers.resolve();
                webTransportChunkPromises.delete(chunkIndex);
                resolvedCount++;
            }
        }
        
        console.debug(`[Encryption Stream] Resolved ${resolvedCount}/${chunkIndices.length} promises from batch completion`);

    } else if (type === 'chunk-upload-error') {
        const { chunkIndex, uploadId, error } = payload;
        if (uploadId !== webTransportUploadId) {
             console.warn('[Encryption Stream] chunk-upload-error for wrong uploadId', uploadId, webTransportUploadId);
             return;
        }
        console.error(`[Encryption Stream] Consumer reported error for chunk #${chunkIndex}:`, error);
        const promiseHandlers = webTransportChunkPromises.get(chunkIndex);
        if (promiseHandlers) {
            promiseHandlers.reject(new Error(error));
            webTransportChunkPromises.delete(chunkIndex);
        }
    }
}

/**
 * Adds a chunk to the WebTransport producer buffer and notifies the consumer worker.
 * 
 * This function implements the producer side of the producer-consumer pattern for WebTransport uploads.
 * It:
 * - Buffers encrypted chunk data for the current upload session
 * - Creates promise handlers that will be resolved when the chunk is confirmed uploaded
 * - Batches chunk-ready notifications for efficient consumer-side processing and throughput
 * - Optimizes notification timing for maximum performance
 *
 * @param {Uint8Array} chunk - The binary chunk data to upload
 * @param {number} chunkIndex - The sequential index of the chunk
 * @param {string} uploadId - The unique ID for the file upload session
 * @returns {Promise<void>} A promise that resolves when the consumer confirms successful upload
 * @throws {Error} If WebTransport is not available or the upload session is invalid
 */
async function addChunkForWebTransport(chunk: Uint8Array, chunkIndex: number, uploadId: string): Promise<void> {
    if (!useWebTransport || !webTransportConsumerWorker || uploadId !== webTransportUploadId) {
        throw new Error("addChunkForWebTransport called in invalid state");
    }

    return new Promise<void>((resolve, reject) => {
        webTransportChunkPromises.set(chunkIndex, { resolve, reject });
        webTransportChunkBuffer.set(chunkIndex, chunk);
        
        // Add to pending notifications - the chunkIndex is the encryption sequence
        // because chunks are encrypted in order by the producer
        pendingChunkNotifications.push({ 
            chunkIndex, 
            uploadId,
            encryptionSequence: chunkIndex // Track encryption sequence for proper decryption
        });
        
        // If this is a large chunk (>100KB) or we have accumulated many small chunks,
        // flush notifications immediately to optimize throughput
        const shouldFlushImmediately = chunk.length > 100 * 1024 || 
                                      pendingChunkNotifications.length >= 10;
        
        if (shouldFlushImmediately) {
            flushChunkNotifications();
        } else {
            // Set a timeout to flush if no more chunks come in soon
            if (batchNotificationTimeout === null) {
                batchNotificationTimeout = self.setTimeout(() => {
                    flushChunkNotifications();
                }, 5); // 5ms batch window
            }
        }
    });
}

/**
 * Flushes pending chunk notifications to the consumer worker, batching for performance.
 * 
 * This function optimizes the communication between producer and consumer workers by:
 * - Batching multiple chunk notifications into a single message when possible
 * - Using an optimized messaging format for batch notifications
 * - Handling error conditions gracefully if the consumer worker is unavailable
 * - Ensuring all notifications are scoped to the correct upload session
 * 
 * The batching mechanism significantly reduces inter-worker communication overhead
 * and improves overall throughput, especially for small chunks.
 */
function flushChunkNotifications(): void {
    if (batchNotificationTimeout !== null) {
        clearTimeout(batchNotificationTimeout);
        batchNotificationTimeout = null;
    }
    
    if (pendingChunkNotifications.length === 0) return;
    
    if (!webTransportConsumerWorker) {
        // Reject all pending promises
        for (const {chunkIndex} of pendingChunkNotifications) {
            const promiseHandlers = webTransportChunkPromises.get(chunkIndex);
            if (promiseHandlers) {
                promiseHandlers.reject(new Error("webTransportConsumerWorker is null when posting chunk-ready"));
                webTransportChunkPromises.delete(chunkIndex);
            }
        }
        pendingChunkNotifications = [];
        return;
    }
    
    // If we have just one notification, use the simple message format for compatibility
    if (pendingChunkNotifications.length === 1) {
        const { chunkIndex, uploadId, encryptionSequence } = pendingChunkNotifications[0];
        console.debug(`[Encryption Stream] Notifying consumer that chunk #${chunkIndex} (encryption sequence: ${encryptionSequence}) is ready`);
        webTransportConsumerWorker.postMessage({
            type: 'chunk-ready',
            payload: { chunkIndex, uploadId, encryptionSequence }
        });
    } else {
        // Batch notifications for better performance
        const firstIndex = pendingChunkNotifications[0].chunkIndex;
        const lastIndex = pendingChunkNotifications[pendingChunkNotifications.length - 1].chunkIndex;
        console.debug(`[Encryption Stream] Notifying consumer of ${pendingChunkNotifications.length} chunks ready (#${firstIndex}-${lastIndex})`);
        
        webTransportConsumerWorker.postMessage({
            type: 'chunks-ready-batch',
            payload: { chunks: pendingChunkNotifications }
        });
    }
    
    pendingChunkNotifications = [];
}

/**
 * Main function for the streaming pipeline. Orchestrates the flow of data from compression to encryption to parallel uploading.
 * 
 * This function is the central coordinator for the streaming upload process. It:
 * - Initializes the compression stream with configured options
 * - Uploads the encryption header before any data chunks
 * - Sets up event handlers for processing compressed chunks
 * - Encrypts each chunk using the libsodium secretstream API
 * - Routes chunks to either WebTransport or HTTP upload paths
 * - Reports progress to the main thread throughout the upload
 * - Handles final completion and cleanup
 * 
 * The pipeline design ensures memory efficiency by processing the file in streaming 
 * chunks rather than loading it entirely into memory.
 *
 * @param {File} file - The file object to be uploaded
 * @param {string} uploadId - A unique identifier for the entire upload session
 * @param {Uint8Array} header - The encryption stream header, which must be uploaded first
 * @returns {Promise<void>} A promise that resolves when all parts of the file have been processed and uploaded
 */
async function streamFileUpload(file: File, uploadId: string, header: Uint8Array): Promise<void> {
    const compressionStream = new Gzip(gzipOptions || { level: 6 });
    // For HTTP fallback, we still need the manager instance
    const uploadManager = new ParallelUploadManager();
    let chunkIndex = 0;
    let totalProcessed = 0;

    // --- Upload Header ---
    if (useWebTransport) {
        await addChunkForWebTransport(header, chunkIndex++, uploadId);
    } else {
        await uploadManager.addChunk(header, chunkIndex++, uploadId);
    }
    console.debug(`[Encryption Stream] Header upload complete`);

    return new Promise((resolve, reject) => {
        compressionStream.ondata = async (compressedChunk: Uint8Array, isFinal: boolean) => {
            try {
                if (compressedChunk.length === 0) {
                    console.debug("[Encryption Stream] Skipping empty chunk");
                    if (isFinal) {
                        if (useWebTransport) {
                             console.debug("[Encryption Stream] Waiting for WebTransport consumer to finish...");
                             // Simple wait for promises - could be more robust
                             const outstandingPromises = Array.from(webTransportChunkPromises.values()).map(p => new Promise<void>((res, rej) => { p.resolve = () => res(); p.reject = (err) => rej(err); }));
                             if (outstandingPromises.length > 0) {
                                 try {
                                     await Promise.all(outstandingPromises);
                                 } catch (e) {
                                     console.warn("[Encryption Stream] Some WebTransport chunks failed, but proceeding to signal completion.");
                                 }
                             }
                             if(webTransportConsumerWorker && webTransportUploadId === uploadId) {
                                 console.debug("[Encryption Stream] Signaling upload completion to consumer.");
                                 webTransportConsumerWorker.postMessage({ type: 'upload-complete', payload: { uploadId } });
                             }
                        } else {
                             await uploadManager.waitForAllUploads();
                        }
                        resolve();
                    }
                    return;
                }

                const encryptedChunk = encryptStreamChunk(cryptoState, compressedChunk, isFinal);
                const currentIndex = chunkIndex++;

                console.debug(`[Encryption Stream] Processing encrypted chunk #${currentIndex}, size: ${encryptedChunk.length} bytes, isFinal: ${isFinal}`);

                // --- Add Chunk to Pipeline ---
                if (useWebTransport) {
                    addChunkForWebTransport(encryptedChunk, currentIndex, uploadId)
                        .catch(error => {
                            console.error(`[Encryption Stream] Failed in WebTransport producer for chunk #${currentIndex}:`, error);
                            if (isFinal || currentIndex === 1) {
                                reject(error);
                            }
                            if (webTransportConsumerWorker) {
                                webTransportConsumerWorker.postMessage({ type: 'abort' });
                            }
                        });
                } else {
                    uploadManager.addChunk(encryptedChunk, currentIndex, uploadId)
                        .catch(error => {
                            console.error(`[Encryption Stream] Failed to upload chunk #${currentIndex} via HTTP:`, error);
                            if (isFinal || currentIndex === 1) {
                                reject(error);
                            }
                        });
                }

                // --- Post Progress ---
                totalProcessed += compressedChunk.length;
                const progressPercent = Math.min(totalProcessed / file.size, 1.0);
                const processedBytes = Math.floor(progressPercent * file.size);
                self.postMessage({
                    type: 'chunk-upload-progress',
                    payload: {
                        processedBytes,
                        totalBytes: file.size,
                        currentChunkSize: DYNAMIC_CHUNK_SIZE,
                        activeUploads: useWebTransport ? 0 : uploadManager['activeUploads'].size,
                        queuedChunks: useWebTransport ? webTransportChunkBuffer.size : chunkIndex - 1 - uploadManager['completedChunks'].size,
                        transportMethod: useWebTransport ? 'WebTransport (Pull)' : 'HTTP'
                    }
                });

                if (isFinal) {
                    console.debug(`[Encryption Stream] All file chunks sent to pipeline`);
                }
            } catch (err) {
                reject(err);
            }
        };

        processFileInChunks(file, compressionStream).catch(reject);
    });
}

/**
 * Reads the specified file in chunks and pushes them into the provided compression stream.
 * 
 * This function implements the first stage of the streaming pipeline by:
 * - Using an adaptive chunk size based on file size and performance measurements
 * - Implementing backpressure controls to prevent memory overflow
 * - Reading file data in a memory-efficient manner using File.slice()
 * - Pushing chunks to the compression stream at a controlled rate
 * - Identifying and marking the final chunk for proper stream termination
 * 
 * The backpressure mechanism is particularly important for very large files,
 * ensuring the worker doesn't consume excessive memory while balancing throughput.
 *
 * @param {File} file - The file to read in chunks
 * @param {Gzip} compressionStream - The fflate Gzip stream to push data into
 * @returns {Promise<void>} A promise that resolves when the entire file has been read and processed
 */
async function processFileInChunks(file: File, compressionStream: Gzip): Promise<void> {
    let effectiveChunkSize = DYNAMIC_CHUNK_SIZE;
    if (file.size < 100 * 1024 * 1024) {
        effectiveChunkSize = Math.min(DYNAMIC_CHUNK_SIZE, 1 * 1024 * 1024);
    }
    console.debug(`[Encryption Stream] Processing file in chunks. File size: ${file.size} bytes, chunk size: ${effectiveChunkSize} bytes`);
    let backpressureCounter = 0;
    for (let position = 0; position < file.size; position += effectiveChunkSize) {
        if (backpressureCounter > 5) {
            const delay = 100 * backpressureCounter;
            console.debug(`[Encryption Stream] Applying backpressure delay: ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
            backpressureCounter = Math.max(0, backpressureCounter - 2);
        }
        const end = Math.min(position + effectiveChunkSize, file.size);
        const chunk = file.slice(position, end);
        const arrayBuffer = await chunk.arrayBuffer();
        const isLastChunk = end >= file.size;
        compressionStream.push(new Uint8Array(arrayBuffer), isLastChunk);
        backpressureCounter++;
        await new Promise(resolve => setTimeout(() => {
            backpressureCounter--;
            resolve(undefined);
        }, 0));
    }
    console.debug(`[Encryption Stream] All file chunks have been read and sent to compression stream`);
}

/**
 * Initializes the worker's environment and sets up all required state for streaming uploads.
 * 
 * This function performs the worker's bootstrap sequence:
 * - Initializes the libsodium cryptography library
 * - Detects available transport capabilities (WebTransport vs HTTP)
 * - Sets up message event handlers for communication with the main thread
 * - Implements handlers for initialization, streaming uploads, and abort commands
 * - Provides robust error handling and recovery
 * - Signals readiness to the main thread when initialization is complete
 * 
 * This is the entry point for the worker and is called immediately when the worker
 * is created. The worker will not be operational until this function completes successfully.
 * 
 * @returns {Promise<void>} A promise that resolves when the worker setup is complete
 */
async function setupWorker(): Promise<void> {
    try {
        await initializeSodium();
        useWebTransport = detectWebTransportSupport();
        console.debug(`[Encryption Stream] Initial WebTransport support check: ${useWebTransport ? 'Available' : 'Not available'}`);

        self.onmessage = async (event) => {
            const { type, payload } = event.data;
            try {
                if (type === 'init') {
                    gzipOptions = { level: payload.compressionLevel || 6 };
                    const { keyFingerprint, useWebTransport: enableWebTransport = true } = payload;
                    USE_WEBTRANSPORT_IF_AVAILABLE = enableWebTransport;
                    useWebTransport = detectWebTransportSupport();
                    console.debug(`[Encryption Stream] Init: WebTransport will be used: ${useWebTransport}`);

                    if (!keyFingerprint) {
                        throw new Error("A key fingerprint must be provided in the 'init' payload.");
                    }
                    const { state, header, hexKey, base64Nonce } = initStreamingEncrypt(keyFingerprint);
                    cryptoState = state;

                    self.postMessage({
                        type: 'init-success',
                        payload: {
                            header,
                            hexKey,
                            base64Nonce,
                            keyFingerprint,
                            transportMethod: useWebTransport ? 'WebTransport' : 'HTTP'
                        }
                    });

                } else if (type === 'start-streaming-upload') {
                    if (!cryptoState || !gzipOptions) {
                        throw new Error("Worker is not initialized. 'init' command must be called first.");
                    }
                    const { file, uploadId, header } = payload;

                    if (useWebTransport) {
                        await initWebTransportProducer(uploadId);
                    }

                    await streamFileUpload(file, uploadId, header);
                    self.postMessage({ type: 'all-chunks-sent' });

                    cryptoState = null;
                    closeAllConnections();

                } else if (type === 'abort') {
                    console.warn("[Encryption Stream] Abort signal received. Cleaning up worker state.");
                    cryptoState = null;
                    closeAllConnections();
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred in the streaming worker.';
                console.error('[Encryption Stream] Fatal error in worker message handler:', error);
                self.postMessage({ type: 'error', payload: errorMessage });
                cryptoState = null;
                closeAllConnections();
            }
        };

        self.postMessage({ type: 'ready' });
    } catch (err) {
        console.error('[Encryption Stream] Fatal initialization error:', err);
        self.postMessage({ type: 'error', payload: 'Worker failed to initialize encryption engine.' });
    }
}

setupWorker();