/**
 * @file WebTransport consumer worker responsible for efficient chunk delivery to the server.
 * @module WebTransportStreamingWorker
 * 
 * @description
 * This worker implements the consumer side of a producer/consumer pattern for optimized file upload.
 * It receives chunk notifications from the producer worker, pulls chunk data, and delivers chunks
 * efficiently to the server using the WebTransport protocol with connection pooling, batching,
 * and advanced throughput optimizations.
 * 
 * @architecture
 * - Maintains a pool of WebTransport connections for parallel chunk delivery
 * - Uses batch processing to group chunks for efficient transmission
 * - Implements adaptive connection management with automatic recovery
 * - Prioritizes chunk delivery based on size to prevent head-of-line blocking
 * - Coordinates closely with producer worker for optimal throughput
 * 
 * @features
 * - Connection pooling and management
 * - Parallel batch streaming
 * - Automatic retry with exponential backoff
 * - Intelligent chunk prioritization
 * - Memory-efficient streaming
 */

/**
 * Represents a WebTransport connection in the connection pool.
 * 
 * Tracks active connection state including busy status and usage metrics
 * for efficient connection management and load balancing.
 * @typedef {Object} ConnectionInfo
 * @property {WebTransport} connection - The WebTransport connection instance
 * @property {boolean} busy - Whether the connection is currently being used for a transfer
 * @property {number} lastUsed - Timestamp of last usage for connection rotation
 */
type ConnectionInfo = {
  connection: WebTransport;
  busy: boolean;             // Track if connection is currently sending
  lastUsed: number;          // Timestamp for connection rotation
};

/**
 * Represents a request to process a chunk that is ready for upload.
 * 
 * Contains identifying information about which chunk to process and which upload it belongs to.
 * @interface ChunkReadyRequest
 * @property {number} chunkIndex - Sequential index of the chunk in the file
 * @property {string} uploadId - Identifier of the upload this chunk belongs to
 */
interface ChunkReadyRequest { chunkIndex: number; uploadId: string; }

/**
 * Pool of active WebTransport connections.
 * 
 * Maintains multiple connections for parallel transfers, improving overall throughput.
 * Each connection can operate independently, allowing for concurrent chunk uploads.
 * @type {ConnectionInfo[]}
 */
let connectionPool: ConnectionInfo[] = [];

/**
 * Current active upload session identifier.
 * 
 * Tracks the upload session being processed. Used to scope connections and chunk transfers
 * to the appropriate upload and prevent cross-upload contamination.
 * @type {string | null}
 */
let currentUploadId: string | null = null;

/**
 * Flag indicating whether processing has been aborted.
 * 
 * When true, ongoing operations should terminate gracefully and new operations should not start.
 * Used during cleanup or when errors require cancellation of the entire upload process.
 * @type {boolean}
 */
let isAborted: boolean = false;

/**
 * Map of additional consumer workers.
 * 
 * When network conditions are slow, we spawn additional consumer workers
 * to parallelize chunk delivery and improve overall throughput.
 * Each worker handles a specific range of chunks.
 * @type {Map<number, Worker>}
 */
let additionalConsumerWorkers: Map<number, {
  worker: Worker,
  chunkRange: {start: number, end: number} | null,
  isReady: boolean,
  uploadId: string | null,
  chunksAssigned: number,
  chunksCompleted: number
}> = new Map();

/**
 * Queue of chunks waiting to be processed and uploaded.
 * 
 * Acts as a buffer between incoming chunk notifications and the actual upload process.
 * Allows for batch processing and prioritization of chunks for optimal throughput.
 * @type {ChunkReadyRequest[]}
 */
let chunkReadyQueue: ChunkReadyRequest[] = [];

/**
 * Indicates whether the chunk queue is currently being processed.
 * 
 * Prevents multiple concurrent queue processing operations from running simultaneously,
 * which could lead to race conditions or excessive resource consumption.
 * @type {boolean}
 */
let isProcessingQueue: boolean = false;

/**
 * Count of currently active chunk transfer operations.
 * 
 * Helps manage concurrency and prevent resource exhaustion by limiting
 * the number of simultaneous transfers.
 * @type {number}
 */
let activeTransfers: number = 0;

/**
 * Timer ID for the connection monitoring interval.
 * 
 * Used to periodically check and maintain the health of the connection pool.
 * Allows for clearing the interval during cleanup.
 * @type {number | null}
 */
let connectionMonitorInterval: number | null = null;

/**
 * Base URL for WebTransport connections to the server.
 * 
 * Forms the foundation for all WebTransport connections, with the upload ID appended.
 * Uses the same hostname as the current page for consistent networking.
 * @type {string}
 */
const WEBTRANSPORT_BASE_URL: string = `https://${self.location.hostname}:8001/upload/`;

/**
 * Maximum number of parallel WebTransport connections to maintain.
 * 
 * Higher values increase throughput at the cost of more browser resources.
 * Balanced to provide optimal performance without overwhelming the browser or server.
 * @type {number}
 */
const MAX_CONNECTIONS: number = 12;

/**
 * Maximum number of additional consumer workers to spawn.
 * 
 * More workers help with slow networks but consume additional browser resources.
 * @type {number}
 */
const MAX_ADDITIONAL_CONSUMER_WORKERS: number = 3;

/**
 * Memory usage threshold (in MB) that triggers spawning a new consumer worker.
 * When memory usage exceeds this value, a new worker will be created.
 * Set this to a value that makes sense for your application.
 * @type {number}
 */
const MEMORY_THRESHOLD_MB: number = 200;

/**
 * Interval (in ms) for checking memory usage.
 * How frequently we'll check if we need to spawn additional workers.
 * @type {number}
 */
const MEMORY_CHECK_INTERVAL: number = 1000;

/**
 * Cooldown period (in ms) between worker spawns.
 * Prevents creating too many workers too quickly.
 * @type {number}
 */
const WORKER_SPAWN_COOLDOWN: number = 5000;

/**
 * Initial number of chunks to process in a single batch operation.
 * 
 * Starts with a smaller value that can be adjusted based on performance.
 * @type {number}
 */
let OPTIMAL_BATCH_SIZE: number = 8;

/**
 * Minimum batch size to use even in constrained conditions.
 * @type {number}
 */
const BATCH_SIZE_MIN: number = 3;

/**
 * Maximum batch size to use even in ideal conditions.
 * @type {number}
 */
const BATCH_SIZE_MAX: number = 24;

/**
 * Number of chunks to process in a single batch operation.
 * 
 * Larger batches improve efficiency by amortizing connection setup costs across more chunks.
 * Value chosen to balance memory usage with transfer efficiency.
 * @type {number}
 */
let BATCH_SIZE: number = OPTIMAL_BATCH_SIZE;

/**
 * Estimated upload bandwidth in Mbps.
 * This starts with a conservative estimate and will be adjusted dynamically.
 * @type {number}
 */
let estimatedUploadBandwidthMbps: number = 10;

/**
 * Target bandwidth usage as a fraction (0.0-1.0) of estimated bandwidth.
 * Using less than 100% helps avoid saturating the connection.
 * @type {number}
 */
const TARGET_BANDWIDTH_USAGE: number = 0.85;

/**
 * Maximum number of batch operations to process concurrently.
 * 
 * Controls overall system load by limiting parallel batch processing.
 * Prevents memory and CPU exhaustion while maintaining high throughput.
 * Dynamically adjusted based on network conditions.
 * @type {number}
 */
let MAX_CONCURRENT_BATCHES: number = 3;

/**
 * Track batch completion times to adjust batch size dynamically.
 * @type {number[]}
 */
const batchCompletionTimes: number[] = [];

/**
 * Track server response times to adjust concurrency.
 * @type {number[]}
 */
const serverResponseTimes: number[] = [];

/**
 * Adjusts various parameters based on current network conditions.
 * This function uses throughput and response time metrics to
 * dynamically optimize the system for current network conditions.
 * 
 * @param {number} throughput - Current throughput in chunks per second
 * @param {number} avgResponseTime - Average server response time in ms
 * @param {number} avgBatchTime - Average batch completion time in ms 
 * @param {number} avgChunkSize - Average chunk size in bytes
 */
function adjustParametersForNetworkConditions(
    throughput: number,
    avgResponseTime: number,
    avgBatchTime: number,
    avgChunkSize: number
): void {
    // Calculate data rate in Mbps based on throughput and average chunk size
    const dataRateMbps = (throughput * avgChunkSize * 8) / (1024 * 1024);
    
    // Update our bandwidth estimate using exponential moving average
    // Give 30% weight to new measurement, 70% to existing estimate
    estimatedUploadBandwidthMbps = estimatedUploadBandwidthMbps * 0.7 + dataRateMbps * 0.3;
    
    // Calculate optimal parameters based on estimated bandwidth
    const availableBandwidthBytes = (estimatedUploadBandwidthMbps * TARGET_BANDWIDTH_USAGE * 1024 * 1024) / 8;
    
    // Log bandwidth estimate
    console.debug(`[WebTransport Stream] Network metrics: estimated bandwidth=${estimatedUploadBandwidthMbps.toFixed(2)} Mbps, ` +
                  `measured=${dataRateMbps.toFixed(2)} Mbps, target usage=${(TARGET_BANDWIDTH_USAGE*100).toFixed(0)}%`);
    
    // Adjust batch size based on response time and bandwidth
    const optimalBatchSize = Math.min(
        BATCH_SIZE_MAX,
        Math.max(
            BATCH_SIZE_MIN,
            // Smaller batch size when response time is high (slow server)
            avgResponseTime > 500 ? Math.floor(OPTIMAL_BATCH_SIZE * 0.7) : 
            // Larger batch size when response time is low (fast server)
            avgResponseTime < 100 ? Math.floor(OPTIMAL_BATCH_SIZE * 1.2) : 
            // Default
            OPTIMAL_BATCH_SIZE
        )
    );
    
    // Adjust MAX_CONCURRENT_BATCHES based on bandwidth and response time
    // The goal is to keep the network pipe full but not overflowed
    const targetConcurrentBatches = Math.min(
        6, // Hard upper limit
        Math.max(
            1, // Hard lower limit
            Math.floor(availableBandwidthBytes / (avgChunkSize * optimalBatchSize * 1.2)) // 1.2 safety factor
        )
    );
    
    // Apply changes gradually
    if (targetConcurrentBatches > MAX_CONCURRENT_BATCHES) {
        MAX_CONCURRENT_BATCHES++;
        console.debug(`[WebTransport Stream] Increasing concurrent batches to ${MAX_CONCURRENT_BATCHES}`);
    } else if (targetConcurrentBatches < MAX_CONCURRENT_BATCHES && MAX_CONCURRENT_BATCHES > 1) {
        MAX_CONCURRENT_BATCHES--;
        console.debug(`[WebTransport Stream] Decreasing concurrent batches to ${MAX_CONCURRENT_BATCHES}`);
    }
    
    // Apply batch size changes if needed
    if (optimalBatchSize !== BATCH_SIZE) {
        BATCH_SIZE = optimalBatchSize;
        console.debug(`[WebTransport Stream] Adjusting batch size to ${BATCH_SIZE}`);
    }
}

