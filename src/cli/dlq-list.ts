#!/usr/bin/env node
import process from "node:process";
import { getStorage } from "../storage/index.js";
import type { DlqItem } from "../storage/types.js";

type ListOptions = {
  tenant?: string;
  limit?: number;
  json?: boolean;
};

function parseArgs(argv: string[]): ListOptions {
  const options: ListOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tenant" && argv[index + 1]) {
      options.tenant = argv[index + 1];
      index += 1;
    } else if ((arg === "--limit" || arg === "-n") && argv[index + 1]) {
      const parsed = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = parsed;
      }
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return options;
}

function printHelp(): void {
  console.info(`Usage: npm run dlq:list [--tenant TENANT] [--limit N] [--json]

Options:
  --tenant TENANT    Filter DLQ entries by tenant id.
  --limit N          Limit the number of entries returned (default: unlimited).
  --json             Print raw JSON instead of a formatted table.
  --help             Show this help message.
`);
}

function summarizePayload(payload: unknown): string {
  if (payload === undefined || payload === null) {
    return "";
  }
  try {
    const serialized = JSON.stringify(payload);
    if (!serialized) {
      return "";
    }
    return serialized.length > 160 ? `${serialized.slice(0, 157)}…` : serialized;
  } catch {
    return String(payload);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const storage = getStorage();

  if (typeof storage.dlq.list !== "function") {
    console.error("DLQ store does not support listing entries.");
    process.exit(1);
  }

  const items: DlqItem[] = await storage.dlq.list({
    tenant: options.tenant,
    limit: options.limit
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
    return;
  }

  if (items.length === 0) {
    console.info("No DLQ entries found.");
    return;
  }

  console.info(
    `Found ${items.length} DLQ entr${items.length === 1 ? "y" : "ies"}${
      options.tenant ? ` for tenant ${options.tenant}` : ""
    }:`
  );
  for (const [index, item] of items.entries()) {
    console.info(
      `${index + 1}. id=${item.id ?? "n/a"} tenant=${item.tenant} invoice=${item.invoiceId} ts=${item.ts}`
    );
    console.info(`   error: ${item.error}`);
    const payloadSummary = summarizePayload(item.payload);
    if (payloadSummary) {
      console.info(`   payload: ${payloadSummary}`);
    }
  }
}

main().catch((error) => {
  console.error("Failed to list DLQ entries:", error);
  process.exit(1);
});
