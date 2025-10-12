import { Logger, LogLevel } from '../logger/logger';

type ConnectionInfo = {
  connection: WebTransport;
  busy: boolean;             
  lastUsed: number;
  consecutiveFailures: number;  
  id: number;                   
};
interface ChunkReadyRequest { chunkIndex: number; uploadId: string; workerId?: string | number; }
const logger = new Logger('WebTransport', LogLevel.INFO);
let connectionPool: ConnectionInfo[] = [];
let currentUploadId: string | null = null;
let authProof: Uint8Array | null = null;
let isAborted: boolean = false;
let nextConnectionId = 0;
const MAX_CONSECUTIVE_FAILURES = 3;
let additionalConsumerWorkers: Map<number, {
  worker: Worker,
  chunkRange: {start: number, end: number} | null,
  isReady: boolean,
  uploadId: string | null,
  chunksAssigned: number,
  chunksCompleted: number
}> = new Map();
let chunkReadyQueue: ChunkReadyRequest[] = [];
let isProcessingQueue: boolean = false;
let activeTransfers: number = 0;
let connectionMonitorInterval: number | null = null;
const WEBTRANSPORT_BASE_URL: string = `https://${self.location.hostname}:8001/upload/`;
const MAX_CONNECTIONS: number = 6;
const MAX_ADDITIONAL_CONSUMER_WORKERS: number = 3;
const MEMORY_THRESHOLD_MB: number = 200;
const MEMORY_CHECK_INTERVAL: number = 1000;
const WORKER_SPAWN_COOLDOWN: number = 5000;
let OPTIMAL_BATCH_SIZE: number = 8;
const BATCH_SIZE_MIN: number = 3;
const BATCH_SIZE_MAX: number = 24;
let BATCH_SIZE: number = OPTIMAL_BATCH_SIZE;
let estimatedUploadBandwidthMbps: number = 10;
const TARGET_BANDWIDTH_USAGE: number = 0.85;
let MAX_CONCURRENT_BATCHES: number = 3;
const batchCompletionTimes: number[] = [];
const serverResponseTimes: number[] = [];

// Pipeline mode configuration
const PIPELINE_BANDWIDTH_THRESHOLD_MBPS: number = 99999; // Switch to pipeline above 20 Mbps
let usePipelineMode: boolean = false;

function adjustParametersForNetworkConditions(
    throughput: number,
    avgResponseTime: number,
    avgBatchTime: number,
    avgChunkSize: number
): void {
    const dataRateMbps = (throughput * avgChunkSize * 8) / (1024 * 1024);
    
    estimatedUploadBandwidthMbps = estimatedUploadBandwidthMbps * 0.7 + dataRateMbps * 0.3;
    
    // Decide whether to use pipeline mode based on bandwidth
    const shouldUsePipeline = estimatedUploadBandwidthMbps > PIPELINE_BANDWIDTH_THRESHOLD_MBPS;
    if (shouldUsePipeline !== usePipelineMode) {
        usePipelineMode = shouldUsePipeline;
        logger.info(`Switching to ${usePipelineMode ? 'PIPELINE' : 'BATCH'} mode (bandwidth: ${estimatedUploadBandwidthMbps.toFixed(1)} Mbps)`);
    }
    
    const availableBandwidthBytes = (estimatedUploadBandwidthMbps * TARGET_BANDWIDTH_USAGE * 1024 * 1024) / 8;
    
    const optimalBatchSize = Math.min(
        BATCH_SIZE_MAX,
        Math.max(
            BATCH_SIZE_MIN,
            avgResponseTime > 500 ? Math.floor(OPTIMAL_BATCH_SIZE * 0.7) : 
            avgResponseTime < 100 ? Math.floor(OPTIMAL_BATCH_SIZE * 1.2) : 
            OPTIMAL_BATCH_SIZE
        )
    );
    
    const targetConcurrentBatches = Math.min(
        6,
        Math.max(
            1,
            Math.floor(availableBandwidthBytes / (avgChunkSize * optimalBatchSize * 1.2))
        )
    );
    
    const oldConcurrent = MAX_CONCURRENT_BATCHES;
    
    if (targetConcurrentBatches > MAX_CONCURRENT_BATCHES) {
        MAX_CONCURRENT_BATCHES++;
    } else if (targetConcurrentBatches < MAX_CONCURRENT_BATCHES && MAX_CONCURRENT_BATCHES > 1) {
        MAX_CONCURRENT_BATCHES--;
    }
    
    if (optimalBatchSize !== BATCH_SIZE) {
        BATCH_SIZE = optimalBatchSize;
    }
}

function detectNetworkConditions(): { 
    batchSize: number; 
    concurrentBatches: number;
    isSlowNetwork: boolean;
} {
    const avgResponseTime = serverResponseTimes.length > 0
        ? serverResponseTimes.reduce((sum, time) => sum + time, 0) / serverResponseTimes.length
        : 500;
    
    const avgBatchTime = batchCompletionTimes.length > 0
        ? batchCompletionTimes.reduce((sum, time) => sum + time, 0) / batchCompletionTimes.length
        : 2000;
        
    const chunkSizes = Array.from(chunkSizeMap.values());
    const avgChunkSize = chunkSizes.length > 0 
        ? chunkSizes.reduce((sum, size) => sum + size, 0) / chunkSizes.length
        : 2 * 1024 * 1024;
        
    const isSlowNetwork = avgBatchTime > 5000 || avgResponseTime > 1000;
    
    if (isSlowNetwork) {
        return {
            batchSize: Math.max(BATCH_SIZE_MIN, Math.floor(OPTIMAL_BATCH_SIZE * 0.5)),
            concurrentBatches: 2,
            isSlowNetwork: true
        };
    } else {
        return {
            batchSize: Math.min(BATCH_SIZE_MAX, Math.floor(OPTIMAL_BATCH_SIZE * 1.2)),
            concurrentBatches: 5,
            isSlowNetwork: false
        };
    }
}

function adaptToNetworkConditions(): void {
    const networkParams = detectNetworkConditions();
    
    BATCH_SIZE = networkParams.batchSize;
    MAX_CONCURRENT_BATCHES = networkParams.concurrentBatches;
}

const MAX_PREFETCH_MEMORY: number = 100 * 1024 * 1024; // 100MB
const PRIORITIZE_SMALL_CHUNKS: boolean = false;
const MIN_CONNECTION_THRESHOLD: number = Math.max(2, Math.floor(MAX_CONNECTIONS / 2));
const chunkSizeMap: Map<number, number> = new Map<number, number>();


let totalChunksSent: number = 0;
let totalChunksConfirmed: number = 0;
let uploadStartTime: number = 0;

