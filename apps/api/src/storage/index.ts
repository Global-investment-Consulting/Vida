import { PrismaClient } from "@prisma/client";
import { createFileDlqStore } from "./file/dlq.js";
import { createFileHistoryStore } from "./file/history.js";
import { createFileStatusStore, resetFileStatusCache } from "./file/status.js";
import { createPrismaDlqStore } from "./prisma/dlq.js";
import { createPrismaHistoryStore } from "./prisma/history.js";
import { createPrismaStatusStore } from "./prisma/status.js";
import type { StorageBundle } from "./types.js";

let storageCache: StorageBundle | null = null;
let prismaClient: PrismaClient | null = null;

function createFileStorage(): StorageBundle {
  return {
    history: createFileHistoryStore(),
    status: createFileStatusStore(),
    dlq: createFileDlqStore()
  };
}

function getOrCreatePrismaClient(): PrismaClient {
  if (!prismaClient) {
    prismaClient = new PrismaClient();
  }
  return prismaClient;
}

function createPrismaStorage(): StorageBundle {
  const client = getOrCreatePrismaClient();
  return {
    history: createPrismaHistoryStore(client),
    status: createPrismaStatusStore(client),
    dlq: createPrismaDlqStore(client)
  };
}

function resolveBackend(): "file" | "prisma" {
  const backend = (process.env.VIDA_STORAGE_BACKEND ?? "file").trim().toLowerCase();
  return backend === "prisma" ? "prisma" : "file";
}

export function getStorage(): StorageBundle {
  if (!storageCache) {
    storageCache = resolveBackend() === "prisma" ? createPrismaStorage() : createFileStorage();
  }
  return storageCache;
}

export async function resetStorage(): Promise<void> {
  if (storageCache) {
    resetFileStatusCache();
  }
  storageCache = null;
  if (prismaClient) {
    try {
      await prismaClient.$transaction([
        prismaClient.invoiceHistory.deleteMany(),
        prismaClient.invoiceStatus.deleteMany(),
        prismaClient.dlq.deleteMany()
      ]);
    } catch (error) {
      if (process.env.DEBUG_STORAGE_PRISMA === "1") {
        console.warn("[storage/prisma] reset cleanup failed", error);
      }
    }
    await prismaClient.$disconnect();
    prismaClient = null;
  }
}
