import { type ApDeliveryStatus } from "../apadapters/types.js";
import { getStorage } from "../storage/index.js";
import type { InvoiceStatusValue } from "../storage/types.js";

export type InvoiceStatusRecord = InvoiceStatusValue;

type SetInvoiceStatusParams = {
  tenant?: string;
  invoiceId: string;
  providerId?: string;
  status: ApDeliveryStatus;
  attempts?: number;
  lastError?: string;
};

const DEFAULT_TENANT = "__default__";
const SNAPSHOT = new Map<string, InvoiceStatusRecord>();
let snapshotPrimed = false;
let snapshotLoadPromise: Promise<void> | null = null;

function statusKey(tenant: string, invoiceId: string): string {
  return `${tenant}::${invoiceId}`;
}

function normalizeTenantInput(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? "" : trimmed;
}

function resolveTenant(value: string | undefined, fallback?: string): string {
  const trimmed = value?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed;
  }
  if (fallback && fallback.length > 0) {
    return fallback;
  }
  return DEFAULT_TENANT;
}

function cacheRecord(record: InvoiceStatusRecord): void {
  SNAPSHOT.set(statusKey(record.tenant, record.invoiceId), record);
  snapshotPrimed = true;
}

async function loadSnapshotFromStore(): Promise<void> {
  const storage = getStorage();
  const snapshotFn = storage.status.snapshot;
  if (typeof snapshotFn !== "function") {
    snapshotPrimed = true;
    return;
  }

  const records = await snapshotFn();
  SNAPSHOT.clear();
  for (const record of records) {
    cacheRecord(record);
  }
  snapshotPrimed = true;
}

function ensureSnapshotPrimed(): void {
  if (snapshotPrimed || snapshotLoadPromise) {
    return;
  }
  snapshotLoadPromise = loadSnapshotFromStore()
    .catch((error) => {
      console.error("[storage/status] failed to load snapshot", error);
    })
    .finally(() => {
      snapshotLoadPromise = null;
    });
}

export async function setInvoiceStatus(params: SetInvoiceStatusParams): Promise<InvoiceStatusRecord> {
  const storage = getStorage();
  const tenantInput = normalizeTenantInput(params.tenant);
  const existing = await storage.status.get(tenantInput, params.invoiceId);
  const updatedAt = new Date().toISOString();

  const tenant = resolveTenant(tenantInput, existing?.tenant);
  const attempts = params.attempts ?? existing?.attempts ?? 0;
  const providerId = params.providerId ?? existing?.providerId;
  const lastError =
    params.status === "error"
      ? params.lastError ?? existing?.lastError
      : undefined;

  const record: InvoiceStatusRecord = {
    tenant,
    invoiceId: params.invoiceId,
    providerId,
    status: params.status,
    attempts,
    lastError,
    updatedAt
  };

  await storage.status.set(tenant, params.invoiceId, {
    status: record.status,
    providerId: record.providerId,
    attempts: record.attempts,
    lastError: record.lastError,
    updatedAt: record.updatedAt
  });

  cacheRecord(record);
  return record;
}

export async function getInvoiceStatus(tenant: string | undefined, invoiceId: string): Promise<InvoiceStatusRecord | null> {
  const storage = getStorage();
  const tenantInput = normalizeTenantInput(tenant);
  const record = await storage.status.get(tenantInput, invoiceId);
  if (record) {
    cacheRecord(record);
  } else {
    ensureSnapshotPrimed();
  }
  return record;
}

export async function listInvoiceStatuses(): Promise<InvoiceStatusRecord[]> {
  await loadSnapshotFromStore();
  return Array.from(SNAPSHOT.values());
}

export function getInvoiceStatusSnapshot(): InvoiceStatusRecord[] {
  ensureSnapshotPrimed();
  return Array.from(SNAPSHOT.values());
}

export function resetInvoiceStatusCache(): void {
  SNAPSHOT.clear();
  snapshotPrimed = false;
  snapshotLoadPromise = null;
}
