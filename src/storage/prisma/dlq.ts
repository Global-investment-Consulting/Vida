import type { PrismaClient, Prisma } from "@prisma/client";
import type { DlqItem, DlqStore } from "../types.js";

function normalizeTenant(tenant: string): string {
  const trimmed = tenant.trim();
  if (trimmed.length === 0 || trimmed === "__default__") {
    return "__default__";
  }
  return trimmed;
}

function parseTimestamp(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function serializePayload(payload: DlqItem["payload"]): Prisma.DlqCreateInput["payload"] {
  if (payload === undefined || payload === null) {
    return null;
  }
  const url = process.env.DATABASE_URL ?? "";
  const isSqlite = url.startsWith("file:") || url.startsWith("sqlite:");
  const serialized = isSqlite ? JSON.stringify(payload) : payload;
  return serialized as Prisma.DlqCreateInput["payload"];
}

export function createPrismaDlqStore(client: PrismaClient): DlqStore {
  return {
    async append(item: DlqItem): Promise<void> {
      await client.dlq.create({
        data: {
          tenant: normalizeTenant(item.tenant),
          invoiceId: item.invoiceId,
          error: item.error,
          payload: serializePayload(item.payload),
          ts: parseTimestamp(item.ts)
        }
      });
    },
    async count(): Promise<number> {
      return client.dlq.count();
    }
  };
}