async function initWebTransport(uploadId: string): Promise<void> {
    if (isAborted) return;
    
    await closeAllConnections();
    
    currentUploadId = uploadId;
    connectionPool = [];
    
    totalChunksSent = 0;
    totalChunksConfirmed = 0;
    uploadStartTime = performance.now();
    
    adaptToNetworkConditions();
    setupNetworkMonitoring(uploadId);

    const connectionPromises: Promise<ConnectionInfo | null>[] = [];
    
    for (let i = 0; i < MAX_CONNECTIONS; i++) {
        connectionPromises.push(createSingleConnection(uploadId, i));
    }
    
    const results = await Promise.allSettled(connectionPromises);
    
    connectionPool = results
        .filter((result): result is PromiseFulfilledResult<ConnectionInfo> => 
            result.status === 'fulfilled' && result.value !== null)
        .map(result => result.value);
    
    const MIN_REQUIRED_CONNECTIONS = Math.ceil(MAX_CONNECTIONS / 2);
    
    if (connectionPool.length < MIN_REQUIRED_CONNECTIONS) {
        currentUploadId = null;
        
        const errorMsg = connectionPool.length === 0
            ? `Failed to establish any WebTransport connections. Browser connection limit may be exceeded. Try refreshing the page.`
            : `Only established ${connectionPool.length}/${MAX_CONNECTIONS} connections (need ${MIN_REQUIRED_CONNECTIONS}). Browser connection limit may be exceeded.`;
        
        throw new Error(errorMsg);
    }
    
    logger.info(`Initialized ${connectionPool.length}/${MAX_CONNECTIONS} connections`);
    
    if (connectionMonitorInterval) {
        clearInterval(connectionMonitorInterval);
    }
    
    connectionMonitorInterval = self.setInterval(() => {
        if (currentUploadId !== uploadId || isAborted) {
            if (connectionMonitorInterval !== null) {
                clearInterval(connectionMonitorInterval);
                connectionMonitorInterval = null;
            }
            return;
        }
        
        if (connectionPool.length < MIN_CONNECTION_THRESHOLD) {
            const connectionsNeeded = MAX_CONNECTIONS - connectionPool.length;
            
            for (let i = 0; i < connectionsNeeded; i++) {
                const connectionIndex = connectionPool.length + i;
                createSingleConnection(uploadId, connectionIndex)
                    .then(connInfo => {
                        if (connInfo && currentUploadId === uploadId) {
                            connectionPool.push(connInfo);
                        }
                    })
                    .catch(err => {
                        logger.error(`Failed to create additional connection:`, err);
                    });
            }
        }
    }, 3000);
}

async function createSingleConnection(uploadId: string, index: number, retryCount: number = 0): Promise<ConnectionInfo | null> {
    const fullUrl = `${WEBTRANSPORT_BASE_URL}${uploadId}?conn=${index}`;
    
    try {
        const connection = new WebTransport(fullUrl);
        await connection.ready;
        
        if (index === 0 && authProof) {
            try {
                const authStream = await connection.createUnidirectionalStream();
                const authWriter = authStream.getWriter();
                await authWriter.write(authProof);
                await authWriter.close();
                
                const datagramReader = connection.datagrams.readable.getReader();
                const ackPromise = datagramReader.read();
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Auth timeout')), 5000)
                );
                
                const result = await Promise.race([ackPromise, timeoutPromise]) as ReadableStreamReadResult<Uint8Array>;
                
                if (result.value) {
                    const ackMessage = new TextDecoder().decode(result.value);
                    
                    if (ackMessage !== 'AUTH_OK') {
                        // Server does not handle authentication verification yet
                        // logger.error('[WebTransport] Authentication verification failed');
                    }
                }
                
                datagramReader.releaseLock();
            } catch (authError) {
                // Server does not handle authentication errors yet
                // logger.error('[WebTransport] Authentication failed');
                connection.close();
                throw authError;
            }
        }
        
        connection.closed.catch((err: Error) => {
            if (!isAborted && currentUploadId === uploadId) {
                logger.warn(`Connection ${index} closed unexpectedly, attempting reconnect`);
            }
            
            connectionPool = connectionPool.filter(info => info.connection !== connection);
            
            if (!isAborted && currentUploadId === uploadId && retryCount < 3) {
                const backoffDelay = Math.min(1000 * (2 ** retryCount), 5000);
                setTimeout(async () => {
                    try {
                        const newConnection = await createSingleConnection(uploadId, index, retryCount + 1);
                        if (newConnection && currentUploadId === uploadId) {
                            connectionPool.push(newConnection);
                        }
                    } catch (reconnectError) {
                        logger.error(`Connection ${index} reconnect failed:`, reconnectError);
                    }
                }, backoffDelay);
            }
        });
        
        return {
            connection,
            busy: false,
            lastUsed: Date.now(),
            consecutiveFailures: 0,  // ADD THIS
            id: nextConnectionId++    // ADD THIS
        };
    } catch (error) {
        if (error instanceof Error && 
            (error.message.includes('Too many pending') || 
             error.message.includes('session limit') ||
             error.message.includes('too many sessions'))) {
            logger.warn(`Connection ${index} rejected: browser session limit reached`);
            return null;
        }
        
        if (retryCount < 3) {
            const backoffDelay = Math.min(1000 * (2 ** retryCount), 5000);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            return createSingleConnection(uploadId, index, retryCount + 1);
        }
        
        logger.error(`Connection ${index} failed after ${retryCount + 1} attempts:`, error);
        return null;
    }
}

async function replaceUnhealthyConnection(
    unhealthyConn: ConnectionInfo, 
    uploadId: string
): Promise<void> {
    const index = connectionPool.indexOf(unhealthyConn);
    
    logger.warn(`[replaceUnhealthyConnection] Replacing connection`, {
        connectionId: unhealthyConn.id,
        consecutiveFailures: unhealthyConn.consecutiveFailures,
        poolIndex: index
    });
    
    // Remove the unhealthy connection
    connectionPool = connectionPool.filter(info => info.id !== unhealthyConn.id);
    
    // Close it
    try {
        unhealthyConn.connection.close();
    } catch (e) {
        logger.warn('[replaceUnhealthyConnection] Error closing unhealthy connection:', e);
    }
    
    // Create a new one
    try {
        const newConnection = await createSingleConnection(uploadId, connectionPool.length, 0);
        if (newConnection && currentUploadId === uploadId) {
            connectionPool.push(newConnection);
            logger.info(`[replaceUnhealthyConnection] Successfully created replacement connection`, {
                newConnectionId: newConnection.id,
                poolSize: connectionPool.length
            });
        }
    } catch (error) {
        logger.error('[replaceUnhealthyConnection] Failed to create replacement:', error);
    }
}

