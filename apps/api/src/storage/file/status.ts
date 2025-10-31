import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveInvoiceStatusDir } from "../../config.js";
import type { InvoiceStatusValue, StatusStore } from "../types.js";

const DEFAULT_TENANT = "__default__";
const CACHE = new Map<string, InvoiceStatusValue>();
let loaded = false;

function normalizeTenant(tenant: string): string {
  const trimmed = tenant.trim();
  if (trimmed.length === 0) {
    return DEFAULT_TENANT;
  }
  return trimmed;
}

function statusKey(tenant: string, invoiceId: string): string {
  return `${tenant}::${invoiceId}`;
}

function statusFilePath(): string {
  return path.join(resolveInvoiceStatusDir(), "status.jsonl");
}

async function ensureLoaded(): Promise<void> {
  if (loaded) {
    return;
  }
  const filePath = statusFilePath();
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
      const parsed = JSON.parse(line) as InvoiceStatusValue;
      const tenant = normalizeTenant(parsed.tenant);
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

async function get(tenant: string, invoiceId: string): Promise<InvoiceStatusValue | null> {
  await ensureLoaded();
  const normalizedTenant = normalizeTenant(tenant);
  const direct = CACHE.get(statusKey(normalizedTenant, invoiceId));
  if (direct) {
    return direct;
  }
  if (tenant.trim().length > 0) {
    return null;
  }
  // Fallback to any tenant when none provided.
  for (const record of CACHE.values()) {
    if (record.invoiceId === invoiceId) {
      return record;
    }
  }
  return null;
}

async function set(
  tenant: string,
  invoiceId: string,
  value: {
    status: InvoiceStatusValue["status"];
    providerId?: string;
    attempts?: number;
    lastError?: string;
    updatedAt: string;
  }
): Promise<void> {
  await ensureLoaded();
  const normalizedTenant = normalizeTenant(tenant);
  const key = statusKey(normalizedTenant, invoiceId);
  const existing = CACHE.get(key);
  const record: InvoiceStatusValue = {
    tenant: normalizedTenant,
    invoiceId,
    providerId: value.providerId ?? existing?.providerId,
    status: value.status,
    attempts: value.attempts ?? existing?.attempts ?? 0,
    lastError: value.status === "error" ? value.lastError ?? existing?.lastError : undefined,
    updatedAt: value.updatedAt
  };
  CACHE.set(key, record);

  const filePath = statusFilePath();
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8" });
}

async function snapshot(): Promise<InvoiceStatusValue[]> {
  await ensureLoaded();
  return Array.from(CACHE.values());
}

export function resetFileStatusCache(): void {
  CACHE.clear();
  loaded = false;
}

export function createFileStatusStore(): StatusStore & { reset(): void } {
  return {
    get,
    set,
    snapshot,
    reset: resetFileStatusCache
  };
}
