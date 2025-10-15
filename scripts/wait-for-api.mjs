// scripts/wait-for-api.mjs
import fetch from "node-fetch";

const HEALTH_URL = process.env.HEALTH_URL || "http://127.0.0.1:3001/healthz";
const TIMEOUT_MS = Number(process.env.WAIT_TIMEOUT_MS || 150000);
const INTERVAL_MS = 1000;

const started = Date.now();

async function probeOnce() {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(HEALTH_URL, { signal: controller.signal });
    const txt = await res.text();
    if (res.ok && typeof txt === "string" && txt.includes("ok")) {
      return true;
    }
    throw new Error(`status=${res.status} body=${JSON.stringify(txt)}`);
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  /* eslint no-constant-condition: 0 */
  while (true) {
    try {
      const ok = await probeOnce();
      if (ok) {
        console.log(`[wait-for-api] ✅ API is up`);
        process.exit(0);
      }
    } catch (err) {
      const msg =
        err?.name === "AbortError" ? "request timeout" : String(err?.message || err);
      console.log(`[wait-for-api] not ready yet: ${msg}`);
    }

    if (Date.now() - started > TIMEOUT_MS) {
      console.error(`[wait-for-api] ❌ timed out after ${TIMEOUT_MS}ms waiting for ${HEALTH_URL}`);
      process.exit(1);
    }
    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }
})();