function markConnectionFailure(connection: WebTransport, error?: Error): void {
    const connInfo = connectionPool.find(info => info.connection === connection);
    if (connInfo) {
        connInfo.consecutiveFailures++;
        
        const isSendStreamError = error instanceof Error && 
            error.message.includes('Failed to create send stream');
        
        logger.warn('[markConnectionFailure] Connection failure recorded', {
            connectionId: connInfo.id,
            consecutiveFailures: connInfo.consecutiveFailures,
            threshold: MAX_CONSECUTIVE_FAILURES,
            errorType: error?.name,
            errorMessage: error?.message,
            isSendStreamError,
            networkNote: isSendStreamError ? 
                'This error is network-dependent (common on faster networks, rare on slower networks)' : 
                undefined
        });
        
        // Check if we should replace it
        if (connInfo.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && currentUploadId) {
            logger.error('[markConnectionFailure] Connection exceeded failure threshold, replacing', {
                connectionId: connInfo.id,
                failures: connInfo.consecutiveFailures,
                lastError: error?.message,
                isSendStreamError
            });
            
            // Don't await, do it in background
            replaceUnhealthyConnection(connInfo, currentUploadId).catch(err => {
                logger.error('[markConnectionFailure] Failed to replace connection:', err);
            });
        }
    }
}

function markConnectionSuccess(connection: WebTransport): void {
    const connInfo = connectionPool.find(info => info.connection === connection);
    if (connInfo && connInfo.consecutiveFailures > 0) {
        logger.info('[markConnectionSuccess] Resetting failure count', {
            connectionId: connInfo.id,
            previousFailures: connInfo.consecutiveFailures
        });
        connInfo.consecutiveFailures = 0;
    }
}


async function closeAllConnections(): Promise<void> {
    if (connectionMonitorInterval !== null) {
        clearInterval(connectionMonitorInterval);
        connectionMonitorInterval = null;
    }
    
    const closePromises = connectionPool.map(async (connInfo, i) => {
        try {
            connInfo.connection.close();
        } catch (e) {
            logger.warn(`Error closing connection ${i}:`, e);
        }
    });
    
    await Promise.allSettled(closePromises);
    connectionPool = [];
}


function getAvailableConnection(): ConnectionInfo | null {
    if (connectionPool.length === 0 || isAborted) return null;
    
    const availableConn = connectionPool.find(conn => !conn.busy);
    if (availableConn) {
        availableConn.busy = true;
        availableConn.lastUsed = Date.now();
        return availableConn;
    }
    
    const leastRecentlyUsed = [...connectionPool].sort((a, b) => a.lastUsed - b.lastUsed)[0];
    leastRecentlyUsed.lastUsed = Date.now();
    return leastRecentlyUsed;
}


function releaseConnection(connection: WebTransport): void {
    const connInfo = connectionPool.find(info => info.connection === connection);
    if (connInfo) {
        connInfo.busy = false;
    }
}


async function pullChunkData(chunkIndex: number, uploadId: string): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            logger.error('[pullChunkData] Timeout waiting for chunk', { 
                chunkIndex, 
                uploadId,
                timeoutMs: 30000 
            });
            reject(new Error(`Timeout waiting for chunk ${chunkIndex} data`));
        }, 30000);
        
        const messageHandler = (event: MessageEvent) => {
            const { type, payload } = event.data;
            if (type === 'chunk-data' && payload.chunkIndex === chunkIndex && payload.uploadId === uploadId) {
                clearTimeout(timeoutId);
                self.removeEventListener('message', messageHandler);
                const chunk = payload.chunk as Uint8Array;
                chunkSizeMap.set(chunkIndex, chunk.byteLength);
                resolve(chunk);
            } else if (type === 'chunk-upload-error' && payload.chunkIndex === chunkIndex && payload.uploadId === uploadId) {
                clearTimeout(timeoutId);
                self.removeEventListener('message', messageHandler);
                
                logger.error('[pullChunkData] Error reported for chunk', {
                    chunkIndex,
                    uploadId,
                    error: payload.error
                });
                
                reject(new Error(`Encryption Stream reported error for chunk ${chunkIndex}: ${payload.error}`));
            }
        };
        
        self.addEventListener('message', messageHandler);
        self.postMessage({ 
            type: 'pull-chunk', 
            payload: { 
                chunkIndex, 
                uploadId,
                useTransferables: true
            } 
        });
    });
}


async function pullMultipleChunks(requests: ChunkReadyRequest[]): Promise<Map<number, Uint8Array>> {
    if (requests.length === 0) return new Map();
    
    let estimatedMemory = 0;
    for (const req of requests) {
        const knownSize = chunkSizeMap.get(req.chunkIndex) || 2 * 1024 * 1024;
        estimatedMemory += knownSize;
    }
    
    if (estimatedMemory > MAX_PREFETCH_MEMORY) {
        const allChunks = new Map<number, Uint8Array>();
        const batchSize = Math.max(5, Math.floor(MAX_PREFETCH_MEMORY / (2 * 1024 * 1024)));
        
        for (let i = 0; i < requests.length; i += batchSize) {
            const batchRequests = requests.slice(i, i + batchSize);
            const batchResults = await pullBatchWithMemoryTracking(batchRequests);
            
            for (const [index, data] of batchResults.entries()) {
                allChunks.set(index, data);
            }
        }
        
        return allChunks;
    }
    
    return await pullBatchWithMemoryTracking(requests);
}


async function pullBatchWithMemoryTracking(requests: ChunkReadyRequest[]): Promise<Map<number, Uint8Array>> {
    const pullPromises: Promise<{index: number, data: Uint8Array}>[] = requests.map(
        request => pullChunkData(request.chunkIndex, request.uploadId)
            .then(data => ({index: request.chunkIndex, data}))
    );
    
    const results = await Promise.allSettled(pullPromises);
    const chunkDataMap = new Map<number, Uint8Array>();
    
    results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            const {index, data} = result.value;
            chunkDataMap.set(index, data);
        } else {
            logger.error(`Failed to pre-fetch chunk #${requests[i].chunkIndex}:`, result.reason);
        }
    });
    
    return chunkDataMap;
}


