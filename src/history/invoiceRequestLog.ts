import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type InvoiceRequestStatus = "OK" | "INVALID";

export type InvoiceRequestRecord = {
  requestId: string;
  tenantId?: string;
  status: InvoiceRequestStatus;
  xmlSha256?: string;
  createdAt: string;
};

const LOG_DIR_ENV = "VIDA_INVOICE_REQUEST_LOG_DIR";

function resolveLogDir(): string {
  const customDir = process.env[LOG_DIR_ENV];
  if (customDir) {
    return path.resolve(customDir);
  }
  return path.resolve(process.cwd(), "data", "invoice-requests");
}

function resolveLogFile(createdAtIso: string): string {
  const day = createdAtIso.slice(0, 10);
  return path.join(resolveLogDir(), `${day}.jsonl`);
}

export async function recordInvoiceRequest(entry: InvoiceRequestRecord): Promise<string> {
  const filePath = resolveLogFile(entry.createdAt);
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
  return filePath;
}
