import { createHmac, timingSafeEqual } from "node:crypto";
import process from "node:process";
import express, { type Request, type Response, Router } from "express";
import { getOutboundUbl, getOutboundStatus } from "../../adapters/scrada.js";
import { saveArchiveObject } from "../../lib/storage.js";
import type {
  ScradaOutboundInfo,
  ScradaWebhookEvent,
  ScradaWebhookStatusUpdateEvent
} from "../../types/scrada.js";
import { hasEvent, rememberEvent } from "../../services/replayGuard.js";

const STATUS_SUCCESS = new Set([
  "DELIVERED",
  "DELIVERY_CONFIRMED",
  "SUCCESS",
  "ACCEPTED",
  "COMPLETED"
]);

function resolveSecret(): string | undefined {
  const secret = process.env.SCRADA_WEBHOOK_SECRET;
  if (!secret) {
    return undefined;
  }
  const trimmed = secret.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function allowUnsignedWebhook(): boolean {
  const raw = process.env.SCRADA_ALLOW_UNSIGNED_WEBHOOK;
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return ["1", "true", "yes", "y"].includes(normalized);
}

function decodeSignature(input?: string): Buffer | null {
  if (!input) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const withoutPrefix = trimmed.startsWith("sha256=") || trimmed.startsWith("SHA256=")
    ? trimmed.slice(7)
    : trimmed;

  const normalizedHex = withoutPrefix.replace(/[^0-9a-f]/gi, "");
  if (normalizedHex.length > 0 && normalizedHex.length % 2 === 0 && /^[0-9a-f]+$/i.test(normalizedHex)) {
    try {
      return Buffer.from(normalizedHex, "hex");
    } catch {
      /* noop */
    }
  }

  try {
    return Buffer.from(withoutPrefix, "base64");
  } catch {
    return null;
  }
}

function verifySignature(secret: string, rawBody: Buffer, headerValue?: string): boolean {
  if (!headerValue) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const provided = decodeSignature(headerValue);
  if (!provided || provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}

function normalizeStatus(value: string | undefined): string {
  return value?.toUpperCase().replace(/\s+/g, "_") ?? "";
}

function isStatusUpdateEvent(event: ScradaWebhookEvent): event is ScradaWebhookStatusUpdateEvent {
  if (event.topic !== "peppolOutboundDocument/statusUpdate") {
    return false;
  }
  const data = event.data;
  if (!data || typeof data !== "object") {
    return false;
  }
  return typeof data.documentId === "string" && typeof data.status === "string";
}

function buildEventKey(event: ScradaWebhookStatusUpdateEvent, documentId?: string): string {
  const parts = ["scrada"];
  const eventId = typeof event.id === "string" && event.id.trim().length > 0 ? event.id.trim() : undefined;
  if (eventId) {
    parts.push(eventId);
  }
  if (documentId) {
    parts.push(documentId);
  }
  const occurredAt =
    event.topic === "peppolOutboundDocument/statusUpdate"
      ? event.data?.occurredAt ?? event.data?.externalReference
      : undefined;
  if (occurredAt) {
    parts.push(occurredAt);
  }
  return parts.join(":");
}

async function archiveStatus(info: ScradaOutboundInfo, ublXml: string): Promise<void> {
  const documentId = info.documentId ?? info.peppolDocumentId ?? "unknown";
  const basePath = `archive/peppol/${documentId}`;

  await saveArchiveObject(`${basePath}.xml`, ublXml, {
    contentType: "application/xml",
    metadata: {
      status: info.status ?? "unknown"
    }
  });

  const statusRecord = {
    documentId: info.documentId,
    status: info.status,
    externalReference: info.externalReference,
    attempts: info.attempts,
    errorMessage: info.errorMessage,
    updatedAt: info.updatedAt ?? new Date().toISOString()
  };

  await saveArchiveObject(`${basePath}.json`, JSON.stringify(statusRecord, null, 2), {
    contentType: "application/json"
  });
}

async function handleStatusUpdate(
  event: ScradaWebhookStatusUpdateEvent,
  res: Response
): Promise<void> {
  const documentId = event.data.documentId;
  if (!documentId) {
    res.status(400).json({ error: "missing_document_id" });
    return;
  }

  const dedupeKey = buildEventKey(event, documentId);
  if (hasEvent(dedupeKey)) {
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  const normalizedStatus = normalizeStatus(event.data.status);
  if (!normalizedStatus) {
    res.status(400).json({ error: "missing_status" });
    return;
  }

  if (!STATUS_SUCCESS.has(normalizedStatus)) {
    rememberEvent(dedupeKey);
    res.json({ ok: true, archived: false });
    return;
  }

  try {
    const [ublXml, info] = await Promise.all([
      getOutboundUbl(documentId),
      getOutboundStatus(documentId)
    ]);
    await archiveStatus(info, ublXml);
    rememberEvent(dedupeKey);
    res.json({ ok: true, archived: true });
  } catch (error) {
    res.status(500).json({ error: "failed_to_archive", details: error instanceof Error ? error.message : "unknown" });
  }
}

function parseEvent(raw: Buffer): ScradaWebhookEvent {
  const text = raw.toString("utf8");
  if (!text) {
    throw new Error("empty_body");
  }
  return JSON.parse(text) as ScradaWebhookEvent;
}

export function createScradaWebhookRouter(): Router {
  const router = Router();

  router.use(
    "/api/webhooks/scrada",
    express.raw({
      type: "application/json",
      limit: "1mb"
    })
  );

  router.get("/api/webhooks/scrada/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.post("/api/webhooks/scrada", async (req: Request, res: Response) => {
    const rawBody =
      Buffer.isBuffer(req.body) && req.body.length > 0
        ? req.body
        : typeof req.body === "string"
          ? Buffer.from(req.body, "utf8")
          : Buffer.from("");

    const secret = resolveSecret();
    const signature = req.header("x-scrada-signature") ?? req.header("X-Scrada-Signature");
    if (secret && signature) {
      if (!verifySignature(secret, rawBody, signature)) {
        res.status(401).json({ error: "invalid_signature" });
        return;
      }
    } else if (secret && !allowUnsignedWebhook()) {
      res.status(401).json({ error: "missing_signature" });
      return;
    }

    let event: ScradaWebhookEvent;
    try {
      event = parseEvent(rawBody);
    } catch (error) {
      res.status(400).json({ error: "invalid_json", details: error instanceof Error ? error.message : String(error) });
      return;
    }

    if (isStatusUpdateEvent(event)) {
      await handleStatusUpdate(event, res);
      return;
    }

    res.json({ ok: true, ignored: true });
  });

  return router;
}
