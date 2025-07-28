/**
 * @file Test suite for ParallelEncryptionManager
 * Enhanced tests with mocked Web Workers
 */

import { jest } from '@jest/globals';
import MockWorker from './mocks/mock.worker';

// Import the actual implementation (mocking its dependencies)
jest.mock('libsodium-wrappers', () => ({
  crypto_kdf_derive_from_key: jest.fn((length: number, id: number, context: string, key: Uint8Array) => {
    // Create deterministic unique keys based on context for testing
    const workerId = parseInt(context.split('-')[1], 10) || 0;
    return new Uint8Array(length).fill(workerId + 1);
  }),
  ready: jest.fn().mockImplementation(() => Promise.resolve(true))
}));

jest.mock('../src/lib/encryption', () => ({
  initializeSodium: jest.fn().mockImplementation(() => Promise.resolve(true))
}));

// Import the real ParallelEncryptionManager (with mocked dependencies)
import { ParallelEncryptionManager } from '../src/lib/parallel.encryption.manager';

// Mock the Worker constructor globally
(global as any).Worker = MockWorker;

// Helper data for tests
const TEST_MASTER_KEY = new Uint8Array(32).fill(42);
const TEST_FINGERPRINT = 'parallel-test-key';

// Helper to create test files with predictable content
function createTestFile(size: number): File {
  const arr = new Uint8Array(size).map((_, i) => i % 256);
  return new File([arr], 'dummy.bin');
}

// Clean up between tests
beforeEach(() => {
  MockWorker.resetAll();
});

afterEach(() => {
  MockWorker.resetAll();
});

