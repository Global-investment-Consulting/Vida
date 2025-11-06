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
const DEFAULT_UNIT_TYPE = 1;

type ReceiverProfile = {
  headerScheme: string;
  headerId: string;
  endpointScheme: string;
  endpointId: string;
  peppolId: string;
  vat: string;
  includeVat: boolean;
};

const RECEIVER_PROFILES: Record<string, ReceiverProfile> = {
  "0208": {
    headerScheme: "iso6523-actorid-upis",
    headerId: "0208:0755799452",
    endpointScheme: "0208",
    endpointId: "0755799452",
    peppolId: "0208:0755799452",
    vat: "BE0755799452",
    includeVat: false
  },
  "9925": {
    headerScheme: "iso6523-actorid-upis",
    headerId: "9925:BE0755799452",
    endpointScheme: "9925",
    endpointId: "BE0755799452",
    peppolId: "9925:BE0755799452",
    vat: "BE0755799452",
    includeVat: true
  }
};

function resolveReceiverProfile(): ReceiverProfile {
  const key = (process.env.SCRADA_RECEIVER_PROFILE ?? "0208").trim();
  return RECEIVER_PROFILES[key] ?? RECEIVER_PROFILES["0208"];
}

const RECEIVER_PROFILE = resolveReceiverProfile();

const NET_AMOUNT = 100;
const VAT_RATE = 21;
const VAT_AMOUNT = Number((NET_AMOUNT * (VAT_RATE / 100)).toFixed(2));
const GROSS_AMOUNT = Number((NET_AMOUNT + VAT_AMOUNT).toFixed(2));

export type InvoiceBuildOptions = {
  invoiceId?: string;
  issueDate?: string;
  dueDate?: string;
  externalReference?: string;
  buyerVat?: string | null;
};

type PartyAddressContext = {
  streetName: string;
  buildingNumber?: string;
  additionalStreetName?: string;
  postalZone: string;
  cityName: string;
  countryCode: string;
};

type PartyContext = {
  name: string;
  scheme: string;
  id: string;
  peppolId: string;
  vatNumber?: string;
  ublVatNumber?: string;
  includeVat?: boolean;
  contactName?: string;
  contactEmail?: string;
  address: PartyAddressContext;
};

type InvoiceLineContext = {
  id: string;
  description: string;
  quantity: number;
  unitCode: string;
  unitType: number;
  unitPrice: number;
};

type PaymentContext = {
  note: string;
  paymentDueDate: string;
  paymentMeansCode: string;
  paymentMeansText: string;
  paymentId: string;
};

export interface ScradaInvoiceContext {
  invoiceId: string;
  externalReference: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  supplier: PartyContext;
  customer: PartyContext;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  vatRate: number;
  line: InvoiceLineContext;
  payment: PaymentContext;
}

function requireEnv(name: string): string {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    throw new Error(`[scrada-payload] Missing required environment variable ${name}`);
  }
  return raw.trim();
}

