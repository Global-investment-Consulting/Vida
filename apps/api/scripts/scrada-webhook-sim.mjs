#!/usr/bin/env node
import { randomUUID, createHmac } from "node:crypto";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config();

const USER_AGENT = "vida-scrada-webhook-sim/1.0";

function parseArgs(argv) {
  const args = {
    url: process.env.STAGING_WEBHOOK_URL,
    documentId: undefined,
    status: "DELIVERED",
    externalReference: undefined
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--url" && argv[i + 1]) {
      args.url = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--url=")) {
      args.url = token.split("=", 2)[1];
      continue;
    }
    if (token === "--document-id" && argv[i + 1]) {
      args.documentId = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--document-id=")) {
      args.documentId = token.split("=", 2)[1];
      continue;
    }
    if (token === "--status" && argv[i + 1]) {
      args.status = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--status=")) {
      args.status = token.split("=", 2)[1];
      continue;
    }
    if (token === "--external-reference" && argv[i + 1]) {
      args.externalReference = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--external-reference=")) {
      args.externalReference = token.split("=", 2)[1];
    }
  }

  return args;
}

function resolveWebhookSecret() {
  const secret = process.env.SCRADA_WEBHOOK_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error("SCRADA_WEBHOOK_SECRET is required to sign the simulated webhook payload.");
  }
  return secret.trim();
}

function buildPayload({ documentId, status, externalReference }) {
  const now = new Date().toISOString();
  const reference = externalReference ?? documentId ?? `SCRADA-${randomUUID()}`;

  return {
    id: `sim-${randomUUID()}`,
    topic: "peppolOutboundDocument/statusUpdate",
    createdAt: now,
    data: {
      documentId: documentId ?? `sim-doc-${randomUUID().slice(0, 8)}`,
      status,
      previousStatus: "SENT",
      externalReference: reference,
      attempts: 1,
      occurredAt: now
    }
  };
}

function signPayload(secret, rawBody) {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

async function sendWebhook(url, secret, payload) {
  const rawBody = JSON.stringify(payload);
  const signature = signPayload(secret, rawBody);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "X-Scrada-Signature": signature
    },
    body: rawBody
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Webhook simulation failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  return {
    status: response.status,
    body: await response.text(),
    signature
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.url || args.url.trim().length === 0) {
    console.log("[scrada-webhook-sim] STAGING_WEBHOOK_URL not set, skipping simulation.");
    return;
  }

  const secret = resolveWebhookSecret();
  const payload = buildPayload({
    documentId: args.documentId,
    status: args.status ?? "DELIVERED",
    externalReference: args.externalReference
  });

  const result = await sendWebhook(args.url.trim(), secret, payload);

  console.log(
    JSON.stringify(
      {
        url: args.url.trim(),
        documentId: payload.data.documentId,
        status: payload.data.status,
        responseStatus: result.status,
        responseBodySnippet: result.body.slice(0, 200),
        timestamp: new Date().toISOString()
      },
      null,
      2
    )
  );
}

try {
  await main();
} catch (error) {
  console.error(
    "[scrada-webhook-sim] Failed to simulate webhook:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
}
