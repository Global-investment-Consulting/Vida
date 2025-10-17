import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const HISTORY_ENV = "VIDA_HISTORY_DIR";

export type HistoryStatus = "ok" | "error";

export type HistoryRecord = {
  requestId: string;
  timestamp: string;
  source?: string;
  orderNumber?: string;
  originalOrderId?: string | number;
  status: HistoryStatus;
  invoicePath?: string;
  durationMs: number;
  error?: string;
  peppolStatus?: string;
  peppolId?: string;
  validationErrors?: { path: string; msg: string }[];
};

function resolveHistoryDir(): string {
  const custom = process.env[HISTORY_ENV];
  if (custom) {
    return path.resolve(custom);
  }
  return path.resolve(process.cwd(), "data", "history");
}

export async function recordHistory(event: HistoryRecord): Promise<string> {
  const dir = resolveHistoryDir();
  await mkdir(dir, { recursive: true });
  const day = event.timestamp.slice(0, 10);
  const filePath = path.join(dir, `${day}.jsonl`);
  await appendFile(filePath, `${JSON.stringify(event)}\n`, { encoding: "utf8" });
  return filePath;
}

export async function listHistory(limit = 20): Promise<HistoryRecord[]> {
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

  const candidates = files
    .filter((file) => file.endsWith(".jsonl"))
    .sort((a, b) => (a < b ? 1 : -1));

  const results: HistoryRecord[] = [];

  for (const file of candidates) {
    const content = await readFile(path.join(dir, file), "utf8");
    const lines = content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as HistoryRecord);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      results.push(lines[index]);
      if (results.length >= limit) {
        return results;
      }
    }
  }

  return results;
}
