// Portable wait-for-api script (Node 18/20+)
// Uses global fetch; waits until HEALTH_URL responds 200 or timeout

const url = process.env.HEALTH_URL || 'http://127.0.0.1:3001/healthz';
const timeoutMs = Number(process.env.WAIT_TIMEOUT_MS || '30000');
const intervalMs = 500;

const deadline = Date.now() + timeoutMs;

process.stdout.write(`[wait-for-api] Waiting for ${url} (timeout ${timeoutMs}ms)…\n`);

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function ok() {
  try {
    const res = await fetch(url, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

(async () => {
  while (Date.now() < deadline) {
    if (await ok()) {
      process.stdout.write('[wait-for-api] ✅ API is up\n');
      process.exit(0);
    }
    await sleep(intervalMs);
  }
  process.stderr.write('[wait-for-api] ❌ Timed out waiting for API\n');
  process.exit(1);
})();