/**
 * Detects current network conditions and returns the best parameters
 * for the given conditions. This allows for a rapid initial adjustment
 * when network conditions change significantly.
 * 
 * @returns {Object} The best parameters for the current network conditions
 */
function detectNetworkConditions(): { 
    batchSize: number; 
    concurrentBatches: number;
    isSlowNetwork: boolean;
} {
    // Calculate average response time
    const avgResponseTime = serverResponseTimes.length > 0
        ? serverResponseTimes.reduce((sum, time) => sum + time, 0) / serverResponseTimes.length
        : 500; // Default to 500ms if no data yet
    
    // Calculate average batch time
    const avgBatchTime = batchCompletionTimes.length > 0
        ? batchCompletionTimes.reduce((sum, time) => sum + time, 0) / batchCompletionTimes.length
        : 2000; // Default to 2000ms if no data yet
        
    // Get average chunk size
    const chunkSizes = Array.from(chunkSizeMap.values());
    const avgChunkSize = chunkSizes.length > 0 
        ? chunkSizes.reduce((sum, size) => sum + size, 0) / chunkSizes.length
        : 2 * 1024 * 1024; // Default to 2MB if no chunks have been processed yet
        
    // Detect if we're on a slow network
    // Heuristics: slow networks have high batch times and/or response times
    const isSlowNetwork = avgBatchTime > 5000 || avgResponseTime > 1000;
    
    if (isSlowNetwork) {
        console.debug(`[WebTransport Stream] Detected slow network: avgResponseTime=${avgResponseTime.toFixed(0)}ms, avgBatchTime=${avgBatchTime.toFixed(0)}ms`);
        
        // Slow network optimizations:
        // - Smaller batch sizes to reduce head-of-line blocking
        // - Fewer concurrent batches to prevent network congestion
        return {
            batchSize: Math.max(BATCH_SIZE_MIN, Math.floor(OPTIMAL_BATCH_SIZE * 0.5)),
            concurrentBatches: 2,
            isSlowNetwork: true
        };
    } else {
        // Fast network optimizations:
        // - Larger batch sizes for better efficiency
        // - More concurrent batches to maximize throughput
        return {
            batchSize: Math.min(BATCH_SIZE_MAX, Math.floor(OPTIMAL_BATCH_SIZE * 1.2)),
            concurrentBatches: 5,
            isSlowNetwork: false
        };
    }
}

/**
 * Adapts parameters immediately based on network conditions.
 * This function is called during initialization and when significant 
 * changes in network conditions are detected.
 */
function adaptToNetworkConditions(): void {
    const networkParams = detectNetworkConditions();
    
    // Apply network-optimized parameters
    BATCH_SIZE = networkParams.batchSize;
    MAX_CONCURRENT_BATCHES = networkParams.concurrentBatches;
    
    // Log the adaptation
    console.debug(
        `[WebTransport Stream] Adapting to ${networkParams.isSlowNetwork ? 'slow' : 'fast'} network: ` +
        `batchSize=${BATCH_SIZE}, concurrentBatches=${MAX_CONCURRENT_BATCHES}`
    );
}

/**
 * Maximum allowed memory (in bytes) for prefetching chunks.
 * Limits memory pressure on the worker.
 * @type {number}
 */
const MAX_PREFETCH_MEMORY: number = 100 * 1024 * 1024; // 100MB

/**
 * Whether to prioritize smaller chunks for earlier processing.
 * 
 * When true, smaller chunks are sent first to prevent head-of-line blocking.
 * Improves overall throughput by allowing more chunks to complete quickly.
 * @type {boolean}
 */
const PRIORITIZE_SMALL_CHUNKS: boolean = false;

/**
 * Minimum acceptable number of active connections.
 * 
 * If the connection count falls below this threshold, new connections will be created.
 * Calculated as a proportion of the maximum connection count to ensure adequate capacity.
 * @type {number}
 */
const MIN_CONNECTION_THRESHOLD: number = Math.max(2, Math.floor(MAX_CONNECTIONS / 2));

/**
 * Tracks the size of each chunk for optimization purposes.
 * 
 * Maps chunk indices to their sizes in bytes, allowing the worker to make
 * intelligent decisions about batching and prioritization based on chunk size.
 * Populated as chunk data is pulled from the producer.
 * @type {Map<number, number>}
 */
const chunkSizeMap: Map<number, number> = new Map<number, number>();

/**
 * Tracks total chunks sent to the server.
 * Used for accurate performance metrics.
 * @type {number}
 */
let totalChunksSent: number = 0;

/**
 * Tracks total chunks confirmed by the server.
 * Used for accurate completion rate metrics.
 * @type {number}
 */
let totalChunksConfirmed: number = 0;

/**
 * Timestamp when upload started.
 * Used for throughput calculations.
 * @type {number}
 */
let uploadStartTime: number = 0;

/**
 * Initializes the WebTransport connection pool for a specific upload session.
 * 
 * This function creates multiple WebTransport connections to the server for a given upload,
 * establishing the necessary infrastructure for parallel chunk uploading. It:
 * - Closes any existing connections to ensure a clean state
 * - Establishes multiple new connections to maximize throughput
 * - Sets up connection monitoring for automatic recovery
 * - Configures error handling for resilient operation
 * 
 * @param {string} uploadId - The unique identifier for the upload session
 * @returns {Promise<void>} Resolves when the connection pool is established
 * @throws {Error} If no connections could be established
 */
async function initWebTransport(uploadId: string): Promise<void> {
    if (isAborted) return;
    
    // Close any existing connections
    await closeAllConnections();
    
    currentUploadId = uploadId;
    connectionPool = [];
    
    // Reset counters when initializing a new upload
    totalChunksSent = 0;
    totalChunksConfirmed = 0;
    uploadStartTime = performance.now();
    
    // Adapt to network conditions for optimal starting parameters
    adaptToNetworkConditions();
    
    // Start monitoring network conditions
    setupNetworkMonitoring(uploadId);

    console.debug(`[WebTransport Stream] Initializing ${MAX_CONNECTIONS} WebTransport connections to ${WEBTRANSPORT_BASE_URL}${uploadId}`);

    // Create multiple connections in parallel
    const connectionPromises: Promise<ConnectionInfo | null>[] = [];
    
    for (let i = 0; i < MAX_CONNECTIONS; i++) {
        connectionPromises.push(createSingleConnection(uploadId, i));
    }
    
    // Wait for all connections to be established
    const results = await Promise.allSettled(connectionPromises);
    
    // Filter out rejected promises and nulls
    connectionPool = results
        .filter((result): result is PromiseFulfilledResult<ConnectionInfo> => 
            result.status === 'fulfilled' && result.value !== null)
        .map(result => result.value);
    
    if (connectionPool.length === 0) {
        currentUploadId = null;
        throw new Error(`Failed to establish any WebTransport connections for ${uploadId}`);
    }
    
    console.debug(`[WebTransport Stream] Successfully established ${connectionPool.length}/${MAX_CONNECTIONS} WebTransport connections for upload ${uploadId}`);
    
    // Set up connection monitoring to maintain optimal connection count
    if (connectionMonitorInterval) {
        clearInterval(connectionMonitorInterval);
    }
    
    connectionMonitorInterval = self.setInterval(() => {
        // Only monitor if we're still using this upload ID
        if (currentUploadId !== uploadId || isAborted) {
            if (connectionMonitorInterval !== null) {
                clearInterval(connectionMonitorInterval);
                connectionMonitorInterval = null;
            }
            return;
        }
        
        // Check if we need to create more connections
        if (connectionPool.length < MIN_CONNECTION_THRESHOLD) {
            const connectionsNeeded = MAX_CONNECTIONS - connectionPool.length;
            console.debug(`[WebTransport Stream] Connection pool below threshold (${connectionPool.length}/${MAX_CONNECTIONS}), creating ${connectionsNeeded} more connections`);
            
            // Start new connections
            for (let i = 0; i < connectionsNeeded; i++) {
                const connectionIndex = connectionPool.length + i;
                createSingleConnection(uploadId, connectionIndex)
                    .then(connInfo => {
                        if (connInfo && currentUploadId === uploadId) {
                            connectionPool.push(connInfo);
                            console.debug(`[WebTransport Stream] Added new connection ${connectionIndex} to pool (${connectionPool.length}/${MAX_CONNECTIONS})`);
                        }
                    })
                    .catch(err => {
                        console.error(`[WebTransport Stream] Failed to create additional connection:`, err);
                    });
            }
        }
    }, 3000); // Check every 3 seconds
}

/**
 * Creates and initializes a single WebTransport connection for the connection pool.
 * 
 * Establishes a dedicated WebTransport connection to the server with automatic
 * error handling and reconnection logic. Each connection is used for streaming
 * chunks to the server through unidirectional streams.
 * 
 * @param {string} uploadId - The unique identifier for the upload session
 * @param {number} index - The index of this connection in the pool (for logging and debugging)
 * @param {number} [retryCount=0] - Number of previous attempts to create this connection
 * @returns {Promise<ConnectionInfo | null>} Connection information or null if connection failed
 */
