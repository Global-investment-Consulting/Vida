import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listHistory, recordHistory } from "../../src/history/logger";

let historyDir: string;

beforeEach(async () => {
  historyDir = await mkdtemp(path.join(tmpdir(), "vida-history-unit-"));
  process.env.VIDA_HISTORY_DIR = historyDir;
});

afterEach(async () => {
  delete process.env.VIDA_HISTORY_DIR;
  await rm(historyDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("history logger", () => {
  it("writes events to JSONL and lists them in reverse chronological order", async () => {
    await recordHistory({
      requestId: "req-1",
      timestamp: "2025-01-01T10:00:00.000Z",
      source: "shopify",
      orderNumber: "1001",
      status: "ok",
      durationMs: 42
    });

    await recordHistory({
      requestId: "req-2",
      timestamp: "2025-01-02T12:00:00.000Z",
      source: "woocommerce",
      status: "error",
      durationMs: 84,
      error: "timeout"
    });

    const fileContent = await readFile(path.join(historyDir, "2025-01-02.jsonl"), "utf8");
    expect(fileContent.trim().split("\n")).toHaveLength(1);

    const records = await listHistory(5);
    expect(records).toHaveLength(2);
    expect(records[0].requestId).toBe("req-2");
    expect(records[1].requestId).toBe("req-1");
    expect(records[0].error).toBe("timeout");
  });

  it("returns an empty array when no history exists", async () => {
    await rm(historyDir, { recursive: true, force: true });
    const history = await listHistory();
    expect(history).toEqual([]);
  });
});
