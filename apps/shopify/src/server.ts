import crypto from "node:crypto";
import express from "express";
import dotenv from "dotenv";
import { orderToInvoice, type ShopifyOrder } from "./mapper.js";

dotenv.config();

const PORT = Number.parseInt(process.env.PORT ?? "4001", 10);
const VIDA_BASE_URL = (process.env.VIDA_PUBLIC_API_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
const VIDA_API_KEY = process.env.VIDA_PUBLIC_API_KEY ?? "";
const SHOPIFY_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET ?? "";

if (!VIDA_API_KEY) {
  console.warn("[shopify-app] VIDA_PUBLIC_API_KEY not configured; forwarding will fail.");
}
if (!SHOPIFY_SECRET) {
  console.warn("[shopify-app] SHOPIFY_WEBHOOK_SECRET not configured; signature validation disabled.");
}

const app = express();
const rawParser = express.raw({ type: "*/*", limit: "1mb" });

function verifySignature(rawBody: Buffer, secret: string, incoming?: string): boolean {
  if (!secret || !incoming) {
    return false;
  }
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBody);
  const digest = hmac.digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(incoming));
}

async function forwardToVida(body: ShopifyOrder) {
  const payload = orderToInvoice(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": VIDA_API_KEY,
    "Idempotency-Key": `shopify-${body.id}`
  };
  const response = await fetch(`${VIDA_BASE_URL}/v0/invoices`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Vida API error: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

app.post("/webhooks/orders", rawParser, async (req, res) => {
  if (!SHOPIFY_SECRET) {
    res.status(503).json({ error: "shopify_secret_unset" });
    return;
  }
  const signature = req.header("X-Shopify-Hmac-Sha256") ?? req.header("x-shopify-hmac-sha256");
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
  if (!verifySignature(rawBody, SHOPIFY_SECRET, signature)) {
    res.status(401).json({ error: "invalid_signature" });
    return;
  }
  let orderPayload: ShopifyOrder;
  try {
    orderPayload = JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    console.error("[shopify-app] invalid JSON payload", error);
    res.status(400).json({ error: "invalid_payload" });
    return;
  }
  try {
    const submission = await forwardToVida(orderPayload);
    res.status(202).json({ ok: true, submission });
  } catch (error) {
    console.error("[shopify-app] forwarding failed", error);
    res.status(502).json({ error: "forward_failed" });
  }
});

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    vidaConfigured: Boolean(VIDA_API_KEY),
    shopifySecret: Boolean(SHOPIFY_SECRET)
  });
});

app.listen(PORT, () => {
  console.log(`[shopify-app] listening on http://localhost:${PORT}`);
});
