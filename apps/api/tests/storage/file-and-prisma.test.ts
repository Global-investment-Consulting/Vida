import { execFile as execFileCb } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetInvoiceStatusCache } from "src/history/invoiceStatus.js";
import { getStorage, resetStorage } from "src/storage/index.js";
import type { StorageBundle } from "src/storage/types.js";

const execFile = promisify(execFileCb);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..", "..");

type BackendConfig = {
  name: "file" | "prisma";
};

const BACKENDS: BackendConfig[] = [
  { name: "file" },
  { name: "prisma" }
];

async function preparePrismaBackend(): Promise<void> {
  const execName = process.platform === "win32" ? "npx.cmd" : "npx";
  await execFile(execName, ["prisma", "generate"], {
    cwd: projectRoot
  });
  await execFile(execName, ["prisma", "migrate", "deploy"], {
    cwd: projectRoot
  });
}

describe.each(BACKENDS)("storage backend: $name", ({ name }) => {
  let tmpRoot: string;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), `vida-storage-${name}-`));
    process.env.VIDA_STORAGE_BACKEND = name;
    process.env.VIDA_HISTORY_DIR = path.join(tmpRoot, "history");
    process.env.VIDA_INVOICE_STATUS_DIR = path.join(tmpRoot, "status");
    process.env.VIDA_DLQ_PATH = path.join(tmpRoot, "dlq.jsonl");

    if (name === "prisma") {
      process.env.DATABASE_URL = `file:${path.join(tmpRoot, "test.db")}`;
      await preparePrismaBackend();
    } else {
      delete process.env.DATABASE_URL;
    }

    await resetStorage();
    resetInvoiceStatusCache();
  });

  afterEach(async () => {
    resetInvoiceStatusCache();
    await resetStorage();
  });

  afterAll(async () => {
    resetInvoiceStatusCache();
    await resetStorage();
    delete process.env.VIDA_STORAGE_BACKEND;
    delete process.env.VIDA_HISTORY_DIR;
    delete process.env.VIDA_INVOICE_STATUS_DIR;
    delete process.env.VIDA_DLQ_PATH;
    delete process.env.DATABASE_URL;
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("persists invoice history and lists by tenant", async () => {
    const storage: StorageBundle = getStorage();
    const entry = {
      requestId: "req-test-1",
      timestamp: "2025-02-01T12:00:00.000Z",
      source: "shopify",
      orderNumber: "1001",
      tenantId: "tenant-a",
      status: "ok" as const,
      durationMs: 123
    };

    await storage.history.append(entry);

    const tenantEntries = await storage.history.list("tenant-a", 10);
    expect(tenantEntries).toHaveLength(1);
    expect(tenantEntries[0].requestId).toBe("req-test-1");

    const allEntries = await storage.history.list("", 10);
    expect(allEntries).toHaveLength(1);
  });

  it("stores and retrieves invoice status updates", async () => {
    const storage: StorageBundle = getStorage();
    const now = new Date().toISOString();
    await storage.status.set("tenant-a", "INV-100", {
      status: "queued",
      providerId: "prov-123",
      attempts: 1,
      updatedAt: now
    });

    let status = await storage.status.get("tenant-a", "INV-100");
    expect(status).not.toBeNull();
    expect(status?.status).toBe("queued");
    expect(status?.providerId).toBe("prov-123");
    expect(status?.attempts).toBe(1);

    const later = new Date(Date.now() + 1000).toISOString();
    await storage.status.set("tenant-a", "INV-100", {
      status: "error",
      attempts: 3,
      lastError: "adapter timeout",
      updatedAt: later
    });

    status = await storage.status.get("", "INV-100");
    expect(status).not.toBeNull();
    expect(status?.status).toBe("error");
    expect(status?.lastError).toMatch(/timeout/);
    expect(status?.attempts).toBe(3);
  });

  it("appends dead-letter entries and counts them", async () => {
    const storage: StorageBundle = getStorage();
    await storage.dlq.append({
      tenant: "tenant-a",
      invoiceId: "INV-DLQ",
      error: "permanent failure",
      payload: { reason: "mock" },
      ts: new Date().toISOString()
    });

    if (typeof storage.dlq.count === "function") {
      const count = await storage.dlq.count();
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });
});
