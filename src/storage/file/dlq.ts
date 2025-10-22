import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveDlqPath } from "../../config.js";
import type { DlqItem, DlqStore } from "../types.js";

async function append(item: DlqItem): Promise<void> {
  const filePath = resolveDlqPath();
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  await appendFile(filePath, `${JSON.stringify(item)}\n`, { encoding: "utf8" });
}

async function count(): Promise<number> {
  const filePath = resolveDlqPath();
  try {
    const content = await readFile(filePath, "utf8");
    return content.split("\n").filter(Boolean).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

export function createFileDlqStore(): DlqStore {
  return {
    append,
    count
  };
}
