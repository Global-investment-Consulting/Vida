import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveDlqPath } from "../../config.js";
import type { DlqItem, DlqStore } from "../types.js";

function ensureId(item: DlqItem): DlqItem {
  if (item.id && item.id.length > 0) {
    return item;
  }
  return {
    ...item,
    id: `${item.tenant}:${item.invoiceId}:${item.ts}`
  };
}

async function readItems(): Promise<DlqItem[]> {
  const filePath = resolveDlqPath();
  try {
    const content = await readFile(filePath, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          const parsed = JSON.parse(line) as DlqItem;
          return ensureId(parsed);
        } catch (error) {
          return ensureId({
            id: randomUUID(),
            tenant: "__unknown__",
            invoiceId: "unknown",
            error: `Failed to parse DLQ line: ${(error as Error).message}`,
            ts: new Date().toISOString()
          });
        }
      })
      .sort((a, b) => b.ts.localeCompare(a.ts));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeItems(items: DlqItem[]): Promise<void> {
  const filePath = resolveDlqPath();
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const payload = items.map((item) => JSON.stringify(item)).join("\n");
  await writeFile(filePath, payload.length > 0 ? `${payload}\n` : "", "utf8");
}

async function append(item: DlqItem): Promise<void> {
  const filePath = resolveDlqPath();
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const entry = ensureId({ ...item, id: item.id ?? randomUUID() });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
}

async function count(): Promise<number> {
  const items = await readItems();
  return items.length;
}

export function createFileDlqStore(): DlqStore {
  return {
    append,
    async list(options) {
      const items = await readItems();
      const filtered = options?.tenant
        ? items.filter((item) => item.tenant === options.tenant)
        : items;
      if (options?.limit && options.limit > 0) {
        return filtered.slice(0, options.limit);
      }
      return filtered;
    },
    async remove(id) {
      const items = await readItems();
      const next = items.filter((item) => item.id !== id);
      if (next.length === items.length) {
        return false;
      }
      await writeItems(next);
      return true;
    },
    count
  };
}
