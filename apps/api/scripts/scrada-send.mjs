#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

const { sendSalesInvoiceJson, sendUbl, getOutboundStatus, lookupParticipantById } =
  await loadAdapter();
const { prepareScradaInvoice, buildBis30Ubl } = await loadPayloadHelpers();

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

function collectSensitiveValues(invoice) {
  const sensitive = [
    process.env.SCRADA_API_KEY,
    process.env.SCRADA_API_PASSWORD,
    process.env.SCRADA_COMPANY_ID,
    process.env.SCRADA_WEBHOOK_SECRET
  ];
  if (invoice?.seller?.vatNumber) {
    sensitive.push(invoice.seller.vatNumber);
  }
  if (invoice?.buyer?.vatNumber) {
    sensitive.push(invoice.buyer.vatNumber);
  }
  return sensitive.filter((value) => typeof value === "string" && value.length > 0);
}

function maskScradaErrorBody(rawBody, invoice) {
  if (!rawBody) {
    return "";
  }
  let serialized;
  if (typeof rawBody === "string") {
    serialized = rawBody;
  } else {
    try {
      serialized = JSON.stringify(rawBody, null, 2);
    } catch {
      serialized = String(rawBody);
    }
  }
  const sensitiveValues = collectSensitiveValues(invoice);
  let masked = serialized;
  for (const secret of sensitiveValues) {
    masked = masked.split(secret).join("***");
  }
  return masked;
}

function extractHttpStatus(error) {
  if (!error) {
    return null;
  }
  if (typeof error === "object" && typeof error.status === "number") {
    return error.status;
  }
  const cause = error.cause;
  if (cause && typeof cause === "object") {
    if (typeof cause.status === "number") {
      return cause.status;
    }
    if (cause.response && typeof cause.response.status === "number") {
      return cause.response.status;
    }
  }
  if (error.response && typeof error.response.status === "number") {
    return error.response.status;
  }
  return null;
}

function extractResponseData(error) {
  if (!error || typeof error !== "object") {
    return null;
  }
  const cause = error.cause;
  if (cause && typeof cause === "object") {
    if (cause.response && typeof cause.response === "object" && "data" in cause.response) {
      return cause.response.data;
    }
  }
  if (error.response && typeof error.response === "object" && "data" in error.response) {
    return error.response.data;
  }
  return null;
}

async function ensureArtifactDir() {
  const dir = path.resolve(process.cwd(), "scrada-artifacts");
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeJsonFile(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    const sample = await loadSampleInvoice(args.input);
    const invoice = applyDynamicFields(sample);
    const buyer = invoice.buyer;

    const envScheme = process.env.SCRADA_TEST_RECEIVER_SCHEME?.trim();
    const envReceiverId = process.env.SCRADA_TEST_RECEIVER_ID?.trim();

    if (args.participant && args.participant.trim().length > 0) {
      const participant = args.participant.trim();
      if (participant.includes(":")) {
        const [schemePart, valuePart] = participant.split(":", 2);
        if (schemePart && valuePart) {
          buyer.peppolScheme = schemePart;
          buyer.peppolId = valuePart;
          buyer.schemeId = schemePart;
          buyer.endpointId = `${schemePart}:${valuePart}`;
          buyer.participantId = `${schemePart}:${valuePart}`;
        } else {
          buyer.peppolId = participant;
        }
      } else {
        buyer.peppolId = participant;
        buyer.participantId = participant;
      }
    } else if (envScheme && envReceiverId) {
      buyer.peppolScheme = envScheme;
      buyer.peppolId = envReceiverId;
      buyer.schemeId = envScheme;
      buyer.endpointId = `${envScheme}:${envReceiverId}`;
      buyer.participantId = `${envScheme}:${envReceiverId}`;
    }

    const preparedInvoice = prepareScradaInvoice(invoice, {
      receiverScheme: envScheme,
      receiverValue: envReceiverId,
      senderScheme: process.env.SCRADA_SENDER_SCHEME?.trim(),
      senderValue: process.env.SCRADA_SENDER_ID?.trim()
    });

    const participantId = resolveParticipantId(preparedInvoice, args.participant);
    let lookupSummary = null;
    if (participantId) {
      lookupSummary = await runParticipantLookup(participantId, Boolean(args.skipLookup));
    } else {
      console.warn("[scrada-send] No participant identifier present on buyer; skipping lookup.");
    }

    const artifactDir = await ensureArtifactDir();
    const jsonArtifactPath = path.join(artifactDir, "scrada-sales-invoice.json");
    const errorArtifactPath = path.join(artifactDir, "scrada-sales-invoice-error.json");
    const ublArtifactPath = path.join(artifactDir, "scrada-sales-invoice.ubl.xml");

    await writeJsonFile(jsonArtifactPath, preparedInvoice);

    let deliveryPath = "json";
    let sendResult = null;
    let fallbackSummary = {
      triggered: false,
      status: null,
      errorArtifact: null,
      ublArtifact: null,
      message: null
    };

    try {
      sendResult = await sendSalesInvoiceJson(preparedInvoice, {
        externalReference: preparedInvoice.externalReference
      });
    } catch (error) {
      const status = extractHttpStatus(error);
      if (status === 400) {
        const responseBody = extractResponseData(error);
        const maskedError = maskScradaErrorBody(responseBody, preparedInvoice);
        await writeFile(errorArtifactPath, `${maskedError}\n`, "utf8");
        console.warn(
          "[scrada-send] JSON payload rejected with HTTP 400. Falling back to UBL document upload."
        );

        const ublPayload = buildBis30Ubl(preparedInvoice, {
          receiverScheme: envScheme,
          receiverValue: envReceiverId,
          senderScheme: process.env.SCRADA_SENDER_SCHEME?.trim(),
          senderValue: process.env.SCRADA_SENDER_ID?.trim()
        });
        await writeFile(ublArtifactPath, `${ublPayload}\n`, "utf8");

        const ublResult = await sendUbl(ublPayload, {
          externalReference: preparedInvoice.externalReference
        });

        sendResult = ublResult;
        deliveryPath = "ubl";
        fallbackSummary = {
          triggered: true,
          status,
          errorArtifact: path.relative(process.cwd(), errorArtifactPath),
          ublArtifact: path.relative(process.cwd(), ublArtifactPath),
          message: error instanceof Error ? error.message : String(error)
        };
      } else {
        throw error;
      }
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

    const artifacts = {
      json: path.relative(process.cwd(), jsonArtifactPath),
      error: fallbackSummary.errorArtifact,
      ubl: fallbackSummary.ublArtifact
    };

    const output = {
      invoiceId: preparedInvoice.id,
      externalReference: preparedInvoice.externalReference,
      documentId: sendResult.documentId,
      status,
      deliveryPath,
      fallback: fallbackSummary,
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
