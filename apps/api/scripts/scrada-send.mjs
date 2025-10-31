#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config();

const DEFAULT_SAMPLE_PATH = fileURLToPath(
  new URL("./samples/scrada-sales-invoice.json", import.meta.url)
);

async function loadAdapter() {
  try {
    return await import("../dist/src/adapters/scrada.js");
  } catch (error) {
    await import("tsx/esm");
    return import("../src/adapters/scrada.ts");
  }
}

const { sendSalesInvoiceJson, getOutboundStatus, lookupParticipantById } = await loadAdapter();

function isoDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const args = {
    input: process.env.SCRADA_SAMPLE_JSON,
    participant: process.env.SCRADA_PARTICIPANT_ID,
    skipLookup: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--input" && argv[i + 1]) {
      args.input = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--input=")) {
      args.input = token.split("=", 2)[1];
      continue;
    }
    if (token === "--participant" && argv[i + 1]) {
      args.participant = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--participant=")) {
      args.participant = token.split("=", 2)[1];
      continue;
    }
    if (token === "--skip-lookup") {
      args.skipLookup = true;
    }
  }

  return args;
}

async function loadSampleInvoice(filePath) {
  const resolved = filePath ? path.resolve(filePath) : DEFAULT_SAMPLE_PATH;
  const contents = await readFile(resolved, "utf8");
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Failed to parse Scrada invoice sample at ${resolved}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function ensureBuyer(invoice) {
  if (!invoice.buyer || typeof invoice.buyer !== "object") {
    invoice.buyer = {
      name: "Unknown Buyer",
      address: {
        streetName: "Unknown street",
        postalZone: "0000",
        cityName: "Unknown",
        countryCode: "BE"
      }
    };
  }
  return invoice.buyer;
}

function resolveParticipantId(invoice, override) {
  if (override && override.trim().length > 0) {
    return override.trim();
  }
  const buyer = invoice?.buyer ?? {};
  if (
    typeof buyer.peppolScheme === "string" &&
    buyer.peppolScheme.trim().length > 0 &&
    typeof buyer.peppolId === "string" &&
    buyer.peppolId.trim().length > 0
  ) {
    return `${buyer.peppolScheme.trim()}:${buyer.peppolId.trim()}`;
  }
  const candidates = [
    buyer.peppolId,
    buyer.peppolID,
    buyer.participantId,
    buyer.participantID,
    buyer.endpointId,
    buyer.endpointID
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  if (typeof buyer.schemeId === "string" && typeof buyer.id === "string") {
    return `${buyer.schemeId}:${buyer.id}`.trim();
  }
  return undefined;
}

function applyDynamicFields(sample) {
  const invoice = structuredClone(sample);
  const invoiceId = `SCRADA-${isoDate().replace(/-/g, "")}-${randomUUID().replace(/-/g, "").slice(0, 6)}`;

  invoice.id = invoiceId;
  invoice.externalReference = invoice.externalReference ?? invoiceId;
  invoice.issueDate = isoDate();
  invoice.dueDate = invoice.dueDate ?? isoDate(14);

  if (invoice.paymentTerms && typeof invoice.paymentTerms === "object") {
    invoice.paymentTerms = {
      ...invoice.paymentTerms,
      paymentDueDate: invoice.paymentTerms.paymentDueDate ?? isoDate(14),
      paymentId: invoice.paymentTerms.paymentId ?? invoiceId
    };
  }

  const buyer = ensureBuyer(invoice);
  if (!buyer.contact) {
    buyer.contact = { email: "ap@unknown.test" };
  }

  if (!Array.isArray(invoice.lines) || invoice.lines.length === 0) {
    throw new Error("Scrada sample invoice must include at least one line");
  }

  return invoice;
}

async function runParticipantLookup(peppolId, skipLookup) {
  if (skipLookup) {
    return { skipped: true, exists: true };
  }
  try {
    const result = await lookupParticipantById(peppolId);
    if (!result.exists) {
      console.warn(
        `[scrada-send] Participant ${result.peppolId} not registered in Scrada TEST (continuing).`
      );
    }
    return {
      skipped: false,
      exists: result.exists,
      response: result.response
    };
  } catch (error) {
    console.warn(
      `[scrada-send] Participant lookup failed (continuing): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return {
      skipped: false,
      exists: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    const sample = await loadSampleInvoice(args.input);
    const invoice = applyDynamicFields(sample);

    const buyer = ensureBuyer(invoice);
    const envScheme = process.env.SCRADA_TEST_RECEIVER_SCHEME?.trim();
    const envReceiverId = process.env.SCRADA_TEST_RECEIVER_ID?.trim();
    if (args.participant && args.participant.trim().length > 0) {
      const participant = args.participant.trim();
      buyer.peppolId = participant;
      if (participant.includes(":")) {
        const [schemePart, valuePart] = participant.split(":", 2);
        if (schemePart && valuePart) {
          buyer.peppolScheme = schemePart;
          if (!buyer.schemeId || buyer.schemeId.trim().length === 0) {
            buyer.schemeId = schemePart;
          }
          if (!buyer.endpointId) {
            buyer.endpointId = valuePart;
          }
          if (!buyer.participantId) {
            buyer.participantId = participant;
          }
        }
      }
    } else if (envScheme && envReceiverId) {
      buyer.peppolScheme = envScheme;
      buyer.peppolId = envReceiverId;
      if (typeof buyer.schemeId !== "string" || buyer.schemeId.trim().length === 0) {
        buyer.schemeId = envScheme;
      }
      if (typeof buyer.endpointId !== "string" || buyer.endpointId.trim().length === 0) {
        buyer.endpointId = envReceiverId;
      }
      if (typeof buyer.participantId !== "string" || buyer.participantId.trim().length === 0) {
        buyer.participantId = `${envScheme}:${envReceiverId}`;
      }
    }

    const participantId = resolveParticipantId(invoice, args.participant);
    let lookupSummary = null;
    if (participantId) {
      lookupSummary = await runParticipantLookup(participantId, Boolean(args.skipLookup));
    } else {
      console.warn("[scrada-send] No participant identifier present on buyer; skipping lookup.");
    }

    const result = await sendSalesInvoiceJson(invoice, {
      externalReference: invoice.externalReference
    });

    let status = "unknown";
    try {
      const info = await getOutboundStatus(result.documentId);
      status = info.status ?? "unknown";
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[scrada-send] Unable to fetch status immediately: ${reason}`);
    }

    const output = {
      invoiceId: invoice.id,
      externalReference: invoice.externalReference,
      documentId: result.documentId,
      status,
      participantLookup: lookupSummary,
      timestamp: new Date().toISOString()
    };

    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(
      "[scrada-send] Failed to send sample invoice:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

await main();
