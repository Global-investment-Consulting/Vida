import { createReadStream } from "node:fs";
import { access, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { resolveHistoryDir } from "../config.js";

function resolveStoreDir(): string {
  const override = process.env.VIDA_PUBLIC_API_STORE_DIR;
  if (override && override.trim().length > 0) {
    return path.resolve(override);
  }
  return path.resolve(process.cwd(), "data", "public-api");
}

function resolveStoreFile(): string {
  return path.join(resolveStoreDir(), "submissions.jsonl");
}

export type SubmissionArtifacts = {
  requestPath: string;
  sendPath: string;
  statusPath: string;
  patchedPath: string;
};

export type SubmissionRecord = {
  scope: string;
  tenant: string;
  idempotencyKey: string;
  invoiceId: string;
  externalReference: string;
  documentId: string;
  status: string;
  buyerReference?: string;
  artifacts: SubmissionArtifacts;
  createdAt: string;
  updatedAt: string;
};

export type SubmissionCreateInput = {
  scope: string;
  tenant: string;
  idempotencyKey: string;
  invoiceId: string;
  externalReference: string;
  documentId: string;
  status: string;
  buyerReference?: string;
};

const submissionsByInvoiceId = new Map<string, SubmissionRecord>();
const submissionsByScope = new Map<string, SubmissionRecord>();
let initialized = false;
let initializePromise: Promise<void> | null = null;
let activeStoreFile: string | null = null;

function sanitizeInvoiceId(invoiceId: string): string {
  const trimmed = invoiceId.trim();
  if (!trimmed) {
    throw new Error("[submissionsStore] invoiceId is required");
  }
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildArtifacts(invoiceId: string): SubmissionArtifacts {
  const base = path.join(resolveHistoryDir(), sanitizeInvoiceId(invoiceId));
  return {
    requestPath: path.join(base, "request.json"),
    sendPath: path.join(base, "send.json"),
    statusPath: path.join(base, "status.json"),
    patchedPath: path.join(base, "patched.xml")
  };
}

async function ensureInitialized(): Promise<void> {
  const storeFile = resolveStoreFile();
  if (activeStoreFile !== storeFile) {
    submissionsByInvoiceId.clear();
    submissionsByScope.clear();
    initializePromise = null;
    initialized = false;
    activeStoreFile = storeFile;
  }
  if (initialized) {
    return;
  }
  if (!initializePromise) {
    initializePromise = loadFromDisk(storeFile);
  }
  await initializePromise;
  initialized = true;
}

async function loadFromDisk(storeFile: string): Promise<void> {
  try {
    await access(storeFile);
  } catch {
    return;
  }

  const stream = createReadStream(storeFile, { encoding: "utf8" });
  const rl = createInterface({
    input: stream,
    crlfDelay: Number.POSITIVE_INFINITY
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const record = JSON.parse(trimmed) as SubmissionRecord;
      submissionsByInvoiceId.set(record.invoiceId, record);
      submissionsByScope.set(record.scope, record);
    } catch (error) {
      console.warn("[submissionsStore] failed to parse submission record", error);
    }
  }
}

async function appendRecord(record: SubmissionRecord): Promise<void> {
  const storeDir = resolveStoreDir();
  const storeFile = resolveStoreFile();
  await mkdir(storeDir, { recursive: true });
  await appendFile(storeFile, `${JSON.stringify(record)}\n`, "utf8");
}

async function persistRecord(record: SubmissionRecord): Promise<void> {
  await ensureInitialized();
  submissionsByInvoiceId.set(record.invoiceId, record);
  submissionsByScope.set(record.scope, record);
  await appendRecord(record);
}

function buildRecord(input: SubmissionCreateInput): SubmissionRecord {
  const timestamps = {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  return {
    ...input,
    artifacts: buildArtifacts(input.invoiceId),
    ...timestamps
  };
}

export async function saveSubmission(input: SubmissionCreateInput): Promise<SubmissionRecord> {
  const record = buildRecord(input);
  await persistRecord(record);
  return record;
}

export async function findSubmissionByScope(scope: string): Promise<SubmissionRecord | null> {
  await ensureInitialized();
  return submissionsByScope.get(scope) ?? null;
}

export async function findSubmissionByInvoiceId(invoiceId: string): Promise<SubmissionRecord | null> {
  await ensureInitialized();
  return submissionsByInvoiceId.get(invoiceId) ?? null;
}

type SubmissionListOptions = {
  tenant?: string;
  status?: string;
  limit?: number;
};

export async function listSubmissions(options: SubmissionListOptions = {}): Promise<SubmissionRecord[]> {
  await ensureInitialized();
  let records = Array.from(submissionsByInvoiceId.values());
  if (options.tenant) {
    records = records.filter((record) => record.tenant === options.tenant);
  }
  if (options.status) {
    const normalized = options.status.trim().toUpperCase();
    records = records.filter((record) => record.status.toUpperCase() === normalized);
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (options.limit && options.limit > 0) {
    records = records.slice(0, options.limit);
  }
  return records;
}

export async function updateSubmissionStatus(invoiceId: string, status: string): Promise<void> {
  await ensureInitialized();
  const existing = submissionsByInvoiceId.get(invoiceId);
  if (!existing) {
    return;
  }
  if (existing.status === status) {
    return;
  }
  const updated: SubmissionRecord = {
    ...existing,
    status,
    updatedAt: new Date().toISOString()
  };
  await persistRecord(updated);
}

export function resetSubmissionsStoreCache(): void {
  submissionsByInvoiceId.clear();
  submissionsByScope.clear();
  initialized = false;
  initializePromise = null;
  activeStoreFile = null;
}
