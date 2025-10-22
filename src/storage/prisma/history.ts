import type { PrismaClient, Prisma } from "@prisma/client";
import type { InvoiceHistoryEntry, InvoiceHistoryStore } from "../types.js";

const DEFAULT_TENANT = "__default__";
const DEFAULT_LIMIT = 20;

function normalizeTenantInput(tenant: string): string | null {
  const trimmed = tenant.trim();
  if (trimmed.length === 0 || trimmed === "*" || trimmed.toLowerCase() === "all") {
    return null;
  }
  return trimmed;
}

function resolveTenant(entry: InvoiceHistoryEntry): string {
  const tenant = entry.tenantId?.trim();
  if (!tenant || tenant.length === 0) {
    return DEFAULT_TENANT;
  }
  return tenant;
}

function resolveInvoiceId(entry: InvoiceHistoryEntry): string {
  if (entry.invoiceId && entry.invoiceId.trim().length > 0) {
    return entry.invoiceId.trim();
  }
  return entry.requestId;
}

function parseTimestamp(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function usesSqlite(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return url.startsWith("file:") || url.startsWith("sqlite:");
}

function serializePayload(entry: InvoiceHistoryEntry): Prisma.InvoiceHistoryCreateInput["payload"] {
  const serialized = usesSqlite() ? JSON.stringify(entry) : entry;
  return serialized as Prisma.InvoiceHistoryCreateInput["payload"];
}

function deserializePayload(raw: unknown): InvoiceHistoryEntry | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as InvoiceHistoryEntry;
    } catch {
      return null;
    }
  }
  return raw as InvoiceHistoryEntry;
}

export function createPrismaHistoryStore(client: PrismaClient): InvoiceHistoryStore {
  return {
    async append(entry: InvoiceHistoryEntry): Promise<void> {
      await client.invoiceHistory.create({
        data: {
          tenant: resolveTenant(entry),
          invoiceId: resolveInvoiceId(entry),
          payload: serializePayload(entry),
          ts: parseTimestamp(entry.timestamp)
        }
      });
    },

    async list(tenant: string, limit?: number): Promise<InvoiceHistoryEntry[]> {
      const normalizedTenant = normalizeTenantInput(tenant);
      const take = limit && Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : DEFAULT_LIMIT;
      const rows = await client.invoiceHistory.findMany({
        where: normalizedTenant ? { tenant: normalizedTenant } : undefined,
        orderBy: { ts: "desc" },
        take
      });

      const entries: InvoiceHistoryEntry[] = [];
      for (const row of rows) {
        const payload = deserializePayload(row.payload);
        if (payload) {
          entries.push(payload);
        }
      }
      return entries;
    }
  };
}
