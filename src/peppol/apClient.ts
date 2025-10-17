import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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

const DEFAULT_MODE = "stub";
const DEFAULT_OUTBOX = path.resolve(process.cwd(), "data", "ap-outbox");

function resolveMode(): string {
  return (process.env.VIDA_PEPPOL_AP ?? DEFAULT_MODE).toLowerCase();
}

function resolveOutboxDir(): string {
  const override = process.env.VIDA_PEPPOL_OUTBOX_DIR;
  if (override) {
    return path.resolve(override);
  }
  return DEFAULT_OUTBOX;
}

export async function sendInvoice(xml: string, meta: SendInvoiceMeta): Promise<SendInvoiceResult> {
  const mode = resolveMode();
  if (mode === "stub") {
    const outboxDir = resolveOutboxDir();
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
