import cors from "cors";
import express, { type Request, type Response } from "express";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { shopifyToOrder } from "./connectors/shopify.js";
import { wooToOrder } from "./connectors/woocommerce.js";
import { orderToInvoiceXml } from "./peppol/convert.js";
import { parseOrder, type OrderT } from "./schemas/order.js";
import { validateUbl } from "./validation/ubl.js";
import { listHistory, recordHistory } from "./history/logger.js";
import { recordInvoiceRequest } from "./history/invoiceRequestLog.js";
import { getAdapter } from "./apadapters/index.js";
import { getInvoiceStatus, setInvoiceStatus } from "./history/invoiceStatus.js";
import { sendWithRetry } from "./services/apDelivery.js";
import { hasEvent, rememberEvent } from "./services/replayGuard.js";
import {
  PORT,
  isApSendOnCreateEnabled,
  isUblValidationEnabled,
  resolveApWebhookSecret
} from "./config.js"; // migrated
import { requireApiKey } from "./mw_auth.js"; // migrated
import { createApiKeyRateLimiter } from "./middleware/rateLimiter.js";
import { getCachedInvoice, storeCachedInvoice } from "./services/idempotencyCache.js";
import {
  incrementApWebhookFail,
  incrementApWebhookOk,
  incrementInvoicesCreated,
  observeApWebhookLatency,
  renderMetrics
} from "./metrics.js";
import { getStorage } from "./storage/index.js";
import type { ApDeliveryStatus } from "./apadapters/types.js";
import { invoicesV0Router } from "./routes/invoicesV0.js";
import { shopifyWebhookRouter } from "./routes/shopifyWebhook.js";

type SupportedSource = "shopify" | "woocommerce" | "order";

