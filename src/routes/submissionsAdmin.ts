import type { Request, Response } from "express";
import { Router } from "express";
import { isStagingEnv } from "../config.js";
import { requireAdminAuth } from "../middleware/adminAuth.js";
import { loadHistoryJson, loadHistoryText } from "../lib/history.js";
import { listHistory, type HistoryRecord } from "../history/logger.js";
import {
  findSubmissionByInvoiceId,
  listSubmissions,
  saveSubmission,
  type SubmissionRecord
} from "../services/submissionsStore.js";
import { resendInvoiceFromHistory } from "../services/submissionResender.js";
import type {
  InvoiceSendRecord,
  InvoiceStatusSnapshot,
  InvoiceSubmissionContext
} from "./invoicesV0.js";
import type { InvoiceDTO } from "../types/public.js";

type SubmissionRequestArtifact = {
  invoiceId: string;
  receivedAt: string;
  payload: InvoiceDTO;
  source?: string;
  metadata?: Record<string, unknown>;
  tenant?: string | null;
};

const router = Router();
router.use(requireAdminAuth);

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function safeLower(value: string | undefined): string {
  return value?.toLowerCase() ?? "";
}

function normalizeLimit(value: string | undefined): number {
  if (!value) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

function mapSubmission(record: SubmissionRecord) {
  return {
    invoiceId: record.invoiceId,
    tenant: record.tenant,
    externalReference: record.externalReference,
    documentId: record.documentId,
    status: record.status,
    buyerReference: record.buyerReference ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function matchesQuery(record: SubmissionRecord, query: string | undefined): boolean {
  if (!query) {
    return true;
  }
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const haystacks = [
    record.invoiceId,
    record.externalReference,
    record.documentId,
    record.tenant,
    record.status,
    record.buyerReference ?? ""
  ]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return haystacks.some((value) => value.includes(normalized));
}

function matchesDateRange(record: SubmissionRecord, fromTs: number | null, toTs: number | null): boolean {
  const updatedAt = Date.parse(record.updatedAt);
  if (Number.isNaN(updatedAt)) {
    return false;
  }
  if (fromTs !== null && updatedAt < fromTs) {
    return false;
  }
  if (toTs !== null && updatedAt > toTs) {
    return false;
  }
  return true;
}

async function loadSubmissionHistory(invoiceId: string): Promise<HistoryRecord[]> {
  const recent = await listHistory(200);
  return recent.filter((entry) => entry.invoiceId === invoiceId);
}

router.get("/ops/submissions", async (req: Request, res: Response) => {
  const rawStatus = typeof req.query.status === "string" ? req.query.status.trim() : undefined;
  const status = rawStatus ? rawStatus.toUpperCase() : undefined;
  const query = typeof req.query.q === "string" ? req.query.q : undefined;
  const fromTs = parseTimestamp(typeof req.query.from === "string" ? req.query.from : undefined);
  const toTs = parseTimestamp(typeof req.query.to === "string" ? req.query.to : undefined);
  const limit = normalizeLimit(typeof req.query.limit === "string" ? req.query.limit : undefined);

  const submissions = await listSubmissions({ limit: MAX_LIMIT, status: rawStatus });
  const sorted = submissions.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const filtered = sorted
    .filter((record) => (status ? record.status.toUpperCase() === status : true))
    .filter((record) => matchesQuery(record, query))
    .filter((record) => matchesDateRange(record, fromTs, toTs))
    .slice(0, limit);

  res.json({
    filters: {
      status: status ?? null,
      q: query ?? null,
      from: fromTs ? new Date(fromTs).toISOString() : null,
      to: toTs ? new Date(toTs).toISOString() : null
    },
    total: filtered.length,
    items: filtered.map((record) => ({
      ...mapSubmission(record),
      artifacts: record.artifacts
    }))
  });
});

router.get("/ops/submissions/:invoiceId", async (req: Request, res: Response) => {
  const invoiceId = req.params.invoiceId?.trim();
  if (!invoiceId) {
    res.status(400).json({ error: "invoice_id_required" });
    return;
  }

  const record = await findSubmissionByInvoiceId(invoiceId);
  if (!record) {
    res.status(404).json({ error: "submission_not_found" });
    return;
  }

  const [requestArtifact, sendRecord, statusSnapshot, patchedUbl, historyEntries] = await Promise.all([
    loadHistoryJson<SubmissionRequestArtifact>(invoiceId, "request"),
    loadHistoryJson<InvoiceSendRecord>(invoiceId, "send"),
    loadHistoryJson<InvoiceStatusSnapshot>(invoiceId, "status"),
    loadHistoryText(invoiceId, "patched"),
    loadSubmissionHistory(invoiceId)
  ]);

  res.json({
    submission: mapSubmission(record),
    dto: requestArtifact?.payload ?? null,
    requestMetadata: requestArtifact ?? null,
    patchedUbl: patchedUbl ?? null,
    sendRecord: sendRecord ?? null,
    statusSnapshot: statusSnapshot ?? null,
    attempts: sendRecord?.attempts ?? [],
    documentId: sendRecord?.documentId ?? record.documentId,
    history: historyEntries,
    artifacts: record.artifacts
  });
});

router.post("/ops/submissions/:invoiceId/resend", async (req: Request, res: Response) => {
  if (!isStagingEnv()) {
    res.status(403).json({ error: "resend_disabled" });
    return;
  }

  const invoiceId = req.params.invoiceId?.trim();
  if (!invoiceId) {
    res.status(400).json({ error: "invoice_id_required" });
    return;
  }

  const record = await findSubmissionByInvoiceId(invoiceId);
  if (!record) {
    res.status(404).json({ error: "submission_not_found" });
    return;
  }

  try {
    const context: InvoiceSubmissionContext = {
      source: "ops_dashboard_resend",
      tenant: record.tenant,
      metadata: {
        previousInvoiceId: invoiceId,
        operator: safeLower(res.locals.adminAuth?.subject ?? "ops_dashboard")
      }
    };
    const submission = await resendInvoiceFromHistory(invoiceId, context);
    const scope = `ops-dashboard:${record.tenant}:${Date.now()}`;
    const stored = await saveSubmission({
      scope,
      tenant: record.tenant,
      idempotencyKey: scope,
      invoiceId: submission.invoiceId,
      externalReference: submission.externalReference,
      documentId: submission.documentId,
      status: submission.normalizedStatus,
      buyerReference: record.buyerReference
    });

    res.status(202).json({
      invoiceId: stored.invoiceId,
      documentId: stored.documentId,
      status: stored.status
    });
  } catch (error) {
    console.error("[ops_dashboard] resend failed", error);
    res.status(500).json({ error: "resend_failed" });
  }
});

export const submissionsAdminRouter = router;
