import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
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
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
  return serialized;
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
    },
    async list(options) {
      const records = await client.dlq.findMany({
        where: options?.tenant ? { tenant: normalizeTenant(options.tenant) } : undefined,
        orderBy: { ts: "desc" },
        take: options?.limit && options.limit > 0 ? options.limit : undefined
      });
      return records.map((record) => {
        let parsedPayload: unknown;
        if (record.payload) {
          try {
            parsedPayload = JSON.parse(record.payload);
          } catch {
            parsedPayload = record.payload;
          }
        }
        return {
          id: record.id,
          tenant: record.tenant,
          invoiceId: record.invoiceId,
          error: record.error,
          payload: parsedPayload,
          ts: record.ts.toISOString()
        } satisfies DlqItem;
      });
    },
    async remove(id) {
      try {
        await client.dlq.delete({ where: { id } });
        return true;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          return false;
        }
        throw error;
      }
    }
  };
}
