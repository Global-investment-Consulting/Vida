import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvePeppolApMode, resolvePeppolOutboxDir } from "../config.js"; // migrated

export type SendInvoiceMeta = {
  sender: string;
  receiver: string;
  docId: string;
};

export type SendInvoiceResult = {
  id: string;
  status: string;
  raw: Record<string, unknown>;
};

export async function sendInvoice(xml: string, meta: SendInvoiceMeta): Promise<SendInvoiceResult> {
  const mode = resolvePeppolApMode();
  if (mode === "stub") {
    const outboxDir = resolvePeppolOutboxDir();
    await mkdir(outboxDir, { recursive: true });
    const filename = `${meta.docId}.xml`;
    const filePath = path.join(outboxDir, filename);
    await writeFile(filePath, xml, "utf8");
    return {
      id: meta.docId,
      status: "SENT",
      raw: {
        mode,
        filePath
      }
    };
  }

  throw new Error(`Unsupported PEPPOL AP mode '${mode}'`);
}