async function createSingleConnection(uploadId: string, index: number, retryCount: number = 0): Promise<ConnectionInfo | null> {
    // Add connection index to URL as a query param to help with server-side debugging
    const fullUrl = `${WEBTRANSPORT_BASE_URL}${uploadId}?conn=${index}`;
    
    try {
        const connection = new WebTransport(fullUrl);
        await connection.ready;
        console.debug(`[WebTransport Stream] WebTransport connection ${index} established for upload ${uploadId}`);
        
        // Set up error handling with automatic reconnection
        connection.closed.catch((err: Error) => {
            console.error(`[WebTransport Stream] WebTransport connection ${index} closed with error:`, err);
            
            // Remove failed connection from pool
            connectionPool = connectionPool.filter(info => info.connection !== connection);
            
            // Try to reconnect if not aborted
            if (!isAborted && currentUploadId === uploadId) {
                const maxRetries = 3;
                if (retryCount < maxRetries) {
                    console.debug(`[WebTransport Stream] Attempting to reconnect connection ${index}, retry ${retryCount + 1}/${maxRetries}`);
                    // Reconnect with exponential backoff
                    const backoffDelay = Math.min(1000 * (2 ** retryCount), 5000);
                    setTimeout(async () => {
                        try {
                            const newConnection = await createSingleConnection(uploadId, index, retryCount + 1);
                            if (newConnection && currentUploadId === uploadId) {
                                connectionPool.push(newConnection);
                                console.debug(`[WebTransport Stream] Successfully reconnected connection ${index}`);
                            }
                        } catch (reconnectError) {
                            console.error(`[WebTransport Stream] Failed to reconnect connection ${index}:`, reconnectError);
                        }
                    }, backoffDelay);
                }
            }
        });
        
        return {
            connection,
            busy: false,
            lastUsed: Date.now()
        };
    } catch (error) {
        console.error(`[WebTransport Stream] Failed to establish WebTransport connection ${index}:`, error);
        return null;
    }
}

/**
 * Closes all WebTransport connections and cleans up resources.
 * 
 * This function performs comprehensive cleanup of all network connections:
 * - Stops the connection monitoring interval
 * - Closes all active WebTransport connections in the pool
 * - Handles errors during connection closure gracefully
 * - Resets the connection pool to an empty state
 * 
 * @returns {Promise<void>} Resolves when all connections are closed
 */
async function closeAllConnections(): Promise<void> {
    // Stop connection monitoring
    if (connectionMonitorInterval !== null) {
        clearInterval(connectionMonitorInterval);
        connectionMonitorInterval = null;
    }
    
    const closePromises = connectionPool.map(async (connInfo, i) => {
        try {
            connInfo.connection.close();
            console.debug(`[WebTransport Stream] Closed connection ${i}`);
        } catch (e) {
            console.warn(`[WebTransport Stream] Error closing connection ${i}:`, e);
        }
    });
    
    await Promise.allSettled(closePromises);
    connectionPool = [];
}

/**
 * Gets an available WebTransport connection from the connection pool.
 * 
 * This function implements a smart selection algorithm that:
 * - Prioritizes non-busy connections for immediate use
 * - Falls back to least recently used connections when all are busy
 * - Updates usage tracking for load balancing across connections
 * - Handles empty pool and aborted state conditions
 *
 * @returns {ConnectionInfo | null} An available connection or null if none available
 */
function getAvailableConnection(): ConnectionInfo | null {
    if (connectionPool.length === 0 || isAborted) return null;
    
    // First try to find a non-busy connection
    const availableConn = connectionPool.find(conn => !conn.busy);
    if (availableConn) {
        availableConn.busy = true;
        availableConn.lastUsed = Date.now();
        return availableConn;
    }
    
    // If all are busy, use least recently used
    const leastRecentlyUsed = [...connectionPool].sort((a, b) => a.lastUsed - b.lastUsed)[0];
    leastRecentlyUsed.lastUsed = Date.now();
    return leastRecentlyUsed;
}

/**
 * Marks a connection as available again after use.
 * 
 * Returns a connection to the available pool by updating its busy state.
 * This is essential for the connection pooling system to properly track
 * which connections are in use and which are available for new transfers.
 * 
 * @param {WebTransport} connection - The connection to release back to the pool
 */
function releaseConnection(connection: WebTransport): void {
    const connInfo = connectionPool.find(info => info.connection === connection);
    if (connInfo) {
        connInfo.busy = false;
    }
}

/**
 * Pulls chunk data from the producer worker.
 * 
 * This function implements the consumer side of the producer-consumer pattern:
 * - Requests a specific chunk from the producer worker using transferable objects
 * - Sets up promise-based communication for data transfer
 * - Handles timeouts and errors gracefully
 * - Tracks chunk sizes for optimization purposes
 * 
 * @param {number} chunkIndex - The index of the chunk to retrieve
 * @param {string} uploadId - The upload session ID the chunk belongs to
 * @returns {Promise<Uint8Array>} The binary chunk data
 * @throws {Error} If the producer fails to provide the chunk or timeout occurs
 */
async function pullChunkData(chunkIndex: number, uploadId: string): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
        // Use longer timeout for large chunks that might take time
        const timeoutId = setTimeout(() => 
            reject(new Error(`Timeout waiting for chunk ${chunkIndex} data`)), 30000);
        
        const messageHandler = (event: MessageEvent) => {
            const { type, payload } = event.data;
            if (type === 'chunk-data' && payload.chunkIndex === chunkIndex && payload.uploadId === uploadId) {
                clearTimeout(timeoutId);
                self.removeEventListener('message', messageHandler);
                const chunk = payload.chunk as Uint8Array;
                // Track chunk size for future categorization
                chunkSizeMap.set(chunkIndex, chunk.byteLength);
                resolve(chunk);
            } else if (type === 'chunk-upload-error' && payload.chunkIndex === chunkIndex && payload.uploadId === uploadId) {
                clearTimeout(timeoutId);
                self.removeEventListener('message', messageHandler);
                reject(new Error(`Encryption Stream reported error for chunk ${chunkIndex}: ${payload.error}`));
            }
        };
        
        self.addEventListener('message', messageHandler);
        self.postMessage({ 
            type: 'pull-chunk', 
            payload: { 
                chunkIndex, 
                uploadId,
                useTransferables: true // Signal that we want transferable objects
            } 
        });
    });
}

/**
 * Pulls multiple chunks in parallel for batch processing with memory awareness.
 * 
 * This optimized function retrieves multiple chunks simultaneously while respecting memory constraints:
 * - Creates parallel requests for all chunks in the batch
 * - Processes results as they arrive for maximum efficiency
 * - Limits total memory usage during prefetch operations
 * - Handles partial failures gracefully
 * - Prepares a complete batch for efficient delivery
 * 
 * @param {ChunkReadyRequest[]} requests - The chunks to retrieve from the producer
 * @returns {Promise<Map<number, Uint8Array>>} Map of chunk indices to binary chunk data
 */
async function pullMultipleChunks(requests: ChunkReadyRequest[]): Promise<Map<number, Uint8Array>> {
    if (requests.length === 0) return new Map();
    
    // Calculate estimated memory needed for this batch
    let estimatedMemory = 0;
    for (const req of requests) {
        const knownSize = chunkSizeMap.get(req.chunkIndex) || 2 * 1024 * 1024; // Default to 2MB if unknown
        estimatedMemory += knownSize;
    }
    
    console.debug(`[WebTransport Stream] Pre-fetching ${requests.length} chunks in parallel (est. ${Math.round(estimatedMemory/1024/1024)}MB)`);
    
    // If estimated memory is too high, pull chunks in smaller batches
    if (estimatedMemory > MAX_PREFETCH_MEMORY) {
        console.debug(`[WebTransport Stream] Breaking large prefetch into smaller batches to limit memory usage`);
        
        // Process in smaller batches to limit memory usage
        const allChunks = new Map<number, Uint8Array>();
        const batchSize = Math.max(5, Math.floor(MAX_PREFETCH_MEMORY / (2 * 1024 * 1024))); // At least 5 chunks
        
        for (let i = 0; i < requests.length; i += batchSize) {
            const batchRequests = requests.slice(i, i + batchSize);
            console.debug(`[WebTransport Stream] Processing prefetch sub-batch ${Math.floor(i/batchSize)+1}/${Math.ceil(requests.length/batchSize)}`);
            
            // Pull this smaller batch
            const batchResults = await pullBatchWithMemoryTracking(batchRequests);
            
            // Merge results
            for (const [index, data] of batchResults.entries()) {
                allChunks.set(index, data);
            }
        }
        
        return allChunks;
    }
    
    // For smaller batches, use normal prefetch
    return await pullBatchWithMemoryTracking(requests);
}

/**
 * Pulls a batch of chunks with memory usage tracking.
 * 
 * Helper function that handles the actual chunk pulling with proper error handling.
 * 
 * @param {ChunkReadyRequest[]} requests - The chunks to retrieve from the producer
 * @returns {Promise<Map<number, Uint8Array>>} Map of chunk indices to binary chunk data
 */
async function pullBatchWithMemoryTracking(requests: ChunkReadyRequest[]): Promise<Map<number, Uint8Array>> {
    // Create pull promises for all chunks in parallel
    const pullPromises: Promise<{index: number, data: Uint8Array}>[] = requests.map(
        request => pullChunkData(request.chunkIndex, request.uploadId)
            .then(data => ({index: request.chunkIndex, data}))
    );
    
    // Wait for all to complete and gather results
    const results = await Promise.allSettled(pullPromises);
    const chunkDataMap = new Map<number, Uint8Array>();
    
    // Process results
    results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            const {index, data} = result.value;
            chunkDataMap.set(index, data);
        } else {
            console.error(`[WebTransport Stream] Failed to pre-fetch chunk #${requests[i].chunkIndex}:`, result.reason);
            // We don't throw here, we'll let the batch process handle missing chunks
        }
    });
    
    return chunkDataMap;
}

