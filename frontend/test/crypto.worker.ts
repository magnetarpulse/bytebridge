// Minimal worker for parallel.worker.node.test.ts
import { parentPort, workerData } from 'worker_threads';
import sodium from 'libsodium-wrappers';

(async () => {
  await sodium.ready;
  // Just simulate some work based on the range
  const { start, end, file, masterKey, context } = workerData;
  
  // Report back success
  if (parentPort) {
    parentPort.postMessage({
      type: 'complete',
      processedBytes: end - start
    });
  }
})();