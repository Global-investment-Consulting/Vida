import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveHistoryDir } from "../../config.js";
import type { InvoiceHistoryEntry, InvoiceHistoryStore } from "../types.js";

const DEFAULT_LIMIT = 20;
const DEFAULT_TENANT = "__default__";

function normalizeTenantInput(tenant: string): string | null {
  const trimmed = tenant.trim();
  if (trimmed.length === 0 || trimmed === "*" || trimmed.toLowerCase() === "all") {
    return null;
  }
  return trimmed;
}

function resolveHistoryFile(timestampIso: string): string {
  const dir = resolveHistoryDir();
  const day = timestampIso.slice(0, 10);
  return path.join(dir, `${day}.jsonl`);
}

function matchesTenant(record: InvoiceHistoryEntry, tenant: string | null): boolean {
  if (!tenant) {
    return true;
  }
  const recordTenant = record.tenantId?.trim();
  return (recordTenant ?? DEFAULT_TENANT) === tenant;
}

async function append(entry: InvoiceHistoryEntry): Promise<void> {
  const filePath = resolveHistoryFile(entry.timestamp);
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
}

async function list(tenant: string, limit?: number): Promise<InvoiceHistoryEntry[]> {
  const dir = resolveHistoryDir();
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const normalizedTenant = normalizeTenantInput(tenant);
  const effectiveLimit = limit && Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : DEFAULT_LIMIT;

  const results: InvoiceHistoryEntry[] = [];

  const candidates = files
    .filter((file) => file.endsWith(".jsonl"))
    .sort((a, b) => (a < b ? 1 : -1));

  for (const file of candidates) {
    const content = await readFile(path.join(dir, file), "utf8");
    const lines = content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as InvoiceHistoryEntry);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const record = lines[index];
      if (!matchesTenant(record, normalizedTenant)) {
        continue;
      }
      results.push(record);
      if (results.length >= effectiveLimit) {
        return results;
      }
    }
  }

  return results;
}

export function createFileHistoryStore(): InvoiceHistoryStore {
  return {
    append,
    list
  };
}
