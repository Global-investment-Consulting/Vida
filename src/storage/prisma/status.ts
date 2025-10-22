import type { PrismaClient, Prisma } from "@prisma/client";
import type { InvoiceStatusValue, StatusStore } from "../types.js";

const DEFAULT_TENANT = "__default__";

function normalizeTenant(tenant: string): string {
  const trimmed = tenant.trim();
  if (trimmed.length === 0) {
    return DEFAULT_TENANT;
  }
  return trimmed;
}

function mapRowToValue(row: {
  tenant: string;
  invoiceId: string;
  status: string;
  providerId: string | null;
  attempts: number;
  lastError: string | null;
  updatedAt: Date;
}): InvoiceStatusValue {
  return {
    tenant: row.tenant,
    invoiceId: row.invoiceId,
    status: row.status as InvoiceStatusValue["status"],
    providerId: row.providerId ?? undefined,
    attempts: row.attempts,
    lastError: row.lastError ?? undefined,
    updatedAt: row.updatedAt.toISOString()
  };
}

export function createPrismaStatusStore(client: PrismaClient): StatusStore {
  return {
    async get(tenant: string, invoiceId: string): Promise<InvoiceStatusValue | null> {
      const trimmed = tenant.trim();
      if (trimmed.length === 0) {
        const row = await client.invoiceStatus.findFirst({
          where: { invoiceId },
          orderBy: { updatedAt: "desc" }
        });
        return row ? mapRowToValue(row) : null;
      }

      const normalizedTenant = normalizeTenant(trimmed);
      const row = await client.invoiceStatus.findUnique({
        where: {
          tenant_invoiceId: {
            tenant: normalizedTenant,
            invoiceId
          }
        }
      });

      return row ? mapRowToValue(row) : null;
    },

    async set(
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
      const normalizedTenant = normalizeTenant(tenant);
      const createData: Prisma.InvoiceStatusCreateInput = {
        tenant: normalizedTenant,
        invoiceId,
        status: value.status,
        providerId: value.providerId ?? null,
        attempts: value.attempts ?? 0,
        lastError: value.status === "error" ? value.lastError ?? null : null
      };

      const updateData: Prisma.InvoiceStatusUpdateInput = {
        status: value.status,
        ...(value.providerId !== undefined ? { providerId: value.providerId } : {}),
        ...(value.attempts !== undefined ? { attempts: value.attempts } : {}),
        lastError: value.status === "error" ? value.lastError ?? null : null
      };

      await client.invoiceStatus.upsert({
        where: {
          tenant_invoiceId: {
            tenant: normalizedTenant,
            invoiceId
          }
        },
        create: createData,
        update: updateData
      });
    },

    async snapshot(): Promise<InvoiceStatusValue[]> {
      const rows = await client.invoiceStatus.findMany();
      return rows.map(mapRowToValue);
    }
  };
}
