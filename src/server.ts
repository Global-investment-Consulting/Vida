import cors from "cors";
import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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
import { recordHistory } from "./history/logger.js";

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

export const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

function resolveApiKeys(): string[] {
  const raw = process.env.VIDA_API_KEYS ?? "";
  return raw
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

function extractApiKey(req: Request): string | null {
  const header = req.header("x-vida-api-key") ?? req.header("authorization");
  if (!header) return null;
  const trimmed = header.trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed.slice(7).trim();
  }
  return trimmed;
}

app.use((req, res, next) => {
  const apiKeys = resolveApiKeys();
  if (apiKeys.length === 0 || req.method === "GET") {
    next();
    return;
  }

  const providedKey = extractApiKey(req);
  if (!providedKey) {
    res.status(401).json({ error: "missing API key" });
    return;
  }

  if (!apiKeys.includes(providedKey)) {
    res.status(403).json({ error: "invalid API key" });
    return;
  }

  next();
});

app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok");
});

app.get("/", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.post("/webhook/order-created", async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const rawSource = req.body?.source;
  const sourceLabel = typeof rawSource === "string" ? rawSource.toLowerCase() : undefined;

  let order: OrderT | undefined;
  let invoicePath: string | undefined;
  let errorMessage: string | undefined;
  let responseSent = false;
  let peppolStatus: string | undefined;
  let peppolId: string | undefined;
  let validationErrors: { path: string; msg: string }[] | undefined;

  try {
    const { source, payload, supplier, defaultVatRate, currencyMinorUnit } = req.body ?? {};

    order = buildOrderFromSource(source, payload, supplier, {
      defaultVatRate,
      currencyMinorUnit
    });

    const xml = await orderToInvoiceXml(order);

    const shouldValidate = (process.env.VIDA_VALIDATE_UBL ?? "").toLowerCase() === "true";
    if (shouldValidate) {
      const validation = validateUbl(xml);
      if (!validation.ok) {
        validationErrors = validation.errors;
        throw new HttpError("UBL validation failed", 422);
      }
    }

    const outputDir = path.resolve(process.cwd(), "output");
    await mkdir(outputDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    invoicePath = path.join(outputDir, `invoice_${timestamp}.xml`);

    await writeFile(invoicePath, xml, "utf8");
    console.log(`[webhook] Generated invoice at ${invoicePath}`);

    const shouldSendPeppol = (process.env.VIDA_PEPPOL_SEND ?? "").toLowerCase() === "true";

    if (shouldSendPeppol) {
      const supplierName = order.supplier.name ?? "unknown";
      const receiverName = order.buyer.name ?? "unknown";
      const docId = order.orderNumber ?? requestId;
      try {
        const result = await sendInvoice(xml, {
          sender: supplierName,
          receiver: receiverName,
          docId
        });
        peppolStatus = result.status;
        peppolId = result.id;
      } catch (apError) {
        const message = apError instanceof Error ? apError.message : "PEPPOL send failed";
        throw new HttpError(`PEPPOL send failed: ${message}`, 502);
      }
    }

    res.json({ path: invoicePath, xmlLength: xml.length });
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
        status: responseSent && !errorMessage ? "ok" : "error",
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
});

const HOST = "0.0.0.0";

export function startServer(port = Number(process.env.PORT ?? 3001)) {
  const server = app.listen(port, HOST, () => {
    console.log(`Server listening on ${HOST}:${port}`);
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
