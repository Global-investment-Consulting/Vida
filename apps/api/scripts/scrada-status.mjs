#!/usr/bin/env node
import process from "node:process";
import dotenv from "dotenv";

dotenv.config();

async function loadAdapter() {
  try {
    return await import("../dist/src/adapters/scrada.js");
  } catch (error) {
    await import("tsx/esm");
    return import("../src/adapters/scrada.ts");
  }
}

async function loadStorage() {
  try {
    return await import("../dist/src/lib/storage.js");
  } catch (error) {
    await import("tsx/esm");
    return import("../src/lib/storage.ts");
  }
}

const { getOutboundStatus, getOutboundUbl } = await loadAdapter();
const { saveArchiveObject } = await loadStorage();

function printUsage() {
  console.log("Usage: node scripts/scrada-status.mjs <documentId> [--save-ubl]");
}

async function main() {
  const [, , documentId, ...rest] = process.argv;
  if (!documentId || documentId.startsWith("-")) {
    printUsage();
    process.exit(1);
  }

  const flags = new Set(rest);
  const shouldSaveUbl = flags.has("--save-ubl") || flags.has("--save");

  try {
    const info = await getOutboundStatus(documentId);
    const statusSummary = {
      documentId: info.documentId ?? documentId,
      status: info.status ?? "unknown",
      attempts: info.attempts ?? null,
      externalReference: info.externalReference ?? null,
      errorMessage: info.errorMessage ?? null,
      fetchedAt: new Date().toISOString()
    };

    console.log(JSON.stringify(statusSummary, null, 2));

    if (shouldSaveUbl) {
      const ublXml = await getOutboundUbl(documentId);
      const key = `archive/peppol/${documentId}.xml`;
      const result = await saveArchiveObject(key, ublXml, {
        contentType: "application/xml",
        metadata: {
          documentId
        }
      });
      console.log(
        JSON.stringify(
          {
            archived: true,
            location: result.location,
            driver: result.driver,
            key
          },
          null,
          2
        )
      );
    }
  } catch (error) {
    console.error(
      "[scrada-status] Failed to fetch Scrada document:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

await main();
