// Portable wait-for-api: uses global fetch (Node 18+)
const HEALTH_URL = process.env.HEALTH_URL || "http://127.0.0.1:3001/healthz";
const TIMEOUT_MS = Number(process.env.WAIT_TIMEOUT_MS || 150000);
const INTERVAL_MS = 750;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const deadline = Date.now() + TIMEOUT_MS;
console.log(`[wait-for-api] Waiting for ${HEALTH_URL} (timeout ${TIMEOUT_MS}ms)…`);

let lastErr;
while (Date.now() < deadline) {
  try {
    const res = await fetch(HEALTH_URL, { cache: "no-store" });
    const text = (await res.text()).trim();
    if (res.ok && text === "ok") {
      console.log("[wait-for-api] ✅ API is up");
      process.exit(0);
    } else {
      lastErr = new Error(`HTTP ${res.status} body=${JSON.stringify(text)}`);
    }
  } catch (e) {
    lastErr = e;
  }
  console.log(`[wait-for-api] not ready yet: ${lastErr?.message}`);
  await sleep(INTERVAL_MS);
}

console.error(`[wait-for-api] ❌ Timed out after ${TIMEOUT_MS}ms`);
if (lastErr) console.error(lastErr);
process.exit(1);
