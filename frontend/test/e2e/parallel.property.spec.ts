/**
 * @file Property-based tests for ParallelEncryptionManager
 * These tests verify that certain properties always hold true across different file sizes and worker counts
 */

import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MASTER_KEY = new Uint8Array(32).fill(42);
const FINGERPRINT = 'property-test-key';

test.describe('ParallelEncryptionManager - Property Tests', () => {
  // Set fast timeout for quick failure detection
  test.setTimeout(3000);

  // Helper to set up the test page
  async function setupPage(page: any) {
    // Load the test harness which imports the TypeScript files through Vite
    await page.goto('/test/e2e/test-harness.html');
    
    // Wait for the test harness to signal it's ready
    await page.waitForFunction(() => (window as any).testHarnessLoaded === true, { timeout: 2000 });
    
    // Configure console logging from browser to test output
    page.on('console', (msg: { type: () => string; text: () => string }) => {
      if (msg.type() === 'debug' || msg.type() === 'info') {
        console.log(`[Browser] ${msg.text()}`);
      } else if (msg.type() === 'error') {
        console.error(`[Browser Error] ${msg.text()}`);
      }
    });
  }

  /**
   * Property: For any file size and worker count, ranges should:
   * 1. Never overlap
   * 2. Cover the entire file
   * 3. Have each byte assigned exactly once
   */
  const fileSizes = [0, 1024, 1024 * 1024, 5 * 1024 * 1024 + 123];
  const workerCounts = [1, 2, 4, 8];
  
  for (const fileSize of fileSizes) {
    for (const workerCount of workerCounts) {
      test(`ensures contiguous non-overlapping ranges - ${fileSize} bytes, ${workerCount} workers`, async ({ page }) => {
        await setupPage(page);
        
        // Transfer test parameters to browser context
        await page.evaluate((testParams) => {
          (window as any).testParams = testParams;
          
          // Create test file
          const buf = new Uint8Array(testParams.fileSize);
          (window as any).fileHandle = new File([buf], `test-${testParams.fileSize}-${testParams.workerCount}.bin`);
        }, {
          fileSize,
          workerCount,
          masterKey: Array.from(MASTER_KEY),
          fingerprint: FINGERPRINT
        });
        
    const result = await page.evaluate(async () => {
      const { ParallelEncryptionManager } = window as any;
      const { fileSize, workerCount, masterKey, fingerprint } = (window as any).testParams;
      const file = (window as any).fileHandle;
      
      console.log(`Property test: testing with file size ${fileSize} and ${workerCount} workers`);
      
      // Initialize manager with specified worker count
      const manager = new ParallelEncryptionManager({
        compressionLevel: 6,
        keyFingerprint: fingerprint,
        masterKey: new Uint8Array(masterKey),
        useWebTransport: false,
        workerCount: workerCount
      });
      
      console.log('Calling manager.initialize()');
      await manager.initialize();
      console.log('Manager initialized');
      
      console.log(`Starting upload for file of size ${file.size}`);
      // We need to actually start the upload to assign ranges
      await manager.startUpload(file, 'property-test');
      console.log('Upload started');
      
      // Actual worker count might be different from requested
      const actualWorkerCount = (manager as any).producers.length;
      console.log(`Actual worker count: ${actualWorkerCount}`);
      
      // Extract ranges for verification
      const ranges = (manager as any).producers.map((p: any) => ({
        start: p.range.start,
        end: p.range.end
      }));
      
      console.log('Extracted ranges:', ranges);          // Create a "coverage map" - for each byte position, how many workers cover it
          const coverage = new Array(fileSize).fill(0);
          
          // Mark each byte covered by a worker
          for (const range of ranges) {
            for (let i = range.start; i < range.end; i++) {
              coverage[i]++;
            }
          }
          
          // Count bytes with different coverage levels
          const coverageCounts = {
            notCovered: 0,    // Bytes covered by 0 workers
            coveredOnce: 0,   // Bytes covered by exactly 1 worker
            overlapped: 0     // Bytes covered by >1 worker
          };
          
          // Only analyze coverage if size > 0
          if (fileSize > 0) {
            for (let i = 0; i < fileSize; i++) {
              if (coverage[i] === 0) coverageCounts.notCovered++;
              else if (coverage[i] === 1) coverageCounts.coveredOnce++;
              else coverageCounts.overlapped++;
            }
          }
          
          // Calculate total bytes assigned
          const totalBytesAssigned = ranges.reduce(
            (sum: number, r: {start: number, end: number}) => sum + (r.end - r.start), 
            0
          );
          
          return {
            fileSize,
            actualWorkerCount,
            ranges,
            totalBytesAssigned,
            coverageCounts
          };
        });
        
        // Type safety guard
        expect(typeof result).toBe('object');
        
        // For empty files, just verify total bytes
        if (fileSize === 0) {
          expect(result.totalBytesAssigned).toBe(0);
          return;
        }
        
        // Actual tests for non-empty files:
        
        // 1. Total bytes assigned should equal file size
        expect(result.totalBytesAssigned).toBe(fileSize);
        
        // 2. No bytes should be uncovered
        expect(result.coverageCounts.notCovered).toBe(0);
        
        // 3. No bytes should be covered more than once
        expect(result.coverageCounts.overlapped).toBe(0);
        
        // 4. All bytes should be covered exactly once
        expect(result.coverageCounts.coveredOnce).toBe(fileSize);
      });
    }
  }

  /**
   * Property: Progress reporting should never move backward
   * This test verifies that as chunks complete, progress only increases
   */
  test('ensures progress never regresses', async ({ page }) => {
    await setupPage(page);
    
    // File size large enough to create multiple chunks
    const fileSize = 5 * 1024 * 1024;
    
    await page.evaluate((testParams) => {
      (window as any).testParams = testParams;
      
      // Create test file
      const buf = new Uint8Array(testParams.fileSize);
      (window as any).fileHandle = new File([buf], 'progress-test.bin');
    }, {
      fileSize,
      masterKey: Array.from(MASTER_KEY),
      fingerprint: FINGERPRINT
    });
    
    const result = await page.evaluate(async () => {
      const { ParallelEncryptionManager } = window as any;
      const { masterKey, fingerprint } = (window as any).testParams;
      const file = (window as any).fileHandle;
      
      // Initialize manager with multiple workers
      const manager = new ParallelEncryptionManager({
        compressionLevel: 6,
        keyFingerprint: fingerprint,
        masterKey: new Uint8Array(masterKey),
        useWebTransport: false,
        workerCount: 4
      });
      
      await manager.initialize();
      
      // Record progress updates
      const progressUpdates: number[] = [];
      manager.onProgress((progress: number) => {
        progressUpdates.push(progress);
      });
      
      // Start the upload
      await manager.startUpload(file, 'progress-test');
      
      return progressUpdates;
    });
    
    // Check that we got progress updates
    expect(result.length).toBeGreaterThan(0);
    
    // Verify progress never decreases
    let lastProgress = 0;
    for (const progress of result) {
      expect(progress).toBeGreaterThanOrEqual(lastProgress);
      lastProgress = progress;
    }
    
    // Verify we got to 100%
    expect(result[result.length - 1]).toBe(1);
  });

  /**
   * Property: With multiple workers, processing should happen in parallel
   * This test verifies that we see evidence of true parallel execution
   */
  test('shows evidence of true parallel execution', async ({ page }) => {
    await setupPage(page);
    
    // Larger file to ensure enough work
    const fileSize = 10 * 1024 * 1024;
    
    await page.evaluate((testParams) => {
      (window as any).testParams = testParams;
      
      // Create test file
      const buf = new Uint8Array(testParams.fileSize);
      (window as any).fileHandle = new File([buf], 'parallel-test.bin');
      
      // Track worker processing events with timestamps
      (window as any).workerEvents = [];
      
      // Create a custom Worker implementation that tracks timing
      class TrackedWorker {
        onmessage = null;
        
        constructor(public url: string) {}
        
        postMessage(data: any) {
          const workerIdx = data.workerId || 0;
          const timestamp = performance.now();
          
          if (data.action === 'process') {
            // Record start of processing
            (window as any).workerEvents.push({
              workerId: workerIdx,
              action: 'start',
              chunkId: data.chunkId,
              timestamp
            });
            
            // Simulate some processing time (10-20ms)
            setTimeout(() => {
              // Record completion
              (window as any).workerEvents.push({
                workerId: workerIdx,
                action: 'end',
                chunkId: data.chunkId,
                timestamp: performance.now()
              });
              
              // Send response back
              if (this.onmessage) {
                (this.onmessage as any)({
                  data: {
                    action: 'processed',
                    chunkId: data.chunkId,
                    data: new Uint8Array(100) // Mock data
                  }
                });
              }
            }, 10 + Math.random() * 10);
          }
        }
        
        terminate() {
          this.onmessage = null;
        }
      }
      
      // Replace Worker with tracking version
      (window as any).originalWorker = window.Worker;
      window.Worker = TrackedWorker as any;
    }, {
      fileSize,
      masterKey: Array.from(MASTER_KEY),
      fingerprint: FINGERPRINT
    });
    
    const result = await page.evaluate(async () => {
      try {
        const { ParallelEncryptionManager } = window as any;
        const { masterKey, fingerprint } = (window as any).testParams;
        const file = (window as any).fileHandle;
        
        // Force a higher worker count
        const manager = new ParallelEncryptionManager({
          compressionLevel: 6,
          keyFingerprint: fingerprint,
          masterKey: new Uint8Array(masterKey),
          useWebTransport: false,
          workerCount: 8
        });
        
        await manager.initialize();
        await manager.startUpload(file, 'parallel-evidence-test');
        
        // Analyze collected events
        const events = (window as any).workerEvents;
        
        // Find active periods for each worker
        interface WorkerEvent {
          workerId: string;
          action: string;
          chunkId: string;
          timestamp: number;
        }
        
        interface WorkerPeriod {
          start: number;
          end?: number;
          duration?: number;
        }
        
        const workerActivePeriods: Record<string, WorkerPeriod[]> = {};
        events.forEach((evt: WorkerEvent) => {
          if (!workerActivePeriods[evt.workerId]) {
            workerActivePeriods[evt.workerId] = [];
          }
          
          if (evt.action === 'start') {
            workerActivePeriods[evt.workerId].push({ start: evt.timestamp });
          } else if (evt.action === 'end') {
            // Find matching start event
            const period = workerActivePeriods[evt.workerId].find((p: WorkerPeriod) => !p.end);
            if (period) {
              period.end = evt.timestamp;
              period.duration = period.end - period.start;
            }
          }
        });
        
        // Find overlapping time periods between workers
        let totalOverlap = 0;
        const workers = Object.keys(workerActivePeriods);
        
        for (let i = 0; i < workers.length; i++) {
          for (let j = i + 1; j < workers.length; j++) {
            const periodsA = workerActivePeriods[workers[i]] || [];
            const periodsB = workerActivePeriods[workers[j]] || [];
            
            // Calculate overlaps between all periods of these two workers
            for (const a of periodsA) {
              if (!a.end) continue;
              
              for (const b of periodsB) {
                if (!b.end) continue;
                
                // Calculate overlap
                const overlapStart = Math.max(a.start, b.start);
                const overlapEnd = Math.min(a.end as number, b.end as number);
                const overlap = Math.max(0, overlapEnd - overlapStart);
                totalOverlap += overlap;
              }
            }
          }
        }
        
        return {
          totalWorkers: workers.length,
          eventCount: events.length,
          hasOverlap: totalOverlap > 0,
          totalOverlap
        };
        
      } finally {
        // Restore original Worker
        window.Worker = (window as any).originalWorker;
      }
    });
    
    // With multiple workers, we should see evidence of parallel execution
    expect(result.totalWorkers).toBeGreaterThan(1);
    expect(result.eventCount).toBeGreaterThan(0);
    
    // Most important: verify we observed overlap, which proves parallel execution
    expect(result.hasOverlap).toBe(true);
    expect(result.totalOverlap).toBeGreaterThan(0);
  });
});