class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function buildOrderFromSource(
  source: SupportedSource | undefined,
  payload: unknown,
  supplier: OrderT["supplier"] | undefined,
  options: { defaultVatRate?: number; currencyMinorUnit?: number }
): OrderT {
  const normalizedSource = source?.toLowerCase() as SupportedSource | undefined;

  if (!payload) {
    throw new HttpError("payload is required", 400);
  }

  if (normalizedSource === "shopify") {
    if (!supplier?.name) {
      throw new HttpError("supplier.name is required for Shopify orders", 422);
    }
    return shopifyToOrder(payload as Parameters<typeof shopifyToOrder>[0], {
      supplier,
      defaultVatRate: options.defaultVatRate,
      currencyMinorUnit: options.currencyMinorUnit
    });
  }

  if (normalizedSource === "woocommerce") {
    if (!supplier?.name) {
      throw new HttpError("supplier.name is required for WooCommerce orders", 422);
    }
    return wooToOrder(payload as Parameters<typeof wooToOrder>[0], {
      supplier,
      defaultVatRate: options.defaultVatRate,
      currencyMinorUnit: options.currencyMinorUnit
    });
  }

  if (normalizedSource && normalizedSource !== "order") {
    throw new HttpError(`unsupported source '${normalizedSource}'`, 422);
  }

  return parseOrder(payload);
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const maybeDistRoot = path.resolve(moduleDir, "..");
const ROOT_DIR = path.basename(maybeDistRoot) === "dist" ? path.resolve(maybeDistRoot, "..") : maybeDistRoot;

const OUTPUT_DIR = path.join(ROOT_DIR, "output");
const invoiceIndex = new Map<string, string>();
const RATE_LIMIT_PER_MINUTE = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const webhookRateLimiter = createApiKeyRateLimiter({
  limit: RATE_LIMIT_PER_MINUTE,
  windowMs: RATE_LIMIT_WINDOW_MS
});
const docsPublicDir = path.join(ROOT_DIR, "public", "docs");
const docsAssetsDir = path.join(ROOT_DIR, "docs");
const docsIndexPath = path.join(docsPublicDir, "index.html");

export const app = express();
app.use(cors());
const jsonBodyParser = express.json({ limit: "1mb" });
const webhookRawParser = express.raw({ type: "*/*", limit: "1mb" });

app.use((req, res, next) => {
  if (req.path === "/ap/status-webhook") {
    webhookRawParser(req, res, next);
    return;
  }
  jsonBodyParser(req, res, next);
});
app.use(
  "/docs",
  express.static(docsPublicDir, { fallthrough: true, index: "index.html", redirect: false })
);
app.use(
  "/docs",
  express.static(docsAssetsDir, { redirect: false })
);

app.get(["/docs", "/docs/"], (_req, res, next) => {
  res.sendFile(docsIndexPath, (error) => {
    if (error) {
      next(error);
    }
  });
});

app.get("/docs/openapi.yaml", (_req, res, next) => {
  const specPath = path.join(docsAssetsDir, "openapi.yaml");
  res.sendFile(specPath, (error) => {
    if (error) {
      next(error);
    }
  });
});

app.get("/docs/postman_collection.json", (_req, res, next) => {
  const collectionPath = path.join(docsAssetsDir, "postman_collection.json");
  res.sendFile(collectionPath, (error) => {
    if (error) {
      next(error);
    }
  });
});

app.get(["/health", "/_health", "/healthz", "/healthz/"], (_req, res) => {
  res.status(200).type("text/plain").send("ok");
});

app.get("/_version", (_req, res) => {
  res.json({
    version: process.env.npm_package_version ?? undefined,
    commit: process.env.GITHUB_SHA ?? process.env.COMMIT_SHA ?? "local",
    builtAt: process.env.BUILT_AT ?? new Date().toISOString()
  });
});

app.get("/", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use(invoicesV0Router);
app.use(shopifyWebhookRouter);

type ValidationErrorShape = {
  path: string;
  msg: string;
  ruleId?: string;
};

app.post("/api/invoice", requireApiKey, async (req: Request, res: Response) => {
  const rawRequestId = req.header("x-request-id") ?? randomUUID();
  const requestId = rawRequestId.trim() || randomUUID();
  const tenantHeader = req.header("x-vida-tenant") ?? undefined;
  const tenantFromBody =
    typeof req.body?.tenantId === "string" && req.body.tenantId.trim().length > 0
      ? req.body.tenantId.trim()
      : undefined;
  const tenantId = tenantHeader?.trim() || tenantFromBody;
  const createdAt = new Date().toISOString();
  res.setHeader("X-Request-Id", requestId);

  try {
    const order = parseOrder(req.body);
    const xml = await orderToInvoiceXml(order);
    const validation = validateUbl(xml);
    const digest = createHash("sha256").update(xml).digest("hex");
    const errors = validation.errors as ValidationErrorShape[];

    if (!validation.ok) {
      const primaryError = errors[0];
      await recordInvoiceRequest({
        requestId,
        tenantId,
        status: "INVALID",
        xmlSha256: digest,
        createdAt
      });
      const summary =
        primaryError?.msg ?? "BIS 3.0 validation failed";
      console.info(
        `[api/invoice] requestId=${requestId} status=INVALID digest=${digest.slice(0, 12)} errors=${errors.length} first="${summary}"`
      );
      const responseBody: {
        code: string;
        message: string;
        field?: string;
        ruleId?: string;
      } = {
        code: "BIS_RULE_VIOLATION",
        message: summary
      };
      if (primaryError?.path && primaryError.path !== "/") {
        responseBody.field = primaryError.path;
      }
      if (primaryError?.ruleId) {
        responseBody.ruleId = primaryError.ruleId;
      }
      return res.status(422).json(responseBody);
    }

    await recordInvoiceRequest({
      requestId,
      tenantId,
      status: "OK",
      xmlSha256: digest,
      createdAt
    });
    console.info(
      `[api/invoice] requestId=${requestId} status=OK digest=${digest.slice(0, 12)} errors=${errors.length}`
    );
    res.type("application/xml; charset=utf-8");
    return res.send(xml);
  } catch (error) {
    if (error instanceof ZodError) {
      const firstIssue = error.issues[0];
      await recordInvoiceRequest({
        requestId,
        tenantId,
        status: "INVALID",
        createdAt
      });
      console.info(
        `[api/invoice] requestId=${requestId} status=INVALID payloadError=${firstIssue?.message ?? "unknown"}`
      );
      return res.status(400).json({
        code: "INVALID_ORDER",
        message: firstIssue?.message ?? "Invalid order payload",
        field: firstIssue?.path?.length ? firstIssue.path.map(String).join(".") : undefined
      });
    }

    console.error(`[api/invoice] requestId=${requestId} status=ERROR`, error);
    return res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "Failed to generate invoice"
    });
  }
});

