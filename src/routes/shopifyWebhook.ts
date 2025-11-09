import { createHmac, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response, Router } from "express";
import { shopifyToOrder, type ShopifyOrder } from "../connectors/shopify.js";
import type { OrderT } from "../schemas/order.js";
import { InvoiceDtoSchema, type InvoiceDTO } from "../types/public.js";
import { resolveShopifyWebhookSecret } from "../config.js";
import { submitInvoiceFromDto } from "./invoicesV0.js";

const router = Router();
const rawParser = express.raw({ type: "*/*", limit: "1mb" });

const SHOPIFY_HMAC_HEADER = "x-shopify-hmac-sha256";

function getEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveSupplier(): OrderT["supplier"] {
  return {
    name: getEnv("SCRADA_SUPPLIER_NAME") ?? "Vida Supplier BV",
    registrationName: getEnv("SCRADA_SUPPLIER_REGISTRATION"),
    companyId: getEnv("SCRADA_COMPANY_ID"),
    vatId: getEnv("SCRADA_SUPPLIER_VAT"),
    endpoint: {
      id: getEnv("SCRADA_SUPPLIER_ID"),
      scheme: getEnv("SCRADA_SUPPLIER_SCHEME")
    },
    address: {
      streetName: getEnv("SCRADA_SUPPLIER_STREET"),
      additionalStreetName: getEnv("SCRADA_SUPPLIER_STREET_LINE_2"),
      buildingNumber: getEnv("SCRADA_SUPPLIER_BUILDING"),
      cityName: getEnv("SCRADA_SUPPLIER_CITY"),
      postalZone: getEnv("SCRADA_SUPPLIER_POSTAL"),
      countryCode: getEnv("SCRADA_SUPPLIER_COUNTRY")
    },
    contact: {
      name: getEnv("SCRADA_SUPPLIER_CONTACT"),
      electronicMail: getEnv("SCRADA_SUPPLIER_EMAIL")
    }
  };
}

function overrideEndpoint(target: InvoiceDTO["seller"] | InvoiceDTO["buyer"], prefix: string): void {
  const id = getEnv(`${prefix}_ENDPOINT_ID`);
  const scheme = getEnv(`${prefix}_ENDPOINT_SCHEME`);
  if (id && scheme) {
    target.endpoint = {
      id,
      scheme
    };
  }
}

function toInvoiceDto(order: OrderT): InvoiceDTO {
  const dto: InvoiceDTO = {
    externalReference: order.orderNumber,
    currency: order.currency,
    currencyMinorUnit: order.currencyMinorUnit,
    issueDate: order.issueDate instanceof Date ? order.issueDate.toISOString() : new Date(order.issueDate).toISOString(),
    dueDate: order.dueDate instanceof Date ? order.dueDate.toISOString() : order.dueDate
      ? new Date(order.dueDate).toISOString()
      : undefined,
    seller: {
      ...order.supplier
    },
    buyer: {
      ...order.buyer
    },
    lines: order.lines,
    defaultVatRate: order.defaultVatRate,
    totals: order.totals,
    meta: order.meta
  };

  overrideEndpoint(dto.seller, "SHOPIFY_SELLER");
  overrideEndpoint(dto.buyer, "SHOPIFY_BUYER");
  return dto;
}

function verifyShopifySignature(secret: string, rawBody: Buffer, incoming: string | undefined): boolean {
  if (!incoming) {
    return false;
  }
  const hmac = createHmac("sha256", secret);
  hmac.update(rawBody);
  const digest = hmac.digest();
  const trimmed = incoming.trim();
  if (!trimmed) {
    return false;
  }
  let candidate: Buffer;
  try {
    candidate = Buffer.from(trimmed, "base64");
  } catch {
    return false;
  }
  return candidate.length === digest.length && timingSafeEqual(candidate, digest);
}

function parseJsonBody(rawBody: Buffer): ShopifyOrder {
  if (!rawBody || rawBody.length === 0) {
    throw new Error("empty_body");
  }
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    throw new Error("invalid_json", { cause: error instanceof Error ? error : undefined });
  }
}

router.post("/v0/webhooks/shopify", rawParser, async (req: Request, res: Response) => {
  const secret = resolveShopifyWebhookSecret();
  if (!secret) {
    res.status(503).json({ error: "webhook_unconfigured" });
    return;
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
  if (!verifyShopifySignature(secret, rawBody, req.header(SHOPIFY_HMAC_HEADER))) {
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  let orderPayload: ShopifyOrder;
  try {
    orderPayload = parseJsonBody(rawBody);
  } catch {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  const normalizedOrder = shopifyToOrder(orderPayload, {
    supplier: resolveSupplier(),
    defaultVatRate: 21
  });
  const dto = InvoiceDtoSchema.parse(toInvoiceDto(normalizedOrder));

  try {
    const result = await submitInvoiceFromDto(dto, {
      source: "shopify_webhook",
      metadata: { shopifyOrderId: orderPayload.id }
    });
    res.status(202).json({
      invoiceId: result.invoiceId,
      status: result.normalizedStatus
    });
  } catch (error) {
    console.error("[shopify_webhook] failed to process order", error);
    res.status(500).json({ error: "internal_error" });
  }
});

export const shopifyWebhookRouter = router;
