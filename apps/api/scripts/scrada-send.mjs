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

const { sendSalesInvoiceJson, sendUbl, getOutboundStatus, lookupParticipantById } = await loadAdapter();

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

function ensureSeller(invoice) {
  if (!invoice.seller || typeof invoice.seller !== "object") {
    invoice.seller = {
      name: "Vida Integration Seller",
      vatNumber: "BE0123456789",
      address: {
        streetName: "Sellerstraat",
        postalZone: "9000",
        cityName: "Ghent",
        countryCode: "BE"
      },
      contact: {
        name: "Vida Finance",
        email: "billing@vida.example"
      }
    };
  }
  const seller = invoice.seller;
  if (!seller.address || typeof seller.address !== "object") {
    seller.address = {
      streetName: "Sellerstraat",
      postalZone: "9000",
      cityName: "Ghent",
      countryCode: "BE"
    };
  }
  if (!seller.address.countryCode) {
    seller.address.countryCode = "BE";
  }
  if (!seller.contact) {
    seller.contact = { email: "billing@vida.example" };
  }
  return seller;
}

function extractSchemeValue(input) {
  if (typeof input !== "string") {
    return { scheme: undefined, value: undefined };
  }
  if (!input.includes(":")) {
    return { scheme: undefined, value: input.trim() };
  }
  const [scheme, value] = input.split(":", 2);
  return { scheme: scheme?.trim(), value: value?.trim() };
}

function normalizeFallback(fallback) {
  if (!fallback) {
    return { scheme: undefined, value: undefined };
  }
  const normalized = { ...fallback };
  if (typeof normalized.value === "string" && normalized.value.includes(":")) {
    const parsed = extractSchemeValue(normalized.value);
    normalized.scheme = normalized.scheme ?? parsed.scheme;
    normalized.value = parsed.value ?? normalized.value;
  }
  return {
    scheme: normalized.scheme,
    value: normalized.value
  };
}

function ensurePartyEndpoint(party, fallback) {
  const participantCandidate = extractSchemeValue(
    party.endpointId || party.endpointID || party.participantId || party.participantID
  );
  const peppolCandidate = extractSchemeValue(party.peppolId || party.peppolID);
  const fallbackCandidate = normalizeFallback(fallback);

  let scheme =
    party.endpointScheme ||
    party.peppolScheme ||
    party.schemeId ||
    participantCandidate.scheme ||
    peppolCandidate.scheme ||
    fallback?.scheme ||
    fallbackCandidate.scheme ||
    undefined;
  let value =
    party.endpointValue ||
    participantCandidate.value ||
    peppolCandidate.value ||
    fallback?.value ||
    fallbackCandidate.value ||
    undefined;

  if (!scheme && typeof party.vatNumber === "string") {
    scheme = "9956"; // VAT number scheme for VAT identifiers.
  }
  if (!value && typeof party.vatNumber === "string") {
    value = party.vatNumber.replace(/^([A-Z]{2})/, "");
  }

  if (scheme && value) {
    const combined = `${scheme}:${value}`;
    party.endpointScheme = scheme;
    party.peppolScheme = party.peppolScheme || scheme;
    party.schemeId = party.schemeId || scheme;
    party.endpointValue = value;
    party.peppolId = value;
    party.endpointId = combined;
    if (!party.endpointID) {
      party.endpointID = combined;
    }
    return { scheme, value, id: combined };
  }

  return { scheme, value, id: scheme && value ? `${scheme}:${value}` : undefined };
}