// Batch mode, which fetches all, then send alls chunks in a batch, best for slow networks
async function sendChunkBatch(batchRequests: ChunkReadyRequest[], connectionInfo: ConnectionInfo): Promise<void> {
    if (isAborted || batchRequests.length === 0) {
        logger.error('[sendChunkBatch] Early exit', {
            isAborted,
            requestCount: batchRequests.length
        });
        return;
    }
    
    const batchStartTime = performance.now();
    const uploadId = batchRequests[0].uploadId;

    activeTransfers++;
    
    const chunkDataMap = await pullMultipleChunks(batchRequests);
    
    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    let streamCreationError: Error | undefined;
    
    try {
        const streamStartTime = performance.now();
        
        try {
            const wtStream = await connectionInfo.connection.createUnidirectionalStream();
            const streamCreationTime = performance.now() - streamStartTime;
            
            serverResponseTimes.push(streamCreationTime);
            writer = wtStream.getWriter();
        } catch (streamError) {
            streamCreationError = streamError instanceof Error ? streamError : new Error(String(streamError));
            
            const isSendStreamError = streamCreationError.message.includes('Failed to create send stream');
            
            logger.error('[sendChunkBatch] Failed to create stream', {
                connectionId: connectionInfo.id,
                error: streamCreationError.message,
                errorType: streamCreationError.name,
                isSendStreamError,
                networkContext: isSendStreamError ?
                    'This error typically occurs on faster networks and indicates the connection is in a bad state' :
                    undefined,
                timeSinceLastUse: Date.now() - connectionInfo.lastUsed,
                consecutiveFailures: connectionInfo.consecutiveFailures
            });
            
            throw streamCreationError;
        }

        const completedChunks: number[] = [];
        const failedChunks: number[] = [];
        
        for (const request of batchRequests) {
            const { chunkIndex, uploadId: reqUploadId, workerId } = request;
            
            if (reqUploadId !== uploadId) {
                logger.warn('[sendChunkBatch] Upload ID mismatch', {
                    chunkIndex,
                    expectedUploadId: uploadId,
                    actualUploadId: reqUploadId
                });
                failedChunks.push(chunkIndex);
                continue;
            }

            const chunk = chunkDataMap.get(chunkIndex);
            if (!chunk) {
                logger.error('[sendChunkBatch] Chunk data missing from map', {
                    chunkIndex,
                    mapSize: chunkDataMap.size,
                    availableIndices: Array.from(chunkDataMap.keys())
                });
                failedChunks.push(chunkIndex);
                continue;
            }

            try {
                const workerIdNum = (workerId?.toString().replace(/\D/g, '') || '0');
                const chunkFileName = `w${workerIdNum}_${String(chunkIndex).padStart(6, '0')}.bin`;
                
                const metadata = {
                    uploadId: reqUploadId,
                    chunkIndex: chunkIndex,
                    filename: chunkFileName
                };
                const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata) + '\n');
                await writer.write(metadataBytes);
                await writer.write(chunk);
                
                completedChunks.push(chunkIndex);
                totalChunksSent++;
            } catch (chunkError) {
                logger.error('[sendChunkBatch] Stream write failed', { 
                    chunkIndex,
                    error: chunkError instanceof Error ? chunkError.message : 'Unknown error',
                    stack: chunkError instanceof Error ? chunkError.stack : undefined,
                    errorType: chunkError instanceof Error ? chunkError.name : typeof chunkError
                });
                failedChunks.push(chunkIndex);
            }
        }

        await writer.close();
        writer = null;
        
        // Success, reset the failure count
        markConnectionSuccess(connectionInfo.connection);
        
        if (completedChunks.length > 0) {
            if (completedChunks.length <= 10) {
                for (const chunkIndex of completedChunks) {
                    self.postMessage({
                        type: 'chunk-upload-complete',
                        payload: { chunkIndex, uploadId }
                    });
                }
            } else {
                self.postMessage({
                    type: 'chunks-upload-complete-batch',
                    payload: { chunkIndices: completedChunks, uploadId }
                });
            }
        }
        
        for (const chunkIndex of failedChunks) {
            logger.warn('[sendChunkBatch] Sending error message for failed chunk', { chunkIndex });
            self.postMessage({
                type: 'chunk-upload-error',
                payload: { 
                    chunkIndex, 
                    uploadId, 
                    error: 'Failed to send chunk in batch'
                }
            });
            
            chunkReadyQueue.push({ chunkIndex, uploadId });
        }
        
        if (failedChunks.length > 0) {
            processChunkQueue();
        }
        
        releaseConnection(connectionInfo.connection);
        
        const batchEndTime = performance.now();
        const batchTime = batchEndTime - batchStartTime;
        batchCompletionTimes.push(batchTime);
        
        totalChunksConfirmed += completedChunks.length;
        
        performPeriodicOptimization();

    } catch (error) {
        // Failure, mark connection failure 
        const errorObj = streamCreationError || (error instanceof Error ? error : new Error(String(error)));
        markConnectionFailure(connectionInfo.connection, errorObj);
        
        logger.error('[sendChunkBatch] Batch failed with exception', {
            error: errorObj.message,
            stack: errorObj.stack,
            errorType: errorObj.name,
            connectionId: connectionInfo.id,
            isSendStreamError: errorObj.message.includes('Failed to create send stream'),
            completedSoFar: 0,
            totalRequested: batchRequests.length
        });
        
        if (writer) {
            try {
                await writer.abort();
            } catch (abortErr) {
                logger.warn('[sendChunkBatch] Writer abort failed', {
                    error: abortErr instanceof Error ? abortErr.message : String(abortErr)
                });
            }
        }
        
        releaseConnection(connectionInfo.connection);
        
        logger.warn('[sendChunkBatch] Marking all chunks as failed', {
            chunkIndices: batchRequests.map(r => r.chunkIndex)
        });
        
        for (const request of batchRequests) {
             self.postMessage({
                type: 'chunk-upload-error',
                payload: { 
                    chunkIndex: request.chunkIndex, 
                    uploadId: request.uploadId, 
                    error: errorObj.message
                }
            });
            
            chunkReadyQueue.push(request);
        }
        
        if (batchRequests.length > 0) {
            processChunkQueue();
        }
        
        throw error;
    } finally {
        activeTransfers--;
    }
}


