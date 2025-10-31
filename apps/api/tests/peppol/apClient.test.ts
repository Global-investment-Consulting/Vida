import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { sendInvoice } from "src/peppol/apClient.js";

let outboxDir: string;

afterEach(async () => {
  delete process.env.VIDA_PEPPOL_AP;
  delete process.env.VIDA_PEPPOL_OUTBOX_DIR;
  if (outboxDir) {
    await rm(outboxDir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("sendInvoice", () => {
  it("writes the XML to the stub outbox", async () => {
    outboxDir = await mkdtemp(path.join(tmpdir(), "vida-ap-client-"));
    process.env.VIDA_PEPPOL_AP = "stub";
    process.env.VIDA_PEPPOL_OUTBOX_DIR = outboxDir;

    const result = await sendInvoice("<Invoice />", {
      sender: "Supplier",
      receiver: "Buyer",
      docId: "DOC-1"
    });

    expect(result.status).toBe("SENT");
    const xml = await readFile(path.join(outboxDir, "DOC-1.xml"), "utf8");
    expect(xml).toContain("Invoice");
  });

  it("throws for unsupported modes", async () => {
    process.env.VIDA_PEPPOL_AP = "unknown";
    await expect(() => sendInvoice("<Invoice />", { sender: "a", receiver: "b", docId: "1" })).rejects.toThrow(
      /Unsupported PEPPOL AP mode/
    );
  });
});
