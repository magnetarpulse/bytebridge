/**
 * @jest-environment node
 */
import { Worker } from 'worker_threads';
import sodium from 'libsodium-wrappers';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Fix for ESM modules which don't have __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let MASTER: Uint8Array;
const FILE_PATH = path.join(__dirname, 'large.bin'); // 100 MB fixture created once

beforeAll(async () => {
  await sodium.ready;
  MASTER = sodium.crypto_secretstream_xchacha20poly1305_keygen();
  if (!fs.existsSync(FILE_PATH)) {
    const buf = Buffer.allocUnsafe(100 * 1024 * 1024).fill(42);
    fs.writeFileSync(FILE_PATH, buf);
  }
});

describe('Parallel worker speedup (Node worker_threads)', () => {
  // Skip this test for now, as it's too environment-dependent
  it.skip('parallel workers reduce wall-clock vs single worker', async () => {
    const single = await encryptRange(FILE_PATH, 0, -1, 1);
    const parallel = await encryptRange(FILE_PATH, 0, -1, 4);
    // Expect ~3× faster on 4 cores
    expect(parallel.duration).toBeLessThan(single.duration / 2.5);
  }, 30000);
});

async function encryptRange(file: string, start: number, end: number, workerCount: number) {
  const ranges = splitRange(start, end === -1 ? fs.statSync(file).size : end, workerCount);
  const workers = ranges.map((r, i) => new Worker(path.join(__dirname, 'crypto.worker.ts'), {
    workerData: { file, ...r, masterKey: Buffer.from(MASTER), context: `worker-${i}` }
  }));

  const startTime = Date.now();
  await Promise.all(workers.map(w => new Promise(res => w.once('message', res))));
  workers.forEach(w => w.terminate());
  return { duration: Date.now() - startTime };
}

function splitRange(start: number, end: number, n: number) {
  const len = end - start;
  const size = Math.floor(len / n);
  return Array.from({ length: n }, (_, i) => ({
    start: start + i * size,
    end: i === n - 1 ? end : start + (i + 1) * size
  }));
}
