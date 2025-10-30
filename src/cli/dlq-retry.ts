#!/usr/bin/env node
import process from "node:process";
import { randomUUID } from "node:crypto";
import { getStorage } from "../storage/index.js";
import type { DlqItem } from "../storage/types.js";
import { orderToInvoiceXml, type Order } from "../peppol/convert.js";
import { sendWithRetry } from "../services/apDelivery.js";
import { incrementDlqRetryFail, incrementDlqRetrySuccess } from "../metrics.js";

type RetryOptions = {
  tenant?: string;
  ids: string[];
  limit?: number;
  all?: boolean;
  dryRun?: boolean;
};

function printHelp(): void {
  console.info(
    `Usage: npm run dlq:retry [options]

Options:
  --tenant TENANT    Retry entries for the specified tenant only.
  --id ID            Retry a specific DLQ entry (can be passed multiple times).
  --limit N          Retry up to N entries (default: 10). Ignored when --id or --all is set.
  --all              Retry every DLQ entry (use with care).
  --dry-run          Show which entries would be retried without sending them.
  --help             Show this help message.
`
  );
}

function parseArgs(argv: string[]): RetryOptions {
  const options: RetryOptions = { ids: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tenant" && argv[index + 1]) {
      options.tenant = argv[index + 1];
      index += 1;
    } else if (arg === "--id" && argv[index + 1]) {
      options.ids.push(argv[index + 1]);
      index += 1;
    } else if ((arg === "--limit" || arg === "-n") && argv[index + 1]) {
      const parsed = Number.parseInt(argv[index + 1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = parsed;
      }
      index += 1;
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return options;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function extractOrder(payload: unknown): Order | undefined {
  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }
  const candidate = asRecord(record.order) ?? record;
  if (candidate && Array.isArray(candidate.lines)) {
    return candidate as unknown as Order;
  }
  return undefined;
}

function extractUblXml(payload: unknown): string | undefined {
  const record = asRecord(payload);
  const xml = record?.ublXml ?? record?.invoiceXml ?? record?.xml;
  if (typeof xml === "string" && xml.trim().length > 0) {
    return xml;
  }
  return undefined;
}

function extractAdapter(payload: unknown): string | undefined {
  const record = asRecord(payload);
  const adapter = record?.adapter ?? record?.adapterName;
  if (typeof adapter === "string" && adapter.trim().length > 0) {
    return adapter.trim();
  }
  return undefined;
}

function normalizeTenant(tenant?: string): string | undefined {
  if (!tenant || tenant === "__default__") {
    return undefined;
  }
  return tenant;
}

async function retryEntry(item: DlqItem, dryRun: boolean): Promise<boolean> {
  const payload = item.payload;
  const order = extractOrder(payload);
  let ublXml = extractUblXml(payload);
  const adapterName = extractAdapter(payload);

  if (!order) {
    console.error(`Cannot retry ${item.id ?? item.invoiceId}: missing order payload`);
    incrementDlqRetryFail();
    return false;
  }

  if (!ublXml) {
    try {
      ublXml = await orderToInvoiceXml(order);
    } catch (error) {
      console.error(`Failed to rebuild UBL for ${item.id ?? item.invoiceId}:`, error);
      incrementDlqRetryFail();
      return false;
    }
  }

  if (dryRun) {
    console.info(
      `[-] ${item.id ?? item.invoiceId} (tenant=${item.tenant}) would be retried via ${adapterName ?? "default"}`
    );
    return true;
  }

  try {
    await sendWithRetry({
      tenant: normalizeTenant(item.tenant),
      invoiceId: item.invoiceId,
      ublXml: ublXml ?? "",
      requestId: `dlq-retry-${randomUUID()}`,
      adapterName,
      order
    });
    incrementDlqRetrySuccess();
    return true;
  } catch (error) {
    console.error(`Retry failed for ${item.id ?? item.invoiceId}:`, error);
    incrementDlqRetryFail();
    return false;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const storage = getStorage();

  if (typeof storage.dlq.list !== "function" || typeof storage.dlq.remove !== "function") {
    console.error("DLQ store does not support list/remove operations.");
    process.exit(1);
  }

  const listLimit =
    options.all || options.ids.length > 0 ? undefined : options.limit && options.limit > 0 ? options.limit : 10;

  let items = await storage.dlq.list({
    tenant: options.tenant,
    limit: listLimit
  });

  if (options.ids.length > 0) {
    const idSet = new Set(options.ids);
    if (listLimit !== undefined && items.length < idSet.size) {
      items = await storage.dlq.list({ tenant: options.tenant });
    }
    const selected = items.filter((item) => item.id && idSet.has(item.id));
    const missing = options.ids.filter((id) => !selected.some((item) => item.id === id));
    if (missing.length > 0) {
      console.warn(`Warning: unable to find DLQ entries with id(s): ${missing.join(", ")}`);
    }
    items = selected;
  }

  if (items.length === 0) {
    console.info("No DLQ entries matched the selection criteria.");
    return;
  }

  console.info(
    `${options.dryRun ? "[dry-run] " : ""}Retrying ${items.length} DLQ entr${
      items.length === 1 ? "y" : "ies"
    }${options.tenant ? ` for tenant ${options.tenant}` : ""}`
  );

  let successCount = 0;
  for (const item of items) {
    const label = `id=${item.id ?? "n/a"} tenant=${item.tenant} invoice=${item.invoiceId}`;
    console.info(`→ Processing ${label}`);
    const success = await retryEntry(item, Boolean(options.dryRun));
    if (success) {
      successCount += 1;
      if (!options.dryRun) {
        const removed = await storage.dlq.remove(item.id ?? `${item.tenant}:${item.invoiceId}:${item.ts}`);
        if (!removed) {
          console.warn(`Warning: failed to remove DLQ entry ${item.id ?? item.invoiceId} after retry`);
        }
      }
    }
  }

  console.info(
    `Completed DLQ retry run: ${successCount}/${items.length} succeeded${options.dryRun ? " (dry-run)" : ""}.`
  );
}

main().catch((error) => {
  console.error("DLQ retry failed:", error);
  process.exit(1);
});
