import cors from "cors";
import express, { type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { shopifyToOrder } from "./connectors/shopify.js";
import { wooToOrder } from "./connectors/woocommerce.js";
import { orderToInvoiceXml } from "./peppol/convert.js";
import { sendInvoice } from "./peppol/apClient.js";
import { parseOrder, type OrderT } from "./schemas/order.js";
import { validateUbl } from "./validation/ubl.js";
import { listHistory, recordHistory } from "./history/logger.js";
import { recordInvoiceRequest } from "./history/invoiceRequestLog.js";
import { PORT, isPeppolSendEnabled, isUblValidationEnabled } from "./config.js"; // migrated
import { requireApiKey } from "./mw_auth.js"; // migrated
import { createApiKeyRateLimiter } from "./middleware/rateLimiter.js";
import { getCachedInvoice, storeCachedInvoice } from "./services/idempotencyCache.js";
import {
  incrementApSendFail,
  incrementApSendSuccess,
  incrementInvoicesCreated,
  renderMetrics
} from "./metrics.js";

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
app.use(express.json({ limit: "1mb" }));
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

app.get("/", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

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

      if (isPeppolSendEnabled()) {
        const supplierName = order.supplier.name ?? "unknown";
        const receiverName = order.buyer.name ?? "unknown";
        const docId = order.orderNumber ?? requestId;
        try {
          const result = await sendInvoice(xml, {
            sender: supplierName,
            receiver: receiverName,
            docId
          });
          incrementApSendSuccess();
          peppolStatus = result.status;
          peppolId = result.id;
        } catch (apError) {
          incrementApSendFail();
          const message = apError instanceof Error ? apError.message : "PEPPOL send failed";
          throw new HttpError(`PEPPOL send failed: ${message}`, 502);
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

app.get("/metrics", (_req, res: Response) => {
  res.type("text/plain; version=0.0.4");
  res.send(renderMetrics());
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