app.post(
  "/webhook/order-created",
  requireApiKey,
  webhookRateLimiter,
  async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const requestId = randomUUID();
    const tenantHeader = req.header("x-vida-tenant") ?? undefined;
    const tenantFromBody =
      typeof req.body?.tenantId === "string" && req.body.tenantId.trim().length > 0
        ? req.body.tenantId.trim()
        : undefined;
    const tenantId = tenantHeader?.trim() || tenantFromBody;
    const rawSource = req.body?.source;
    const sourceLabel = typeof rawSource === "string" ? rawSource.toLowerCase() : undefined;
    const apiKey = typeof res.locals.apiKey === "string" ? res.locals.apiKey : undefined;
    const headerIdempotencyKey = req.header("idempotency-key") ?? req.header("x-idempotency-key");
    const idempotencyKey = headerIdempotencyKey?.trim() ? headerIdempotencyKey.trim() : undefined;

    let order: OrderT | undefined;
    let invoiceId: string | undefined;
    let invoicePath: string | undefined;
    let errorMessage: string | undefined;
    let responseSent = false;
    let peppolStatus: string | undefined;
    let peppolId: string | undefined;
    let validationErrors: { path: string; msg: string }[] | undefined;
    let skipHistoryLog = false;

    try {
      if (apiKey && idempotencyKey) {
        const cached = getCachedInvoice(apiKey, idempotencyKey);
        if (cached) {
          invoiceId = cached.invoiceId;
          invoicePath = cached.invoicePath;
          invoiceIndex.set(invoiceId, invoicePath);
          res.setHeader("X-Idempotency-Cache", "HIT");
          res.json({ invoiceId });
          responseSent = true;
          skipHistoryLog = true;
          return;
        }
      }

      const { source, payload, supplier, defaultVatRate, currencyMinorUnit } = req.body ?? {};

      order = buildOrderFromSource(source, payload, supplier, {
        defaultVatRate,
        currencyMinorUnit
      });

      const xml = await orderToInvoiceXml(order);

      if (isUblValidationEnabled()) {
        const validation = validateUbl(xml);
        if (!validation.ok) {
          validationErrors = validation.errors;
          throw new HttpError("UBL validation failed", 422);
        }
      }

      await mkdir(OUTPUT_DIR, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      invoiceId = `invoice_${timestamp}`;
      invoicePath = path.join(OUTPUT_DIR, `${invoiceId}.xml`);

      await writeFile(invoicePath, xml, "utf8");
      invoiceIndex.set(invoiceId, invoicePath);
      incrementInvoicesCreated();
      console.info(`[webhook] Generated invoice at ${invoicePath}`);

      if (isApSendOnCreateEnabled()) {
        try {
          if (!invoiceId) {
            throw new Error("Missing invoice id for AP delivery");
          }
          await sendWithRetry({
            tenant: tenantId,
            invoiceId,
            ublXml: xml,
            requestId,
            order
          });
          const deliveryStatus = await getInvoiceStatus(tenantId, invoiceId);
          peppolStatus = deliveryStatus?.status;
          peppolId = deliveryStatus?.providerId;
        } catch (apError) {
          const message = apError instanceof Error ? apError.message : "AP send failed";
          throw new HttpError(`AP send failed: ${message}`, 502);
        }
      }

      if (apiKey && idempotencyKey && invoiceId && invoicePath) {
        storeCachedInvoice(apiKey, idempotencyKey, { invoiceId, invoicePath });
        res.setHeader("X-Idempotency-Cache", "MISS");
      }

      res.json({ invoiceId });
      responseSent = true;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Failed to generate invoice";

      if (error instanceof ZodError) {
        res.status(400).json({ error: "Invalid order payload", details: error.issues });
        responseSent = true;
      } else if (error instanceof HttpError) {
        const payload: Record<string, unknown> = { error: error.message };
        if (error.status === 422 && validationErrors?.length) {
          payload.details = validationErrors;
        }
        res.status(error.status).json(payload);
        responseSent = true;
      } else if (error instanceof Error) {
        res.status(400).json({ error: error.message });
        responseSent = true;
      } else {
        res.status(500).json({ error: "Failed to generate invoice" });
        responseSent = true;
      }
    } finally {
      if (skipHistoryLog) {
        return;
      }
      const meta = order?.meta as Record<string, unknown> | undefined;
      const originalOrderId =
        typeof meta?.originalOrderId === "string" || typeof meta?.originalOrderId === "number"
          ? (meta.originalOrderId as string | number)
          : undefined;
      try {
        await recordHistory({
          requestId,
          timestamp: new Date().toISOString(),
          source: sourceLabel,
          orderNumber: order?.orderNumber,
          originalOrderId,
          tenantId,
          status: responseSent && !errorMessage ? "ok" : "error",
          invoiceId,
          invoicePath,
          durationMs: Date.now() - startedAt,
          error: responseSent && !errorMessage ? undefined : errorMessage,
          peppolStatus,
          peppolId,
          validationErrors
        });
      } catch (historyError) {
        console.error("[history] failed to record event", historyError);
      }
    }
  }
);

