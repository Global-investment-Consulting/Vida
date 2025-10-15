// scripts/wait-for-api.mjs
// Portable wait-for-HTTP-200 with env-configurable URL & timeouts (Node 18+ ESM)

import fetch from "node-fetch";

const HEALTH_URL = process.env.HEALTH_URL || "http://127.0.0.1:3001/healthz";
const TIMEOUT_MS = Number(process.env.WAIT_TIMEOUT_MS || 150000); // 150s
const INTERVAL_MS = Number(process.env.WAIT_INTERVAL_MS || 1000);  // 1s
const START = Date.now();

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function tryOnce() {
  try {
    const res = await fetch(HEALTH_URL, { timeout: 3000 });
    if (res.ok) return true;
    console.log(`[wait-for-api] ${HEALTH_URL} → ${res.status} ${res.statusText}`);
    return false;
  } catch (e) {
    console.log(`[wait-for-api] not ready yet: ${e.message}`);
    return false;
  }
}

(async () => {
  console.log(`[wait-for-api] Waiting for ${HEALTH_URL} (timeout ${TIMEOUT_MS}ms)…`);
  while (Date.now() - START < TIMEOUT_MS) {
    if (await tryOnce()) {
      console.log("[wait-for-api] ✅ API is up");
      process.exit(0);
    }
    await sleep(INTERVAL_MS);
  }
  console.error("[wait-for-api] ❌ Timed out waiting for API");
  process.exit(1);
})();
