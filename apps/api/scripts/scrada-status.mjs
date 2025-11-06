#!/usr/bin/env node
import process from "node:process";
import dotenv from "dotenv";

dotenv.config();

async function loadAdapter() {
  try {
    return await import("../dist/src/adapters/scrada.js");
  } catch {
    await import("tsx/esm");
    return import("../src/adapters/scrada.ts");
  }
}

const { pollOutboundDocument, fetchAndArchiveOutboundUbl } = await loadAdapter();

function parseArgs(argv) {
  const parsed = {
    documentId: null,
    archive: false,
    maxWaitMinutes: process.env.SCRADA_STATUS_MAX_WAIT_MINUTES,
    pollIntervalSeconds: process.env.SCRADA_STATUS_POLL_INTERVAL_SECONDS
  };

  if (argv[0] && !argv[0].startsWith("-")) {
    parsed.documentId = argv[0];
    argv = argv.slice(1);
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--archive") {
      parsed.archive = true;
      continue;
    }
    if (token === "--max-wait" && argv[i + 1]) {
      parsed.maxWaitMinutes = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--max-wait=")) {
      parsed.maxWaitMinutes = token.split("=", 2)[1];
      continue;
    }
    if (token === "--interval" && argv[i + 1]) {
      parsed.pollIntervalSeconds = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--interval=")) {
      parsed.pollIntervalSeconds = token.split("=", 2)[1];
      continue;
    }
  }

  return parsed;
}

function toNumber(raw, fallback) {
  if (raw === undefined || raw === null) {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function printUsage() {
  console.error("Usage: scrada-status.mjs <documentId> [--archive] [--max-wait <minutes>] [--interval <seconds>]");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.documentId) {
    printUsage();
    process.exit(1);
  }

  const documentId = args.documentId.trim();

  try {
    const pollResult = await pollOutboundDocument(documentId, {
      maxWaitMinutes: toNumber(args.maxWaitMinutes, undefined),
      pollIntervalSeconds: toNumber(args.pollIntervalSeconds, undefined),
      logger: (message) => console.error(message)
    });

    const statusSummary = {
      documentId,
      status: pollResult.info.status ?? "unknown",
      classification: pollResult.classification,
      attempts: pollResult.info.attempts ?? pollResult.history.length,
      history: pollResult.history,
      fetchedAt: new Date().toISOString()
    };

    console.log(JSON.stringify(statusSummary, null, 2));

    if (args.archive && pollResult.classification === "success") {
      const archiveResult = await fetchAndArchiveOutboundUbl(documentId);
      console.log(
        JSON.stringify(
          {
            archived: true,
            driver: archiveResult.driver,
            location: archiveResult.location,
            key: archiveResult.key
          },
          null,
          2
        )
      );
    } else if (args.archive) {
      console.error("[scrada-status] Skipping archive because document was not delivered.");
    }
  } catch (error) {
    console.error(
      "[scrada-status] Failed to poll Scrada document:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

await main();
