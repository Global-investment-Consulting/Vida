import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Storage } from "@google-cloud/storage";

type Driver = "gcs" | "local";

export interface SaveOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface SaveResult {
  driver: Driver;
  location: string;
  key: string;
}

const LOCAL_ROOT = path.resolve(process.cwd(), ".data");
const DEFAULT_BUCKET = "vida-archive-test";

let storageClient: Storage | null = null;
let driverCache: Driver | null = null;

function normalizeKey(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function resolveDriver(): Driver {
  if (driverCache) {
    return driverCache;
  }
  const hasGcpCredentials =
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) ||
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim()) ||
    Boolean(process.env.GCLOUD_PROJECT?.trim()) ||
    Boolean(process.env.GCP_PROJECT?.trim());
  driverCache = hasGcpCredentials ? "gcs" : "local";
  return driverCache;
}

function getStorage(): Storage {
  if (!storageClient) {
    storageClient = new Storage();
  }
  return storageClient;
}

async function saveToGcs(
  key: string,
  payload: Buffer | string,
  options: SaveOptions
): Promise<SaveResult> {
  const bucketName = process.env.ARCHIVE_BUCKET?.trim() || DEFAULT_BUCKET;
  const bucket = getStorage().bucket(bucketName);
  const file = bucket.file(key);
  await file.save(payload, {
    resumable: false,
    contentType: options.contentType,
    metadata: options.metadata
  });
  return {
    driver: "gcs",
    location: `gs://${bucketName}/${key}`,
    key
  };
}

async function saveToLocal(key: string, payload: Buffer | string): Promise<SaveResult> {
  const filePath = path.join(LOCAL_ROOT, key);
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, payload);
  return {
    driver: "local",
    location: filePath,
    key
  };
}

export async function saveArchiveObject(
  relativePath: string,
  data: string | Buffer,
  options: SaveOptions = {}
): Promise<SaveResult> {
  const key = normalizeKey(relativePath);
  if (!key) {
    throw new Error("[storage] archive key is required");
  }
  const payload = typeof data === "string" ? data : data;
  if (resolveDriver() === "gcs") {
    return saveToGcs(key, payload, options);
  }
  return saveToLocal(key, payload);
}

export function getArchiveBasePath(): string {
  if (resolveDriver() === "gcs") {
    const bucketName = process.env.ARCHIVE_BUCKET?.trim() || DEFAULT_BUCKET;
    return `gs://${bucketName}/archive`;
  }
  return path.join(LOCAL_ROOT, "archive");
}