// Pipeline mode: Fetch and send in parallel
async function sendChunksThroughPipeline(batchRequests: ChunkReadyRequest[], connectionInfo: ConnectionInfo): Promise<void> {
    if (isAborted || batchRequests.length === 0) {
        return;
    }
    
    const batchStartTime = performance.now();
    const uploadId = batchRequests[0].uploadId;

    activeTransfers++;
    
    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    const completedChunks: number[] = [];
    const failedChunks: number[] = [];
    let streamCreationError: Error | undefined;
    
    try {
        const streamStartTime = performance.now();
        
        try {
            const wtStream = await connectionInfo.connection.createUnidirectionalStream();
            const streamCreationTime = performance.now() - streamStartTime;
            serverResponseTimes.push(streamCreationTime);
            writer = wtStream.getWriter();
        } catch (streamError) {
            streamCreationError = streamError instanceof Error ? streamError : new Error(String(streamError));
            
            const isSendStreamError = streamCreationError.message.includes('Failed to create send stream');
            
            logger.error('[sendChunksThroughPipeline] Failed to create stream', {
                connectionId: connectionInfo.id,
                error: streamCreationError.message,
                errorType: streamCreationError.name,
                isSendStreamError,
                networkContext: isSendStreamError ?
                    'This error typically occurs on faster networks and indicates the connection is in a bad state' :
                    undefined,
                timeSinceLastUse: Date.now() - connectionInfo.lastUsed,
                consecutiveFailures: connectionInfo.consecutiveFailures
            });
            
            throw streamCreationError;
        }

        const chunkPromises = batchRequests.map(async (request) => {
            const { chunkIndex, uploadId: reqUploadId, workerId } = request;
            
            if (reqUploadId !== uploadId) {
                logger.warn('[sendChunksThroughPipeline] Upload ID mismatch', {
                    chunkIndex,
                    expectedUploadId: uploadId,
                    actualUploadId: reqUploadId
                });
                failedChunks.push(chunkIndex);
                return;
            }

            try {
                const chunk = await pullChunkData(chunkIndex, reqUploadId);
                
                if (!chunk) {
                    logger.error('[sendChunksThroughPipeline] Chunk data missing', { chunkIndex });
                    failedChunks.push(chunkIndex);
                    return;
                }

                const workerIdNum = (workerId?.toString().replace(/\D/g, '') || '0');
                const chunkFileName = `w${workerIdNum}_${String(chunkIndex).padStart(6, '0')}.bin`;
                
                const metadata = {
                    uploadId: reqUploadId,
                    chunkIndex: chunkIndex,
                    filename: chunkFileName
                };
                const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata) + '\n');
                
                await writer!.write(metadataBytes);
                await writer!.write(chunk);
                
                completedChunks.push(chunkIndex);
                totalChunksSent++;
                
            } catch (chunkError) {
                logger.error('[sendChunksThroughPipeline] Chunk processing failed', { 
                    chunkIndex,
                    error: chunkError instanceof Error ? chunkError.message : 'Unknown error',
                    stack: chunkError instanceof Error ? chunkError.stack : undefined,
                    errorType: chunkError instanceof Error ? chunkError.name : typeof chunkError
                });
                failedChunks.push(chunkIndex);
            }
        });
        await Promise.all(chunkPromises);
        
        await writer.close();
        writer = null;
        
        // Success, reset the failure count
        markConnectionSuccess(connectionInfo.connection);
        
        if (completedChunks.length > 0) {
            if (completedChunks.length <= 10) {
                for (const chunkIndex of completedChunks) {
                    self.postMessage({
                        type: 'chunk-upload-complete',
                        payload: { chunkIndex, uploadId }
                    });
                }
            } else {
                self.postMessage({
                    type: 'chunks-upload-complete-batch',
                    payload: { chunkIndices: completedChunks, uploadId }
                });
            }
        }
        for (const chunkIndex of failedChunks) {
            logger.warn('[sendChunksThroughPipeline] Sending error message for failed chunk', { chunkIndex });
            self.postMessage({
                type: 'chunk-upload-error',
                payload: { 
                    chunkIndex, 
                    uploadId, 
                    error: 'Failed to send chunk in pipeline'
                }
            });
            
            chunkReadyQueue.push({ chunkIndex, uploadId });
        }
        
        if (failedChunks.length > 0) {
            logger.info('[sendChunksThroughPipeline] Re-queuing failed chunks', {
                count: failedChunks.length,
                newQueueLength: chunkReadyQueue.length
            });
            processChunkQueue();
        }
        
        releaseConnection(connectionInfo.connection);
        
        const batchEndTime = performance.now();
        const batchTime = batchEndTime - batchStartTime;
        batchCompletionTimes.push(batchTime);
        
        totalChunksConfirmed += completedChunks.length;
        
        performPeriodicOptimization();

    } catch (error) {
        // Failure, mark the connection as failed with error details
        const errorObj = streamCreationError || (error instanceof Error ? error : new Error(String(error)));
        markConnectionFailure(connectionInfo.connection, errorObj);
        
        logger.error('[sendChunksThroughPipeline] Pipeline failed with exception', {
            error: errorObj.message,
            stack: errorObj.stack,
            errorType: errorObj.name,
            connectionId: connectionInfo.id,
            isSendStreamError: errorObj.message.includes('Failed to create send stream'),
            completedSoFar: completedChunks.length,
            failedSoFar: failedChunks.length
        });
        
        if (writer) {
            try {
                await writer.abort();
            } catch (abortErr) {
                logger.warn('[sendChunksThroughPipeline] Writer abort failed', {
                    error: abortErr instanceof Error ? abortErr.message : String(abortErr)
                });
            }
        }
        
        releaseConnection(connectionInfo.connection);
        
        logger.info('[sendChunksThroughPipeline] Marking all chunks as failed', {
            chunkIndices: batchRequests.map(r => r.chunkIndex)
        });
        
        for (const request of batchRequests) {
             self.postMessage({
                type: 'chunk-upload-error',
                payload: { 
                    chunkIndex: request.chunkIndex, 
                    uploadId: request.uploadId, 
                    error: errorObj.message
                }
            });
            
            chunkReadyQueue.push(request);
        }
        
        if (batchRequests.length > 0) {
            logger.info('[sendChunksThroughPipeline] Re-scheduling queue processing');
            processChunkQueue();
        }
        
        throw error;
    } finally {
        activeTransfers--;
    }
}


// Unified function that dispatches to the appropriate implementation
async function sendOnConnection(batchRequests: ChunkReadyRequest[], connectionInfo: ConnectionInfo): Promise<void> {
    if (usePipelineMode) {
        return sendChunksThroughPipeline(batchRequests, connectionInfo);
    } else {
        return sendChunkBatch(batchRequests, connectionInfo);
    }
}


// Extracted periodic optimization logic to avoid duplication
function performPeriodicOptimization(): void {
    if (batchCompletionTimes.length >= 3 && batchCompletionTimes.length % 50 === 0) {
        const recentAvgTime = batchCompletionTimes
            .slice(-3)
            .reduce((sum, time) => sum + time, 0) / 3;
            
        if (recentAvgTime < 1000 && OPTIMAL_BATCH_SIZE < BATCH_SIZE_MAX) {
            OPTIMAL_BATCH_SIZE = Math.min(BATCH_SIZE_MAX, OPTIMAL_BATCH_SIZE + 2);
            BATCH_SIZE = OPTIMAL_BATCH_SIZE;
        } else if (recentAvgTime > 3000 && OPTIMAL_BATCH_SIZE > BATCH_SIZE_MIN) {
            OPTIMAL_BATCH_SIZE = Math.max(BATCH_SIZE_MIN, OPTIMAL_BATCH_SIZE - 2);
            BATCH_SIZE = OPTIMAL_BATCH_SIZE;
        }
        
        if (serverResponseTimes.length > 20) {
            serverResponseTimes.splice(0, serverResponseTimes.length - 10);
        }
        
        if (batchCompletionTimes.length > 10) {
            batchCompletionTimes.splice(0, batchCompletionTimes.length - 10);
        }
        
        const elapsedTimeSeconds = (performance.now() - uploadStartTime) / 1000;
        const throughput = elapsedTimeSeconds > 0 ? totalChunksConfirmed / elapsedTimeSeconds : 0;
        
        const chunkSizes = Array.from(chunkSizeMap.values());
        const avgChunkSize = chunkSizes.length > 0 
            ? chunkSizes.reduce((sum, size) => sum + size, 0) / chunkSizes.length
            : 2 * 1024 * 1024;
        
        const avgResponseTime = serverResponseTimes.length > 0
            ? serverResponseTimes.reduce((sum, time) => sum + time, 0) / serverResponseTimes.length
            : 500;
            
        adjustParametersForNetworkConditions(
            throughput,
            avgResponseTime,
            recentAvgTime,
            avgChunkSize
        );
        
        const mode = usePipelineMode ? 'PIPELINE' : 'BATCH';
        logger.info(`[${mode}] Throughput: ${throughput.toFixed(1)} chunks/sec, batch=${BATCH_SIZE}, concurrent=${MAX_CONCURRENT_BATCHES}, bw=${estimatedUploadBandwidthMbps.toFixed(1)}Mbps, confirmed=${totalChunksConfirmed}`);
    }
}