/**
 * Sends a batch of chunks over a single WebTransport stream.
 * 
 * This function optimizes chunk delivery by:
 * - Pre-fetching all chunks in parallel before sending
 * - Using a single WebTransport stream for the entire batch
 * - Providing detailed progress tracking and error handling
 * - Implementing batch notification for completed chunks
 * - Managing connection lifecycle and resource cleanup
 * 
 * @param {ChunkReadyRequest[]} batchRequests - The batch of chunks to send
 * @returns {Promise<void>} Resolves when the batch has been sent
 * @throws {Error} If batch sending fails catastrophically
 */
async function sendChunkBatch(batchRequests: ChunkReadyRequest[]): Promise<void> {
    if (isAborted || batchRequests.length === 0) {
        return;
    }
    
    const batchStartTime = performance.now();
    const uploadId = batchRequests[0].uploadId; // Assume all in batch are for the same uploadId

    // Ensure we have a connection pool
    if (connectionPool.length === 0 || currentUploadId !== uploadId) {
        await initWebTransport(uploadId);
    }

    // Get a connection from the pool
    const connectionInfo = getAvailableConnection();
    if (!connectionInfo) {
        throw new Error('No WebTransport connections available in pool');
    }

    activeTransfers++;
    
    // --- Pre-fetch all chunks in the batch in parallel ---
    // This significantly improves throughput by requesting all chunks at once
    const chunkDataMap = await pullMultipleChunks(batchRequests);
    
    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    try {
        console.debug(`[WebTransport Stream] Opening stream for batch of ${batchRequests.length} chunks starting from #${batchRequests[0].chunkIndex}`);
        const streamStartTime = performance.now();
        const wtStream = await connectionInfo.connection.createUnidirectionalStream();
        const streamCreationTime = performance.now() - streamStartTime;
        
        // Track stream creation time to help detect network issues
        serverResponseTimes.push(streamCreationTime);
        
        writer = wtStream.getWriter();

        // Process all the chunks we successfully pre-fetched
        const completedChunks: number[] = [];
        const failedChunks: number[] = [];
        
        // Send chunks sequentially within the same stream
        for (const request of batchRequests) {
            const { chunkIndex, uploadId: reqUploadId } = request;
            if (reqUploadId !== uploadId) {
                 console.error(`[WebTransport Stream] Batch contains mixed uploadIds: ${reqUploadId} vs ${uploadId}`);
                 failedChunks.push(chunkIndex);
                 continue;
            }

            // Get the pre-fetched chunk data
            const chunk = chunkDataMap.get(chunkIndex);
            if (!chunk) {
                console.warn(`[WebTransport Stream] Missing pre-fetched chunk #${chunkIndex}, skipping`);
                failedChunks.push(chunkIndex);
                continue;
            }

            try {
                // Send chunk data within the batch stream
                const metadata = {
                    uploadId: reqUploadId,
                    chunkIndex: chunkIndex,
                    filename: `${reqUploadId}-chunk-${chunkIndex}.bin`
                };
                const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata) + '\n');
                await writer.write(metadataBytes);
                await writer.write(chunk);
                console.debug(`[WebTransport Stream] Sent chunk #${chunkIndex} (${chunk.length} bytes) over WebTransport (in batch)`);
                
                // Track successful chunks
                completedChunks.push(chunkIndex);
                totalChunksSent++; // Increment global counter
            } catch (chunkError) {
                console.error(`[WebTransport Stream] Failed to send chunk #${chunkIndex}:`, chunkError);
                failedChunks.push(chunkIndex);
            }
        }

        // Close the stream after all chunks in the batch are sent
        await writer.close();
        writer = null;
        console.debug(`[WebTransport Stream] Closed stream after sending batch. Successfully sent: ${completedChunks.length}, Failed: ${failedChunks.length}`);
        
        // Notify the producer of completion for successful chunks
        if (completedChunks.length > 0) {
            if (completedChunks.length <= 10) {
                // Use individual notifications for small numbers of completions
                for (const chunkIndex of completedChunks) {
                    self.postMessage({
                        type: 'chunk-upload-complete',
                        payload: { chunkIndex, uploadId }
                    });
                }
            } else {
                // Use batch notification for larger numbers of completions
                self.postMessage({
                    type: 'chunks-upload-complete-batch',
                    payload: { chunkIndices: completedChunks, uploadId }
                });
            }
        }
        
        // Notify producer of errors for failed chunks
        for (const chunkIndex of failedChunks) {
            self.postMessage({
                type: 'chunk-upload-error',
                payload: { 
                    chunkIndex, 
                    uploadId, 
                    error: 'Failed to send chunk in batch'
                }
            });
        }
        
        // Release the connection back to the pool
        releaseConnection(connectionInfo.connection);
        
        // Track batch completion time for performance optimization
        const batchEndTime = performance.now();
        const batchTime = batchEndTime - batchStartTime;
        batchCompletionTimes.push(batchTime);
        
        // Update global counters
        totalChunksConfirmed += completedChunks.length;
        
        // Calculate average batch time
        if (batchCompletionTimes.length >= 3) {
            const recentAvgTime = batchCompletionTimes
                .slice(-3)
                .reduce((sum, time) => sum + time, 0) / 3;
                
            // Adjust batch size based on performance
            const oldBatchSize = BATCH_SIZE;
            
            if (recentAvgTime < 1000 && OPTIMAL_BATCH_SIZE < BATCH_SIZE_MAX) {
                // Performing well, gradually increase batch size
                OPTIMAL_BATCH_SIZE = Math.min(BATCH_SIZE_MAX, OPTIMAL_BATCH_SIZE + 2);
                BATCH_SIZE = OPTIMAL_BATCH_SIZE;
                console.debug(`[WebTransport Stream] Good performance (${recentAvgTime.toFixed(0)}ms), increasing batch size to ${BATCH_SIZE}`);
            } else if (recentAvgTime > 3000 && OPTIMAL_BATCH_SIZE > BATCH_SIZE_MIN) {
                // Too slow, gradually decrease batch size
                OPTIMAL_BATCH_SIZE = Math.max(BATCH_SIZE_MIN, OPTIMAL_BATCH_SIZE - 2);
                BATCH_SIZE = OPTIMAL_BATCH_SIZE;
                console.debug(`[WebTransport Stream] Poor performance (${recentAvgTime.toFixed(0)}ms), decreasing batch size to ${BATCH_SIZE}`);
            }
            
            // Keep array bounded (moved outside adjustParametersForNetworkConditions)
            if (serverResponseTimes.length > 20) {
                serverResponseTimes.splice(0, serverResponseTimes.length - 10);
            }
            
            // Keep the array bounded
            if (batchCompletionTimes.length > 10) {
                batchCompletionTimes.splice(0, batchCompletionTimes.length - 10);
            }
            
            // Calculate throughput (chunks per second)
            const elapsedTimeSeconds = (performance.now() - uploadStartTime) / 1000;
            const throughput = elapsedTimeSeconds > 0 ? totalChunksConfirmed / elapsedTimeSeconds : 0;
            
            // Calculate average chunk size from the known sizes
            const chunkSizes = Array.from(chunkSizeMap.values());
            const avgChunkSize = chunkSizes.length > 0 
                ? chunkSizes.reduce((sum, size) => sum + size, 0) / chunkSizes.length
                : 2 * 1024 * 1024; // Default to 2MB if no chunks have been processed yet
            
            // Calculate average response time
            const avgResponseTime = serverResponseTimes.length > 0
                ? serverResponseTimes.reduce((sum, time) => sum + time, 0) / serverResponseTimes.length
                : 500; // Default to 500ms if no data yet
                
            // Adjust parameters based on network conditions
            adjustParametersForNetworkConditions(
                throughput,
                avgResponseTime,
                recentAvgTime,
                avgChunkSize
            );
            
            // Log comprehensive performance metrics
            console.debug(`[WebTransport Stream] Performance metrics: avg=${recentAvgTime.toFixed(0)}ms, avgChunkSize=${(avgChunkSize/1024/1024).toFixed(2)}MB, batchSize=${BATCH_SIZE}, concurrentBatches=${MAX_CONCURRENT_BATCHES}, completed=${completedChunks.length}, totalConfirmed=${totalChunksConfirmed}, throughput=${throughput.toFixed(1)} chunks/sec`);
        }

    } catch (error) {
        if (writer) {
            try {
                await writer.abort();
            } catch (abortErr) {
                console.warn('[WebTransport Stream] Failed to abort stream during batch error:', abortErr);
            }
        }
        
        // Release the connection back to the pool even on error
        releaseConnection(connectionInfo.connection);
        
        console.error(`[WebTransport Stream] Failed to send batch of chunks for upload ${uploadId}:`, error);
        
        // Notify producer of errors for the chunks in this batch
        for (const request of batchRequests) {
             self.postMessage({
                type: 'chunk-upload-error',
                payload: { chunkIndex: request.chunkIndex, uploadId: request.uploadId, error: error instanceof Error ? error.message : String(error) }
            });
        }
        
        // Re-throw to signal failure to the queue processor
        throw error;
    } finally {
        activeTransfers--;
    }
}

/**
 * Categorizes chunks by size to optimize transfer scheduling.
 * 
 * This intelligent function improves overall throughput by:
 * - Separating chunks into small and large categories
 * - Using known size data from previous transfers when available
 * - Applying heuristics for unknown chunk sizes
 * - Ensuring small chunks don't get blocked behind large ones
 * - Preventing head-of-line blocking in the upload pipeline
 * 
 * @param {ChunkReadyRequest[]} queue - The queue of chunks to categorize
 * @returns {{small: ChunkReadyRequest[], large: ChunkReadyRequest[]}} Categorized chunks
 */
