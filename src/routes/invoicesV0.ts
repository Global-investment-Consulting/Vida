import type { Request, Response } from "express";
import { Router } from "express";
import { ZodError } from "zod";
import { ulid } from "ulid";
import { orderToInvoiceXml } from "../peppol/convert.js";
import { parseOrder, type OrderT } from "../schemas/order.js";
import { requirePublicApiKey } from "../middleware/publicAuth.js";
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
  findSubmissionByInvoiceId,
  findSubmissionByScope,
  saveSubmission,
  updateSubmissionStatus
} from "../services/submissionsStore.js";
import { createApiKeyRateLimiter } from "../middleware/rateLimiter.js";
import { captureServerException } from "../lib/telemetry.js";

const router = Router();

const DEFAULT_TERMS_DAYS = 30;
const SCRADA_SECRET_HEADER = "x-scrada-webhook-secret";
const IDEMPOTENCY_HEADER = "Idempotency-Key";
const IDEMPOTENCY_HELP = "Provide the same Idempotency-Key header when retrying this request.";

const PUBLIC_RATE_LIMIT = Number.parseInt(process.env.VIDA_PUBLIC_RATE_LIMIT ?? "120", 10);
const PUBLIC_RATE_WINDOW_MS = Number.parseInt(process.env.VIDA_PUBLIC_RATE_LIMIT_WINDOW_MS ?? "60000", 10);

const publicRateLimiter = createApiKeyRateLimiter({
  limit: Number.isFinite(PUBLIC_RATE_LIMIT) && PUBLIC_RATE_LIMIT > 0 ? PUBLIC_RATE_LIMIT : 120,
  windowMs: Number.isFinite(PUBLIC_RATE_WINDOW_MS) && PUBLIC_RATE_WINDOW_MS > 0 ? PUBLIC_RATE_WINDOW_MS : 60_000
});

type PublicApiContext = {
  tenant: string;
  token: string;
};

function requireAuthContext(res: Response): PublicApiContext {
  const ctx = res.locals.publicApi;
  if (!ctx) {
    throw new Error("public_api_auth_missing");
  }
  return ctx;
}

export type InvoiceSubmissionContext = {
  source: string;
  metadata?: Record<string, unknown>;
  tenant?: string;
  idempotencyKey?: string | null;
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

function extractIdempotencyKey(req: Request): string | null {
  const raw = req.header(IDEMPOTENCY_HEADER);
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildIdempotencyScope(tenant: string, idempotencyKey: string): string {
  return `${tenant}:${idempotencyKey}`;
}

function respondWithStoredSubmission(
  res: Response,
  record: Awaited<ReturnType<typeof saveSubmission>>,
  idempotencyKey: string,
  statusCode: number
): void {
  res.setHeader("X-Idempotency-Key", idempotencyKey);
  if (statusCode !== 202) {
    res.setHeader("X-Idempotent-Replay", "true");
  }
  res.status(statusCode).json({
    invoiceId: record.invoiceId,
    documentId: record.documentId,
    status: record.status,
    externalReference: record.externalReference
  });
}

function deriveBuyerReference(dto: InvoiceDTO): string | undefined {
  const candidates = [
    typeof dto.meta?.buyerReference === "string" ? dto.meta.buyerReference.trim() : "",
    dto.buyer?.companyId?.trim() ?? "",
    dto.buyer?.endpoint?.id?.trim() ?? ""
  ];
  return candidates.find((entry) => entry.length > 0) || undefined;
}

function logSendEvent(
  event: "send_started" | "send_attempt" | "send_final",
  payload: Record<string, unknown>
): void {
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

function mapParty(party: InvoiceDTO["seller"] | InvoiceDTO["buyer"]): OrderT["supplier"] {
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
  const dueDate = dto.dueDate ?? (payable > 0 ? addBusinessDays(issueDate, DEFAULT_TERMS_DAYS) : issueDate);
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

async function persistRequest(
  invoiceId: string,
  dto: InvoiceDTO,
  context: InvoiceSubmissionContext
): Promise<void> {
  await saveHistoryJson(invoiceId, "request", {
    invoiceId,
    receivedAt: new Date().toISOString(),
    payload: dto,
    source: context.source,
    metadata: context.metadata ?? {},
    tenant: context.tenant ?? null,
    idempotencyKey: context.idempotencyKey ?? null
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

async function persistStatus(
  invoiceId: string,
  documentId: string,
  info: ScradaOutboundInfo
): Promise<InvoiceStatusSnapshot> {
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

router.post("/v0/invoices", requirePublicApiKey, publicRateLimiter, async (req: Request, res: Response) => {
  const auth = requireAuthContext(res);
  const idempotencyKey = extractIdempotencyKey(req);

  if (!idempotencyKey) {
    res.status(400).json({
      error: "idempotency_key_required",
      help: IDEMPOTENCY_HELP
    });
    return;
  }

  const scope = buildIdempotencyScope(auth.tenant, idempotencyKey);

  try {
    const existing = await findSubmissionByScope(scope);
    if (existing) {
      respondWithStoredSubmission(res, existing, idempotencyKey, 200);
      return;
    }
  } catch (error) {
    console.error("[invoices_v0] failed to inspect submissions store", error);
    captureServerException(error, req);
    res.status(500).json({ error: "internal_error" });
    return;
  }

  try {
    const parsed = InvoiceDtoSchema.parse(req.body);
    const result = await submitInvoiceFromDto(parsed, {
      source: "public_api",
      tenant: auth.tenant,
      idempotencyKey
    });
    const stored = await saveSubmission({
      scope,
      tenant: auth.tenant,
      idempotencyKey,
      invoiceId: result.invoiceId,
      externalReference: result.externalReference,
      documentId: result.documentId,
      status: result.normalizedStatus,
      buyerReference: deriveBuyerReference(parsed)
    });
    respondWithStoredSubmission(res, stored, idempotencyKey, 202);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(422).json({ error: "invalid_payload", details: error.issues });
      return;
    }
    console.error("[invoices_v0] failed to submit invoice", error);
    captureServerException(error, req);
    res.status(500).json({ error: "internal_error" });
  }
});

router.get("/v0/invoices/:invoiceId", requirePublicApiKey, publicRateLimiter, async (req: Request, res: Response) => {
  const invoiceId = req.params.invoiceId.trim();
  if (!invoiceId) {
    res.status(400).json({ error: "invoice_id_required" });
    return;
  }

  const [sendRecord, storedSubmission] = await Promise.all([
    loadHistoryJson<InvoiceSendRecord>(invoiceId, "send"),
    findSubmissionByInvoiceId(invoiceId)
  ]);
  const documentId = sendRecord?.documentId ?? storedSubmission?.documentId;
  if (!documentId) {
    res.status(404).json({ error: "invoice_not_found" });
    return;
  }

  let statusSnapshot = await loadHistoryJson<InvoiceStatusSnapshot>(invoiceId, "status");

  try {
    const info = await fetchScradaStatus(documentId);
    statusSnapshot = await persistStatus(invoiceId, documentId, info);
    await updateSubmissionStatus(invoiceId, statusSnapshot.normalizedStatus);
  } catch (error) {
    console.warn(
      `[invoices_v0] status refresh failed invoiceId=${invoiceId} documentId=${documentId}`,
      error
    );
  }

  res.json({
    invoiceId,
    documentId,
    status: statusSnapshot?.normalizedStatus ?? storedSubmission?.status ?? "UNKNOWN",
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
  await updateSubmissionStatus(invoiceId, normalizeStatus(status));

  res.json({ ok: true });
});

export const invoicesV0Router = router;