function categorizeChunks(queue: ChunkReadyRequest[]): {small: ChunkReadyRequest[], large: ChunkReadyRequest[]} {
    const threshold = 256 * 1024;
    
    const small: ChunkReadyRequest[] = [];
    const large: ChunkReadyRequest[] = [];
    
    for (const request of queue) {
        const size = chunkSizeMap.get(request.chunkIndex);
        
        if (size !== undefined) {
            if (size < threshold) {
                small.push(request);
            } else {
                large.push(request);
            }
        } else {
            if (request.chunkIndex === 0 || request.chunkIndex === 1) {
                small.push(request);
            } else {
                if (request.chunkIndex % 3 === 0) {
                    small.push(request);
                } else {
                    large.push(request);
                }
            }
        }
    }
    
    return { small, large };
}


async function processChunkQueue(): Promise<void> {
    if (isProcessingQueue || isAborted || chunkReadyQueue.length === 0 || !currentUploadId) {
        logger.warn('[processChunkQueue] Early exit', {
            isProcessingQueue,
            isAborted,
            queueLength: chunkReadyQueue.length,
            currentUploadId
        });
        return;
    }

    isProcessingQueue = true;
    try {
        while (chunkReadyQueue.length > 0 && !isAborted) {
            const availableConns = connectionPool.filter(c => !c.busy);
            const numParallel = Math.min(
                availableConns.length, 
                MAX_CONCURRENT_BATCHES,
                Math.ceil(chunkReadyQueue.length / BATCH_SIZE)
            );
            
            if (numParallel === 0) {
                logger.warn('[processChunkQueue] No available connections, waiting...');
                await new Promise(resolve => setTimeout(resolve, 10));
                continue;
            }
            
            const batches: ChunkReadyRequest[][] = [];
            for (let i = 0; i < numParallel && chunkReadyQueue.length > 0; i++) {
                let batch: ChunkReadyRequest[] = [];
                
                if (PRIORITIZE_SMALL_CHUNKS && chunkReadyQueue.length > BATCH_SIZE) {
                    const categorized = categorizeChunks([...chunkReadyQueue]);
                    
                    if (categorized.small.length > 0) {
                        const smallChunksToProcess = categorized.small.slice(0, BATCH_SIZE);
                        batch = smallChunksToProcess;
                        
                        chunkReadyQueue = chunkReadyQueue.filter(item => 
                            !smallChunksToProcess.some(selected => 
                                selected.chunkIndex === item.chunkIndex));
                    }
                }
                
                if (batch.length === 0) {
                    batch = chunkReadyQueue.splice(0, Math.min(BATCH_SIZE, chunkReadyQueue.length));
                }
                
                if (batch.length > 0) {
                    batches.push(batch);
                }
            }
            
            if (batches.length === 0) {
                logger.warn('[processChunkQueue] No batches created despite queue having items');
                break;
            }
            availableConns.slice(0, batches.length).forEach(c => c.busy = true);    
            const batchPromises = batches.map((batch, idx) => 
                sendOnConnection(batch, availableConns[idx])
                    .catch(error => {
                        logger.error('[processChunkQueue] Batch failed', {
                            batchIndex: idx,
                            batchSize: batch.length,
                            error: error instanceof Error ? error.message : String(error),
                            stack: error instanceof Error ? error.stack : undefined
                        });
                    })
                    .finally(() => {
                        availableConns[idx].busy = false;
                    })
            );
            
            await Promise.allSettled(batchPromises);
        }
    } catch (error) {
        logger.error('[processChunkQueue] Error during batch processing', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            queueLength: chunkReadyQueue.length
        });
    }

    isProcessingQueue = false;

    if (chunkReadyQueue.length > 0 && !isAborted) {
        logger.info('[processChunkQueue] Re-scheduling for remaining items', {
            remainingCount: chunkReadyQueue.length
        });
        setTimeout(processChunkQueue, 0);
    }
}

async function processChunkReady(chunkIndex: number, uploadId: string, workerId?: string | number): Promise<void> {
  if (isAborted || !uploadId) return;
  
  if (currentUploadId !== uploadId) {
    await initWebTransport(uploadId);
  }
  
  chunkReadyQueue.push({ chunkIndex, uploadId, workerId });
  
  if (currentUploadId === uploadId && memoryMonitoringInterval === null) {
    setupMemoryMonitoring(uploadId);
  }
  
  if (!isProcessingQueue) {
    processChunkQueue().catch(err => {
      logger.error('Error in processChunkQueue:', err);
    });
  }
}

async function processBatchChunksReady(chunks: {chunkIndex: number, uploadId: string, workerId?: string | number}[]): Promise<void> {
    if (isAborted || chunks.length === 0) return;
    
    const uploadId = chunks[0].uploadId;
    
    if (currentUploadId !== uploadId) {
        await initWebTransport(uploadId);
    }
    
    if (additionalConsumerWorkers.size > 0) {
        const distributedChunks: {chunkIndex: number, uploadId: string, workerId?: string | number}[] = [];
        const chunksForMainWorker: {chunkIndex: number, uploadId: string, workerId?: string | number}[] = [];
        
        for (const chunk of chunks) {
            let isAssigned = false;
            
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
            
            if (!isAssigned) {
                chunksForMainWorker.push(chunk);
            }
        }
        
        if (chunksForMainWorker.length > 0) {
            chunkReadyQueue.push(...chunksForMainWorker);
        }
    } else {
        chunkReadyQueue.push(...chunks);
    }
    
    if (!isProcessingQueue) {
        processChunkQueue().catch(err => {
            logger.error('Error in processChunkQueue:', err);
        });
    }
    
    if (currentUploadId === uploadId && memoryMonitoringInterval === null) {
        setupMemoryMonitoring(uploadId);
    }
    
    monitorBacklogAndScaleWorkers(uploadId);
}


let memoryMonitoringInterval: number | null = null;
let lastWorkerSpawnTime: number = 0;


