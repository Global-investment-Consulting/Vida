#!/usr/bin/env node
import process from "node:process";
import dotenv from "dotenv";
import axios from "axios";

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

const SUCCESS_STATUSES = new Set([
  "DELIVERED",
  "DELIVERY_CONFIRMED",
  "ACCEPTED",
  "COMPLETED",
  "SUCCESS"
]);
const FAILURE_STATUSES = new Set([
  "FAILED",
  "ERROR",
  "DELIVERY_FAILED",
  "REJECTED",
  "DECLINED",
  "CANCELLED"
]);
const PENDING_STATUSES = new Set([
  "QUEUED",
  "PENDING",
  "RECEIVED",
  "PROCESSING",
  "SENT",
  "SENT_TO_PEPPOL",
  "DISPATCHED"
]);

const DEFAULT_MAX_WAIT_MINUTES = Number.parseFloat(
  process.env.SCRADA_STATUS_MAX_WAIT_MINUTES ?? "40"
);
const DEFAULT_POLL_INTERVAL_SECONDS = Number.parseFloat(
  process.env.SCRADA_STATUS_POLL_INTERVAL_SECONDS ?? "60"
);

function normalizeStatus(status) {
  return status?.toUpperCase().replace(/\s+/g, "_") ?? "";
}

function classifyStatus(status) {
  const normalized = normalizeStatus(status);
  if (SUCCESS_STATUSES.has(normalized)) {
    return "success";
  }
  if (FAILURE_STATUSES.has(normalized)) {
    return "failure";
  }
  if (PENDING_STATUSES.has(normalized)) {
    return "pending";
  }
  return "unknown";
}

function extractStatusCode(error) {
  if (!error || typeof error !== "object") {
    return null;
  }
  const cause = error.cause;
  if (axios.isAxiosError(cause) && cause.response) {
    return cause.response.status ?? null;
  }
  if (axios.isAxiosError(error) && error.response) {
    return error.response.status ?? null;
  }
  return null;
}

function jitteredDelay(baseMs) {
  if (baseMs <= 0) {
    return 0;
  }
  const spread = Math.min(20_000, Math.max(3_000, Math.floor(baseMs * 0.15)));
  const offset = Math.floor((Math.random() - 0.5) * spread);
  return Math.max(0, baseMs + offset);
}

function sleep(ms) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    documentId: undefined,
    saveUbl: false,
    maxWaitMinutes: DEFAULT_MAX_WAIT_MINUTES,
    pollIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS
  };

  if (!argv[0] || argv[0].startsWith("-")) {
    return args;
  }

  args.documentId = argv[0];
  const rest = argv.slice(1);

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--save-ubl" || token === "--save") {
      args.saveUbl = true;
      continue;
    }
    if (token.startsWith("--max-wait-minutes=")) {
      args.maxWaitMinutes = Number.parseFloat(token.split("=", 2)[1]);
      continue;
    }
    if (token === "--max-wait-minutes" && rest[i + 1]) {
      args.maxWaitMinutes = Number.parseFloat(rest[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--poll-interval-seconds=")) {
      args.pollIntervalSeconds = Number.parseFloat(token.split("=", 2)[1]);
      continue;
    }
    if (token === "--poll-interval-seconds" && rest[i + 1]) {
      args.pollIntervalSeconds = Number.parseFloat(rest[i + 1]);
      i += 1;
      continue;
    }
  }

  return args;
}

function ensurePositiveNumber(value, fallback) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function printUsage() {
  console.log(
    "Usage: node scripts/scrada-status.mjs <documentId> [--save-ubl] [--max-wait-minutes <minutes>] [--poll-interval-seconds <seconds>]"
  );
}

async function pollScradaStatus(documentId, { maxWaitMinutes, pollIntervalSeconds }) {
  const maxWaitMs = minutesToMilliseconds(maxWaitMinutes);
  const intervalMs = Math.max(10_000, pollIntervalSeconds * 1000);
  const startedAt = Date.now();
  const history = [];
  let lastError = null;

  while (true) {
    const attempt = history.length + 1;
    console.error(`[scrada-status] Poll attempt ${attempt} for document ${documentId}.`);
    try {
      const info = await getOutboundStatus(documentId);
      const normalizedStatus = normalizeStatus(info.status);
      const classification = classifyStatus(info.status);
      history.push({
        attempt,
        fetchedAt: new Date().toISOString(),
        status: info.status ?? "unknown",
        normalizedStatus,
        classification
      });

      if (classification === "success" || classification === "failure") {
        return {
          info,
          classification,
          history,
          elapsedMs: Date.now() - startedAt
        };
      }

      if (classification === "unknown") {
        console.error(
          `[scrada-status] Received unclassified status "${info.status}". Continuing to poll.`
        );
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const statusCode = extractStatusCode(lastError);
      if (statusCode === 400 || statusCode === 404) {
        console.error(
          `[scrada-status] Status endpoint returned HTTP ${statusCode} for ${documentId}; retrying.`
        );
      } else {
        throw lastError;
      }
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= maxWaitMs) {
      const finalStatus = history.at(-1)?.status ?? "unknown";
      const timeoutError = new Error(
        `[scrada-status] Timed out after ${Math.round(
          elapsed / 1000
        )}s waiting for document ${documentId} (last status: ${finalStatus}).`
      );
      timeoutError.cause = lastError;
      throw timeoutError;
    }

    const delay = jitteredDelay(intervalMs);
    console.error(
      `[scrada-status] Waiting ${Math.round(delay / 1000)}s before next poll (document ${documentId}).`
    );
    await sleep(delay);
  }
}

function minutesToMilliseconds(minutes) {
  return Math.round(minutes * 60 * 1000);
}

async function maybeSaveUbl(documentId) {
  const ublXml = await getOutboundUbl(documentId);
  const key = `archive/peppol/${documentId}.xml`;
  const result = await saveArchiveObject(key, ublXml, {
    contentType: "application/xml",
    metadata: {
      documentId
    }
  });
  return {
    archived: true,
    location: result.location,
    driver: result.driver,
    key
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.documentId || args.documentId.startsWith("-")) {
    printUsage();
    process.exit(1);
  }

  const documentId = args.documentId.trim();
  const maxWaitMinutes = ensurePositiveNumber(args.maxWaitMinutes, DEFAULT_MAX_WAIT_MINUTES);
  const pollIntervalSeconds = ensurePositiveNumber(
    args.pollIntervalSeconds,
    DEFAULT_POLL_INTERVAL_SECONDS
  );

  try {
    const pollResult = await pollScradaStatus(documentId, {
      maxWaitMinutes,
      pollIntervalSeconds
    });
    const info = pollResult.info;

    const statusSummary = {
      documentId: info.documentId ?? documentId,
      status: info.status ?? "unknown",
      classification: pollResult.classification,
      attempts: info.attempts ?? null,
      externalReference: info.externalReference ?? null,
      errorMessage: info.errorMessage ?? null,
      fetchedAt: new Date().toISOString(),
      pollAttempts: pollResult.history.length,
      elapsedSeconds: Math.round(pollResult.elapsedMs / 1000),
      history: pollResult.history
    };

    console.log(JSON.stringify(statusSummary, null, 2));

    if (args.saveUbl && pollResult.classification === "success") {
      const archiveSummary = await maybeSaveUbl(documentId);
      console.log(JSON.stringify(archiveSummary, null, 2));
    } else if (args.saveUbl) {
      console.error("[scrada-status] Skipping UBL archive because document was not delivered.");
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
