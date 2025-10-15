// Portable "wait for API" used on both Windows + Linux runners.
const { setTimeout: sleep } = await import('node:timers/promises');
const url = process.env.HEALTH_URL || 'http://127.0.0.1:3001/healthz';
const timeoutMs = Number(process.env.WAIT_TIMEOUT_MS || 20000);

const started = Date.now();
process.stdout.write(`[wait-for-api] Waiting for ${url} (timeout ${timeoutMs}ms)…\n`);

while (Date.now() - started < timeoutMs) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) {
      process.stdout.write('[wait-for-api] ✅ API is up\n');
      process.exit(0);
    }
  } catch (_) {
    // ignore and retry
  }
  await sleep(500);
}

process.stderr.write('[wait-for-api] ❌ Timed out waiting for API\n');
process.exit(1);
