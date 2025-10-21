import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveInvoiceStatusDir } from "../config.js";
import { type ApDeliveryStatus } from "../apadapters/types.js";

export type InvoiceStatusRecord = {
  tenant: string;
  invoiceId: string;
  providerId?: string;
  status: ApDeliveryStatus;
  attempts: number;
  lastError?: string;
  updatedAt: string;
};

type StatusKey = string;

const DEFAULT_TENANT = "__default__";
const CACHE = new Map<StatusKey, InvoiceStatusRecord>();
let loaded = false;

function statusKey(tenant: string, invoiceId: string): StatusKey {
  return `${tenant}::${invoiceId}`;
}

function resolveStatusPath(): string {
  return path.join(resolveInvoiceStatusDir(), "status.jsonl");
}

async function ensureLoaded(): Promise<void> {
  if (loaded) {
    return;
  }
  const filePath = resolveStatusPath();
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      loaded = true;
      return;
    }
    throw error;
  }

  for (const line of content.split("\n")) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as InvoiceStatusRecord;
      const tenant = parsed.tenant || DEFAULT_TENANT;
      CACHE.set(statusKey(tenant, parsed.invoiceId), {
        ...parsed,
        tenant
      });
    } catch {
      // ignore malformed records
    }
  }
  loaded = true;
}

type SetInvoiceStatusParams = {
  tenant?: string;
  invoiceId: string;
  providerId?: string;
  status: ApDeliveryStatus;
  attempts?: number;
  lastError?: string;
};

export async function setInvoiceStatus(params: SetInvoiceStatusParams): Promise<InvoiceStatusRecord> {
  await ensureLoaded();
  const tenant = params.tenant?.trim() || DEFAULT_TENANT;
  const key = statusKey(tenant, params.invoiceId);
  const existing = CACHE.get(key);
  const updatedAt = new Date().toISOString();
  const attempts = params.attempts ?? existing?.attempts ?? 0;
  const record: InvoiceStatusRecord = {
    tenant,
    invoiceId: params.invoiceId,
    providerId: params.providerId ?? existing?.providerId,
    status: params.status,
    attempts,
    lastError:
      params.status === "error"
        ? params.lastError ?? existing?.lastError
        : undefined,
    updatedAt
  };

  CACHE.set(key, record);

  const filePath = resolveStatusPath();
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8" });
  return record;
}

export async function getInvoiceStatus(tenant: string | undefined, invoiceId: string): Promise<InvoiceStatusRecord | null> {
  await ensureLoaded();
  const normalizedTenant = tenant?.trim() || DEFAULT_TENANT;
  const exact = CACHE.get(statusKey(normalizedTenant, invoiceId));
  if (exact) {
    return exact;
  }
  if (tenant) {
    return null;
  }
  // Fallback to any tenant when none provided.
  for (const value of CACHE.values()) {
    if (value.invoiceId === invoiceId) {
      return value;
    }
  }
  return null;
}

export async function listInvoiceStatuses(): Promise<InvoiceStatusRecord[]> {
  await ensureLoaded();
  return Array.from(CACHE.values());
}

export function resetInvoiceStatusCache(): void {
  CACHE.clear();
  loaded = false;
}

export function getInvoiceStatusSnapshot(): InvoiceStatusRecord[] {
  return Array.from(CACHE.values());
}