function categorizeChunks(queue: ChunkReadyRequest[]): {small: ChunkReadyRequest[], large: ChunkReadyRequest[]} {
    const threshold = 256 * 1024; // 256KB threshold between "small" and "large" chunks
    
    // Attempt to categorize based on known sizes
    const small: ChunkReadyRequest[] = [];
    const large: ChunkReadyRequest[] = [];
    
    // First pass: check chunks with known sizes (from previous pulls)
    for (const request of queue) {
        const size = chunkSizeMap.get(request.chunkIndex);
        
        if (size !== undefined) {
            // We know the actual size
            if (size < threshold) {
                small.push(request);
            } else {
                large.push(request);
            }
        } else {
            // Special cases: header is always small, first chunk is likely small
            // And file fragments at the end tend to be small
            if (request.chunkIndex === 0 || request.chunkIndex === 1) {
                small.push(request);
            } else {
                // Use heuristic: Higher chunk indices tend to have more uniform sizes
                // Let's put every 3rd unknown chunk in small category to ensure we're processing some
                if (request.chunkIndex % 3 === 0) {
                    small.push(request);
                } else {
                    large.push(request);
                }
            }
        }
    }
    
    console.debug(`[WebTransport Stream] Categorized chunks: ${small.length} small, ${large.length} large`);
    
    return { small, large };
}

/**
 * Processes the chunk queue in parallel batches for maximum throughput.
 * 
 * This central orchestration function manages the flow of chunks:
 * - Executes multiple batch transfers concurrently for maximum throughput
 * - Implements smart chunk prioritization based on size
 * - Controls concurrency to prevent resource exhaustion
 * - Manages batch formation and execution for optimal performance
 * - Handles errors gracefully at the batch level
 * - Provides self-scheduling to process the entire queue
 * 
 * @returns {Promise<void>} Resolves when queue processing is complete
 */
async function processChunkQueue(): Promise<void> {
    // Prevent multiple instances from running or running when aborted/empty
    if (isProcessingQueue || isAborted || chunkReadyQueue.length === 0 || !currentUploadId) {
        return;
    }

    isProcessingQueue = true;
    console.debug(`[WebTransport Stream] Starting to process chunk queue (size: ${chunkReadyQueue.length}, connections: ${connectionPool.length}, active transfers: ${activeTransfers})`);

    try {
        // Process multiple batches concurrently to maximize throughput
        const batchPromises: Promise<void>[] = [];
        
        while (chunkReadyQueue.length > 0 && 
               activeTransfers < MAX_CONCURRENT_BATCHES && 
               !isAborted) {
            
            // Prioritize and organize chunks for optimal streaming
            let batch: ChunkReadyRequest[] = [];
            
            if (PRIORITIZE_SMALL_CHUNKS && chunkReadyQueue.length > BATCH_SIZE) {
                // Split queue into small and large chunks to optimize pipelining
                const categorized = categorizeChunks([...chunkReadyQueue]);
                
                // Process small chunks first to avoid head-of-line blocking
                if (categorized.small.length > 0) {
                    const smallChunksToProcess = categorized.small.slice(0, BATCH_SIZE);
                    batch = smallChunksToProcess;
                    
                    // Remove the selected chunks from the queue
                    chunkReadyQueue = chunkReadyQueue.filter(item => 
                        !smallChunksToProcess.some(selected => 
                            selected.chunkIndex === item.chunkIndex));
                }
            }
            
            // If we didn't form a batch with small chunks, use normal FIFO
            if (batch.length === 0) {
                // Form a batch from the queue
                batch = chunkReadyQueue.splice(0, Math.min(BATCH_SIZE, chunkReadyQueue.length));
            }
            
            if (batch.length === 0) break;
            
            // Start batch processing without awaiting completion
            const batchSize = batch.length;
            const firstIndex = batch[0].chunkIndex;
            const lastIndex = batch[batch.length - 1].chunkIndex;
            
            console.debug(`[WebTransport Stream] Starting batch ${activeTransfers + 1}/${MAX_CONCURRENT_BATCHES}: ${batchSize} chunks (${firstIndex}-${lastIndex})`);
            
            // Process this batch without waiting for it to complete
            const batchPromise = sendChunkBatch(batch).catch(error => {
                console.error(`[WebTransport Stream] Batch ${firstIndex}-${lastIndex} failed:`, error);
                // Individual errors are already reported in sendChunkBatch
            });
            
            batchPromises.push(batchPromise);
            
            // If we've reached max concurrent batches or the queue is empty, wait for at least one batch to complete
            if (activeTransfers >= MAX_CONCURRENT_BATCHES || chunkReadyQueue.length === 0) {
                if (batchPromises.length > 0) {
                    // Use adaptive wait strategy based on performance
                    const waitStartTime = performance.now();
                    await Promise.race(batchPromises);
                    const waitTime = performance.now() - waitStartTime;
                    
                    // If waiting was very short, consider increasing concurrency
                    if (waitTime < 100 && MAX_CONCURRENT_BATCHES < 6 && serverResponseTimes.length >= 3) {
                        const avgResponse = serverResponseTimes.slice(-3).reduce((a,b) => a+b, 0) / 3;
                        if (avgResponse < 300) {
                            MAX_CONCURRENT_BATCHES++;
                            console.debug(`[WebTransport Stream] Fast response time (${avgResponse.toFixed(1)}ms), increasing concurrent batches to ${MAX_CONCURRENT_BATCHES}`);
                        }
                    }
                    
                    // Filter out completed promises
                    // We can't easily check isPending in standard Promise API, so we'll
                    // just wait for all the promises we have so far
                    await Promise.allSettled(batchPromises);
                    batchPromises.length = 0;
                }
            }
        }
        
        // Wait for all outstanding batches to complete before ending
        if (batchPromises.length > 0) {
            await Promise.allSettled(batchPromises);
        }
    } catch (error) {
        console.error('[WebTransport Stream] Error occurred during batch processing:', error);
    }

    isProcessingQueue = false;
    console.debug(`[WebTransport Stream] Finished processChunkQueue cycle. Queue size: ${chunkReadyQueue.length}, active transfers: ${activeTransfers}`);

    // If queue still has items and we're not aborted, trigger another cycle
    if (chunkReadyQueue.length > 0 && !isAborted) {
        setTimeout(processChunkQueue, 0); // Schedule next cycle
    }
}


/**
 * Processes a single chunk ready notification from the producer.
 * 
 * Handles individual chunk ready messages by:
 * - Ensuring the correct upload ID is active
 * - Adding the chunk to the processing queue
 * - Triggering queue processing if not already running
 * - Handling connection initialization for new upload sessions
 * 
 * @param {number} chunkIndex - The index of the chunk that is ready
 * @param {string} uploadId - The upload ID this chunk belongs to
 * @returns {Promise<void>} Resolves when the chunk has been queued
 */
async function processChunkReady(chunkIndex: number, uploadId: string): Promise<void> {
    if (isAborted || !uploadId) return;
    
    // If uploadId changed, we need to initialize a new connection
    if (currentUploadId !== uploadId) {
        await initWebTransport(uploadId);
    }
    
    console.debug(`[WebTransport Stream] Got chunk-ready for #${chunkIndex} of upload ${uploadId}`);
    
    // Add to queue
    chunkReadyQueue.push({ chunkIndex, uploadId });
    
    // Start memory monitoring if it's not already running
    setupMemoryMonitoring(uploadId);
    
    // Start processing the queue if not already running
    if (!isProcessingQueue) {
        processChunkQueue().catch(err => {
            console.error('[WebTransport Stream] Error in processChunkQueue:', err);
        });
    }
}

/**
 * Processes a batch of chunk ready notifications from the producer.
 * 
 * Optimized to handle multiple chunk notifications in a single operation:
 * - Efficiently processes entire batches of ready chunks at once
 * - Ensures the correct upload ID is active
 * - Adds all chunks to the processing queue in one operation
 * - Triggers queue processing if not already running
 * - Monitors backlog and scales consumer workers as needed
 * 
 * @param {Array<{chunkIndex: number, uploadId: string}>} chunks - Batch of chunks that are ready
 * @returns {Promise<void>} Resolves when all chunks have been queued
 */
async function processBatchChunksReady(chunks: {chunkIndex: number, uploadId: string}[]): Promise<void> {
    if (isAborted || chunks.length === 0) return;
    
    const uploadId = chunks[0].uploadId;
    
    // If uploadId changed, we need to initialize a new connection
    if (currentUploadId !== uploadId) {
        await initWebTransport(uploadId);
    }
    
    console.debug(`[WebTransport Stream] Got batch of ${chunks.length} chunks ready for upload ${uploadId}`);
    
    // Check if we need to distribute chunks to additional workers
    if (additionalConsumerWorkers.size > 0) {
        // Distribute chunks to workers based on their assigned ranges
        const distributedChunks: {chunkIndex: number, uploadId: string}[] = [];
        const chunksForMainWorker: {chunkIndex: number, uploadId: string}[] = [];
        
        for (const chunk of chunks) {
            let isAssigned = false;
            
            // Try to assign to a worker with a matching range
            for (const [workerId, workerInfo] of additionalConsumerWorkers.entries()) {
                if (workerInfo.isReady && workerInfo.uploadId === uploadId && workerInfo.chunkRange) {
                    if (chunk.chunkIndex >= workerInfo.chunkRange.start && 
                        chunk.chunkIndex <= workerInfo.chunkRange.end) {
                        workerInfo.worker.postMessage({
                            type: 'chunk-ready',
                            payload: { chunkIndex: chunk.chunkIndex, uploadId }
                        });
                        workerInfo.chunksAssigned++;
                        isAssigned = true;
                        distributedChunks.push(chunk);
                        break;
                    }
                }
            }
            
            // If not assigned to any additional worker, keep for main worker
            if (!isAssigned) {
                chunksForMainWorker.push(chunk);
            }
        }
        
        // Process remaining chunks in the main worker
        if (chunksForMainWorker.length > 0) {
            console.debug(`[WebTransport Stream] Processing ${chunksForMainWorker.length}/${chunks.length} chunks in main worker, ${distributedChunks.length} distributed to additional workers`);
            chunkReadyQueue.push(...chunksForMainWorker);
        } else {
            console.debug(`[WebTransport Stream] All ${chunks.length} chunks distributed to additional workers`);
        }
    } else {
        // Add all to queue for the main worker
        chunkReadyQueue.push(...chunks);
    }
    
    // Start processing the queue if not already running
    if (!isProcessingQueue) {
        processChunkQueue().catch(err => {
            console.error('[WebTransport Stream] Error in processChunkQueue:', err);
        });
    }
    
    // Start memory monitoring if it's not already running
    setupMemoryMonitoring(uploadId);
    
    // Do an immediate memory check when we receive chunks
    checkMemoryAndScaleWorkers(uploadId);
    
    // Monitor backlog and consider scaling workers
    monitorBacklogAndScaleWorkers(uploadId);
}

