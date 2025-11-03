import { randomUUID } from "node:crypto";
import process from "node:process";
import { create } from "xmlbuilder2";
import { ScradaSalesInvoice } from "../types/scrada.js";

const PROFILE_ID = "urn:fdc:peppol.eu:2017:poacc:billing:3.0";
const CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017";
const INVOICE_TYPE_CODE = "380";
const DOCUMENT_CURRENCY = "EUR";
const VAT_CATEGORY = "S";
const TAX_SCHEME_ID = "VAT";
const DEFAULT_UNIT_CODE = "EA";
export const OMIT_BUYER_VAT_VARIANT = "omit-buyer-vat";

const NET_AMOUNT = 100;
const VAT_RATE = 21;
const VAT_AMOUNT = Number((NET_AMOUNT * (VAT_RATE / 100)).toFixed(2));
const GROSS_AMOUNT = Number((NET_AMOUNT + VAT_AMOUNT).toFixed(2));

type InvoiceBuildOptions = {
  invoiceId?: string;
  issueDate?: string;
  dueDate?: string;
  externalReference?: string;
  buyerVat?: string | null;
};

function requireEnv(name: string): string {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    throw new Error(`[scrada-payload] Missing required environment variable ${name}`);
  }
  return raw.trim();
}

function optionalEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function formatAmount(value: number): string {
  return value.toFixed(2);
}

function isoDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): Date {
  const copy = new Date(base.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function generateInvoiceId(): string {
  const now = isoDateString(new Date()).replace(/-/g, "");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `VIDA-${now}-${suffix}`;
}

export function resolveBuyerVatVariants(source?: string): string[] {
  const raw = (source ?? process.env.SCRADA_RECEIVER_VAT ?? "").trim();
  const compact = raw.replace(/\s+/g, "");
  const variants: string[] = [];

  const pushUnique = (value: string | undefined) => {
    if (!value) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (!variants.includes(trimmed)) {
      variants.push(trimmed);
    }
  };

  if (compact) {
    if (compact.startsWith("BE") && compact.length > 2) {
      pushUnique(compact);
      const digits = compact.slice(2);
      pushUnique(digits);
      if (digits.length === 10) {
        pushUnique(`BE ${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`);
      }
    } else {
      pushUnique(compact);
    }
  }

  if (raw && raw !== compact) {
    pushUnique(raw);
  }

  if (variants.length === 0) {
    throw new Error("[scrada-payload] SCRADA_RECEIVER_VAT is required to build invoice payloads");
  }

  return variants.slice(0, 3);
}

export function isOmitBuyerVatVariant(value: string | null | undefined): boolean {
  return value === OMIT_BUYER_VAT_VARIANT;
}

function canonicalizeBuyerVat(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (isOmitBuyerVatVariant(value)) {
    return undefined;
  }
  const trimmed = value.trim();
  const normalizedVariants = resolveBuyerVatVariants();
  const targetCore = compactVat(trimmed).replace(/^BE/i, "");

  for (const variant of normalizedVariants) {
    if (!variant) {
      continue;
    }
    const normalizedVariant = variant.trim();
    if (normalizedVariant === trimmed) {
      return normalizedVariant;
    }
    const variantCore = compactVat(normalizedVariant).replace(/^BE/i, "");
    if (variantCore === targetCore && variantCore.length > 0) {
      return normalizedVariant;
    }
  }

  return trimmed;
}

function resolveJsonBuyerVat(options: InvoiceBuildOptions): string | undefined {
  const raw = options.buyerVat ?? resolveBuyerVatVariants()[0];
  if (isOmitBuyerVatVariant(raw)) {
    return undefined;
  }
  return raw;
}

function resolveUblBuyerVat(options: InvoiceBuildOptions): string | undefined {
  const raw = options.buyerVat ?? resolveBuyerVatVariants()[0];
  if (isOmitBuyerVatVariant(raw)) {
    return undefined;
  }
  return canonicalizeBuyerVat(raw);
}

function resolveInvoiceId(options: InvoiceBuildOptions): string {
  return options.invoiceId?.trim() && options.invoiceId.trim().length > 0
    ? options.invoiceId.trim()
    : generateInvoiceId();
}

function resolveReference(invoiceId: string, options: InvoiceBuildOptions): string {
  if (options.externalReference && options.externalReference.trim().length > 0) {
    return options.externalReference.trim();
  }
  return invoiceId;
}

function compactVat(value: string | undefined): string {
  return value ? value.replace(/\s+/g, "") : "";
}

function resolveDates(options: InvoiceBuildOptions): { issueDate: string; dueDate: string } {
  if (options.issueDate && options.issueDate.trim().length > 0) {
    const providedIssue = options.issueDate.trim();
    const providedDue =
      options.dueDate && options.dueDate.trim().length > 0
        ? options.dueDate.trim()
        : isoDateString(addDays(new Date(providedIssue), 30));
    return { issueDate: providedIssue, dueDate: providedDue };
  }

  const today = new Date();
  const issueDate = isoDateString(today);
  const dueDate = isoDateString(addDays(today, 30));
  return { issueDate, dueDate };
}

function buildSupplierParty() {
  const companyIdRaw = process.env.SCRADA_COMPANY_ID?.trim();
  let supplierScheme = requireEnv("SCRADA_SUPPLIER_SCHEME");
  let supplierId = requireEnv("SCRADA_SUPPLIER_ID");
  if (companyIdRaw && companyIdRaw.includes(":")) {
    const [schemePart, valuePart] = companyIdRaw.split(":", 2);
    if (schemePart && valuePart) {
      supplierScheme = schemePart.trim() || supplierScheme;
      supplierId = valuePart.trim() || supplierId;
    }
  }
  const supplierVat = requireEnv("SCRADA_SUPPLIER_VAT");
  const name = optionalEnv("SCRADA_SUPPLIER_NAME", "Vida Supplier NV");

  return {
    name,
    endpointId: supplierId,
    endpointScheme: supplierScheme,
    vatNumber: supplierVat,
    schemeId: supplierScheme,
    peppolId: `${supplierScheme}:${supplierId}`,
    address: {
      streetName: optionalEnv("SCRADA_SUPPLIER_STREET", "Koning Albert II-laan"),
      buildingNumber: optionalEnv("SCRADA_SUPPLIER_BUILDING", "21"),
      postalZone: optionalEnv("SCRADA_SUPPLIER_POSTAL", "1000"),
      cityName: optionalEnv("SCRADA_SUPPLIER_CITY", "Brussels"),
      countryCode: optionalEnv("SCRADA_SUPPLIER_COUNTRY", "BE")
    },
    contact: {
      name: optionalEnv("SCRADA_SUPPLIER_CONTACT", "Vida Finance"),
      email: optionalEnv("SCRADA_SUPPLIER_EMAIL", "billing@example.test")
    }
  };
}

function buildBuyerParty(buyerVat?: string | null) {
  const participantRaw = process.env.SCRADA_PARTICIPANT_ID?.trim();
  let receiverScheme = requireEnv("SCRADA_TEST_RECEIVER_SCHEME");
  let receiverId = requireEnv("SCRADA_TEST_RECEIVER_ID");
  if (participantRaw && participantRaw.includes(":")) {
    const [schemePart, valuePart] = participantRaw.split(":", 2);
    if (schemePart && valuePart) {
      receiverScheme = schemePart.trim() || receiverScheme;
      receiverId = valuePart.trim() || receiverId;
    }
  }
  const name = optionalEnv("SCRADA_RECEIVER_NAME", "Vida Sandbox Buyer");

  return {
    name,
    endpointId: `${receiverScheme}:${receiverId}`,
    endpointScheme: receiverScheme,
    vatNumber: buyerVat ?? undefined,
    schemeId: receiverScheme,
    peppolId: `${receiverScheme}:${receiverId}`,
    address: {
      streetName: optionalEnv("SCRADA_RECEIVER_STREET", "Receiverstraat"),
      buildingNumber: optionalEnv("SCRADA_RECEIVER_BUILDING", "5"),
      postalZone: optionalEnv("SCRADA_RECEIVER_POSTAL", "2000"),
      cityName: optionalEnv("SCRADA_RECEIVER_CITY", "Antwerpen"),
      countryCode: optionalEnv("SCRADA_RECEIVER_COUNTRY", "BE")
    },
    contact: {
      name: optionalEnv("SCRADA_RECEIVER_CONTACT", "Vida AP Sandbox"),
      email: optionalEnv("SCRADA_RECEIVER_EMAIL", "ap@example.test")
    }
  };
}

function baseInvoice(
  invoiceId: string,
  options: InvoiceBuildOptions,
  buyerVat: string | undefined
): ScradaSalesInvoice {
  const { issueDate, dueDate } = resolveDates(options);
  const reference = resolveReference(invoiceId, options);
  const supplier = buildSupplierParty();
  const buyer = buildBuyerParty(buyerVat);

  return {
    profileId: PROFILE_ID,
    customizationId: CUSTOMIZATION_ID,
    id: invoiceId,
    issueDate,
    dueDate,
    currency: DOCUMENT_CURRENCY,
    externalReference: reference,
    seller: supplier,
    buyer,
    totals: {
      lineExtensionAmount: { currency: DOCUMENT_CURRENCY, value: NET_AMOUNT },
      taxExclusiveAmount: { currency: DOCUMENT_CURRENCY, value: NET_AMOUNT },
      taxInclusiveAmount: { currency: DOCUMENT_CURRENCY, value: GROSS_AMOUNT },
      payableAmount: { currency: DOCUMENT_CURRENCY, value: GROSS_AMOUNT },
      taxTotals: [
        {
          rate: VAT_RATE,
          taxableAmount: { currency: DOCUMENT_CURRENCY, value: NET_AMOUNT },
          taxAmount: { currency: DOCUMENT_CURRENCY, value: VAT_AMOUNT }
        }
      ]
    },
    lines: [
      {
        id: "1",
        description: optionalEnv("SCRADA_LINE_DESCRIPTION", "Scrada sandbox service"),
        quantity: 1,
        unitCode: DEFAULT_UNIT_CODE,
        unitPrice: { currency: DOCUMENT_CURRENCY, value: NET_AMOUNT },
        lineExtensionAmount: { currency: DOCUMENT_CURRENCY, value: NET_AMOUNT },
        vat: {
          rate: VAT_RATE,
          taxableAmount: { currency: DOCUMENT_CURRENCY, value: NET_AMOUNT },
          taxAmount: { currency: DOCUMENT_CURRENCY, value: VAT_AMOUNT }
        }
      }
    ],
    paymentTerms: {
      note: "Payment due within 30 days",
      paymentDueDate: dueDate,
      paymentMeansCode: "30",
      paymentMeansText: "Credit transfer",
      paymentId: reference
    }
  };
}

export function buildScradaJsonInvoice(options: InvoiceBuildOptions = {}): ScradaSalesInvoice {
  const invoiceId = resolveInvoiceId(options);
  return baseInvoice(invoiceId, options, resolveJsonBuyerVat(options));
}

function appendParty(aggregation: any, role: "supplier" | "customer", invoice: ScradaSalesInvoice) {
  const party = role === "supplier" ? invoice.seller : invoice.buyer;
  const container =
    role === "supplier" ? aggregation.ele("cac:AccountingSupplierParty") : aggregation.ele("cac:AccountingCustomerParty");
  const partyElement = container.ele("cac:Party");

  const endpointScheme = party.endpointScheme ?? "0208";
  const endpointValue =
    role === "supplier"
      ? requireEnv("SCRADA_SUPPLIER_ID")
      : requireEnv("SCRADA_TEST_RECEIVER_ID");

  partyElement
    .ele("cbc:EndpointID", { schemeID: endpointScheme })
    .txt(endpointValue)
    .up();

  if (party.peppolId) {
    const [schemePart, valuePart] = party.peppolId.includes(":")
      ? party.peppolId.split(":", 2)
      : [endpointScheme, party.peppolId];
    const identification = partyElement.ele("cac:PartyIdentification").ele("cbc:ID");
    if (schemePart) {
      identification.att("schemeID", schemePart);
    }
    identification.txt(valuePart).up().up();
  }

  if (party.name) {
    partyElement.ele("cac:PartyName").ele("cbc:Name").txt(party.name).up().up();
  }

  const address = party.address;
  const addressElement = partyElement.ele("cac:PostalAddress");
  addressElement.ele("cbc:StreetName").txt(address.streetName).up();
  if (address.buildingNumber) {
    addressElement.ele("cbc:BuildingNumber").txt(address.buildingNumber).up();
  }
  if (address.additionalStreetName) {
    addressElement.ele("cbc:AdditionalStreetName").txt(address.additionalStreetName).up();
  }
  addressElement.ele("cbc:CityName").txt(address.cityName).up();
  addressElement.ele("cbc:PostalZone").txt(address.postalZone).up();
  addressElement.ele("cac:Country").ele("cbc:IdentificationCode").txt(address.countryCode).up().up();

  const vatValue = compactVat(party.vatNumber);
  const shouldIncludeTaxScheme = role === "supplier" || Boolean(vatValue);
  if (shouldIncludeTaxScheme) {
    const companyVat = role === "supplier" ? vatValue || compactVat(requireEnv("SCRADA_SUPPLIER_VAT")) : vatValue;
    const partyTaxScheme = partyElement.ele("cac:PartyTaxScheme");
    partyTaxScheme
      .ele("cbc:CompanyID", { schemeID: "VAT" })
      .txt(companyVat)
      .up();
    partyTaxScheme
      .ele("cac:TaxScheme")
      .ele("cbc:ID", { schemeID: "UN/ECE 5153", schemeAgencyID: "6" })
      .txt(TAX_SCHEME_ID)
      .up()
      .up();
    partyTaxScheme.up();
  }

  partyElement
    .ele("cac:PartyLegalEntity")
    .ele("cbc:RegistrationName")
    .txt(party.name)
    .up()
    .ele("cbc:CompanyID", { schemeID: endpointScheme })
    .txt(endpointValue)
    .up()
    .up();
}

function appendTaxTotals(root: any) {
  const taxTotal = root.ele("cac:TaxTotal");
  taxTotal
    .ele("cbc:TaxAmount", { currencyID: DOCUMENT_CURRENCY })
    .txt(formatAmount(VAT_AMOUNT))
    .up();

  const taxSubtotal = taxTotal.ele("cac:TaxSubtotal");
  taxSubtotal
    .ele("cbc:TaxableAmount", { currencyID: DOCUMENT_CURRENCY })
    .txt(formatAmount(NET_AMOUNT))
    .up();
  taxSubtotal
    .ele("cbc:TaxAmount", { currencyID: DOCUMENT_CURRENCY })
    .txt(formatAmount(VAT_AMOUNT))
    .up();

  const taxCategory = taxSubtotal.ele("cac:TaxCategory");
  taxCategory
    .ele("cbc:ID", { schemeID: "UNCL5305", schemeAgencyID: "6" })
    .txt(VAT_CATEGORY)
    .up();
  taxCategory.ele("cbc:Percent").txt(VAT_RATE.toFixed(2)).up();
  taxCategory
    .ele("cac:TaxScheme")
    .ele("cbc:ID", { schemeID: "UN/ECE 5153", schemeAgencyID: "6" })
    .txt(TAX_SCHEME_ID)
    .up()
    .up();
}

function appendLegalMonetaryTotal(root: any) {
  const totals = root.ele("cac:LegalMonetaryTotal");
  totals
    .ele("cbc:LineExtensionAmount", { currencyID: DOCUMENT_CURRENCY })
    .txt(formatAmount(NET_AMOUNT))
    .up();
  totals
    .ele("cbc:TaxExclusiveAmount", { currencyID: DOCUMENT_CURRENCY })
    .txt(formatAmount(NET_AMOUNT))
    .up();
  totals
    .ele("cbc:TaxInclusiveAmount", { currencyID: DOCUMENT_CURRENCY })
    .txt(formatAmount(GROSS_AMOUNT))
    .up();
  totals
    .ele("cbc:PayableAmount", { currencyID: DOCUMENT_CURRENCY })
    .txt(formatAmount(GROSS_AMOUNT))
    .up();
}

function appendInvoiceLine(root: any, invoice: ScradaSalesInvoice) {
  const line = invoice.lines[0];
  const invoiceLine = root.ele("cac:InvoiceLine");
  invoiceLine.ele("cbc:ID").txt(line.id).up();
  invoiceLine.ele("cbc:InvoicedQuantity", { unitCode: line.unitCode ?? DEFAULT_UNIT_CODE }).txt(line.quantity.toString()).up();
  invoiceLine
    .ele("cbc:LineExtensionAmount", { currencyID: DOCUMENT_CURRENCY })
    .txt(formatAmount(line.lineExtensionAmount.value))
    .up();

  const item = invoiceLine.ele("cac:Item");
  item.ele("cbc:Description").txt(line.description).up();
  item.ele("cbc:Name").txt(line.description).up();

  const classifiedTax = item.ele("cac:ClassifiedTaxCategory");
  classifiedTax
    .ele("cbc:ID", { schemeID: "UNCL5305", schemeAgencyID: "6" })
    .txt(VAT_CATEGORY)
    .up();
  classifiedTax.ele("cbc:Percent").txt(VAT_RATE.toFixed(2)).up();
  classifiedTax
    .ele("cac:TaxScheme")
    .ele("cbc:ID", { schemeID: "UN/ECE 5153", schemeAgencyID: "6" })
    .txt(TAX_SCHEME_ID)
    .up()
    .up();

  const price = invoiceLine.ele("cac:Price");
  price
    .ele("cbc:PriceAmount", { currencyID: DOCUMENT_CURRENCY })
    .txt(formatAmount(line.unitPrice.value))
    .up();
}

export function buildScradaUblInvoice(options: InvoiceBuildOptions = {}): string {
  const invoiceId = resolveInvoiceId(options);
  const invoice = baseInvoice(invoiceId, options, resolveUblBuyerVat(options));

  const root = create({ version: "1.0", encoding: "UTF-8" }).ele("Invoice", {
    xmlns: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    "xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  });

  root.ele("cbc:CustomizationID").txt(CUSTOMIZATION_ID).up();
  root.ele("cbc:ProfileID").txt(PROFILE_ID).up();
  root.ele("cbc:ID").txt(invoice.id).up();
  root.ele("cbc:IssueDate").txt(invoice.issueDate).up();
  root.ele("cbc:DueDate").txt(invoice.dueDate ?? invoice.issueDate).up();
  root.ele("cbc:InvoiceTypeCode").txt(INVOICE_TYPE_CODE).up();
  root.ele("cbc:DocumentCurrencyCode", { listID: "ISO4217" }).txt(DOCUMENT_CURRENCY).up();
  if (invoice.externalReference) {
    root.ele("cbc:BuyerReference").txt(invoice.externalReference).up();
  }

  appendParty(root, "supplier", invoice);
  appendParty(root, "customer", invoice);
  appendTaxTotals(root);
  appendLegalMonetaryTotal(root);
  appendInvoiceLine(root, invoice);

  const paymentTermsData = invoice.paymentTerms ?? {
    note: "Payment due within 30 days",
    paymentDueDate: invoice.dueDate ?? invoice.issueDate,
    paymentMeansCode: "31",
    paymentId: invoice.externalReference ?? invoice.id
  };

  const paymentMeans = root.ele("cac:PaymentMeans");
  paymentMeans
    .ele("cbc:PaymentMeansCode")
    .txt(paymentTermsData.paymentMeansCode ?? "31")
    .up();
  if (paymentTermsData.paymentId) {
    paymentMeans.ele("cbc:PaymentID").txt(paymentTermsData.paymentId).up();
  }

  const paymentTerms = root.ele("cac:PaymentTerms");
  if (paymentTermsData.note) {
    paymentTerms.ele("cbc:Note").txt(paymentTermsData.note).up();
  }
  if (paymentTermsData.paymentDueDate) {
    paymentTerms.ele("cbc:PaymentDueDate").txt(paymentTermsData.paymentDueDate).up();
  }
  if (paymentTermsData.paymentId) {
    paymentTerms.ele("cbc:PaymentID").txt(paymentTermsData.paymentId).up();
  }

  return root.end({ prettyPrint: true });
}