function setupNetworkMonitoring(uploadId: string): void {
    let lastAvgResponseTime = 500;
    let lastBatchTime = 2000;
    let lastThroughput = 0;
    
    const monitoringInterval = setInterval(() => {
        if (isAborted || currentUploadId !== uploadId) {
            clearInterval(monitoringInterval);
            return;
        }
        
        const avgResponseTime = serverResponseTimes.length > 0
            ? serverResponseTimes.reduce((sum, time) => sum + time, 0) / serverResponseTimes.length
            : lastAvgResponseTime;
            
        const avgBatchTime = batchCompletionTimes.length > 0
            ? batchCompletionTimes.reduce((sum, time) => sum + time, 0) / batchCompletionTimes.length
            : lastBatchTime;
            
        const elapsedTimeSeconds = (performance.now() - uploadStartTime) / 1000;
        const throughput = elapsedTimeSeconds > 0 ? totalChunksConfirmed / elapsedTimeSeconds : 0;
        
        const responseTimeDelta = Math.abs(avgResponseTime - lastAvgResponseTime) / lastAvgResponseTime;
        const batchTimeDelta = Math.abs(avgBatchTime - lastBatchTime) / lastBatchTime;
        const throughputDelta = lastThroughput > 0 
            ? Math.abs(throughput - lastThroughput) / lastThroughput 
            : 1;
            
        if (responseTimeDelta > 0.5 || batchTimeDelta > 0.5 || throughputDelta > 0.5) {
            adaptToNetworkConditions();
        }
        
        lastAvgResponseTime = avgResponseTime;
        lastBatchTime = avgBatchTime;
        lastThroughput = throughput;
    }, 5000);
}

function setupMemoryMonitoring(uploadId: string): void {
  if (memoryMonitoringInterval !== null && currentUploadId === uploadId) {
    return;
  }
  
  if (memoryMonitoringInterval !== null && currentUploadId !== uploadId) {
    clearInterval(memoryMonitoringInterval);
    memoryMonitoringInterval = null;
  }
  
  memoryMonitoringInterval = self.setInterval(() => {
    if (isAborted || currentUploadId !== uploadId) {
      if (memoryMonitoringInterval !== null) {
        clearInterval(memoryMonitoringInterval);
        memoryMonitoringInterval = null;
      }
      return;
    }
    
    checkMemoryAndScaleWorkers(uploadId);
  }, MEMORY_CHECK_INTERVAL);
}

function checkMemoryAndScaleWorkers(uploadId: string): void {
    let memoryUsageMB = 0;
    let memoryMetrics = {};
    
    try {
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
            
            const heapUsagePercent = (usedJSHeapSize / jsHeapSizeLimit) * 100;
            
            const currentTime = Date.now();
            const cooldownElapsed = currentTime - lastWorkerSpawnTime > WORKER_SPAWN_COOLDOWN;
            
            const networkConditions = detectNetworkConditions();
            const isSlowNetwork = networkConditions.isSlowNetwork;
            
            if ((memoryUsageMB > MEMORY_THRESHOLD_MB || 
                (isSlowNetwork && chunkReadyQueue.length > 30)) && 
                chunkReadyQueue.length > 0 && 
                additionalConsumerWorkers.size < MAX_ADDITIONAL_CONSUMER_WORKERS && 
                cooldownElapsed) {
                
                spawnAdditionalConsumerWorker(uploadId);
                lastWorkerSpawnTime = currentTime;
            }
            
            if (memoryUsageMB < MEMORY_THRESHOLD_MB * 0.7 && additionalConsumerWorkers.size > 0) {
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
                
                if (leastBusyWorker !== null && leastBusyWorkload < 10) {
                    terminateAdditionalConsumerWorker(leastBusyWorker);
                }
            }
        } else {
            if (chunkReadyQueue.length > 100 && 
                additionalConsumerWorkers.size < MAX_ADDITIONAL_CONSUMER_WORKERS &&
                Date.now() - lastWorkerSpawnTime > WORKER_SPAWN_COOLDOWN) {
                
                spawnAdditionalConsumerWorker(uploadId);
                lastWorkerSpawnTime = Date.now();
            }
        }
    } catch (error) {
        logger.warn('[WebTransport] Error checking memory:', error);
    }
}

function monitorBacklogAndScaleWorkers(uploadId: string): void {
    if (isAborted || !uploadId) return;
    
    setupMemoryMonitoring(uploadId);
}


function spawnAdditionalConsumerWorker(uploadId: string): void {
    const workerId = additionalConsumerWorkers.size + 1;
    
    const workerScript = (self as any).location.href;
    const worker = new Worker(workerScript);
    
    const chunkRange = calculateChunkRangeForWorker(workerId, uploadId);
    
    const workerInfo = {
        worker,
        chunkRange,
        isReady: false,
        uploadId,
        chunksAssigned: 0,
        chunksCompleted: 0
    };
    
    additionalConsumerWorkers.set(workerId, workerInfo);
    
    worker.onmessage = (event) => {
        const { type, payload } = event.data;
        
        switch (type) {
            case 'consumer-ready':
                if (payload.uploadId === uploadId) {
                    workerInfo.isReady = true;
                    redistributeChunksToWorker(workerId, uploadId);
                }
                break;
                
            case 'chunk-upload-complete':
                workerInfo.chunksCompleted++;
                
                self.postMessage({
                    type: 'chunk-upload-complete',
                    payload: payload
                });
                break;
                
            case 'chunks-upload-complete-batch':
                workerInfo.chunksCompleted += payload.chunkIndices.length;
                
                self.postMessage({
                    type: 'chunks-upload-complete-batch',
                    payload: payload
                });
                break;
                
            case 'consumer-error':
            case 'web-transport-error':
                logger.error(`Worker ${workerId} error:`, payload);
                
                if (payload.critical) {
                    terminateAdditionalConsumerWorker(workerId);
                }
                break;
                
            case 'pull-chunk':
                self.postMessage({
                    type: 'pull-chunk',
                    payload: payload
                });
                break;
        }
    };
    
    worker.postMessage({
        type: 'consumer-init',
        payload: { uploadId }
    });
    
    setupDiagnosticsReporting();
}


function terminateAdditionalConsumerWorker(workerId: number): void {
    const workerInfo = additionalConsumerWorkers.get(workerId);
    if (!workerInfo) return;
    
    workerInfo.worker.postMessage({ type: 'close-web-transport' });
    
    setTimeout(() => {
        try {
            workerInfo.worker.terminate();
        } catch (err) {
            logger.warn(`Worker ${workerId} termination error:`, err);
        }
        
        additionalConsumerWorkers.delete(workerId);
        
        if (additionalConsumerWorkers.size > 0 && workerInfo.uploadId) {
            rebalanceWorkerChunkRanges(workerInfo.uploadId);
        }
    }, 500);
}

function calculateChunkRangeForWorker(workerId: number, uploadId: string): {start: number, end: number} | null {
    let highestChunkIndex = 0;
    
    for (const request of chunkReadyQueue) {
        if (request.uploadId === uploadId && request.chunkIndex > highestChunkIndex) {
            highestChunkIndex = request.chunkIndex;
        }
    }
    
    let lowestPendingChunk = chunkReadyQueue.length > 0 ? 
        chunkReadyQueue[0].chunkIndex : 0;
    
    if (highestChunkIndex <= lowestPendingChunk) {
        return null;
    }
    
    const totalWorkers = additionalConsumerWorkers.size + 1;
    const totalChunks = highestChunkIndex + 1;
    
    const remainingChunks = Math.max(0, totalChunks - lowestPendingChunk);
    const chunksPerWorker = Math.ceil(remainingChunks / totalWorkers);
    
    const workersBeforeThis = workerId - 1;
    const rangeStart = lowestPendingChunk + (chunksPerWorker * workersBeforeThis);
    const rangeEnd = Math.min(totalChunks - 1, rangeStart + chunksPerWorker - 1);
    
    return { start: rangeStart, end: rangeEnd };
}