function roundCurrency(value) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function ensureTotals(invoice) {
  const currency = (invoice.currency || "EUR").trim() || "EUR";
  const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
  let netTotal = 0;
  let taxTotal = 0;
  const normalizedLines = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = { ...lines[i] };
    line.id = line.id || String(i + 1);
    const quantity = Number.isFinite(line.quantity) ? Number(line.quantity) : 1;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      line.quantity = 1;
    }
    const unitPrice = line.unitPrice?.value ?? line.unitPrice ?? line.unitPriceMinor ?? 0;
    const numericUnitPrice = roundCurrency(unitPrice);
    const lineExtensionAmount =
      line.lineExtensionAmount?.value ??
      line.lineExtensionAmount ??
      roundCurrency(numericUnitPrice * quantity);
    const lineNet = roundCurrency(lineExtensionAmount);
    const vatRate = Number.isFinite(line.vat?.rate) ? Number(line.vat.rate) : 21;
    const lineVatAmount =
      line.vat?.taxAmount?.value ?? line.vat?.taxAmount ?? roundCurrency((lineNet * vatRate) / 100);

    line.unitCode = line.unitCode || "EA";
    line.unitPrice = {
      currency,
      value: numericUnitPrice
    };
    line.lineExtensionAmount = {
      currency,
      value: lineNet
    };
    line.vat = {
      rate: vatRate,
      taxAmount: { currency, value: roundCurrency(lineVatAmount) },
      taxableAmount: { currency, value: lineNet },
      taxCategoryCode: line.vat?.taxCategoryCode || "S"
    };

    netTotal += lineNet;
    taxTotal += roundCurrency(lineVatAmount);
    normalizedLines.push(line);
  }

  invoice.lines = normalizedLines;

  const taxExclusive = roundCurrency(netTotal);
  const taxAmount = roundCurrency(taxTotal);
  const taxInclusive = roundCurrency(taxExclusive + taxAmount);

  invoice.totals = {
    lineExtensionAmount: { currency, value: taxExclusive },
    taxExclusiveAmount: { currency, value: taxExclusive },
    taxInclusiveAmount: { currency, value: taxInclusive },
    payableAmount: { currency, value: taxInclusive },
    taxTotals: [
      {
        rate: 21,
        taxCategoryCode: "S",
        taxableAmount: { currency, value: taxExclusive },
        taxAmount: { currency, value: taxAmount }
      }
    ],
    legalMonetaryTotal: {
      lineExtensionAmount: { currency, value: taxExclusive },
      taxExclusiveAmount: { currency, value: taxExclusive },
      taxInclusiveAmount: { currency, value: taxInclusive },
      payableAmount: { currency, value: taxInclusive }
    }
  };

  return invoice.totals;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatAmount(value) {
  return roundCurrency(value).toFixed(2);
}

function buildAddressXml(address = {}) {
  if (!address || typeof address !== "object") {
    return "";
  }
  const parts = [
    address.streetName ? `<cbc:StreetName>${xmlEscape(address.streetName)}</cbc:StreetName>` : "",
    address.buildingNumber
      ? `<cbc:BuildingNumber>${xmlEscape(address.buildingNumber)}</cbc:BuildingNumber>`
      : "",
    address.additionalStreetName
      ? `<cbc:AdditionalStreetName>${xmlEscape(address.additionalStreetName)}</cbc:AdditionalStreetName>`
      : "",
    address.postalZone ? `<cbc:PostalZone>${xmlEscape(address.postalZone)}</cbc:PostalZone>` : "",
    address.cityName ? `<cbc:CityName>${xmlEscape(address.cityName)}</cbc:CityName>` : "",
    address.countryCode
      ? `<cac:Country><cbc:IdentificationCode>${xmlEscape(address.countryCode)}</cbc:IdentificationCode></cac:Country>`
      : ""
  ].filter(Boolean);
  if (parts.length === 0) {
    return "";
  }
  return `<cac:PostalAddress>${parts.join("")}</cac:PostalAddress>`;
}

function buildPartyTaxSchemeXml(vatNumber) {
  if (!vatNumber) {
    return "";
  }
  return `<cac:PartyTaxScheme>
    <cbc:CompanyID schemeID="VA">${xmlEscape(vatNumber)}</cbc:CompanyID>
    <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
  </cac:PartyTaxScheme>`;
}

function buildContactXml(contact) {
  if (!contact || typeof contact !== "object") {
    return "";
  }
  const parts = [
    contact.name ? `<cbc:Name>${xmlEscape(contact.name)}</cbc:Name>` : "",
    contact.telephone ? `<cbc:Telephone>${xmlEscape(contact.telephone)}</cbc:Telephone>` : "",
    contact.email ? `<cbc:ElectronicMail>${xmlEscape(contact.email)}</cbc:ElectronicMail>` : ""
  ].filter(Boolean);
  if (parts.length === 0) {
    return "";
  }
  return `<cac:Contact>${parts.join("")}</cac:Contact>`;
}

function buildPartyXml(party, role) {
  const endpoint = ensurePartyEndpoint(party);
  const addressXml = buildAddressXml(party.address);
  const taxXml = buildPartyTaxSchemeXml(party.vatNumber);
  const contactXml = buildContactXml(party.contact);

  const endpointXml =
    endpoint.scheme && endpoint.value
      ? `<cbc:EndpointID schemeID="${xmlEscape(endpoint.scheme)}">${xmlEscape(endpoint.value)}</cbc:EndpointID>`
      : "";

  return `<cac:${role}>
    <cac:Party>
      ${endpointXml}
      <cac:PartyName><cbc:Name>${xmlEscape(party.name || "Unknown party")}</cbc:Name></cac:PartyName>
      ${addressXml}
      ${taxXml}
      ${contactXml}
    </cac:Party>
  </cac:${role}>`;
}