function optionalEnv(name: string, fallback?: string): string | undefined {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed;
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

function compactVat(value: string | undefined): string {
  return value ? value.replace(/\s+/g, "") : "";
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

function buildSupplierContext(): PartyContext {
  let supplierScheme = requireEnv("SCRADA_SUPPLIER_SCHEME");
  let supplierId = requireEnv("SCRADA_SUPPLIER_ID");

  const companyIdRaw = optionalEnv("SCRADA_COMPANY_ID");
  if (companyIdRaw && companyIdRaw.includes(":")) {
    const [schemePart, valuePart] = companyIdRaw.split(":", 2);
    if (schemePart && valuePart) {
      supplierScheme = schemePart.trim() || supplierScheme;
      supplierId = valuePart.trim() || supplierId;
    }
  }

  const supplierVat = requireEnv("SCRADA_SUPPLIER_VAT");
  const name = optionalEnv("SCRADA_SUPPLIER_NAME", "Vida Supplier NV")!;

  return {
    name,
    scheme: supplierScheme,
    id: supplierId,
    peppolId: `${supplierScheme}:${supplierId}`,
    vatNumber: supplierVat,
    ublVatNumber: compactVat(supplierVat),
    contactName: optionalEnv("SCRADA_SUPPLIER_CONTACT"),
    contactEmail: optionalEnv("SCRADA_SUPPLIER_EMAIL"),
    address: {
      streetName: optionalEnv("SCRADA_SUPPLIER_STREET", "Koning Albert II-laan")!,
      buildingNumber: optionalEnv("SCRADA_SUPPLIER_BUILDING", "21"),
      additionalStreetName: optionalEnv("SCRADA_SUPPLIER_STREET_LINE_2"),
      postalZone: optionalEnv("SCRADA_SUPPLIER_POSTAL", "1000")!,
      cityName: optionalEnv("SCRADA_SUPPLIER_CITY", "Brussels")!,
      countryCode: optionalEnv("SCRADA_SUPPLIER_COUNTRY", "BE")!
    }
  };
}

function buildBuyerContext(receiver: ReceiverProfile, buyerVat: string | null | undefined): PartyContext {
  const name = optionalEnv("SCRADA_RECEIVER_NAME", "Vida Sandbox Buyer")!;
  const vat =
    typeof buyerVat === "string" && buyerVat.trim().length > 0
      ? buyerVat.trim()
      : receiver.vat;

  return {
    name,
    scheme: receiver.endpointScheme,
    id: receiver.endpointId,
    peppolId: receiver.peppolId,
    vatNumber: vat,
    ublVatNumber: receiver.includeVat ? compactVat(vat) : undefined,
    includeVat: receiver.includeVat,
    contactName: optionalEnv("SCRADA_RECEIVER_CONTACT"),
    contactEmail: optionalEnv("SCRADA_RECEIVER_EMAIL"),
    address: {
      streetName: optionalEnv("SCRADA_RECEIVER_STREET", "Receiverstraat")!,
      buildingNumber: optionalEnv("SCRADA_RECEIVER_BUILDING", "5"),
      additionalStreetName: optionalEnv("SCRADA_RECEIVER_STREET_LINE_2"),
      postalZone: optionalEnv("SCRADA_RECEIVER_POSTAL", "2000")!,
      cityName: optionalEnv("SCRADA_RECEIVER_CITY", "Antwerpen")!,
      countryCode: optionalEnv("SCRADA_RECEIVER_COUNTRY", "BE")!
    }
  };
}

function buildPaymentContext(externalReference: string, dueDate: string): PaymentContext {
  const note = optionalEnv("SCRADA_PAYMENT_NOTE", "Payment due within 30 days")!;
  const meansCode = optionalEnv("SCRADA_PAYMENT_MEANS_CODE", "30")!;
  const meansText = optionalEnv("SCRADA_PAYMENT_MEANS_TEXT", "Credit transfer")!;
  const paymentId = optionalEnv("SCRADA_PAYMENT_REFERENCE", externalReference)!;
  return {
    note,
    paymentDueDate: dueDate,
    paymentMeansCode: meansCode,
    paymentMeansText: meansText,
    paymentId
  };
}

function buildLineContext(): InvoiceLineContext {
  const description = optionalEnv("SCRADA_LINE_DESCRIPTION", "Scrada sandbox service")!;
  return {
    id: "1",
    description,
    quantity: 1,
    unitCode: DEFAULT_UNIT_CODE,
    unitType: DEFAULT_UNIT_TYPE,
    unitPrice: NET_AMOUNT
  };
}

function buildInvoiceContext(options: InvoiceBuildOptions = {}): ScradaInvoiceContext {
  const receiverProfile = RECEIVER_PROFILE;
  const invoiceId = resolveInvoiceId(options);
  const externalReference = resolveReference(invoiceId, options);
  const { issueDate, dueDate } = resolveDates(options);

  const supplier = buildSupplierContext();
  const customer = buildBuyerContext(receiverProfile, options.buyerVat ?? undefined);
  const payment = buildPaymentContext(externalReference, dueDate);
  const line = buildLineContext();

  return {
    invoiceId,
    externalReference,
    issueDate,
    dueDate,
    currency: DOCUMENT_CURRENCY,
    supplier,
    customer,
    netAmount: NET_AMOUNT,
    vatAmount: VAT_AMOUNT,
    grossAmount: GROSS_AMOUNT,
    vatRate: VAT_RATE,
    line,
    payment
  };
}

type JsonParty = ScradaSalesInvoice["supplier"];
type JsonLine = ScradaSalesInvoice["lines"][number];
type JsonVatTotal = ScradaSalesInvoice["vatTotals"][number];

function mapPartyToJson(context: PartyContext): JsonParty {
  return {
    name: context.name,
    contact: context.contactName,
    email: context.contactEmail,
    vatNumber: context.vatNumber,
    peppolID: context.peppolId,
    address: {
      street: context.address.streetName,
      streetNumber: context.address.buildingNumber,
      zipCode: context.address.postalZone,
      city: context.address.cityName,
      countryCode: context.address.countryCode
    }
  };
}

function mapLineToJson(context: ScradaInvoiceContext): JsonLine {
  return {
    lineNumber: context.line.id,
    itemName: context.line.description,
    quantity: context.line.quantity,
    unitType: context.line.unitType,
    itemExclVat: context.line.unitPrice,
    totalExclVat: context.netAmount,
    totalInclVat: context.grossAmount,
    vatType: 1,
    vatPercentage: Number(context.vatRate.toFixed(2))
  };
}

function mapVatTotalsToJson(context: ScradaInvoiceContext): JsonVatTotal[] {
  return [
    {
      vatType: 1,
      vatPercentage: Number(context.vatRate.toFixed(2)),
      totalExclVat: context.netAmount,
      totalVat: context.vatAmount,
      totalInclVat: context.grossAmount
    }
  ];
}

function buildJsonInvoice(context: ScradaInvoiceContext): ScradaSalesInvoice {
  const supplier = mapPartyToJson(context.supplier);
  const customer = mapPartyToJson(context.customer);
  const normalizedPeppolId = customer.peppolID?.trim();
  if (normalizedPeppolId) {
    customer.peppolID = normalizedPeppolId;
  } else {
    customer.peppolID = `${context.customer.scheme}:${context.customer.id}`;
  }

  return {
    number: context.invoiceId,
    externalReference: context.externalReference,
    invoiceDate: context.issueDate,
    invoiceExpiryDate: context.dueDate,
    supplier,
    customer,
    currency: context.currency,
    totalExclVat: context.netAmount,
    totalVat: context.vatAmount,
    totalInclVat: context.grossAmount,
    isInclVat: false,
    buyerReference: context.externalReference,
    note: optionalEnv("SCRADA_INVOICE_NOTE") ?? undefined,
    lines: [mapLineToJson(context)],
    vatTotals: mapVatTotalsToJson(context),
    paymentTerms: context.payment.note
  };
}

function appendParty(root: any, role: "supplier" | "customer", context: ScradaInvoiceContext) {
  const isCustomer = role === "customer";
  const party = role === "supplier" ? context.supplier : context.customer;
  const containerName = role === "supplier" ? "cac:AccountingSupplierParty" : "cac:AccountingCustomerParty";
  const container = root.ele(containerName);
  const partyElement = container.ele("cac:Party");

  partyElement
    .ele("cbc:EndpointID", { schemeID: party.scheme })
    .txt(party.id)
    .up();

  if (party.peppolId) {
    const [schemePart, valuePart] = party.peppolId.includes(":")
      ? party.peppolId.split(":", 2)
      : [party.scheme, party.peppolId];
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

  const includeCustomerVat = isCustomer && Boolean(party.includeVat);
  let vatValue: string | undefined;
  if (!isCustomer) {
    vatValue = compactVat(party.vatNumber) || compactVat(requireEnv("SCRADA_SUPPLIER_VAT"));
  } else if (includeCustomerVat) {
    vatValue = compactVat(party.ublVatNumber) || compactVat(RECEIVER_PROFILE.vat);
  }

  if (vatValue) {
    const partyTaxScheme = partyElement.ele("cac:PartyTaxScheme");
    partyTaxScheme
      .ele("cbc:CompanyID", { schemeID: "VAT" })
      .txt(vatValue)
      .up();
    const taxScheme = partyTaxScheme.ele("cac:TaxScheme");
    const taxSchemeId = isCustomer
      ? taxScheme.ele("cbc:ID")
      : taxScheme.ele("cbc:ID", { schemeID: "UN/ECE 5153", schemeAgencyID: "6" });
    taxSchemeId.txt(TAX_SCHEME_ID).up();
    taxScheme.up();
  }

  const legalEntity = partyElement.ele("cac:PartyLegalEntity");
  legalEntity
    .ele("cbc:RegistrationName")
    .txt(party.name)
    .up();
  legalEntity
    .ele("cbc:CompanyID", { schemeID: party.scheme })
    .txt(party.id)
    .up();
}

function appendTaxTotals(root: any, context: ScradaInvoiceContext) {
  const taxTotal = root.ele("cac:TaxTotal");
  taxTotal
    .ele("cbc:TaxAmount", { currencyID: context.currency })
    .txt(formatAmount(context.vatAmount))
    .up();

  const taxSubtotal = taxTotal.ele("cac:TaxSubtotal");
  taxSubtotal
    .ele("cbc:TaxableAmount", { currencyID: context.currency })
    .txt(formatAmount(context.netAmount))
    .up();
  taxSubtotal
    .ele("cbc:TaxAmount", { currencyID: context.currency })
    .txt(formatAmount(context.vatAmount))
    .up();

  const taxCategory = taxSubtotal.ele("cac:TaxCategory");
  taxCategory
    .ele("cbc:ID", { schemeID: "UNCL5305", schemeAgencyID: "6" })
    .txt(VAT_CATEGORY)
    .up();
  taxCategory.ele("cbc:Percent").txt(context.vatRate.toFixed(2)).up();
  taxCategory
    .ele("cac:TaxScheme")
    .ele("cbc:ID", { schemeID: "UN/ECE 5153", schemeAgencyID: "6" })
    .txt(TAX_SCHEME_ID)
    .up()
    .up();
}

function appendLegalMonetaryTotal(root: any, context: ScradaInvoiceContext) {
  const totals = root.ele("cac:LegalMonetaryTotal");
  totals
    .ele("cbc:LineExtensionAmount", { currencyID: context.currency })
    .txt(formatAmount(context.netAmount))
    .up();
  totals
    .ele("cbc:TaxExclusiveAmount", { currencyID: context.currency })
    .txt(formatAmount(context.netAmount))
    .up();
  totals
    .ele("cbc:TaxInclusiveAmount", { currencyID: context.currency })
    .txt(formatAmount(context.grossAmount))
    .up();
  totals
    .ele("cbc:PayableAmount", { currencyID: context.currency })
    .txt(formatAmount(context.grossAmount))
    .up();
}

function appendInvoiceLine(root: any, context: ScradaInvoiceContext) {
  const invoiceLine = root.ele("cac:InvoiceLine");
  invoiceLine.ele("cbc:ID").txt(context.line.id).up();
  invoiceLine
    .ele("cbc:InvoicedQuantity", { unitCode: context.line.unitCode })
    .txt(context.line.quantity.toString())
    .up();
  invoiceLine
    .ele("cbc:LineExtensionAmount", { currencyID: context.currency })
    .txt(formatAmount(context.netAmount))
    .up();

  const item = invoiceLine.ele("cac:Item");
  item.ele("cbc:Description").txt(context.line.description).up();
  item.ele("cbc:Name").txt(context.line.description).up();

  const classifiedTax = item.ele("cac:ClassifiedTaxCategory");
  classifiedTax
    .ele("cbc:ID", { schemeID: "UNCL5305", schemeAgencyID: "6" })
    .txt(VAT_CATEGORY)
    .up();
  classifiedTax.ele("cbc:Percent").txt(context.vatRate.toFixed(2)).up();
  classifiedTax
    .ele("cac:TaxScheme")
    .ele("cbc:ID", { schemeID: "UN/ECE 5153", schemeAgencyID: "6" })
    .txt(TAX_SCHEME_ID)
    .up()
    .up();

  const price = invoiceLine.ele("cac:Price");
  price
    .ele("cbc:PriceAmount", { currencyID: context.currency })
    .txt(formatAmount(context.line.unitPrice))
    .up();
}

function buildUblInvoice(context: ScradaInvoiceContext): string {
  const root = create({ version: "1.0", encoding: "UTF-8" }).ele("Invoice", {
    xmlns: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    "xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  });

  root.ele("cbc:CustomizationID").txt(CUSTOMIZATION_ID).up();
  root.ele("cbc:ProfileID").txt(PROFILE_ID).up();
  root.ele("cbc:ID").txt(context.invoiceId).up();
  root.ele("cbc:IssueDate").txt(context.issueDate).up();
  root.ele("cbc:DueDate").txt(context.dueDate).up();
  root.ele("cbc:InvoiceTypeCode").txt(INVOICE_TYPE_CODE).up();
  root.ele("cbc:DocumentCurrencyCode", { listID: "ISO4217" }).txt(context.currency).up();
  if (context.externalReference) {
    root.ele("cbc:BuyerReference").txt(context.externalReference).up();
  }

  appendParty(root, "supplier", context);
  appendParty(root, "customer", context);
  appendTaxTotals(root, context);
  appendLegalMonetaryTotal(root, context);
  appendInvoiceLine(root, context);

  const paymentMeans = root.ele("cac:PaymentMeans");
  paymentMeans
    .ele("cbc:PaymentMeansCode")
    .txt(context.payment.paymentMeansCode)
    .up();
  if (context.payment.paymentId) {
    paymentMeans.ele("cbc:PaymentID").txt(context.payment.paymentId).up();
  }

  const paymentTerms = root.ele("cac:PaymentTerms");
  if (context.payment.note) {
    paymentTerms.ele("cbc:Note").txt(context.payment.note).up();
  }
  if (context.payment.paymentDueDate) {
    paymentTerms.ele("cbc:PaymentDueDate").txt(context.payment.paymentDueDate).up();
  }
  if (context.payment.paymentId) {
    paymentTerms.ele("cbc:PaymentID").txt(context.payment.paymentId).up();
  }

  return root.end({ prettyPrint: true });
}

export interface ScradaInvoiceArtifacts {
  context: ScradaInvoiceContext;
  json: ScradaSalesInvoice;
  ubl: string;
}

export function createScradaInvoiceArtifacts(options: InvoiceBuildOptions = {}): ScradaInvoiceArtifacts {
  const context = buildInvoiceContext(options);
  const json = buildJsonInvoice(context);
  const ubl = buildUblInvoice(context);
  return { context, json, ubl };
}

export function buildScradaJsonInvoice(options: InvoiceBuildOptions = {}): ScradaSalesInvoice {
  return createScradaInvoiceArtifacts(options).json;
}

export function buildScradaUblInvoice(options: InvoiceBuildOptions = {}): string {
  return createScradaInvoiceArtifacts(options).ubl;
}
