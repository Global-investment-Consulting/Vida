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

async function loadPayloadHelpers() {
  try {
    return await import("../dist/src/scrada/payload.js");
  } catch (error) {
    await import("tsx/esm");
    return import("../src/scrada/payload.ts");
  }
}

const { sendSalesInvoiceJson, getOutboundStatus, lookupParticipantById } = await loadAdapter();
const { jsonFromEnv } = await loadPayloadHelpers();

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
    throw new Error(
      `Failed to parse Scrada invoice sample at ${resolved}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function ensureBuyerShell(invoice) {
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
  if (!invoice.buyer.contact || typeof invoice.buyer.contact !== "object") {
    invoice.buyer.contact = { email: "ap@unknown.test" };
  }
  return invoice.buyer;
}

function applyDynamicFields(sample) {
  const invoice = structuredClone(sample);
  const invoiceId = `SCRADA-${isoDate().replace(/-/g, "")}-${randomUUID().replace(/-/g, "").slice(0, 6)}`;

  invoice.id = invoiceId;
  invoice.externalReference = invoice.externalReference ?? invoiceId;
  invoice.issueDate = isoDate();
  invoice.dueDate = invoice.dueDate ?? isoDate(14);
  invoice.currency = (invoice.currency || "EUR").trim() || "EUR";

  if (invoice.paymentTerms && typeof invoice.paymentTerms === "object") {
    invoice.paymentTerms = {
      ...invoice.paymentTerms,
      paymentDueDate: invoice.paymentTerms.paymentDueDate ?? isoDate(14),
      paymentId: invoice.paymentTerms.paymentId ?? invoiceId
    };
  }

  ensureBuyerShell(invoice);

  if (!Array.isArray(invoice.lines) || invoice.lines.length === 0) {
    throw new Error("Scrada sample invoice must include at least one line");
  }

  return invoice;
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
    const invoiceSeed = applyDynamicFields(sample);

    const envOverrides = { ...process.env };
    if (args.participant && args.participant.trim().length > 0) {
      const participant = args.participant.trim();
      if (participant.includes(":")) {
        const [schemePart, valuePart] = participant.split(":", 2);
        if (schemePart && valuePart) {
          envOverrides.SCRADA_TEST_RECEIVER_SCHEME = schemePart;
          envOverrides.SCRADA_TEST_RECEIVER_ID = valuePart;
          envOverrides.SCRADA_PARTICIPANT_ID = `${schemePart}:${valuePart}`;
        } else {
          envOverrides.SCRADA_PARTICIPANT_ID = participant;
          envOverrides.SCRADA_TEST_RECEIVER_ID = participant;
        }
      } else {
        envOverrides.SCRADA_PARTICIPANT_ID = participant;
        envOverrides.SCRADA_TEST_RECEIVER_ID = participant;
      }
    }

    const preparedInvoice = jsonFromEnv(invoiceSeed, { env: envOverrides });

    const participantId = resolveParticipantId(preparedInvoice, args.participant);
    let lookupSummary = null;
    if (participantId) {
      lookupSummary = await runParticipantLookup(participantId, Boolean(args.skipLookup));
    } else {
      console.warn("[scrada-send] No participant identifier present on buyer; skipping lookup.");
    }

    const artifactBase = path.resolve(process.cwd(), "scrada-artifacts");
    const sendResult = await sendSalesInvoiceJson(preparedInvoice, {
      externalReference: preparedInvoice.externalReference,
      artifactDir: artifactBase
    });

    if (sendResult.fallback.triggered) {
      console.warn(
        `[scrada-send] JSON payload rejected (HTTP ${sendResult.fallback.status ?? 400}). Falling back to ${sendResult.deliveryPath}.`
      );
    }

    let status = "unknown";
    let outboundInfo = null;
    try {
      outboundInfo = await getOutboundStatus(sendResult.documentId);
      status = outboundInfo.status ?? "unknown";
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[scrada-send] Unable to fetch status immediately: ${reason}`);
    }

    const fallbackDetails = {
      triggered: sendResult.fallback.triggered,
      status: sendResult.fallback.status,
      errorArtifact: sendResult.fallback.triggered ? sendResult.artifacts.error : null,
      ublArtifact: sendResult.fallback.triggered ? sendResult.artifacts.ubl : null,
      message: sendResult.fallback.message
    };

    const artifacts = {
      json: sendResult.artifacts.json,
      error: sendResult.artifacts.error,
      ubl: sendResult.artifacts.ubl
    };

    const output = {
      invoiceId: preparedInvoice.id,
      externalReference: sendResult.externalReference ?? preparedInvoice.externalReference,
      documentId: sendResult.documentId,
      status,
      deliveryPath: sendResult.deliveryPath,
      fallback: fallbackDetails,
      participantLookup: lookupSummary,
      artifacts,
      outboundInfo,
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