function buildInvoiceLineXml(line, currency) {
  const quantity = Number.isFinite(line.quantity) && Number(line.quantity) > 0 ? Number(line.quantity) : 1;
  const unitCode = line.unitCode || "EA";
  const lineAmount = line.lineExtensionAmount?.value ?? 0;
  const VAT_RATE = Number.isFinite(line.vat?.rate) ? Number(line.vat.rate) : 21;
  const taxAmount = line.vat?.taxAmount?.value ?? 0;

  return `<cac:InvoiceLine>
    <cbc:ID>${xmlEscape(line.id || "1")}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${xmlEscape(unitCode)}">${formatAmount(quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${xmlEscape(currency)}">${formatAmount(lineAmount)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>${xmlEscape(line.description || "Invoice line")}</cbc:Description>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${xmlEscape(line.vat?.taxCategoryCode || "S")}</cbc:ID>
        <cbc:Percent>${formatAmount(VAT_RATE)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${xmlEscape(currency)}">${formatAmount(line.unitPrice?.value ?? 0)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
}

function buildTaxTotalXml(totals, currency) {
  const taxTotal = totals?.taxTotals?.[0];
  if (!taxTotal) {
    return "";
  }
  const taxableAmount = taxTotal.taxableAmount?.value ?? 0;
  const taxAmount = taxTotal.taxAmount?.value ?? 0;
  return `<cac:TaxTotal>
    <cbc:TaxAmount currencyID="${xmlEscape(currency)}">${formatAmount(taxAmount)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${xmlEscape(currency)}">${formatAmount(taxableAmount)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${xmlEscape(currency)}">${formatAmount(taxAmount)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${xmlEscape(taxTotal.taxCategoryCode || "S")}</cbc:ID>
        <cbc:Percent>${formatAmount(taxTotal.rate ?? 21)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>`;
}

function buildLegalMonetaryTotalXml(totals, currency) {
  const legal = totals?.legalMonetaryTotal || totals;
  if (!legal) {
    return "";
  }
  return `<cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${xmlEscape(currency)}">${formatAmount(
      legal.lineExtensionAmount?.value ?? totals.lineExtensionAmount?.value ?? 0
    )}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${xmlEscape(currency)}">${formatAmount(
      legal.taxExclusiveAmount?.value ?? totals.taxExclusiveAmount?.value ?? 0
    )}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${xmlEscape(currency)}">${formatAmount(
      legal.taxInclusiveAmount?.value ?? totals.taxInclusiveAmount?.value ?? 0
    )}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${xmlEscape(currency)}">${formatAmount(
      legal.payableAmount?.value ?? totals.payableAmount?.value ?? 0
    )}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`;
}

function buildBis30Ubl(invoice) {
  const currency = (invoice.currency || "EUR").trim() || "EUR";
  const buyer = ensureBuyer(invoice);
  const seller = ensureSeller(invoice);

  ensurePartyEndpoint(buyer, {
    scheme: process.env.SCRADA_TEST_RECEIVER_SCHEME,
    value: process.env.SCRADA_TEST_RECEIVER_ID
  });
  ensurePartyEndpoint(seller, {
    scheme: process.env.SCRADA_SENDER_SCHEME,
    value: process.env.SCRADA_SENDER_ID
  });

  const totals = ensureTotals(invoice);
  const lines = Array.isArray(invoice.lines) ? invoice.lines : [];

  const invoiceLinesXml = lines.map((line) => buildInvoiceLineXml(line, currency)).join("\n");
  const taxTotalXml = buildTaxTotalXml(totals, currency);
  const legalMonetaryXml = buildLegalMonetaryTotalXml(totals, currency);

  const paymentTerms = invoice.paymentTerms || {};
  const paymentTermsXml =
    paymentTerms.note || paymentTerms.paymentDueDate || paymentTerms.paymentId
      ? `<cac:PaymentTerms>
    ${paymentTerms.note ? `<cbc:Note>${xmlEscape(paymentTerms.note)}</cbc:Note>` : ""}
    ${paymentTerms.paymentDueDate ? `<cbc:PaymentDueDate>${xmlEscape(paymentTerms.paymentDueDate)}</cbc:PaymentDueDate>` : ""}
    ${paymentTerms.paymentMeansText ? `<cbc:InstructionNote>${xmlEscape(paymentTerms.paymentMeansText)}</cbc:InstructionNote>` : ""}
    ${paymentTerms.paymentId ? `<cbc:ID>${xmlEscape(paymentTerms.paymentId)}</cbc:ID>` : ""}
  </cac:PaymentTerms>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${xmlEscape(invoice.customizationId || "urn:fdc:peppol.eu:poacc:billing:3")}</cbc:CustomizationID>
  <cbc:ProfileID>${xmlEscape(invoice.profileId || "urn:fdc:peppol.eu:poacc:billing:3.0")}</cbc:ProfileID>
  <cbc:ID>${xmlEscape(invoice.id)}</cbc:ID>
  <cbc:IssueDate>${xmlEscape(invoice.issueDate)}</cbc:IssueDate>
  ${invoice.dueDate ? `<cbc:DueDate>${xmlEscape(invoice.dueDate)}</cbc:DueDate>` : ""}
  <cbc:InvoiceTypeCode>${xmlEscape(invoice.invoiceTypeCode || "380")}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${xmlEscape(currency)}</cbc:DocumentCurrencyCode>
  ${buildPartyXml(seller, "AccountingSupplierParty")}
  ${buildPartyXml(buyer, "AccountingCustomerParty")}
  ${taxTotalXml}
  ${legalMonetaryXml}
  ${invoiceLinesXml}
  ${paymentTermsXml}