// Tests
describe('ParallelEncryptionManager', () => {
  it('assigns non-overlapping ranges to workers and covers all bytes', async () => {
    const fileSize = 1024 * 1024 * 5 + 123; // 5MB + 123 bytes
    const file = createTestFile(fileSize);
    const manager = new ParallelEncryptionManager({
      compressionLevel: 6,
      keyFingerprint: TEST_FINGERPRINT,
      masterKey: TEST_MASTER_KEY,
      useWebTransport: false,
      workerCount: 4
    });
    
    await manager.initialize();
    
    let progressUpdates = 0;
    await manager.startUpload(file, 'test-upload', () => {
      progressUpdates++;
    });
    
    // Access private properties for testing
    const producers = (manager as any).producers;
    
    // Check all bytes are assigned
    const totalBytes = producers.reduce((sum: number, p: any) => 
      sum + (p.range.end - p.range.start), 0);
    expect(totalBytes).toBe(fileSize);
    
    // Check for no overlap between ranges
    const sortedRanges = [...producers.map((p: any) => p.range)]
      .sort((a, b) => a.start - b.start);
      
    for (let i = 1; i < sortedRanges.length; i++) {
      expect(sortedRanges[i].start).toBe(sortedRanges[i-1].end);
    }
    
    // Verify first range starts at 0
    expect(sortedRanges[0].start).toBe(0);
    
    // Verify last range ends at file size
    expect(sortedRanges[sortedRanges.length - 1].end).toBe(fileSize);
    
    // We should have received at least one progress update
    expect(progressUpdates).toBeGreaterThan(0);
  });

  it('derives unique sub-keys for each worker from the master key', async () => {
    const manager = new ParallelEncryptionManager({
      compressionLevel: 6,
      keyFingerprint: TEST_FINGERPRINT,
      masterKey: TEST_MASTER_KEY,
      useWebTransport: false,
      workerCount: 3
    });
    
    await manager.initialize();
    
    // Access private properties for testing
    const producers = (manager as any).producers;
    const subKeys = producers.map((p: any) => p.subKey);
    
    // Every worker should have a subKey
    expect(subKeys.every((key: any) => key instanceof Uint8Array)).toBe(true);
    
    // All sub-keys should be different
    const uniqueSubKeys = new Set(subKeys.map((key: any) => {
      return Array.from(key).toString();
    }));
    
    expect(uniqueSubKeys.size).toBe(3);
    
    // Each key should be unique
    for (let i = 0; i < subKeys.length; i++) {
      for (let j = i + 1; j < subKeys.length; j++) {
        expect(Array.from(subKeys[i]).toString())
          .not.toBe(Array.from(subKeys[j]).toString());
      }
    }
  });

  it('passes the correct header to each worker', async () => {
    const manager = new ParallelEncryptionManager({
      compressionLevel: 6,
      keyFingerprint: TEST_FINGERPRINT,
      masterKey: TEST_MASTER_KEY,
      useWebTransport: false,
      workerCount: 2
    });
    
    await manager.initialize();
    
    // Access private properties for testing
    const producers = (manager as any).producers;
    
    // Each worker should have a header
    for (const p of producers) {
      expect(p.header).toBeInstanceOf(Uint8Array);
      expect(p.header.length).toBeGreaterThan(0);
    }
  });

  it('aggregates progress correctly from all workers', async () => {
    const fileSize = 4096;
    const file = createTestFile(fileSize);
    const manager = new ParallelEncryptionManager({
      compressionLevel: 6,
      keyFingerprint: TEST_FINGERPRINT,
      masterKey: TEST_MASTER_KEY,
      useWebTransport: false,
      workerCount: 2
    });
    
    await manager.initialize();
    
    const progressUpdates: Array<{processedBytes: number, totalBytes: number}> = [];
    
    await manager.startUpload(file, 'progress-upload', (progress) => {
      progressUpdates.push(progress);
    });
    
    // Should have received multiple progress updates
    expect(progressUpdates.length).toBeGreaterThan(1);
    
    // Final progress should match file size
    const finalProgress = progressUpdates[progressUpdates.length - 1];
    expect(finalProgress.processedBytes).toBe(fileSize);
    expect(finalProgress.totalBytes).toBe(fileSize);
    
    // Progress should only increase, never decrease
    for (let i = 1; i < progressUpdates.length; i++) {
      expect(progressUpdates[i].processedBytes)
        .toBeGreaterThanOrEqual(progressUpdates[i-1].processedBytes);
    }
  });

  it('handles abort and cleanup gracefully', async () => {
    const file = createTestFile(1024);
    const manager = new ParallelEncryptionManager({
      compressionLevel: 6,
      keyFingerprint: TEST_FINGERPRINT,
      masterKey: TEST_MASTER_KEY,
      useWebTransport: false,
      workerCount: 2
    });
    
    await manager.initialize();
    
    // Access private properties for testing
    const producersBeforeAbort = (manager as any).producers;
    expect(producersBeforeAbort.length).toBe(2);
    
    // Capture the worker instances to check termination
    const workers = MockWorker.getAll();
    expect(workers.length).toBe(2);
    
    // Abort and check cleanup
    await manager.abort();
    
    // All workers should be terminated
    expect(workers.every(w => w.terminated)).toBe(true);
    
    // Producers array should be cleared
    const producersAfterAbort = (manager as any).producers;
    expect(producersAfterAbort.length).toBe(0);
  });

  it('handles empty file uploads', async () => {
    const file = createTestFile(0);
    const manager = new ParallelEncryptionManager({
      compressionLevel: 6,
      keyFingerprint: TEST_FINGERPRINT,
      masterKey: TEST_MASTER_KEY,
      useWebTransport: false,
      workerCount: 2
    });
    
    await manager.initialize();
    
    // Should complete without errors
    await expect(manager.startUpload(file, 'empty-upload')).resolves.not.toThrow();
    
    // All ranges should be zero
    const producers = (manager as any).producers;
    const totalBytes = producers.reduce((sum: number, p: any) => 
      sum + (p.range.end - p.range.start), 0);
    expect(totalBytes).toBe(0);
  });

  it('handles errors during worker initialization', async () => {
    // Simulate an initialization error in one worker
    const originalPostMessage = MockWorker.prototype.postMessage;
    
    // Override postMessage to make one worker fail
    MockWorker.prototype.postMessage = function(msg: any) {
      if (msg.type === 'init' && (this as any).scriptUrl?.includes('worker.js')) {
        // Make the first worker fail
        if (MockWorker.getAll().length === 1) {
          setTimeout(() => {
            if (this.onerror) {
              this.onerror(new Error('Simulated worker initialization error'));
            }
          }, 10);
          return;
        }
      }
      originalPostMessage.call(this, msg);
    };
    
    const manager = new ParallelEncryptionManager({
      compressionLevel: 6,
      keyFingerprint: TEST_FINGERPRINT,
      masterKey: TEST_MASTER_KEY,
      useWebTransport: false,
      workerCount: 2
    });
    
    // Should fail initialization
    await expect(manager.initialize()).rejects.toThrow();
    
    // Restore original function
    MockWorker.prototype.postMessage = originalPostMessage;
  });
});
