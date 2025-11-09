import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveHistoryDir } from "../config.js";

export type HistoryArtifact = "request" | "send" | "status" | "patched";

const ARTIFACT_NAMES: Record<Exclude<HistoryArtifact, "patched">, string> = {
  request: "request.json",
  send: "send.json",
  status: "status.json"
};

const TEXT_ARTIFACT_NAMES: Record<"patched", string> = {
  patched: "patched.xml"
};

const sanitizeInvoiceId = (invoiceId: string): string => {
  const trimmed = invoiceId.trim();
  if (!trimmed) {
    throw new Error("[history] invoiceId is required");
  }
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
};

async function ensureInvoiceDir(invoiceId: string): Promise<string> {
  const dir = path.join(resolveHistoryDir(), sanitizeInvoiceId(invoiceId));
  await mkdir(dir, { recursive: true });
  return dir;
}

function artifactPath(invoiceId: string, artifact: HistoryArtifact): string {
  const dir = path.join(resolveHistoryDir(), sanitizeInvoiceId(invoiceId));
  if (artifact === "patched") {
    return path.join(dir, TEXT_ARTIFACT_NAMES.patched);
  }
  return path.join(dir, ARTIFACT_NAMES[artifact]);
}

export async function saveHistoryJson<T>(invoiceId: string, artifact: "request" | "send" | "status", payload: T): Promise<void> {
  const dir = await ensureInvoiceDir(invoiceId);
  const fileName = ARTIFACT_NAMES[artifact];
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

export async function saveHistoryText(invoiceId: string, artifact: "patched", contents: string): Promise<void> {
  const dir = await ensureInvoiceDir(invoiceId);
  const fileName = TEXT_ARTIFACT_NAMES[artifact];
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, contents, "utf8");
}

export async function loadHistoryJson<T>(
  invoiceId: string,
  artifact: "request" | "send" | "status"
): Promise<T | null> {
  const filePath = artifactPath(invoiceId, artifact);
  try {
    const data = await readFile(filePath, "utf8");
    return JSON.parse(data) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function loadHistoryText(invoiceId: string, artifact: "patched"): Promise<string | null> {
  const filePath = artifactPath(invoiceId, artifact);
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
