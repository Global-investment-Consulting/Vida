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

const { lookupParticipantById, lookupPartyBySchemeValue } = await loadAdapter();

const DEFAULT_RETRY_MINUTES = [2, 4, 8, 16];

function minutesToMilliseconds(minutes) {
  return Math.round(minutes * 60 * 1000);
}

function withJitter(baseMs) {
  if (baseMs <= 0) {
    return 0;
  }
  const spread = Math.min(30_000, Math.max(5_000, Math.floor(baseMs * 0.1)));
  const offset = Math.floor((Math.random() - 0.5) * spread);
  return Math.max(0, baseMs + offset);
}

function sleep(ms) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseArgs(argv) {
  const args = {
    participant: process.env.SCRADA_PARTICIPANT_ID,
    scheme: process.env.SCRADA_TEST_RECEIVER_SCHEME,
    receiverId: process.env.SCRADA_TEST_RECEIVER_ID
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--participant" && argv[i + 1]) {
      args.participant = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--participant=")) {
      args.participant = token.split("=", 2)[1];
      continue;
    }
    if (token === "--scheme" && argv[i + 1]) {
      args.scheme = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--scheme=")) {
      args.scheme = token.split("=", 2)[1];
      continue;
    }
    if (token === "--receiver-id" && argv[i + 1]) {
      args.receiverId = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--receiver-id=")) {
      args.receiverId = token.split("=", 2)[1];
    }
  }

  return args;
}

function resolveParticipantId(args) {
  const candidate = args.participant?.trim();
  if (candidate) {
    return candidate;
  }
  const scheme = args.scheme?.trim();
  const receiverId = args.receiverId?.trim();
  if (scheme && receiverId) {
    return `${scheme}:${receiverId}`;
  }
  if (!scheme && !receiverId) {
    throw new Error(
      "Missing participant identifier. Provide SCRADA_PARTICIPANT_ID or both SCRADA_TEST_RECEIVER_SCHEME and SCRADA_TEST_RECEIVER_ID."
    );
  }
  if (!scheme) {
    throw new Error(
      "Missing SCRADA_TEST_RECEIVER_SCHEME. Provide SCRADA_PARTICIPANT_ID or ensure both receiver variables are set."
    );
  }
  throw new Error(
    "Missing SCRADA_TEST_RECEIVER_ID. Provide SCRADA_PARTICIPANT_ID or ensure both receiver variables are set."
  );
}

function extractStatus(error) {
  if (!error || typeof error !== "object") {
    return null;
  }
  const maybeAxios = error.cause;
  if (axios.isAxiosError(maybeAxios) && maybeAxios.response) {
    return maybeAxios.response.status ?? null;
  }
  if ("cause" in error && typeof error.cause === "object" && error.cause) {
    const nested = error.cause;
    if (axios.isAxiosError(nested) && nested.response) {
      return nested.response.status ?? null;
    }
  }
  return null;
}

