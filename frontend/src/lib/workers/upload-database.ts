/**
 * IndexedDB-based checkpoint system for resumable uploads
 * Tracks chunk completion state to enable resume after interruption
 */

export interface ChunkCheckpoint {
  chunkIndex: number;
  uploadId: string;
  workerId: number;
  completed: boolean;
  timestamp: number;
  size: number;
  attempts: number;
}

export interface UploadCheckpoint {
  uploadId: string;
  fileName: string;
  fileSize: number;
  fileMimeType: string;
  totalChunks: number;
  completedChunks: number;
  workerCount: number;
  startedAt: number;
  lastUpdated: number;
  status: 'in-progress' | 'paused' | 'completed' | 'failed';
  error?: string;
}

const DB_NAME = 'ByteBridgeUploads';
const DB_VERSION = 1;
const UPLOAD_STORE = 'uploads';
const CHUNK_STORE = 'chunks';

class CheckpointDatabase {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Upload metadata store
        if (!db.objectStoreNames.contains(UPLOAD_STORE)) {
          const uploadStore = db.createObjectStore(UPLOAD_STORE, { keyPath: 'uploadId' });
          uploadStore.createIndex('status', 'status', { unique: false });
          uploadStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }

        // Chunk completion store
        if (!db.objectStoreNames.contains(CHUNK_STORE)) {
          const chunkStore = db.createObjectStore(CHUNK_STORE, { 
            keyPath: ['uploadId', 'chunkIndex'] 
          });
          chunkStore.createIndex('uploadId', 'uploadId', { unique: false });
          chunkStore.createIndex('completed', 'completed', { unique: false });
          chunkStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  private ensureDB(): IDBDatabase {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  // ==================== Upload Operations ====================

  async saveUpload(checkpoint: UploadCheckpoint): Promise<void> {
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(UPLOAD_STORE, 'readwrite');
      const store = tx.objectStore(UPLOAD_STORE);
      const request = store.put(checkpoint);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to save upload: ${request.error?.message}`));
    });
  }

  async getUpload(uploadId: string): Promise<UploadCheckpoint | null> {
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(UPLOAD_STORE, 'readonly');
      const store = tx.objectStore(UPLOAD_STORE);
      const request = store.get(uploadId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error(`Failed to get upload: ${request.error?.message}`));
    });
  }

  async getAllUploads(): Promise<UploadCheckpoint[]> {
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(UPLOAD_STORE, 'readonly');
      const store = tx.objectStore(UPLOAD_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Failed to get uploads: ${request.error?.message}`));
    });
  }

  async getInProgressUploads(): Promise<UploadCheckpoint[]> {
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(UPLOAD_STORE, 'readonly');
      const store = tx.objectStore(UPLOAD_STORE);
      const index = store.index('status');
      const request = index.getAll('in-progress');

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Failed to get in-progress uploads: ${request.error?.message}`));
    });
  }

  async deleteUpload(uploadId: string): Promise<void> {
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([UPLOAD_STORE, CHUNK_STORE], 'readwrite');
      
      // Delete upload metadata
      const uploadStore = tx.objectStore(UPLOAD_STORE);
      uploadStore.delete(uploadId);

      // Delete all chunks for this upload
      const chunkStore = tx.objectStore(CHUNK_STORE);
      const index = chunkStore.index('uploadId');
      const request = index.openCursor(IDBKeyRange.only(uploadId));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(`Failed to delete upload: ${tx.error?.message}`));
    });
  }

  // ==================== Chunk Operations ====================

  async saveChunk(checkpoint: ChunkCheckpoint): Promise<void> {
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHUNK_STORE, 'readwrite');
      const store = tx.objectStore(CHUNK_STORE);
      const request = store.put(checkpoint);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to save chunk: ${request.error?.message}`));
    });
  }

  async saveChunksBatch(checkpoints: ChunkCheckpoint[]): Promise<void> {
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHUNK_STORE, 'readwrite');
      const store = tx.objectStore(CHUNK_STORE);

      for (const checkpoint of checkpoints) {
        store.put(checkpoint);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(`Failed to save chunks batch: ${tx.error?.message}`));
    });
  }

  async getChunk(uploadId: string, chunkIndex: number): Promise<ChunkCheckpoint | null> {
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHUNK_STORE, 'readonly');
      const store = tx.objectStore(CHUNK_STORE);
      const request = store.get([uploadId, chunkIndex]);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error(`Failed to get chunk: ${request.error?.message}`));
    });
  }

  async getChunksForUpload(uploadId: string): Promise<ChunkCheckpoint[]> {
    const db = this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHUNK_STORE, 'readonly');
      const store = tx.objectStore(CHUNK_STORE);
      const index = store.index('uploadId');
      const request = index.getAll(uploadId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(`Failed to get chunks: ${request.error?.message}`));
    });
  }

  async getCompletedChunks(uploadId: string): Promise<Set<number>> {
    const chunks = await this.getChunksForUpload(uploadId);
    return new Set(
      chunks
        .filter(c => c.completed)
        .map(c => c.chunkIndex)
    );
  }

  async getPendingChunks(uploadId: string): Promise<number[]> {
    const chunks = await this.getChunksForUpload(uploadId);
    return chunks
      .filter(c => !c.completed)
      .map(c => c.chunkIndex)
      .sort((a, b) => a - b);
  }

  async markChunkCompleted(
    uploadId: string, 
    chunkIndex: number, 
    workerId: number,
    size: number
  ): Promise<void> {
    const checkpoint: ChunkCheckpoint = {
      uploadId,
      chunkIndex,
      workerId,
      completed: true,
      timestamp: Date.now(),
      size,
      attempts: 1,
    };
    await this.saveChunk(checkpoint);
  }

  async incrementChunkAttempts(uploadId: string, chunkIndex: number): Promise<void> {
    const chunk = await this.getChunk(uploadId, chunkIndex);
    if (chunk) {
      chunk.attempts++;
      chunk.timestamp = Date.now();
      await this.saveChunk(chunk);
    }
  }

  // ==================== Utility Operations ====================

  async cleanupOldUploads(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const uploads = await this.getAllUploads();
    const now = Date.now();
    let cleanedCount = 0;

    for (const upload of uploads) {
      if (now - upload.lastUpdated > maxAgeMs) {
        await this.deleteUpload(upload.uploadId);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  async getStatistics(uploadId: string): Promise<{
    totalChunks: number;
    completedChunks: number;
    pendingChunks: number;
    completionPercentage: number;
    totalSize: number;
    uploadedSize: number;
  }> {
    const chunks = await this.getChunksForUpload(uploadId);
    const completed = chunks.filter(c => c.completed);

    const totalSize = chunks.reduce((sum, c) => sum + c.size, 0);
    const uploadedSize = completed.reduce((sum, c) => sum + c.size, 0);

    return {
      totalChunks: chunks.length,
      completedChunks: completed.length,
      pendingChunks: chunks.length - completed.length,
      completionPercentage: chunks.length > 0 ? (completed.length / chunks.length) * 100 : 0,
      totalSize,
      uploadedSize,
    };
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }
}

// Singleton instance
let checkpointDB: CheckpointDatabase | null = null;

export function getCheckpointDB(): CheckpointDatabase {
  if (!checkpointDB) {
    checkpointDB = new CheckpointDatabase();
  }
  return checkpointDB;
}

export async function initializeCheckpointDB(): Promise<CheckpointDatabase> {
  const db = getCheckpointDB();
  await db.initialize();
  return db;
}