const VALID_AP_STATUSES = new Set(["queued", "sent", "delivered", "error"]);
const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

function parseEventTimestamp(header: string | undefined): number | null {
  if (!header) {
    return null;
  }
  const trimmed = header.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    if (trimmed.length <= 10) {
      return numeric * 1000;
    }
    return numeric;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function verifySignature(rawBody: Buffer, secret: string, signatureHeader: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const candidates: Buffer[] = [];
  const trimmed = signatureHeader.trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    try {
      candidates.push(Buffer.from(trimmed, "hex"));
    } catch {
      // ignore invalid hex
    }
  }
  try {
    candidates.push(Buffer.from(trimmed, "base64"));
  } catch {
    // ignore invalid base64
  }

  for (const candidate of candidates) {
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return true;
    }
  }
  return false;
}

app.post("/ap/status-webhook", requireApiKey, async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const rawBody =
    Buffer.isBuffer(req.body) && req.body.length > 0
      ? req.body
      : typeof req.body === "string"
        ? Buffer.from(req.body, "utf8")
        : Buffer.from("");
  const secret = resolveApWebhookSecret();

  if (!secret) {
    console.error(`[ap/webhook] requestId=${requestId} status=ERROR missing_secret`);
    res.status(500).json({ error: "webhook_secret_unset" });
    return;
  }

  const signatureHeader = req.header("x-ap-signature");
  if (!signatureHeader || !verifySignature(rawBody, secret, signatureHeader)) {
    incrementApWebhookFail();
    console.warn(`[ap/webhook] requestId=${requestId} status=INVALID signature`);
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  const eventId = req.header("x-event-id")?.trim();
  if (!eventId) {
    incrementApWebhookFail();
    res.status(400).json({ error: "missing_event_id" });
    return;
  }

  const eventTimestampMs = parseEventTimestamp(req.header("x-event-timestamp"));
  if (eventTimestampMs === null) {
    incrementApWebhookFail();
    res.status(400).json({ error: "invalid_event_timestamp" });
    return;
  }

  const now = Date.now();
  if (Math.abs(now - eventTimestampMs) > WEBHOOK_MAX_AGE_MS) {
    incrementApWebhookFail();
    res.status(401).json({ error: "stale_event" });
    return;
  }

  if (hasEvent(eventId, now)) {
    incrementApWebhookOk();
    observeApWebhookLatency(Date.now() - startedAt);
    res.json({ ok: true, duplicate: true });
    return;
  }

  let payload: unknown;
  if (rawBody.length === 0) {
    payload = {};
  } else {
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch (error) {
      incrementApWebhookFail();
      console.error(`[ap/webhook] requestId=${requestId} status=INVALID json`, error);
      res.status(400).json({ error: "invalid_json" });
      return;
    }
  }

  const body = payload as Record<string, unknown>;
  const tenant =
    typeof body?.tenant === "string" && body.tenant.trim().length > 0
      ? body.tenant.trim()
      : undefined;
  const invoiceId =
    typeof body?.invoiceId === "string" && body.invoiceId.trim().length > 0
      ? body.invoiceId.trim()
      : undefined;
  const providerId =
    typeof body?.providerId === "string" && body.providerId.trim().length > 0
      ? body.providerId.trim()
      : undefined;
  const status =
    typeof body?.status === "string" && body.status.trim().length > 0
      ? body.status.trim().toLowerCase()
      : undefined;
  const attempts =
    typeof body?.attempts === "number" && Number.isFinite(body.attempts)
      ? Math.max(0, Math.floor(body.attempts))
      : undefined;
  const lastError =
    typeof body?.error === "string" && body.error.trim().length > 0
      ? body.error.trim()
      : undefined;

  if (!invoiceId || !providerId || !status || !VALID_AP_STATUSES.has(status)) {
    incrementApWebhookFail();
    console.error(
      `[ap/webhook] requestId=${requestId} tenant=${tenant ?? "unknown"} invoiceId=${invoiceId ?? "missing"} status=INVALID payload`
    );
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  try {
    await setInvoiceStatus({
      tenant,
      invoiceId,
      providerId,
      status: status as ApDeliveryStatus,
      attempts,
      lastError
    });
    rememberEvent(eventId, now);
    incrementApWebhookOk();
    observeApWebhookLatency(Date.now() - startedAt);
    console.info(
      `[ap/webhook] requestId=${requestId} tenant=${tenant ?? "unknown"} invoiceId=${invoiceId} providerId=${providerId} status=${status}`
    );
    res.json({ ok: true });
  } catch (error) {
    incrementApWebhookFail();
    console.error(
      `[ap/webhook] requestId=${requestId} tenant=${tenant ?? "unknown"} invoiceId=${invoiceId} status=ERROR`,
      error
    );
    res.status(500).json({ error: "failed_to_update_status" });
  }
});

app.get("/invoice/:invoiceId/status", requireApiKey, async (req: Request, res: Response) => {
  const invoiceIdParam = req.params.invoiceId?.trim();
  if (!invoiceIdParam) {
    res.status(400).json({ error: "invalid invoice id" });
    return;
  }
  const tenantHeader = req.header("x-vida-tenant");
  const tenantQuery = typeof req.query?.tenant === "string" ? req.query.tenant : undefined;
  const tenant =
    typeof tenantHeader === "string" && tenantHeader.trim().length > 0
      ? tenantHeader.trim()
      : tenantQuery && tenantQuery.trim().length > 0
        ? tenantQuery.trim()
        : undefined;

  try {
    let record = await getInvoiceStatus(tenant, invoiceIdParam);
    if (!record) {
      res.status(404).json({ error: "status not found" });
      return;
    }
    if (record.providerId && (record.status === "queued" || record.status === "sent")) {
      try {
        const adapter = getAdapter();
        const nextStatus = await adapter.getStatus(record.providerId);
        if (nextStatus && nextStatus !== record.status) {
          record = await setInvoiceStatus({
            tenant: record.tenant === "__default__" ? undefined : record.tenant,
            invoiceId: record.invoiceId,
            providerId: record.providerId,
            status: nextStatus,
            attempts: record.attempts,
            lastError: record.lastError
          });
        }
      } catch (statusError) {
        console.error(
          `[invoice/${invoiceIdParam}/status] failed to refresh provider status tenant=${tenant ?? "unknown"} providerId=${record.providerId}`,
          statusError
        );
      }
    }
    res.json({
      status: record.status,
      providerId: record.providerId ?? null
    });
  } catch (error) {
    console.error(
      `[invoice/${invoiceIdParam}/status] failed to load status tenant=${tenant ?? "unknown"}`,
      error
    );
    res.status(500).json({ error: "failed to load status" });
  }
});

app.get("/invoice/:invoiceId", requireApiKey, async (req: Request, res: Response) => {
  const invoiceIdParam = req.params.invoiceId?.trim();
  if (!invoiceIdParam) {
    res.status(400).json({ error: "invalid invoice id" });
    return;
  }

  const knownPath = invoiceIndex.get(invoiceIdParam);
  const candidatePath = knownPath ?? path.join(OUTPUT_DIR, `${invoiceIdParam}.xml`);

  try {
    const xml = await readFile(candidatePath, "utf8");
    invoiceIndex.set(invoiceIdParam, candidatePath);
    res.type("application/xml; charset=utf-8").send(xml);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      res.status(404).json({ error: "invoice not found" });
      return;
    }
    console.error(`[invoice/${invoiceIdParam}] failed to load invoice`, error);
    res.status(500).json({ error: "failed to load invoice" });
  }
});

