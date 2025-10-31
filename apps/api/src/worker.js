// file: src/worker.js
// Minimal webhook delivery worker for the ViDA MVP (no external queue).
// Polls the Event table and POSTs each new event to all webhook endpoints.
// Safe to run alongside the API. Uses in-memory cursor (reset on restart).

import 'dotenv/config';
import { prisma } from './db.js';

const TENANT_SLUG = process.env.TENANT_SLUG || 'demo-tenant';
const POLL_MS = parseInt(process.env.WEBHOOK_POLL_MS || '2000', 10);
const MAX_RETRIES = parseInt(process.env.WEBHOOK_MAX_RETRIES || '5', 10);

let tenantId = null;
let cursorTime = null;          // ISO timestamp of last processed event
const inFlight = new Map();     // eventId -> attemptCount

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function httpPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'vida-mvp-webhook-worker/0.1',
    },
    body: JSON.stringify(body),
  });
  return res;
}

async function boot() {
  // Resolve tenant
  const t = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!t) {
    console.error(`[worker] Tenant slug "${TENANT_SLUG}" not found. Create it first.`);
    process.exit(1);
  }
  tenantId = t.id;

  // Set initial cursor = last event time (so we don't replay old ones)
  const last = await prisma.event.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  cursorTime = last?.createdAt?.toISOString() || new Date().toISOString();

  console.log(
    `[worker] started | tenant=${TENANT_SLUG} poll=${POLL_MS}ms maxRetries=${MAX_RETRIES} cursor=${cursorTime}`
  );
}

async function fetchNewEvents() {
  // Get events newer than cursorTime, oldest first for ordering
  const rows = await prisma.event.findMany({
    where: { tenantId, createdAt: { gt: new Date(cursorTime) } },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  return rows;
}

async function deliverToAllEndpoints(ev) {
  // Load endpoints each time (small table, fine for MVP). Cache if you like.
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { tenantId, disabled: { not: true } },
    orderBy: { createdAt: 'asc' },
  });

  if (!endpoints.length) {
    console.warn(`[worker] no endpoints for tenant; event ${ev.id} not delivered`);
    return;
  }

  const envelope = {
    id: crypto.randomUUID(),
    type: ev.type,
    data: ev.data,                 // JSON column
    created_at: ev.createdAt.toISOString(),
  };

  for (const ep of endpoints) {
    try {
      const res = await httpPost(ep.url, envelope);
      if (res.ok) {
        console.log(`[ok] event ${ev.id} -> ${ep.url} (${res.status})`);
      } else {
        console.warn(`[warn] event ${ev.id} -> ${ep.url} HTTP ${res.status}`);
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      // Retry in-process with simple backoff
      const key = `${ev.id}|${ep.id}`;
      const attempt = (inFlight.get(key) || 0) + 1;
      inFlight.set(key, attempt);

      if (attempt <= MAX_RETRIES) {
        const delay = Math.min(30000, 1000 * Math.pow(2, attempt - 1)); // 1s,2s,4s,8s,...
        console.log(
          `[retry] event ${ev.id} -> ${ep.url} attempt=${attempt}/${MAX_RETRIES} in ${delay}ms (${err.message})`
        );
        setTimeout(async () => {
          try {
            const res2 = await httpPost(ep.url, envelope);
            if (res2.ok) {
              console.log(`[ok] event ${ev.id} (retry ${attempt}) -> ${ep.url} (${res2.status})`);
              inFlight.delete(key);
            } else {
              throw new Error(`HTTP ${res2.status}`);
            }
          } catch (err2) {
            // Keep counter; next main loop may retry again (we keep entry in map)
            console.warn(
              `[retry-fail] event ${ev.id} -> ${ep.url} attempt=${attempt} (${err2.message})`
            );
          }
        }, delay);
      } else {
        console.error(
          `[dead] event ${ev.id} -> ${ep.url} exceeded ${MAX_RETRIES} attempts (${err.message})`
        );
        inFlight.delete(key);
      }
    }
  }
}

async function loop() {
  while (true) {
    try {
      const events = await fetchNewEvents();
      for (const ev of events) {
        await deliverToAllEndpoints(ev);
        // Advance cursor after processing this event
        cursorTime = ev.createdAt.toISOString();
      }
    } catch (e) {
      console.error('[worker] loop error:', e.message);
    }
    await sleep(POLL_MS);
  }
}

boot().then(loop).catch((e) => {
  console.error('[worker] failed to start:', e);
  process.exit(1);
});
