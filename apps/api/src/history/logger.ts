import { getStorage } from "../storage/index.js";
import type { InvoiceHistoryEntry } from "../storage/types.js";

export type HistoryRecord = InvoiceHistoryEntry;

export async function recordHistory(event: HistoryRecord): Promise<void> {
  await getStorage().history.append(event);
}

export async function listHistory(limit = 20, tenant?: string): Promise<HistoryRecord[]> {
  const normalizedTenant = tenant ?? "";
  return getStorage().history.list(normalizedTenant, limit);
}