/**
 * Memory monitoring timer ID for periodic checks.
 * @type {number | null}
 */
let memoryMonitoringInterval: number | null = null;

/**
 * Timestamp of the last worker spawn to enforce cooldown.
 * @type {number}
 */
let lastWorkerSpawnTime: number = 0;

/**
 * Sets up periodic memory monitoring for worker scaling.
 * 
 * This function establishes a regular interval to check memory usage:
 * - Measures heap size using performance.memory API when available
 * - Spawns additional workers when memory thresholds are exceeded
 * - Scales down when memory usage decreases
 * - Self-cleans when uploads are complete
 * 
 * @param {string} uploadId - The current upload session ID
 */
/**
 * Monitors network conditions for significant changes and
 * adapts parameters as needed.
 * 
 * @param {string} uploadId - Current upload ID
 */
function setupNetworkMonitoring(uploadId: string): void {
    // Store previous metrics for comparison
    let lastAvgResponseTime = 500; // Default starting value
    let lastBatchTime = 2000;   // Default starting value
    let lastThroughput = 0;
    
    // Check network conditions periodically
    const monitoringInterval = setInterval(() => {
        if (isAborted || currentUploadId !== uploadId) {
            clearInterval(monitoringInterval);
            return;
        }
        
        // Calculate current metrics
        const avgResponseTime = serverResponseTimes.length > 0
            ? serverResponseTimes.reduce((sum, time) => sum + time, 0) / serverResponseTimes.length
            : lastAvgResponseTime;
            
        const avgBatchTime = batchCompletionTimes.length > 0
            ? batchCompletionTimes.reduce((sum, time) => sum + time, 0) / batchCompletionTimes.length
            : lastBatchTime;
            
        const elapsedTimeSeconds = (performance.now() - uploadStartTime) / 1000;
        const throughput = elapsedTimeSeconds > 0 ? totalChunksConfirmed / elapsedTimeSeconds : 0;
        
        // Detect significant changes in network conditions
        const responseTimeDelta = Math.abs(avgResponseTime - lastAvgResponseTime) / lastAvgResponseTime;
        const batchTimeDelta = Math.abs(avgBatchTime - lastBatchTime) / lastBatchTime;
        const throughputDelta = lastThroughput > 0 
            ? Math.abs(throughput - lastThroughput) / lastThroughput 
            : 1;
            
        // If significant change detected (>50% change in any metric)
        if (responseTimeDelta > 0.5 || batchTimeDelta > 0.5 || throughputDelta > 0.5) {
            console.debug(`[WebTransport Stream] Significant network change detected: responseTimeDelta=${responseTimeDelta.toFixed(2)}, batchTimeDelta=${batchTimeDelta.toFixed(2)}, throughputDelta=${throughputDelta.toFixed(2)}`);
            
            // Adapt parameters to new network conditions
            adaptToNetworkConditions();
        }
        
        // Store current values for next comparison
        lastAvgResponseTime = avgResponseTime;
        lastBatchTime = avgBatchTime;
        lastThroughput = throughput;
    }, 5000); // Check every 5 seconds
}

function setupMemoryMonitoring(uploadId: string): void {
    // Don't set up duplicates
    if (memoryMonitoringInterval !== null) return;
    
    console.warn(`[WebTransport Stream] Setting up memory monitoring for upload ${uploadId}`);
    
    memoryMonitoringInterval = self.setInterval(() => {
        if (isAborted || currentUploadId !== uploadId) {
            // Clean up if we're done
            if (memoryMonitoringInterval !== null) {
                clearInterval(memoryMonitoringInterval);
                memoryMonitoringInterval = null;
            }
            return;
        }
        
        // Check current memory usage
        checkMemoryAndScaleWorkers(uploadId);
    }, MEMORY_CHECK_INTERVAL);
}

/**
 * Checks current memory usage and scales workers accordingly.
 * 
 * This function is the core of our memory-based worker scaling:
 * - Gets current memory stats
 * - Spawns workers when usage exceeds thresholds
 * - Reduces workers when usage is low
 * - Logs detailed memory metrics for monitoring
 * 
 * @param {string} uploadId - The current upload session ID
 */
function checkMemoryAndScaleWorkers(uploadId: string): void {
    // Get memory usage
    let memoryUsageMB = 0;
    let memoryMetrics = {};
    
    try {
        // Try to use performance.memory if available (Chrome/Chromium browsers)
        const performance = self.performance as any;
        if (performance && performance.memory) {
            const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = performance.memory;
            
            memoryUsageMB = Math.round(usedJSHeapSize / (1024 * 1024));
            const totalHeapMB = Math.round(totalJSHeapSize / (1024 * 1024));
            const heapLimitMB = Math.round(jsHeapSizeLimit / (1024 * 1024));
            
            memoryMetrics = {
                usedMB: memoryUsageMB,
                totalMB: totalHeapMB,
                limitMB: heapLimitMB,
                usagePercent: Math.round((usedJSHeapSize / jsHeapSizeLimit) * 100)
            };
            
            // Use heap usage percentage as an alternative metric
            const heapUsagePercent = (usedJSHeapSize / jsHeapSizeLimit) * 100;
            
            console.warn(`[WebTransport Stream] Memory usage: ${memoryUsageMB}MB / ${heapLimitMB}MB (${heapUsagePercent.toFixed(1)}%)`);
            
            // If we're using a significant portion of memory and we have chunks in the queue
            const currentTime = Date.now();
            const cooldownElapsed = currentTime - lastWorkerSpawnTime > WORKER_SPAWN_COOLDOWN;
            
            // Detect if we're on a slow network that could benefit from more workers
            const networkConditions = detectNetworkConditions();
            const isSlowNetwork = networkConditions.isSlowNetwork;
            
            // Spawn worker if memory threshold is exceeded or we're on a slow network with a growing queue
            if ((memoryUsageMB > MEMORY_THRESHOLD_MB || 
                (isSlowNetwork && chunkReadyQueue.length > 30)) && 
                chunkReadyQueue.length > 0 && 
                additionalConsumerWorkers.size < MAX_ADDITIONAL_CONSUMER_WORKERS && 
                cooldownElapsed) {
                
                if (isSlowNetwork) {
                    console.warn(`[WebTransport Stream] Slow network detected with ${chunkReadyQueue.length} queued chunks, spawning new worker`);
                } else {
                    console.warn(`[WebTransport Stream] Memory threshold exceeded (${memoryUsageMB}MB > ${MEMORY_THRESHOLD_MB}MB), spawning new worker`);
                }
                
                spawnAdditionalConsumerWorker(uploadId);
                lastWorkerSpawnTime = currentTime;
            }
            
            // Consider reducing workers if memory usage is low
            if (memoryUsageMB < MEMORY_THRESHOLD_MB * 0.7 && additionalConsumerWorkers.size > 0) {
                // Find least busy worker to terminate
                let leastBusyWorker: number | null = null;
                let leastBusyWorkload = Infinity;
                
                additionalConsumerWorkers.forEach((info, workerId) => {
                    if (info.uploadId === uploadId) {
                        const workerBacklog = info.chunksAssigned - info.chunksCompleted;
                        
                        if (workerBacklog < leastBusyWorkload) {
                            leastBusyWorkload = workerBacklog;
                            leastBusyWorker = workerId;
                        }
                    }
                });
                
                // Only terminate if worker has minimal backlog
                if (leastBusyWorker !== null && leastBusyWorkload < 10) {
                    console.warn(`[WebTransport Stream] Memory usage low and worker ${leastBusyWorker} has little work, terminating`);
                    terminateAdditionalConsumerWorker(leastBusyWorker);
                }
            }
        } else {
            // Fallback: if performance.memory isn't available, use the queue size as a proxy
            // This is less accurate but better than nothing
            if (chunkReadyQueue.length > 100 && 
                additionalConsumerWorkers.size < MAX_ADDITIONAL_CONSUMER_WORKERS &&
                Date.now() - lastWorkerSpawnTime > WORKER_SPAWN_COOLDOWN) {
                
                console.warn(`[WebTransport Stream] Large queue detected (${chunkReadyQueue.length} chunks), spawning new worker`);
                spawnAdditionalConsumerWorker(uploadId);
                lastWorkerSpawnTime = Date.now();
            }
        }
    } catch (error) {
        console.warn('[WebTransport Stream] Error checking memory usage:', error);
    }
    
    // Report the current memory and worker state
    self.postMessage({
        type: 'memory-usage-report',
        payload: {
            uploadId,
            memory: memoryMetrics,
            queueSize: chunkReadyQueue.length,
            workerCount: additionalConsumerWorkers.size + 1
        }
    });
}

/**
 * Monitors backlog and scales consumer workers as needed.
 * 
 * This function tracks chunk processing metrics:
 * - Logs current backlog statistics
 * - Initializes memory monitoring if needed
 * 
 * @param {string} uploadId - The current upload session ID
 */
function monitorBacklogAndScaleWorkers(uploadId: string): void {
    if (isAborted || !uploadId) return;
    
    // Make sure we have a memory checking interval set up
    setupMemoryMonitoring(uploadId);
    
    // Still track chunks for statistics and distribution purposes
    let totalChunksAssigned = 0;
    let totalChunksCompleted = 0;
    
    // Count from main worker
    totalChunksAssigned = chunkReadyQueue.length;
    
    // Add counts from additional workers
    additionalConsumerWorkers.forEach(workerInfo => {
        if (workerInfo.uploadId === uploadId) {
            totalChunksAssigned += workerInfo.chunksAssigned;
            totalChunksCompleted += workerInfo.chunksCompleted;
        }
    });
    
    // Log current status for debugging
    const backlogSize = totalChunksAssigned - totalChunksCompleted;
    
    console.debug(`[WebTransport Stream] Current status: ${additionalConsumerWorkers.size} additional workers, ${backlogSize} chunks in backlog (assigned: ${totalChunksAssigned}, completed: ${totalChunksCompleted})`);
}

