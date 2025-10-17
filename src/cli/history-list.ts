import { listHistory } from "../history/logger";

async function main() {
  const arg = process.argv[2];
  const limit = Number.isNaN(Number(arg)) ? 20 : Number(arg ?? 20);
  const records = await listHistory(limit > 0 ? limit : 20);

  if (records.length === 0) {
    console.log("No history entries found.");
    return;
  }

  console.table(
    records.map((record) => ({
      timestamp: record.timestamp,
      requestId: record.requestId,
      source: record.source ?? "unknown",
      orderNumber: record.orderNumber ?? "-",
      status: record.status,
      invoicePath: record.invoicePath ?? "-",
      durationMs: record.durationMs,
      error: record.error ?? ""
    }))
  );
}

main().catch((error) => {
  console.error("Failed to list history", error);
  process.exit(1);
});
