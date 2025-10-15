// Portable wait-for-api script (Node 18/20+)
// Waits until HEALTH_URL responds 200 OK or timeout reached

const url = process.env.HEALTH_URL || 'http://127.0.0.1:3001/healthz';
const timeoutMs = Number(process.env.WAIT_TIMEOUT_MS || '30000');
const intervalMs = 500;
const deadline = Date.now() + timeoutMs;

console.log(`[wait-for-api] Waiting for ${url} (timeout ${timeoutMs}ms)…`);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function check() {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

(async () => {
  while (Date.now() < deadline) {
    if (await check()) {
      console.log('[wait-for-api] ✅ API is up');
      process.exit(0);
    }
    await sleep(intervalMs);
  }
  console.error('[wait-for-api] ❌ Timed out waiting for API');
  process.exit(1);
})();