/**
 * Spawns an additional consumer worker to help process chunks.
 * 
 * Creates a new WebTransport consumer worker and:
 * - Assigns it a specific range of chunks to handle
 * - Sets up communication channels with the main worker
 * - Initializes it with the current upload session
 * - Adds it to the worker tracking map
 * 
 * @param {string} uploadId - The current upload session ID
 */
function spawnAdditionalConsumerWorker(uploadId: string): void {
    const workerId = additionalConsumerWorkers.size + 1;
    
    console.debug(`[WebTransport Stream] Spawning additional consumer worker #${workerId} to help with backlog`);
    
    // Create a new worker from the same script
    const workerScript = (self as any).location.href;
    const worker = new Worker(workerScript);
    
    // Calculate chunk range for this worker
    const chunkRange = calculateChunkRangeForWorker(workerId, uploadId);
    
    // Initialize worker tracking
    const workerInfo = {
        worker,
        chunkRange,
        isReady: false,
        uploadId,
        chunksAssigned: 0,
        chunksCompleted: 0
    };
    
    additionalConsumerWorkers.set(workerId, workerInfo);
    
    // Handle messages from the worker
    worker.onmessage = (event) => {
        const { type, payload } = event.data;
        
        switch (type) {
            case 'consumer-ready':
                if (payload.uploadId === uploadId) {
                    console.debug(`[WebTransport Stream] Additional consumer worker #${workerId} is ready`);
                    workerInfo.isReady = true;
                    
                    // Redistribute some chunks from our queue to this worker if needed
                    redistributeChunksToWorker(workerId, uploadId);
                }
                break;
                
            case 'chunk-upload-complete':
                workerInfo.chunksCompleted++;
                
                // Forward to the producer worker
                self.postMessage({
                    type: 'chunk-upload-complete',
                    payload: payload
                });
                break;
                
            case 'chunks-upload-complete-batch':
                workerInfo.chunksCompleted += payload.chunkIndices.length;
                
                // Forward to the producer worker
                self.postMessage({
                    type: 'chunks-upload-complete-batch',
                    payload: payload
                });
                break;
                
            case 'consumer-error':
            case 'web-transport-error':
                console.error(`[WebTransport Stream] Error in additional worker #${workerId}:`, payload);
                
                // If critical error, terminate the worker
                if (payload.critical) {
                    terminateAdditionalConsumerWorker(workerId);
                }
                break;
                
            case 'pull-chunk':
                // Forward pull request to main thread
                self.postMessage({
                    type: 'pull-chunk',
                    payload: payload
                });
                break;
        }
    };
    
    // Initialize the worker with the current upload
    worker.postMessage({
        type: 'consumer-init',
        payload: { uploadId }
    });
    
    // Start diagnostics reporting now that we have additional workers
    setupDiagnosticsReporting();
}

/**
 * Terminates an additional consumer worker and redistributes its work.
 * 
 * This function handles clean shutdown of a worker:
 * - Closes its connections and releases resources
 * - Reassigns any pending chunks back to the main worker
 * - Removes it from the worker tracking map
 * 
 * @param {number} workerId - The ID of the worker to terminate
 */
function terminateAdditionalConsumerWorker(workerId: number): void {
    const workerInfo = additionalConsumerWorkers.get(workerId);
    if (!workerInfo) return;
    
    console.debug(`[WebTransport Stream] Terminating additional consumer worker #${workerId}`);
    
    // Send close message first to allow graceful cleanup
    workerInfo.worker.postMessage({ type: 'close-web-transport' });
    
    // Give a small window for cleanup before termination
    setTimeout(() => {
        try {
            workerInfo.worker.terminate();
            console.debug(`[WebTransport Stream] Additional worker #${workerId} terminated`);
        } catch (err) {
            console.warn(`[WebTransport Stream] Error terminating worker #${workerId}:`, err);
        }
        
        // Remove from tracking map
        additionalConsumerWorkers.delete(workerId);
        
        // If we terminated the last worker, rebalance remaining workers
        if (additionalConsumerWorkers.size > 0 && workerInfo.uploadId) {
            rebalanceWorkerChunkRanges(workerInfo.uploadId);
        }
    }, 500);
}

/**
 * Calculates the optimal chunk range for a new worker.
 * 
 * This function determines which chunks should be assigned to a new worker:
 * - Analyzes current processing progress
 * - Identifies areas with highest backlog
 * - Creates a non-overlapping range assignment
 * - Prioritizes chunks that haven't been processed yet
 * 
 * @param {number} workerId - The ID of the worker being assigned a range
 * @param {string} uploadId - The current upload session ID
 * @returns {Object} The start and end chunk indices for this worker
 */
function calculateChunkRangeForWorker(workerId: number, uploadId: string): {start: number, end: number} | null {
    // For now, use a simple strategy of dividing unprocessed chunks
    // Find highest chunk index seen so far as a proxy for total chunks
    let highestChunkIndex = 0;
    
    // Look at the queue for chunks
    for (const request of chunkReadyQueue) {
        if (request.uploadId === uploadId && request.chunkIndex > highestChunkIndex) {
            highestChunkIndex = request.chunkIndex;
        }
    }
    
    // Use first chunk index in queue as a proxy for current progress
    let lowestPendingChunk = chunkReadyQueue.length > 0 ? 
        chunkReadyQueue[0].chunkIndex : 0;
    
    // If we can't determine a good range, return null
    if (highestChunkIndex <= lowestPendingChunk) {
        return null;
    }
    
    // Calculate range based on worker count and current workers
    const totalWorkers = additionalConsumerWorkers.size + 1; // Including the new one
    const totalChunks = highestChunkIndex + 1; // +1 because indices are 0-based
    
    // Determine how to split chunks among workers
    const remainingChunks = Math.max(0, totalChunks - lowestPendingChunk);
    const chunksPerWorker = Math.ceil(remainingChunks / totalWorkers);
    
    // Calculate this worker's range
    // Place newer workers toward the higher end of the range
    const workersBeforeThis = workerId - 1;
    const rangeStart = lowestPendingChunk + (chunksPerWorker * workersBeforeThis);
    const rangeEnd = Math.min(totalChunks - 1, rangeStart + chunksPerWorker - 1);
    
    console.debug(`[WebTransport Stream] Assigned worker #${workerId} range: ${rangeStart}-${rangeEnd} (of 0-${totalChunks-1})`);
    
    return { start: rangeStart, end: rangeEnd };
}

/**
 * Redistributes chunks from the main worker's queue to a newly ready worker.
 * 
 * This function optimizes workload distribution by:
 * - Finding chunks in the main queue that match a worker's assigned range
 * - Moving those chunks to the worker for processing
 * - Updating tracking metrics for both workers
 * 
 * @param {number} workerId - The ID of the worker receiving redistributed chunks
 * @param {string} uploadId - The current upload session ID
 */
function redistributeChunksToWorker(workerId: number, uploadId: string): void {
    const workerInfo = additionalConsumerWorkers.get(workerId);
    if (!workerInfo || !workerInfo.chunkRange) return;
    
    const { start, end } = workerInfo.chunkRange;
    const chunksToRedistribute: {chunkIndex: number, uploadId: string}[] = [];
    
    // Find chunks in our queue that belong to this worker's range
    const remainingChunks: ChunkReadyRequest[] = [];
    
    for (const chunk of chunkReadyQueue) {
        if (chunk.uploadId === uploadId && 
            chunk.chunkIndex >= start && 
            chunk.chunkIndex <= end) {
            chunksToRedistribute.push(chunk);
        } else {
            remainingChunks.push(chunk);
        }
    }
    
    // Update our queue to remove redistributed chunks
    chunkReadyQueue = remainingChunks;
    
    // Send chunks to the worker if we found any
    if (chunksToRedistribute.length > 0) {
        console.debug(`[WebTransport Stream] Redistributing ${chunksToRedistribute.length} chunks to worker #${workerId}`);
        
        // Send chunks in batches
        workerInfo.worker.postMessage({
            type: 'chunks-ready-batch',
            payload: { chunks: chunksToRedistribute }
        });
        
        workerInfo.chunksAssigned += chunksToRedistribute.length;
    }
}

/**
 * Rebalances chunk range assignments among all active workers.
 * 
 * This function is called when workers are added or removed:
 * - Recalculates optimal chunk distribution based on current progress
 * - Updates each worker with its new range assignment
 * - Triggers redistribution of chunks as needed
 * 
 * @param {string} uploadId - The current upload session ID
 */
function rebalanceWorkerChunkRanges(uploadId: string): void {
    if (additionalConsumerWorkers.size === 0) return;
    
    console.debug(`[WebTransport Stream] Rebalancing chunk ranges across ${additionalConsumerWorkers.size} workers`);
    
    // Recalculate ranges for all workers
    additionalConsumerWorkers.forEach((info, workerId) => {
        if (info.uploadId === uploadId) {
            info.chunkRange = calculateChunkRangeForWorker(workerId, uploadId);
            
            // Notify worker of its new range
            if (info.isReady && info.chunkRange) {
                info.worker.postMessage({
                    type: 'update-chunk-range',
                    payload: { 
                        range: info.chunkRange,
                        uploadId: uploadId
                    }
                });
                
                // Redistribute chunks based on new ranges
                redistributeChunksToWorker(workerId, uploadId);
            }
        }
    });
}

/**
 * Cleans up and closes all WebTransport connections and resets worker state.
 * 
 * Performs complete cleanup of the worker's state:
 * - Sets abort flag to prevent new operations
 * - Closes all active WebTransport connections
 * - Terminates any additional consumer workers
 * - Clears the current upload ID
 * - Resets the queue and processing state
 * - Prepares the worker for potential future use
 * 
 * @returns {Promise<void>} Resolves when cleanup is complete
 */