function redistributeChunksToWorker(workerId: number, uploadId: string): void {
    const workerInfo = additionalConsumerWorkers.get(workerId);
    if (!workerInfo || !workerInfo.chunkRange) return;
    
    const { start, end } = workerInfo.chunkRange;
    const chunksToRedistribute: {chunkIndex: number, uploadId: string}[] = [];
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
    
    chunkReadyQueue = remainingChunks;
    
    if (chunksToRedistribute.length > 0) {
        workerInfo.worker.postMessage({
            type: 'chunks-ready-batch',
            payload: { chunks: chunksToRedistribute }
        });
        
        workerInfo.chunksAssigned += chunksToRedistribute.length;
    }
}

function rebalanceWorkerChunkRanges(uploadId: string): void {
    if (additionalConsumerWorkers.size === 0) return;
    
    additionalConsumerWorkers.forEach((info, workerId) => {
        if (info.uploadId === uploadId) {
            info.chunkRange = calculateChunkRangeForWorker(workerId, uploadId);
            
            if (info.isReady && info.chunkRange) {
                info.worker.postMessage({
                    type: 'update-chunk-range',
                    payload: { 
                        range: info.chunkRange,
                        uploadId: uploadId
                    }
                });
                
                redistributeChunksToWorker(workerId, uploadId);
            }
        }
    });
}

async function closeWebTransport(): Promise<void> {
    isAborted = true;
    
    if (memoryMonitoringInterval !== null) {
        clearInterval(memoryMonitoringInterval);
        memoryMonitoringInterval = null;
    }
    
    const workerTerminatePromises = Array.from(additionalConsumerWorkers.keys()).map(workerId => {
        return new Promise<void>(resolve => {
            const workerInfo = additionalConsumerWorkers.get(workerId);
            if (workerInfo) {
                workerInfo.worker.postMessage({ type: 'abort' });
                setTimeout(() => {
                    try {
                        workerInfo.worker.terminate();
                    } catch (err) {
                        logger.warn(`Worker ${workerId} cleanup error:`, err);
                    }
                    resolve();
                }, 100);
            } else {
                resolve();
            }
        });
    });
    
    await Promise.all(workerTerminatePromises);
    additionalConsumerWorkers.clear();
    
    await closeAllConnections();
    currentUploadId = null;
    isAborted = false;
    chunkReadyQueue = [];
    isProcessingQueue = false;
    activeTransfers = 0;
}

self.onmessage = async function (e: MessageEvent) {
    if (!e.data || !e.data.type) return;

    try {
        const { type, payload } = e.data;

        switch (type) {
            case 'consumer-init':
                if (payload.authProof) {
                    authProof = new Uint8Array(payload.authProof);
                }
                
                try {
                    await initWebTransport(payload.uploadId);
                    self.postMessage({
                        type: 'consumer-ready',
                        payload: { uploadId: payload.uploadId }
                    });
                } catch (error) {
                    logger.error(`Consumer initialization failed:`, error);
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
                await processChunkReady(payload.chunkIndex, payload.uploadId, payload.workerId);
                break;
                
            case 'chunks-ready-batch':
                await processBatchChunksReady(payload.chunks);
                break;

            case 'chunk-data':
                break;

            case 'close-web-transport':
                await closeWebTransport();
                break;

            case 'abort':
                isAborted = true;
                await closeWebTransport();
                break;

            case 'upload-complete':
                setTimeout(() => {
                    closeWebTransport().catch(err => {
                        logger.error('Error closing connections:', err);
                    });
                }, 2000);
                break;
                
            case 'update-chunk-range':
                break;
                
            case 'worker-chunk-complete':
                if (payload.workerId && payload.chunkIndex) {
                    const workerInfo = additionalConsumerWorkers.get(payload.workerId);
                    if (workerInfo) {
                        workerInfo.chunksCompleted++;
                    }
                }
                break;
                
            case 'worker-status-update':
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
                break;
        }
    } catch (error) {
        logger.error(`Message handling error:`, error);
        self.postMessage({
            type: 'web-transport-error',
            payload: {
                message: error instanceof Error ? error.message : String(error)
            }
        });
    }
};

self.onerror = (event) => {
    logger.error('Worker error:', event);
};

let diagnosticsIntervalId: number | null = null;

function collectWorkerPerformanceMetrics(): any {
    let totalChunksAssigned = chunkReadyQueue.length;
    let totalChunksCompleted = 0;
    let chunksInProgress = activeTransfers * BATCH_SIZE;
    
    const workerMetrics = [];
    for (const [workerId, info] of additionalConsumerWorkers.entries()) {
        totalChunksAssigned += info.chunksAssigned;
        totalChunksCompleted += info.chunksCompleted;
        
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
    
    const elapsedTimeSeconds = (performance.now() - uploadStartTime) / 1000;
    const throughputRate = elapsedTimeSeconds > 0 ? (totalChunksConfirmed / elapsedTimeSeconds).toFixed(2) : '0';
    
    const avgBatchTime = batchCompletionTimes.length > 0 ? 
        (batchCompletionTimes.reduce((a, b) => a + b, 0) / batchCompletionTimes.length).toFixed(1) + 'ms' : 'N/A';
        
    const avgServerResponseTime = serverResponseTimes.length > 0 ? 
        (serverResponseTimes.reduce((a, b) => a + b, 0) / serverResponseTimes.length).toFixed(1) + 'ms' : 'N/A';
    
    const overallMetrics = {
        totalChunksAssigned,
        totalChunksCompleted,
        pendingChunks: totalChunksAssigned - totalChunksCompleted,
        mainQueueSize: chunkReadyQueue.length,
        chunksInProgress,
        workerCount: additionalConsumerWorkers.size + 1,
        totalChunksConfirmed,
        throughput: throughputRate + ' chunks/sec',
        avgBatchTime,
        avgServerResponseTime,
        batchSize: BATCH_SIZE,
        concurrentBatches: MAX_CONCURRENT_BATCHES,
        elapsedTimeSeconds: elapsedTimeSeconds.toFixed(1) + 's',
        mode: usePipelineMode ? 'PIPELINE' : 'BATCH',
        bandwidthMbps: estimatedUploadBandwidthMbps.toFixed(1),
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
        
        const metrics = collectWorkerPerformanceMetrics();
        
        self.postMessage({
            type: 'worker-pool-metrics',
            payload: metrics
        });
    }, 10000);
}