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

const { lookupParticipantById } = await loadAdapter();

const DEFAULT_MAX_ATTEMPTS = Number.parseInt(process.env.SCRADA_PARTICIPANT_MAX_ATTEMPTS ?? "10", 10);
const DEFAULT_INTERVAL_SECONDS = Number.parseFloat(process.env.SCRADA_PARTICIPANT_INTERVAL_SECONDS ?? "30");

function parseArgs(argv) {
  const parsed = {
    participant: process.env.SCRADA_PARTICIPANT_ID,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--participant" && argv[i + 1]) {
      parsed.participant = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--participant=")) {
      parsed.participant = token.split("=", 2)[1];
      continue;
    }
    if (token === "--max-attempts" && argv[i + 1]) {
      parsed.maxAttempts = Number.parseInt(argv[i + 1], 10);
      i += 1;
      continue;
    }
    if (token.startsWith("--max-attempts=")) {
      parsed.maxAttempts = Number.parseInt(token.split("=", 2)[1], 10);
      continue;
    }
    if (token === "--interval" && argv[i + 1]) {
      parsed.intervalSeconds = Number.parseFloat(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--interval=")) {
      parsed.intervalSeconds = Number.parseFloat(token.split("=", 2)[1]);
      continue;
    }
  }

  return parsed;
}

function shouldSkipPrefLight() {
  const raw = process.env.SCRADA_SKIP_PARTICIPANT_PREFLIGHT;
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return ["1", "true", "yes", "y"].includes(normalized);
}

async function sleep(seconds) {
  if (seconds <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (shouldSkipPrefLight()) {
    console.log(
      JSON.stringify(
        {
          skipped: true,
          reason: "SCRADA_SKIP_PARTICIPANT_PREFLIGHT",
          timestamp: new Date().toISOString()
        },
        null,
        2
      )
    );
    return;
  }

  const participant = args.participant?.trim();
  if (!participant) {
    console.log(
      JSON.stringify(
        {
          skipped: true,
          reason: "missing_participant",
          timestamp: new Date().toISOString()
        },
        null,
        2
      )
    );
    return;
  }

  let attempt = 0;
  while (attempt < Math.max(1, args.maxAttempts)) {
    attempt += 1;
    try {
      const result = await lookupParticipantById(participant);
      if (result.exists) {
        console.log(
          JSON.stringify(
            {
              participant: participant,
              exists: true,
              attempts: attempt,
              timestamp: new Date().toISOString()
            },
            null,
            2
          )
        );
        return;
      }
    } catch (error) {
      console.warn(
        "[scrada-wait-participant] Lookup failed:",
        error instanceof Error ? error.message : error
      );
    }

    if (attempt >= args.maxAttempts) {
      break;
    }
    await sleep(Math.max(5, args.intervalSeconds));
  }

  console.log(
    JSON.stringify(
      {
        participant,
        exists: false,
        attempts: attempt,
        timestamp: new Date().toISOString()
      },
      null,
      2
    )
  );
  process.exitCode = 1;
}

await main();
