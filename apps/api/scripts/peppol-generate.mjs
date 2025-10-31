
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { buildInvoiceXml } from "../peppol/ubl21.js";

const DEFAULT_OUTPUT = "invoice.xml";
const DEFAULT_SUPPLIER = {
  name: "ViDA Demo Ltd.",
  registrationName: "ViDA Demo Ltd.",
  vatId: "BE0123456789",
  companyId: "BE0123456789",
  endpoint: { id: "1234567890123", scheme: "0088" },
  address: {
    streetName: "Rue du Test 1",
    cityName: "Brussels",
    postalZone: "1000",
    countryCode: "BE"
  }
};

function toMinor(value) {
  if (typeof value === "number") return Math.round(value * 100);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed * 100);
    }
  }
  return 0;
}

function normalizeVatRate(value) {
  if (value === undefined || value === null) return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  if (numeric <= 1) {
    return Math.round(numeric * 100);
  }
  return Math.round(numeric);
}

function normalizeInvoiceShape(raw) {
  if (raw && typeof raw === "object" && raw.invoiceNumber && raw.supplier) {
    return raw;
  }

  const invoice = { ...raw };
  invoice.invoiceNumber = invoice.number ?? invoice.invoiceNumber ?? invoice.id ?? "DRAFT-0001";
  invoice.issueDate = invoice.issueDate ?? invoice.createdAt ?? new Date().toISOString();
  invoice.currency = invoice.currency ?? "EUR";
  invoice.defaultVatRate = normalizeVatRate(invoice.vatRate ?? 0.21) ?? 21;
  invoice.supplier = invoice.supplier ?? DEFAULT_SUPPLIER;
  invoice.currencyMinorUnit = invoice.currencyMinorUnit ?? 2;
  invoice.buyer = invoice.buyer ?? {
    name: invoice.buyerName ?? "Unknown Buyer",
    vatId: invoice.buyer?.vat_id ?? invoice.buyerVat ?? "",
    address: invoice.buyer?.address ?? {
      countryCode: (invoice.buyer?.country ?? "BE").toUpperCase()
    }
  };
  invoice.notes = invoice.notes ?? [];
  const meta = { ...(invoice.meta ?? {}) };
  invoice.meta = meta;
  if (!Array.isArray(invoice.lines)) {
    invoice.lines = [];
  }

  invoice.lines = invoice.lines.map((line, idx) => {
    const qty = line.quantity ?? line.qty ?? 1;
    const numericQty = Number(qty);
    const safeQty = Number.isFinite(numericQty) && numericQty > 0 ? numericQty : 1;
    const desc = line.description ?? line.name ?? `Line ${idx + 1}`;
    const unitPriceMinorRaw =
      line.unitPriceMinor ??
      line.unit_price_minor ??
      (typeof line.unitPrice === "number" ? toMinor(line.unitPrice) : undefined) ??
      toMinor(line.price ?? 0);
    const unitPriceMinor = typeof unitPriceMinorRaw === "number" ? Math.trunc(unitPriceMinorRaw) : 0;
    const discountMinorRaw =
      line.discountMinor ??
      line.discount_minor ??
      toMinor(line.discount ?? 0);
    const discountMinor = typeof discountMinorRaw === "number" ? Math.max(Math.trunc(discountMinorRaw), 0) : 0;
    const vatRate = normalizeVatRate(line.vatRate ?? line.vat_rate ?? invoice.vatRate);
    const vatCategory = line.vatCategory ?? line.taxCategory;
    const vatExemptionReason = line.vatExemptionReason ?? line.taxExemptionReason ?? meta.exemptionReason;

    return {
      id: line.id ?? String(idx + 1),
      description: desc,
      quantity: safeQty,
      unitCode: line.unitCode ?? "EA",
      unitPriceMinor,
      discountMinor,
      vatRate,
      vatCategory,
      vatExemptionReason,
      itemName: line.name ?? line.description ?? undefined
    };
  });

  if (!meta.taxExemptionReason && typeof meta.exemptionReason === "string") {
    meta.taxExemptionReason = meta.exemptionReason;
  }

  invoice.allowances = invoice.allowances ?? [];

  return invoice;
}

function extractInvoicePayload(input) {
  if (Array.isArray(input)) {
    return normalizeInvoiceShape(input[0]);
  }

  if (input && typeof input === "object") {
    if (Array.isArray(input.invoices) && input.invoices.length > 0) {
      return normalizeInvoiceShape(input.invoices[0]);
    }
    if (input.invoice) {
      return normalizeInvoiceShape(input.invoice);
    }
    return normalizeInvoiceShape(input);
  }

  throw new Error("Unsupported invoice JSON format");
}

async function main() {
  const [, , inputArg, outputArg] = process.argv;
  if (!inputArg) {
    console.error("Usage: node scripts/peppol-generate.mjs <invoice.json> [output.xml]");
    process.exit(1);
  }

  const inputPath = resolve(process.cwd(), inputArg);
  const outputPath = resolve(process.cwd(), outputArg ?? DEFAULT_OUTPUT);

  const fileContents = await readFile(inputPath, "utf8");
  const parsed = JSON.parse(fileContents);
  const invoicePayload = extractInvoicePayload(parsed);
  const xml = buildInvoiceXml(invoicePayload, { pretty: true });

  await writeFile(outputPath, xml, "utf8");
  console.log(`UBL invoice written to ${outputPath}`);
}

main().catch((error) => {
  console.error("Failed to generate UBL invoice:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
