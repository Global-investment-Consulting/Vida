// Portable wait-for-api: respects HEALTH_URL and WAIT_TIMEOUT_MS.
// Defaults: http://127.0.0.1:3001/healthz, 150000 ms
const HEALTH_URL = process.env.HEALTH_URL || 'http://127.0.0.1:3001/healthz';
const TIMEOUT_MS = Number(process.env.WAIT_TIMEOUT_MS || 150000);
const INTERVAL_MS = 1000;

function now() { return new Date().toISOString(); }

async function ping(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const text = (await res.text()).trim();
    return /ok/i.test(text);
  } catch {
    clearTimeout(timer);
    return false;
  }
}

async function wait() {
  const start = Date.now();
  console.log(`[wait-for-api] Waiting for ${HEALTH_URL} (timeout ${TIMEOUT_MS}ms)…`);
  while (Date.now() - start < TIMEOUT_MS) {
    // eslint-disable-next-line no-await-in-loop
    if (await ping(HEALTH_URL)) {
      console.log('[wait-for-api] ✅ API is up');
      process.exit(0);
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }
  console.error(`[wait-for-api] ❌ Timed out after ${TIMEOUT_MS}ms`);
  process.exit(1);
}

wait();
