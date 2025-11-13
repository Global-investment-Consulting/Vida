import type { Request, Response } from "express";
import { Router } from "express";
import { ZodError } from "zod";
import { ulid } from "ulid";
import { orderToInvoiceXml } from "../peppol/convert.js";
import { parseOrder, type OrderT } from "../schemas/order.js";
import { requirePublicApiKey } from "../middleware/apiKeyAuth.js";
import { loadHistoryJson, saveHistoryJson, saveHistoryText } from "../lib/history.js";
import {
  fetchScradaStatus,
  sendInvoiceThroughScrada,
  type ScradaOutboundInfo,
  type ScradaSendAttempt,
  type ScradaSendResult
} from "../services/scradaClient.js";
import { InvoiceDtoSchema, type InvoiceDTO } from "../types/public.js";
import { resolveApWebhookSecret } from "../config.js";
import {
  getCachedSubmission,
  storeCachedSubmission
} from "../services/publicApiIdempotency.js";

const router = Router();

const DEFAULT_TERMS_DAYS = 30;
const SCRADA_SECRET_HEADER = "x-scrada-webhook-secret";
const IDEMPOTENCY_HEADER_PRIMARY = "idempotency-key";
const IDEMPOTENCY_HEADER_FALLBACK = "x-idempotency-key";

type InvoiceSubmissionContext = {
  source: string;
  metadata?: Record<string, unknown>;
};

export type InvoiceSubmissionResult = {
  invoiceId: string;
  externalReference: string;
  documentId: string;
  normalizedStatus: string;
};

export interface InvoiceSendRecord {
  invoiceId: string;
  externalReference: string;
  provider: "scrada";
  documentId: string;
  sentAt: string;
  channel: string;
  attempts: ScradaSendAttempt[];
  vatVariant: string;
  headerSweep: boolean;
}

export interface InvoiceStatusSnapshot {
  invoiceId: string;
  documentId: string;
  fetchedAt: string;
  status: string;
  normalizedStatus: string;
  info: ScradaOutboundInfo;
}

function logSendEvent(event: "send_started" | "send_attempt" | "send_final", payload: Record<string, unknown>): void {
  const entry = {
    event,
    ts: new Date().toISOString(),
    ...payload
  };
  console.info(`[invoices_v0] ${JSON.stringify(entry)}`);
}

function addBusinessDays(issueDate: string, delta: number): string {
  const date = new Date(issueDate);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString();
}

function mapParty(
  party: InvoiceDTO["seller"] | InvoiceDTO["buyer"]
): OrderT["supplier"] {
  return {
    name: party.name,
    registrationName: party.registrationName,
    companyId: party.companyId,
    vatId: party.vatId,
    endpoint: party.endpoint,
    address: party.address,
    contact: party.contact
  };
}

function buildOrderCandidate(dto: InvoiceDTO, invoiceId: string): unknown {
  const orderNumber = dto.externalReference?.trim() || invoiceId;
  const issueDate = dto.issueDate;
  const payable = dto.totals?.payableAmountMinor ?? 0;
  const dueDate =
    dto.dueDate ?? (payable > 0 ? addBusinessDays(issueDate, DEFAULT_TERMS_DAYS) : issueDate);
  return {
    orderNumber,
    currency: dto.currency,
    currencyMinorUnit: dto.currencyMinorUnit ?? 2,
    issueDate,
    dueDate,
    buyer: mapParty(dto.buyer),
    supplier: mapParty(dto.seller),
    lines: dto.lines,
    defaultVatRate: dto.defaultVatRate,
    totals: dto.totals,
    meta: {
      ...(dto.meta ?? {}),
      externalReference: dto.externalReference,
      source: "public_api"
    }
  };
}

function normalizeStatus(status: string | null | undefined): string {
  return status?.toString().trim().toUpperCase().replace(/\s+/g, "_") || "UNKNOWN";
}