async function closeWebTransport(): Promise<void> {
    console.debug('[WebTransport Stream] Closing all WebTransport connections');
    isAborted = true;
    
    // Stop memory monitoring
    if (memoryMonitoringInterval !== null) {
        clearInterval(memoryMonitoringInterval);
        memoryMonitoringInterval = null;
    }
    
    // Terminate all additional consumer workers
    const workerTerminatePromises = Array.from(additionalConsumerWorkers.keys()).map(workerId => {
        return new Promise<void>(resolve => {
            const workerInfo = additionalConsumerWorkers.get(workerId);
            if (workerInfo) {
                workerInfo.worker.postMessage({ type: 'abort' });
                setTimeout(() => {
                    try {
                        workerInfo.worker.terminate();
                    } catch (err) {
                        console.warn(`[WebTransport Stream] Error terminating worker #${workerId} during cleanup:`, err);
                    }
                    resolve();
                }, 100);
            } else {
                resolve();
            }
        });
    });
    
    // Wait for all workers to terminate
    await Promise.all(workerTerminatePromises);
    additionalConsumerWorkers.clear();
    
    await closeAllConnections();
    currentUploadId = null;
    isAborted = false; // Reset for potential future use
    chunkReadyQueue = [];
    isProcessingQueue = false;
    activeTransfers = 0;
}

/**
 * Message handler for communications from the producer worker.
 * 
 * This comprehensive handler processes all inter-worker messages:
 * - Initializes the consumer when requested by the producer
 * - Processes chunk ready notifications (both individual and batched)
 * - Handles chunk data responses for pull requests
 * - Manages worker lifecycle events (abort, complete)
 * - Provides error reporting back to the producer
 * - Maintains the producer-consumer coordination protocol
 * 
 * @param {MessageEvent} e - The message event from the producer worker
 */
self.onmessage = async function (e: MessageEvent) {
    if (!e.data || !e.data.type) return;

    try {
        const { type, payload } = e.data;

        switch (type) {
            case 'consumer-init':
                // Initialize consumer when producer sends init message
                console.debug(`[WebTransport Stream] Received consumer-init message for upload ${payload.uploadId}`);
                try {
                    await initWebTransport(payload.uploadId);
                    // Inform the producer that consumer is ready
                    self.postMessage({
                        type: 'consumer-ready',
                        payload: { uploadId: payload.uploadId }
                    });
                    console.debug(`[WebTransport Stream] Consumer initialization complete for upload ${payload.uploadId}`);
                } catch (error) {
                    console.error(`[WebTransport Stream] Failed to initialize consumer:`, error);
                    self.postMessage({
                        type: 'consumer-error',
                        payload: error instanceof Error ? error.message : String(error)
                    });
                }
                break;

            case 'init-web-transport':
                await initWebTransport(payload.uploadId);
                break;

            case 'chunk-ready':
                await processChunkReady(payload.chunkIndex, payload.uploadId);
                break;
                
            case 'chunks-ready-batch':
                // Process batches of chunk notifications for improved throughput
                await processBatchChunksReady(payload.chunks);
                break;

            case 'chunk-data':
                // This is needed to handle chunk data coming from the producer
                // but we don't need to do anything specific here as the data is already
                // being handled by the pullChunkData promises directly.
                break;

            case 'close-web-transport':
                await closeWebTransport();
                break;

            case 'abort':
                // Handle abort signal from producer
                console.debug('[WebTransport Stream] Received abort signal, cleaning up resources');
                isAborted = true;
                await closeWebTransport();
                break;

            case 'upload-complete':
                // Handle upload complete signal from producer
                console.debug(`[WebTransport Stream] Upload ${payload.uploadId} complete, will close connections soon`);
                // Wait a bit before closing connections to ensure all chunks are processed
                setTimeout(() => {
                    closeWebTransport().catch(err => {
                        console.error('[WebTransport Stream] Error closing connections after upload complete:', err);
                    });
                }, 2000);
                break;
                
            case 'update-chunk-range':
                // Handle updated chunk range assignment (for additional workers only)
                if (payload.range) {
                    console.debug(`[WebTransport Stream] Received updated chunk range: ${payload.range.start}-${payload.range.end}`);
                    // Nothing to do in the primary worker for now
                }
                break;
                
            case 'worker-chunk-complete':
                // Handle notification from an additional worker that a chunk is complete
                if (payload.workerId && payload.chunkIndex) {
                    const workerInfo = additionalConsumerWorkers.get(payload.workerId);
                    if (workerInfo) {
                        workerInfo.chunksCompleted++;
                    }
                }
                break;
                
            case 'worker-status-update':
                // Update tracking stats for a worker
                if (payload.workerId) {
                    const workerInfo = additionalConsumerWorkers.get(payload.workerId);
                    if (workerInfo) {
                        if (typeof payload.chunksAssigned === 'number') {
                            workerInfo.chunksAssigned = payload.chunksAssigned;
                        }
                        if (typeof payload.chunksCompleted === 'number') {
                            workerInfo.chunksCompleted = payload.chunksCompleted;
                        }
                    }
                }
                break;

            default:
                console.warn(`[WebTransport Stream] Unhandled message type: ${type}`);
                break;
        }
    } catch (error) {
        console.error(`[WebTransport Stream] Error handling message:`, error);
        self.postMessage({
            type: 'web-transport-error',
            payload: {
                message: error instanceof Error ? error.message : String(error)
            }
        });
    }
};

self.onerror = (event) => {
    console.error('[WebTransport Stream] Global error in consumer worker:', event);
};

console.debug('[WebTransport Stream] WebTransport consumer worker script loaded and waiting for consumer-init');

// Report performance metrics at regular intervals when we have multiple workers
let diagnosticsIntervalId: number | null = null;

// Setup diagnostics reporting when we have at least one additional worker
/**
 * Collects and reports statistics about the multi-worker performance.
 * 
 * This function gathers key metrics to evaluate the effectiveness of the multi-worker approach:
 * - Overall throughput gains from parallelization
 * - Per-worker performance metrics
 * - Backlog reduction metrics
 * - Resource utilization statistics
 * 
 * @returns {Object} Performance metrics for the worker pool
 */
function collectWorkerPerformanceMetrics(): any {
    // Calculate overall performance metrics
    let totalChunksAssigned = chunkReadyQueue.length;
    let totalChunksCompleted = 0;
    let chunksInProgress = activeTransfers * BATCH_SIZE; // Estimate
    
    // Add data from additional workers
    const workerMetrics = [];
    for (const [workerId, info] of additionalConsumerWorkers.entries()) {
        totalChunksAssigned += info.chunksAssigned;
        totalChunksCompleted += info.chunksCompleted;
        
        // Per-worker metrics
        workerMetrics.push({
            workerId,
            assigned: info.chunksAssigned,
            completed: info.chunksCompleted,
            backlog: info.chunksAssigned - info.chunksCompleted,
            throughputShare: info.chunksCompleted > 0 ? 
                (info.chunksCompleted / Math.max(1, totalChunksCompleted) * 100).toFixed(1) + '%' : '0%',
            range: info.chunkRange ? `${info.chunkRange.start}-${info.chunkRange.end}` : 'none'
        });
    }
    
    // Calculate performance metrics with our enhanced tracking
    const elapsedTimeSeconds = (performance.now() - uploadStartTime) / 1000;
    const throughputRate = elapsedTimeSeconds > 0 ? (totalChunksConfirmed / elapsedTimeSeconds).toFixed(2) : '0';
    
    // Get batch and server response time statistics
    const avgBatchTime = batchCompletionTimes.length > 0 ? 
        (batchCompletionTimes.reduce((a, b) => a + b, 0) / batchCompletionTimes.length).toFixed(1) + 'ms' : 'N/A';
        
    const avgServerResponseTime = serverResponseTimes.length > 0 ? 
        (serverResponseTimes.reduce((a, b) => a + b, 0) / serverResponseTimes.length).toFixed(1) + 'ms' : 'N/A';
    
    // Calculate the speedup from parallelization (if we have data)
    const overallMetrics = {
        // Standard metrics
        totalChunksAssigned,
        totalChunksCompleted,
        pendingChunks: totalChunksAssigned - totalChunksCompleted,
        mainQueueSize: chunkReadyQueue.length,
        chunksInProgress,
        workerCount: additionalConsumerWorkers.size + 1, // Include main worker
        
        // Enhanced metrics for better performance monitoring
        totalChunksConfirmed,  // Accurate global counter
        throughput: throughputRate + ' chunks/sec',
        avgBatchTime,
        avgServerResponseTime,
        batchSize: BATCH_SIZE,
        concurrentBatches: MAX_CONCURRENT_BATCHES,
        elapsedTimeSeconds: elapsedTimeSeconds.toFixed(1) + 's',
        
        estimatedSpeedup: workerMetrics.length > 0 ? 
            (totalChunksCompleted / Math.max(1, totalChunksCompleted - workerMetrics.reduce((sum, m) => sum + m.completed, 0))).toFixed(2) + 'x' : 
            'N/A'
    };
    
    return {
        overall: overallMetrics,
        workers: workerMetrics
    };
}

function setupDiagnosticsReporting(): void {
    if (diagnosticsIntervalId !== null || additionalConsumerWorkers.size === 0) return;
    
    diagnosticsIntervalId = self.setInterval(() => {
        if (additionalConsumerWorkers.size === 0) {
            if (diagnosticsIntervalId !== null) {
                clearInterval(diagnosticsIntervalId);
                diagnosticsIntervalId = null;
            }
            return;
        }
        
        // Collect comprehensive performance metrics
        const metrics = collectWorkerPerformanceMetrics();
        
        console.debug('[WebTransport Stream] Multi-worker diagnostics:', JSON.stringify(metrics));
        
        // Also send metrics to the main thread for monitoring
        self.postMessage({
            type: 'worker-pool-metrics',
            payload: metrics
        });
    }, 5000); // Report every 5 seconds
}