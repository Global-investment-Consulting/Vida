// scripts/wait-for-api.mjs
// Portable “wait until /healthz is OK” poller for CI and local use.
// Works on Node 18+ (uses the built-in global fetch).

const HEALTH_URL = process.env.HEALTH_URL || 'http://127.0.0.1:3001/healthz';
const TIMEOUT_MS = Number(process.env.WAIT_TIMEOUT_MS || 150000); // 2.5 min default
const INTERVAL_MS = Number(process.env.WAIT_INTERVAL_MS || 400);   // polling gap
const REQ_TIMEOUT_MS = Number(process.env.REQ_TIMEOUT_MS || 3000); // per-request timeout

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function pingOnce(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    const text = await res.text().catch(() => '');
    // Accept 200 OK and content that looks like 'ok'
    const okBody = (text || '').trim().toLowerCase();
    return res.ok && (okBody === 'ok' || okBody.includes('ok'));
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  const start = Date.now();
  console.log(`[wait-for-api] Waiting for ${HEALTH_URL} (timeout ${TIMEOUT_MS}ms)…`);

  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const healthy = await pingOnce(HEALTH_URL, REQ_TIMEOUT_MS);
      if (healthy) {
        console.log('[wait-for-api] ✅ API is up');
        process.exit(0);
      } else {
        console.log('[wait-for-api] not ready yet (HTTP responded but not OK)…');
      }
    } catch (err) {
      console.log(`[wait-for-api] not ready yet: ${err?.message || err}`);
    }
    await sleep(INTERVAL_MS);
  }

  console.error(`[wait-for-api] ❌ Timed out after ${TIMEOUT_MS}ms waiting for ${HEALTH_URL}`);
  process.exit(1);
})();