</Invoice>`;
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
  invoice.invoiceTypeCode = invoice.invoiceTypeCode || "380";
  invoice.currency = (invoice.currency || "EUR").trim() || "EUR";

  if (invoice.paymentTerms && typeof invoice.paymentTerms === "object") {
    invoice.paymentTerms = {
      ...invoice.paymentTerms,
      paymentDueDate: invoice.paymentTerms.paymentDueDate ?? isoDate(14),
      paymentId: invoice.paymentTerms.paymentId ?? invoiceId
    };
  }

  const buyer = ensureBuyer(invoice);
  const seller = ensureSeller(invoice);
  if (!buyer.contact) {
    buyer.contact = { email: "ap@unknown.test" };
  }

  if (!Array.isArray(invoice.lines) || invoice.lines.length === 0) {
    throw new Error("Scrada sample invoice must include at least one line");
  }

  ensurePartyEndpoint(seller, {
    scheme: process.env.SCRADA_SENDER_SCHEME,
    value: process.env.SCRADA_SENDER_ID
  });

  ensureTotals(invoice);

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
      if (participant.includes(":")) {
        const [schemePart, valuePart] = participant.split(":", 2);
        if (schemePart && valuePart) {
          buyer.peppolScheme = schemePart;
          buyer.peppolId = valuePart;
          if (!buyer.schemeId || buyer.schemeId.trim().length === 0) {
            buyer.schemeId = schemePart;
          }
          if (!buyer.endpointId) {
            buyer.endpointId = `${schemePart}:${valuePart}`;
          }
          if (!buyer.participantId) {
            buyer.participantId = `${schemePart}:${valuePart}`;
          }
        } else {
          buyer.peppolId = participant;
        }
      } else {
        buyer.peppolId = participant;
        if (!buyer.participantId) {
          buyer.participantId = participant;
        }
      }
    } else if (envScheme && envReceiverId) {
      buyer.peppolScheme = envScheme;
      buyer.peppolId = envReceiverId;
      if (typeof buyer.schemeId !== "string" || buyer.schemeId.trim().length === 0) {
        buyer.schemeId = envScheme;
      }
      if (typeof buyer.endpointId !== "string" || buyer.endpointId.trim().length === 0) {
        buyer.endpointId = `${envScheme}:${envReceiverId}`;
      }
      if (typeof buyer.participantId !== "string" || buyer.participantId.trim().length === 0) {
        buyer.participantId = `${envScheme}:${envReceiverId}`;
      }
    }

    ensurePartyEndpoint(buyer, {
      scheme: envScheme,
      value: envReceiverId
    });
    ensurePartyEndpoint(invoice.seller, {
      scheme: process.env.SCRADA_SENDER_SCHEME,
      value: process.env.SCRADA_SENDER_ID
    });

    const participantId = resolveParticipantId(invoice, args.participant);
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

    await writeJsonFile(jsonArtifactPath, invoice);

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
      sendResult = await sendSalesInvoiceJson(invoice, {
        externalReference: invoice.externalReference
      });
    } catch (error) {
      const status = extractHttpStatus(error);
      if (status === 400) {
        const responseBody = extractResponseData(error);
        const maskedError = maskScradaErrorBody(responseBody, invoice);
        await writeFile(errorArtifactPath, `${maskedError}\n`, "utf8");
        console.warn("[scrada-send] JSON payload rejected with HTTP 400. Falling back to UBL document upload.");

        const ublPayload = buildBis30Ubl(invoice);
        await writeFile(ublArtifactPath, `${ublPayload}\n`, "utf8");

        const ublResult = await sendUbl(ublPayload, {
          externalReference: invoice.externalReference
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
      invoiceId: invoice.id,
      externalReference: invoice.externalReference,
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
