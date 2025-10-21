import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveInvoiceRequestLogDir } from "../config.js"; // migrated

export type InvoiceRequestStatus = "OK" | "INVALID";

export type InvoiceRequestRecord = {
  requestId: string;
  tenantId?: string;
  status: InvoiceRequestStatus;
  xmlSha256?: string;
  createdAt: string;
};

function resolveLogFile(createdAtIso: string): string {
  const day = createdAtIso.slice(0, 10);
  return path.join(resolveInvoiceRequestLogDir(), `${day}.jsonl`);
}

export async function recordInvoiceRequest(entry: InvoiceRequestRecord): Promise<string> {
  const filePath = resolveLogFile(entry.createdAt);
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
  return filePath;
}