function buildSummary({
  participantId,
  exists,
  attempts,
  elapsedMs,
  response,
  lastError,
  method,
  skipped
}) {
  return {
    participantId,
    exists,
    attempts,
    elapsedSeconds: Math.round(elapsedMs / 1000),
    timestamp: new Date().toISOString(),
    response,
    method: method ?? null,
    skipped: Boolean(skipped),
    lastError: lastError ? { message: lastError.message, status: extractStatus(lastError) } : null
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const participantId = resolveParticipantId(args);
  const skipPref = (process.env.SCRADA_SKIP_PARTICIPANT_PREFLIGHT ?? "").trim().toLowerCase() === "true";
  const start = Date.now();

  if (skipPref) {
    console.warn("[scrada-wait-participant] Preflight skip enabled via SCRADA_SKIP_PARTICIPANT_PREFLIGHT.");
    const summary = buildSummary({
      participantId,
      exists: true,
      attempts: 0,
      elapsedMs: Date.now() - start,
      response: null,
      lastError: null,
      method: "skipped",
      skipped: true
    });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  const maxAttempts = DEFAULT_RETRY_MINUTES.length + 1;
  let attempts = 0;
  let lastError = null;
  let lastParticipantResponse = null;
  let lastPartyResponse = null;
  const scheme = args.scheme?.trim() || process.env.SCRADA_TEST_RECEIVER_SCHEME?.trim();
  const receiverValue = args.receiverId?.trim() || process.env.SCRADA_TEST_RECEIVER_ID?.trim();
  const composedResponses = () => ({
    participantLookup: lastParticipantResponse,
    partyLookup: lastPartyResponse
  });

  for (let i = 0; i < maxAttempts; i += 1) {
    if (i > 0) {
      const waitMs = withJitter(minutesToMilliseconds(DEFAULT_RETRY_MINUTES[i - 1]));
      console.error(
        `[scrada-wait-participant] Waiting ${Math.round(waitMs / 1000)}s before retry ${i + 1} for ${participantId}.`
      );
      await sleep(waitMs);
    }

    attempts += 1;
    console.error(`[scrada-wait-participant] Attempt ${attempts} lookup for ${participantId}.`);

    try {
      const result = await lookupParticipantById(participantId);
      lastParticipantResponse = result.response ?? null;

      if (result.exists) {
        const summary = buildSummary({
          participantId,
          exists: true,
          attempts,
          elapsedMs: Date.now() - start,
          response: composedResponses(),
          lastError,
          method: "participantLookup",
          skipped: false
        });
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      lastError = new Error("Participant not found in participantLookup response");
      console.error(
        `[scrada-wait-participant] Participant ${participantId} not found (attempt ${attempts}).`
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const status = extractStatus(lastError);
      if (status === 400 || status === 404) {
        console.error(
          `[scrada-wait-participant] Participant ${participantId} not yet available (HTTP ${status}) on attempt ${attempts}.`
        );
      } else {
        console.error(
          `[scrada-wait-participant] Participant lookup failed with non-retryable error: ${lastError.message}`
        );
        throw lastError;
      }
    }

    if (scheme && receiverValue) {
      try {
        const partyResult = await lookupPartyBySchemeValue(scheme, receiverValue, {
          countryCode: "BE"
        });
        lastPartyResponse = partyResult.response ?? null;
        if (partyResult.exists) {
          const summary = buildSummary({
            participantId: partyResult.peppolId,
            exists: true,
            attempts,
            elapsedMs: Date.now() - start,
            response: composedResponses(),
            lastError,
            method: "partyLookup",
            skipped: false
          });
          console.log(JSON.stringify(summary, null, 2));
          return;
        }
        lastError = new Error("Participant not found in partyLookup response");
        console.error(
          `[scrada-wait-participant] Party lookup did not resolve participant ${scheme}:${receiverValue} on attempt ${attempts}.`
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const status = extractStatus(lastError);
        if (status === 400 || status === 404) {
          console.error(
            `[scrada-wait-participant] Party lookup for ${scheme}:${receiverValue} returned HTTP ${status} on attempt ${attempts}.`
          );
        } else {
          console.error(
            `[scrada-wait-participant] Party lookup failed with non-retryable error: ${lastError.message}`
          );
          throw lastError;
        }
      }
    }
  }

  const elapsed = Date.now() - start;
  console.error(
    `[scrada-wait-participant] Participant ${participantId} not found after ${attempts} attempts spanning ${Math.round(
      elapsed / 1000
    )}s.`
  );
  const summary = buildSummary({
    participantId,
    exists: false,
    attempts,
    elapsedMs: elapsed,
    response: composedResponses(),
    lastError,
    method: null,
    skipped: false
  });
  console.log(JSON.stringify(summary, null, 2));
  process.exit(1);
}

try {
  await main();
} catch (error) {
  console.error(
    "[scrada-wait-participant] Failed during participant wait:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
}