app.get("/history", requireApiKey, async (req: Request, res: Response) => {
  const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const parsedLimit = typeof rawLimit === "string" ? Number.parseInt(rawLimit, 10) : undefined;
  const limit = Number.isNaN(parsedLimit) || (parsedLimit ?? 0) <= 0 ? 20 : Math.min(parsedLimit ?? 20, 200);
  const rawTenant = Array.isArray(req.query.tenant) ? req.query.tenant[0] : req.query.tenant;
  const tenant = typeof rawTenant === "string" && rawTenant.trim().length > 0 ? rawTenant.trim() : undefined;

  try {
    const records = await listHistory(limit);
    const filtered = tenant ? records.filter((record) => record.tenantId === tenant) : records;
    res.json({ history: filtered });
  } catch (error) {
    console.error("[history] failed to list", error);
    res.status(500).json({ error: "failed to load history" });
  }
});

app.get("/ops/dlq", requireApiKey, async (req: Request, res: Response) => {
  const storage = getStorage();
  if (typeof storage.dlq.list !== "function") {
    res.status(501).json({ ok: false, error: "DLQ listing not supported in this storage backend." });
    return;
  }

  const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const parsedLimit = typeof rawLimit === "string" ? Number.parseInt(rawLimit, 10) : undefined;
  const limit = Number.isFinite(parsedLimit) && (parsedLimit ?? 0) > 0 ? parsedLimit : undefined;
  const rawTenant = Array.isArray(req.query.tenant) ? req.query.tenant[0] : req.query.tenant;
  const tenant = typeof rawTenant === "string" && rawTenant.trim().length > 0 ? rawTenant.trim() : undefined;

  try {
    const items = await storage.dlq.list({
      tenant,
      limit
    });
    res.json({ items });
  } catch (error) {
    console.error("[ops/dlq] failed to list entries", error);
    res.status(500).json({ ok: false, error: "failed to load DLQ entries" });
  }
});

app.post("/ops/dlq/:id/retry", requireApiKey, async (req: Request, res: Response) => {
  const { id } = req.params;
  console.info(`[ops/dlq] retry placeholder invoked for id=${id}`);
  res.status(202).json({
    ok: false,
    message: "DLQ retry placeholder: implementation pending"
  });
});

app.get("/metrics", async (_req, res: Response) => {
  res.type("text/plain; version=0.0.4");
  try {
    const body = await renderMetrics();
    res.send(body);
  } catch (error) {
    console.error("[metrics] failed to render", error);
    res.status(500).send("# metrics temporarily unavailable\n");
  }
});

const HOST = "0.0.0.0";

export function startServer(port = PORT) {
  const server = app.listen(port, HOST, () => {
    console.info(`Server listening on ${HOST}:${port}`);
  });

  const stop = () => {
    server.close(() => process.exit(0));
  };

  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  return server;
}

const currentFile = fileURLToPath(import.meta.url);
const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined;

if (entryPoint === currentFile) {
  startServer();
}
