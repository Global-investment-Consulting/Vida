// scripts/wait-for-api.mjs
import fetch from "node-fetch";

const HEALTH_URL = process.env.HEALTH_URL || "http://127.0.0.1:3001/healthz";
const TIMEOUT_MS = parseInt(process.env.WAIT_TIMEOUT_MS || "150000", 10); // 2.5 min
const INTERVAL_MS = 500;

const start = Date.now();

console.log(`[wait-for-api] Waiting for ${HEALTH_URL} (timeout ${TIMEOUT_MS}ms)…`);

while (true) {
  try {
    const res = await fetch(HEALTH_URL, { method: "GET" });
    const text = await res.text();
    if (res.ok && (text === "ok" || text.trim() === "ok")) {
      console.log("[wait-for-api] ✅ API is up");
      process.exit(0);
    } else {
      console.log(`[wait-for-api] not ready yet: status ${res.status} body "${text}"`);
    }
  } catch (err) {
    console.log(`[wait-for-api] not ready yet: ${err.message}`);
  }

  if (Date.now() - start > TIMEOUT_MS) {
    console.error(`[wait-for-api] ❌ Timed out after ${TIMEOUT_MS}ms`);
    process.exit(1);
  }

  await new Promise(r => setTimeout(r, INTERVAL_MS));
}