function getIdempotencyKey(req: Request): string | undefined {
  const raw =
    req.header(IDEMPOTENCY_HEADER_PRIMARY) ??
    req.header(IDEMPOTENCY_HEADER_FALLBACK);
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

async function persistRequest(invoiceId: string, dto: InvoiceDTO, context: InvoiceSubmissionContext): Promise<void> {
  await saveHistoryJson(invoiceId, "request", {
    invoiceId,
    receivedAt: new Date().toISOString(),
    payload: dto,
    source: context.source,
    metadata: context.metadata ?? {}
  });
}

async function persistSendRecord(invoiceId: string, result: ScradaSendResult): Promise<void> {
  const record: InvoiceSendRecord = {
    invoiceId,
    externalReference: result.externalReference,
    provider: "scrada",
    documentId: result.documentId,
    sentAt: new Date().toISOString(),
    channel: result.channel,
    attempts: result.attempts,
    vatVariant: result.vatVariant,
    headerSweep: result.headerSweep
  };
  await saveHistoryJson(invoiceId, "send", record);
}

async function persistStatus(invoiceId: string, documentId: string, info: ScradaOutboundInfo): Promise<InvoiceStatusSnapshot> {
  const snapshot: InvoiceStatusSnapshot = {
    invoiceId,
    documentId,
    fetchedAt: new Date().toISOString(),
    status: info.status ?? "unknown",
    normalizedStatus: normalizeStatus(info.status),
    info
  };
  await saveHistoryJson(invoiceId, "status", snapshot);
  return snapshot;
}

export async function submitInvoiceFromDto(
  dto: InvoiceDTO,
  context: InvoiceSubmissionContext
): Promise<InvoiceSubmissionResult> {
  const invoiceId = ulid().toLowerCase();
  await persistRequest(invoiceId, dto, context);

  const order = parseOrder(buildOrderCandidate(dto, invoiceId));
  const ublXml = await orderToInvoiceXml(order);
  await saveHistoryText(invoiceId, "patched", ublXml);

  const externalReference = order.orderNumber;
  logSendEvent("send_started", { invoiceId, externalReference, provider: "scrada" });

  const sendResult = await sendInvoiceThroughScrada({
    invoiceId,
    externalReference
  });

  for (const attempt of sendResult.attempts) {
    logSendEvent("send_attempt", {
      invoiceId,
      externalReference,
      provider: "scrada",
      providerDocId: sendResult.documentId,
      attempt: attempt.attempt,
      channel: attempt.channel,
      statusCode: attempt.statusCode ?? undefined,
      success: attempt.success
    });
  }

  await persistSendRecord(invoiceId, sendResult);

  let snapshot: InvoiceStatusSnapshot | null = null;
  try {
    const info = await fetchScradaStatus(sendResult.documentId);
    snapshot = await persistStatus(invoiceId, sendResult.documentId, info);
  } catch (error) {
    console.warn(
      `[invoices_v0] status fetch failed invoiceId=${invoiceId} documentId=${sendResult.documentId}`,
      error
    );
  }

  logSendEvent("send_final", {
    invoiceId,
    externalReference,
    provider: "scrada",
    providerDocId: sendResult.documentId,
    status: snapshot?.normalizedStatus ?? "PENDING"
  });

  return {
    invoiceId,
    externalReference,
    documentId: sendResult.documentId,
    normalizedStatus: snapshot?.normalizedStatus ?? "PENDING"
  };
}

router.post("/v0/invoices", requirePublicApiKey, async (req: Request, res: Response) => {
  const idempotencyKey = getIdempotencyKey(req);
  const publicContext = res.locals.publicApi;

  if (publicContext && idempotencyKey) {
    const cached = getCachedSubmission(publicContext.token, idempotencyKey);
    if (cached) {
      res.setHeader("X-Idempotency-Cache", "HIT");
      res.status(202).json(cached);
      return;
    }
  }

  try {
    const parsed = InvoiceDtoSchema.parse(req.body);
    const result = await submitInvoiceFromDto(parsed, { source: "public_api" });
    const payload = {
      invoiceId: result.invoiceId,
      documentId: result.documentId,
      status: result.normalizedStatus,
      externalReference: result.externalReference
    };

    if (publicContext && idempotencyKey) {
      storeCachedSubmission(publicContext.token, idempotencyKey, payload);
      res.setHeader("X-Idempotency-Cache", "MISS");
    }

    res.status(202).json(payload);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ error: "invalid_payload", details: error.issues });
      return;
    }
    console.error("[invoices_v0] failed to submit invoice", error);
    res.status(500).json({ error: "internal_error" });
  }
});

router.get("/v0/invoices/:invoiceId", requirePublicApiKey, async (req: Request, res: Response) => {
  const invoiceId = req.params.invoiceId.trim();
  if (!invoiceId) {
    res.status(400).json({ error: "invoice_id_required" });
    return;
  }

  const sendRecord = await loadHistoryJson<InvoiceSendRecord>(invoiceId, "send");
  if (!sendRecord) {
    res.status(404).json({ error: "invoice_not_found" });
    return;
  }

  let statusSnapshot = await loadHistoryJson<InvoiceStatusSnapshot>(invoiceId, "status");

  try {
    const info = await fetchScradaStatus(sendRecord.documentId);
    statusSnapshot = await persistStatus(invoiceId, sendRecord.documentId, info);
  } catch (error) {
    console.warn(
      `[invoices_v0] status refresh failed invoiceId=${invoiceId} documentId=${sendRecord.documentId}`,
      error
    );
  }

  res.json({
    invoiceId,
    documentId: sendRecord.documentId,
    status: statusSnapshot?.normalizedStatus ?? "UNKNOWN",
    info: statusSnapshot?.info ?? null
  });
});

router.post("/v0/webhooks/scrada", async (req: Request, res: Response) => {
  const secret = resolveApWebhookSecret();
  if (!secret) {
    res.status(503).json({ error: "webhook_unconfigured" });
    return;
  }

  const provided = req.header(SCRADA_SECRET_HEADER)?.trim();
  if (!provided || provided !== secret) {
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
  const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
  const status = typeof body.status === "string" ? body.status : "unknown";
  const info = (body.info ?? {}) as ScradaOutboundInfo;

  if (!invoiceId || !documentId) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  const statusPayload: ScradaOutboundInfo = {
    ...info,
    documentId,
    status
  };
  await persistStatus(invoiceId, documentId, statusPayload);

  res.json({ ok: true });
});

export const invoicesV0Router = router;
