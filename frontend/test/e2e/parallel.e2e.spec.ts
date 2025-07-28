import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Type definitions for encryption manager config
interface EncryptionConfig {
  compressionLevel: number;
  keyFingerprint: string;
  masterKey: Uint8Array;
  useWebTransport: boolean;
  workerCount?: number;
}

// Create test data
const MASTER_KEY = new Uint8Array(32).fill(42);
const FINGERPRINT = 'parallel-test-key';

/**
 * End-to-end test suite for ParallelEncryptionManager
 * Tests real browser implementation with actual Web Workers
 */
test.describe('ParallelEncryptionManager – real browser', () => {
  // Set fast timeout for quick failure detection
  test.setTimeout(3000);

  // Mock implementation for tests to prevent Web Worker issues in tests
  async function setupMockWorkers(page: any) {

    await page.evaluate(() => {
      // Create a mock Web Worker implementation for testing
      (window as any).originalWorker = window.Worker;
      
      // Mock Worker with synchronous message handling
      class MockWorker {
        onmessage: ((event: any) => void) | null = null;
        
        constructor(public url: string) {
          console.log(`Creating mock worker for ${url}`);
        }
        
        postMessage(data: any) {
          console.log(`Mock worker received message:`, data);
          
          // Simulate immediate response for initialization
          if (data.action === 'init') {
            if (this.onmessage) {
              const onMessageHandler = this.onmessage;
              onMessageHandler({
                data: {
                  action: 'initialized'
                }
              });
            }
          }
          
          // Simulate encryption response
          if (data.action === 'process') {
            if (this.onmessage) {
              const onMessageHandler = this.onmessage;
              setTimeout(() => {
                if (onMessageHandler) {
                  onMessageHandler({
                    data: {
                      action: 'processed',
                      chunkId: data.chunkId,
                      data: new Uint8Array(data.chunk.length) // Mock encrypted data
                    }
                  });
                }
              }, 10);
            }
          }
        }
        
        terminate() {
          console.log('Mock worker terminated');
        }
      }
      
      // Replace the global Worker constructor with our mock
      window.Worker = MockWorker as any;
    });
  }

  // Helper to set up the page with required scripts
  async function setupPage(page: any) {
    // Configure console logging from browser to test output
    page.on('console', (msg: { type: () => string; text: () => any }) => {
      if (msg.type() === 'debug' || msg.type() === 'info') {
        console.log(`[Browser] ${msg.text()}`);
      } else if (msg.type() === 'error') {
        console.error(`[Browser Error] ${msg.text()}`);
      } else if (msg.type() === 'warning') {
        console.warn(`[Browser Warning] ${msg.text()}`);
      }
    });
    
    // Load the test harness which imports the TypeScript files through Vite
    await page.goto('/test/e2e/test-harness.html');

    try {
      // Wait for the test harness to signal it's ready with a longer timeout
      // This part needs more time but keeps the test assertions fast
      await page.waitForFunction(() => {
        return (window as any).testHarnessLoaded === true;
      }, { timeout: 5000 });

      // Log successful loading
      console.log('Test harness loaded successfully');

      // No mock workers: use real browser Workers

    } catch (e) {
      // If loading fails, get any error information
      const errorInfo = await page.evaluate(() => {
        return {
          loaded: (window as any).testHarnessLoaded,
          error: (window as any).testHarnessError,
          statusText: document.getElementById('test-status')?.textContent
        };
      });
      
      console.error('Test harness failed to load:', errorInfo);
      throw new Error(`Test harness failed to load: ${JSON.stringify(errorInfo)}`);
    }
  }
  
  test('assigns non-overlapping ranges and completes upload', async ({ page }) => {
    await setupPage(page);

    page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));
    page.on('pageerror', err => console.log('[PAGE ERROR]', err));

    // Create test file in the browser context - smaller size for faster tests
    const fileSize = 512 * 1024 + 123; // 512KB + 123 bytes

    // Pass test parameters to the browser context including file size
    await page.evaluate((testParams) => {
      (window as any).testParams = testParams;
      
      // Create the test file in the browser
      const buf = new Uint8Array(testParams.fileSize).map((_, i) => i % 256);
      (window as any).fileHandle = new File([buf], 'test-file.bin', { type: 'application/octet-stream' });
    }, {
      fileSize,
      masterKey: Array.from(MASTER_KEY),
      fingerprint: FINGERPRINT
    });
    
    // Run the actual encryption manager in the browser
    const result = await page.evaluate(async () => {
      const file = (window as any).fileHandle;
      const { masterKey: mk, fingerprint: fp, fileSize } = (window as any).testParams;
      
      // Create the manager
      const { ParallelEncryptionManager } = window as any;
      
      const manager = new ParallelEncryptionManager({
        compressionLevel: 6,
        keyFingerprint: fp,
        masterKey: new Uint8Array(mk),
        useWebTransport: false,
        workerCount: 4
      });
      
      // Initialize and upload
      await manager.initialize();
      const producers = (manager as any).producers;
      const producerCount = producers.length;
      
      // Get ranges before upload starts
      const ranges = producers.map((p: any) => ({
        start: p.range.start,
        end: p.range.end
      }));
      
      // Start the upload and track progress
      let progressEvents: number[] = [];
      manager.onProgress((progress: number) => {
        progressEvents.push(progress);
      });
      
      const uploadId = await manager.startUpload(file, 'e2e-test-upload');
      
      return {
        uploadId,
        producerCount,
        ranges,
        totalSize: fileSize,
        progressEvents
      };
    });
    
    // Assertions
    expect(result.uploadId).toBeDefined();
    expect(result.producerCount).toBeGreaterThan(0);
    
    // Check that ranges are defined for each producer
    expect(result.ranges.length).toBe(result.producerCount);
    
    // Verify ranges are non-overlapping and cover the entire file
    let coveredBytes = 0;
    const sortedRanges = [...result.ranges].sort((a, b) => a.start - b.start);
    
    for (let i = 0; i < sortedRanges.length; i++) {
      const range = sortedRanges[i];
      
      // Range should have valid start/end
      expect(range.start).toBeGreaterThanOrEqual(0);
      expect(range.end).toBeGreaterThan(range.start);
      
      // Check for no overlap with next range
      if (i < sortedRanges.length - 1) {
        expect(range.end).toBeLessThanOrEqual(sortedRanges[i + 1].start);
      }
      
      coveredBytes += (range.end - range.start);
    }
    
    // Verify that all bytes are covered
    expect(coveredBytes).toBe(result.totalSize);
    
    // Verify progress reporting worked
    expect(result.progressEvents.length).toBeGreaterThan(0);
    const lastProgress = result.progressEvents[result.progressEvents.length - 1];
    expect(lastProgress).toBe(1); // 100% complete
  });

  test('derives unique sub-keys for each worker', async ({ page }) => {
    await setupPage(page);

    page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));
    page.on('pageerror', err => console.log('[PAGE ERROR]', err));

    // Pass test parameters to browser
    await page.evaluate((testParams) => {
      (window as any).testParams = testParams;
      console.log('Test parameters loaded:', testParams);
    }, {
      masterKey: Array.from(MASTER_KEY),
      fingerprint: FINGERPRINT,
      workerCount: 4
    });
    
    // Enable detailed console logging for debugging
    await page.evaluate(() => {
      console.log('Starting sub-key derivation test');
      
      // Add debug logging to key derivation
      const { Encryption } = window as any;
      const originalDeriveKey = Encryption.deriveKey;
      
      Encryption.deriveKey = function(masterKey: Uint8Array, salt: string) {
        console.log(`Deriving key with salt: ${salt}`);
        const result = originalDeriveKey(masterKey, salt);
        console.log('Key derived successfully');
        return result;
      };
    });
    
    const result = await page.evaluate(async () => {
      try {
        console.log('Starting manager creation');
        const { ParallelEncryptionManager } = window as any;
        const { masterKey: mk, fingerprint: fp, workerCount } = (window as any).testParams;
        
        // Create the manager
        const manager = new ParallelEncryptionManager({
          compressionLevel: 6,
          keyFingerprint: fp,
          masterKey: new Uint8Array(mk),
          useWebTransport: false,
          workerCount
        });
        
        console.log('Manager created, initializing...');
        await manager.initialize();
        console.log('Manager initialized successfully');
        
        // Extract the sub-keys (private implementation detail)
        const subKeys = (manager as any).producers.map((p: any) => p.encryptionKey);
        console.log(`Extracted ${subKeys.length} sub-keys`);
        
        // Convert to regular arrays for comparison
        return {
          success: true,
          keys: subKeys.map((key: Uint8Array) => Array.from(key))
        };
      } catch (error) {
        console.error('Test failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.toString() : String(error)
        };
      }
    });
    
    // Check if the test succeeded
    expect(result.success).toBe(true);
    
    // Verify we have the expected number of sub-keys
    expect(result.keys.length).toBeGreaterThan(1);
    
    // Verify all sub-keys are different from each other
    for (let i = 0; i < result.keys.length; i++) {
      for (let j = i + 1; j < result.keys.length; j++) {
        // Convert the arrays to strings for deep comparison
        const keyI = JSON.stringify(result.keys[i]);
        const keyJ = JSON.stringify(result.keys[j]);
        
        expect(keyI).not.toEqual(keyJ);
      }
    }
  });

  test('handles abort and cleanup correctly', async ({ page }) => {
    await setupPage(page);

    page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));
    page.on('pageerror', err => console.log('[PAGE ERROR]', err));

    // Create a file for this test (reduced size for faster testing)
    const fileSize = 256 * 1024; // 256KB

    await page.evaluate((testParams) => {
      (window as any).testParams = testParams;
      
      // Create the test file in the browser
      const buf = new Uint8Array(testParams.fileSize);
      (window as any).fileHandle = new File([buf], 'test-abort.bin', { type: 'application/octet-stream' });
    }, {
      fileSize,
      masterKey: Array.from(MASTER_KEY),
      fingerprint: FINGERPRINT
    });
    
    const result = await page.evaluate(async () => {
      const file = (window as any).fileHandle;
      const { masterKey: mk, fingerprint: fp } = (window as any).testParams;
      
      // Create the manager
      const { ParallelEncryptionManager } = window as any;
      
      const manager = new ParallelEncryptionManager({
        compressionLevel: 6,
        keyFingerprint: fp,
        masterKey: new Uint8Array(mk),
        useWebTransport: false,
        workerCount: 4
      });
      
      await manager.initialize();
      
      // Start the upload
      const uploadId = await manager.startUpload(file, 'abort-test');
      
      // Store worker count before abort
      const workerCountBefore = (manager as any).producers.length;
      
      // Wait a short time to allow some processing
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Abort the upload
      await manager.abortUpload(uploadId);
      
      // Check worker state after abort
      const workerCountAfter = (manager as any).producers.length;
      const anyActive = (manager as any).producers.some((p: any) => p.active);
      
      return {
        workerCountBefore,
        workerCountAfter,
        anyActive
      };
    });
    
    // Verify the workers were created initially
    expect(result.workerCountBefore).toBeGreaterThan(0);
    
    // Verify workers were properly cleaned up
    expect(result.anyActive).toBe(false);
  });

  test('handles fault injection - workers terminating mid-upload', async ({ page }) => {
    await setupPage(page);

    page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));
    page.on('pageerror', err => console.log('[PAGE ERROR]', err));

    // Create test file
    const fileSize = 256 * 1024; // 256KB

    await page.evaluate((testParams) => {
      (window as any).testParams = testParams;
      
      // Create the test file in the browser
      const buf = new Uint8Array(testParams.fileSize);
      (window as any).fileHandle = new File([buf], 'fault-test.bin', { type: 'application/octet-stream' });
      
      // Mock implementation to test fault handling
      class MockWorker {
        onmessage: ((event: any) => void) | null = null;
        
        constructor(public url: string) {}
        
        postMessage(data: any) {
          // Simulate worker message handling
          setTimeout(() => {
            if (data.action === 'process') {
              // 20% chance of worker failure
              if (Math.random() < 0.2) {
                this.terminate(); // Simulate worker crash
                return;
              }
              
              // Otherwise simulate success
              if (this.onmessage) {
                this.onmessage({
                  data: {
                    action: 'processed',
                    chunkId: data.chunkId,
                    data: new Uint8Array(100) // Mock encrypted data
                  }
                });
              }
            }
          }, 5);
        }
        
        terminate() {
          // Simulate termination by nullifying onmessage
          this.onmessage = null;
        }
      }
      
      // Replace Worker with our mock
      (window as any).originalWorker = window.Worker;
      window.Worker = MockWorker as any;
    }, {
      fileSize,
      masterKey: Array.from(MASTER_KEY),
      fingerprint: FINGERPRINT
    });
    
    const result = await page.evaluate(async () => {
      try {
        const file = (window as any).fileHandle;
        const { masterKey: mk, fingerprint: fp } = (window as any).testParams;
        
        // Create the manager
        const { ParallelEncryptionManager } = window as any;
        
        const manager = new ParallelEncryptionManager({
          compressionLevel: 6,
          keyFingerprint: fp,
          masterKey: new Uint8Array(mk),
          useWebTransport: false,
          workerCount: 8 // More workers = more chances for failure
        });
        
        await manager.initialize();
        
        // Start the upload
        const uploadPromise = manager.startUpload(file, 'fault-test');
        
        // The upload should complete despite worker failures
        const uploadId = await uploadPromise;
        
        return { success: true, uploadId };
      } catch (error: unknown) {
        return { 
          success: false, 
          error: error instanceof Error ? error.toString() : String(error)
        };
      } finally {
        // Restore original Worker
        window.Worker = (window as any).originalWorker;
      }
    });
    
    // Verify the upload completed successfully despite faults
    expect(result.success).toBe(true);
    expect(result.uploadId).toBeDefined();
  });
});
