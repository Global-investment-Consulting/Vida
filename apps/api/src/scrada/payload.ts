import { randomUUID } from "node:crypto";
import process from "node:process";

import type {
  ScradaInvoiceLine,
  ScradaInvoiceTotals,
  ScradaParty,
  ScradaSalesInvoice,
  ScradaVatDetail
} from "../types/scrada.js";

export interface PrepareOptions {
  receiverScheme?: string;
  receiverValue?: string;
  senderScheme?: string;
  senderValue?: string;
  receiverVat?: string;
  senderVat?: string;
}

export type ScradaInvoiceSeed = Partial<ScradaSalesInvoice> & {
  lines?: Array<Partial<ScradaInvoiceLine>>;
};

export interface JsonFromEnvOptions {
  env?: NodeJS.ProcessEnv;
  overrides?: PrepareOptions;
}

const DEFAULT_PROFILE_ID = "urn:fdc:peppol.eu:2017:poacc:billing:3.0";
const DEFAULT_CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017";
const DEFAULT_CURRENCY = "EUR";
const DEFAULT_VAT_RATE = 21;
const DEFAULT_TAX_CATEGORY = "S";
const DEFAULT_UNIT_CODE = "EA";
const DEFAULT_BUYER_VAT = "BE0456123456";
const DEFAULT_SELLER_VAT = "BE0123456789";
const DEFAULT_PAYMENT_TERM_DAYS = 30;

interface EndpointSummary {
  scheme?: string;
  value?: string;
  id?: string;
}

function normalizeDigits(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const digits = value.replace(/\D+/g, "");
  return digits.length > 0 ? digits : undefined;
}

function deriveVatNumberFromIdentifier(
  scheme: string | undefined,
  value: string | undefined
): string | undefined {
  const trimmedScheme = scheme?.trim();
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return undefined;
  }
  if (/^BE\d{8,12}$/i.test(trimmedValue)) {
    return trimmedValue.toUpperCase();
  }
  const digits = normalizeDigits(trimmedValue);
  if (!digits) {
    return undefined;
  }
  if (trimmedScheme === "0208" || trimmedScheme === "9956") {
    if (digits.length === 10) {
      return `BE${digits}`;
    }
  }
  if (digits.length === 10 && trimmedValue.startsWith("BE")) {
    return `BE${digits}`;
  }
  return undefined;
}

function digitsOnly(input?: string): string {
  if (typeof input !== "string") {
    return "";
  }
  return input.replace(/\D+/g, "");
}

function normalizeEnterpriseNumber(input?: string): string | undefined {
  const digits = digitsOnly(input);
  if (digits.length === 10) {
    return digits.startsWith("0") ? digits : undefined;
  }
  if (digits.length === 9) {
    return `0${digits}`;
  }
  return undefined;
}

function normalizeBelgianVatNumber(input?: string): string | undefined {
  const digits = digitsOnly(input);
  if (digits.length === 10 && digits.startsWith("0")) {
    return `BE${digits}`;
  }
  if (digits.length === 9) {
    return `BE0${digits}`;
  }
  if (/^BE0\d{9}$/i.test((input ?? "").trim())) {
    return (input ?? "").trim().toUpperCase();
  }
  return undefined;
}

function normalizeVatFromEnterprise(input?: string): string | undefined {
  const enterprise = normalizeEnterpriseNumber(input);
  return enterprise ? `BE${enterprise}` : undefined;
}

function applyPartyIdentifiers(
  party: ScradaParty,
  endpoint: EndpointSummary,
  defaults: { vat?: string; enterprise?: string }
): void {
  const explicitVat = normalizeBelgianVatNumber(defaults.vat);
  const existingEnterprise = normalizeEnterpriseNumber(party.companyRegistrationNumber as string | undefined);
  const endpointEnterprise = normalizeEnterpriseNumber(endpoint.value);
  const defaultEnterprise = normalizeEnterpriseNumber(defaults.enterprise);

  const enterpriseNumber = existingEnterprise ?? endpointEnterprise ?? defaultEnterprise ?? undefined;
  if (enterpriseNumber) {
    party.companyRegistrationNumber = enterpriseNumber;
  }

  const partyVat = normalizeBelgianVatNumber(party.vatNumber as string | undefined);
  const derivedVat = deriveVatNumberFromIdentifier(endpoint.scheme, endpoint.value);
  const derivedVatNormalized = normalizeBelgianVatNumber(derivedVat);
  const enterpriseVat = enterpriseNumber ? normalizeVatFromEnterprise(enterpriseNumber) : undefined;
  const fallbackVat = explicitVat ?? partyVat ?? derivedVatNormalized ?? enterpriseVat;

  if (fallbackVat) {
    party.vatNumber = fallbackVat;
  }
}

function ensureBuyer(invoice: ScradaSalesInvoice): ScradaParty {
  if (!invoice.buyer || typeof invoice.buyer !== "object") {
    invoice.buyer = {
      name: "Unknown Buyer",
      vatNumber: DEFAULT_BUYER_VAT,
      address: {
        streetName: "Unknown street",
        postalZone: "0000",
        cityName: "Unknown",
        countryCode: "BE"
      },
      contact: {
        email: "ap@example.test"
      }
    };
  }
  const buyer = invoice.buyer as ScradaParty;
  if (!buyer.address || typeof buyer.address !== "object") {
    buyer.address = {
      streetName: "Unknown street",
      postalZone: "0000",
      cityName: "Unknown",
      countryCode: "BE"
    };
  }
  if (!buyer.address.countryCode) {
    buyer.address.countryCode = "BE";
  }
  if (!buyer.contact || typeof buyer.contact !== "object") {
    buyer.contact = {
      email: "ap@example.test"
    };
  }
  if (!buyer.vatNumber) {
    buyer.vatNumber = DEFAULT_BUYER_VAT;
  }
  return buyer;
}

function ensureSeller(invoice: ScradaSalesInvoice): ScradaParty {
  if (!invoice.seller || typeof invoice.seller !== "object") {
    invoice.seller = {
      name: "Vida Integration Seller",
      vatNumber: DEFAULT_SELLER_VAT,
      address: {
        streetName: "Sellerstraat",
        postalZone: "9000",
        cityName: "Ghent",
        countryCode: "BE"
      },
      contact: {
        email: "billing@vida.example"
      }
    };
  }
  const seller = invoice.seller as ScradaParty;
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
  if (!seller.contact || typeof seller.contact !== "object") {
    seller.contact = {
      email: "billing@vida.example"
    };
  }
  if (!seller.vatNumber) {
    seller.vatNumber = DEFAULT_SELLER_VAT;
  }
  return seller;
}

function extractSchemeValue(input?: string): EndpointSummary {
  if (typeof input !== "string") {
    return {};
  }
  if (input.includes(":")) {
    const [scheme, value] = input.split(":", 2);
    return { scheme: scheme?.trim(), value: value?.trim(), id: input.trim() };
  }
  return { value: input.trim() };
}

function normalizeFallback(fallback?: { scheme?: string; value?: string }): EndpointSummary {
  if (!fallback) {
    return {};
  }
  if (fallback.value && fallback.value.includes(":")) {
    const parsed = extractSchemeValue(fallback.value);
    return {
      scheme: fallback.scheme ?? parsed.scheme,
      value: parsed.value,
      id: parsed.id
    };
  }
  return {
    scheme: fallback.scheme,
    value: fallback.value,
    id: fallback.scheme && fallback.value ? `${fallback.scheme}:${fallback.value}` : undefined
  };
}

function ensurePartyEndpoint(
  party: ScradaParty,
  fallback?: { scheme?: string; value?: string }
): EndpointSummary {
  const participant = extractSchemeValue(
    (party.endpointId as string | undefined) ??
      (party.endpointID as string | undefined) ??
      (party.participantId as string | undefined) ??
      (party.participantID as string | undefined)
  );
  const peppol = extractSchemeValue(
    (party.endpointValue as string | undefined) ??
      (party.peppolId as string | undefined) ??
      (party.peppolID as string | undefined)
  );
  const fallbackCandidate = normalizeFallback(fallback);

  let scheme =
    (party.endpointScheme as string | undefined) ??
    (party.peppolScheme as string | undefined) ??
    (party.schemeId as string | undefined) ??
    participant.scheme ??
    peppol.scheme ??
    fallbackCandidate.scheme;
  let value =
    (party.endpointValue as string | undefined) ??
    participant.value ??
    peppol.value ??
    fallbackCandidate.value;

  if (!scheme && typeof party.vatNumber === "string") {
    scheme = "9956";
  }
  if (!value && typeof party.vatNumber === "string") {
    value = party.vatNumber.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }

  if (scheme && value) {
    const id = `${scheme}:${value}`;
    (party as Record<string, unknown>).endpointScheme = scheme;
    (party as Record<string, unknown>).peppolScheme =
      (party.peppolScheme as string | undefined) ?? scheme;
    (party as Record<string, unknown>).schemeId =
      (party.schemeId as string | undefined) ?? scheme;
    (party as Record<string, unknown>).endpointValue = value;
    (party as Record<string, unknown>).peppolId = value;
    (party as Record<string, unknown>).endpointId = id;
    if (!(party as Record<string, unknown>).endpointID) {
      (party as Record<string, unknown>).endpointID = id;
    }
    if (!(party as Record<string, unknown>).participantId) {
      (party as Record<string, unknown>).participantId = id;
    }
    if (!(party as Record<string, unknown>).participantID) {
      (party as Record<string, unknown>).participantID = id;
    }
    return { scheme, value, id };
  }

  return { scheme, value, id: scheme && value ? `${scheme}:${value}` : undefined };
}

function roundCurrency(value: unknown): number {
  const numeric = Number.parseFloat(String(value ?? 0));
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function normaliseLine(
  line: ScradaInvoiceLine,
  currency: string
): { line: ScradaInvoiceLine; net: number; tax: number } {
  const normalized: ScradaInvoiceLine = structuredClone(line);
  const quantityRaw = Number(normalized.quantity ?? 1);
  const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;
  const unitPriceValue =
    (normalized.unitPrice as Record<string, unknown> | undefined)?.value ??
    (normalized.unitPrice as unknown as number | undefined) ??
    (normalized.unitPrice as unknown as { value: number } | undefined)?.value ??
    (normalized as Record<string, unknown>).unitPriceMinor ??
    0;
  const unitPrice = roundCurrency(unitPriceValue);
  const lineExtension =
    (normalized.lineExtensionAmount as Record<string, unknown> | undefined)?.value ??
    roundCurrency(unitPrice * quantity);
  const net = roundCurrency(lineExtension);

  const defaultRate =
    typeof normalized.vat?.rate === "number" && Number.isFinite(normalized.vat.rate)
      ? normalized.vat.rate
      : DEFAULT_VAT_RATE;
  const vat: ScradaVatDetail = {
    rate: defaultRate,
    taxableAmount: { currency, value: net },
    taxAmount: {
      currency,
      value:
        normalized.vat?.taxAmount?.value ??
        roundCurrency((net * defaultRate) / 100)
    },
    taxCategoryCode: normalized.vat?.taxCategoryCode ?? DEFAULT_TAX_CATEGORY
  };

  normalized.quantity = quantity;
  normalized.unitCode = normalized.unitCode || DEFAULT_UNIT_CODE;
  normalized.unitPrice = { currency, value: unitPrice };
  normalized.lineExtensionAmount = { currency, value: net };
  normalized.vat = vat;

  return { line: normalized, net, tax: roundCurrency(vat.taxAmount.value) };
}

function ensureTotals(invoice: ScradaSalesInvoice): ScradaInvoiceTotals {
  const currency = (invoice.currency || "EUR").trim() || "EUR";
  const lines = Array.isArray(invoice.lines) ? invoice.lines : [];

  let netTotal = 0;
  let taxTotal = 0;
  const normalisedLines: ScradaInvoiceLine[] = [];

  for (const entry of lines) {
    const { line, net, tax } = normaliseLine(entry, currency);
    normalisedLines.push(line);
    netTotal += net;
    taxTotal += tax;
  }

  invoice.lines = normalisedLines;

  const taxExclusive = roundCurrency(netTotal);
  const taxAmount = roundCurrency(taxTotal);
  const taxInclusive = roundCurrency(taxExclusive + taxAmount);

  const taxTotals: ScradaVatDetail[] = [
    {
      rate: DEFAULT_VAT_RATE,
      taxCategoryCode: DEFAULT_TAX_CATEGORY,
      taxableAmount: { currency, value: taxExclusive },
      taxAmount: { currency, value: taxAmount }
    }
  ];

  const totals: ScradaInvoiceTotals = {
    lineExtensionAmount: { currency, value: taxExclusive },
    taxExclusiveAmount: { currency, value: taxExclusive },
    taxInclusiveAmount: { currency, value: taxInclusive },
    payableAmount: { currency, value: taxInclusive },
    taxTotals,
    legalMonetaryTotal: {
      lineExtensionAmount: { currency, value: taxExclusive },
      taxExclusiveAmount: { currency, value: taxExclusive },
      taxInclusiveAmount: { currency, value: taxInclusive },
      payableAmount: { currency, value: taxInclusive }
    }
  };

  invoice.totals = totals;
  return totals;
}

function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatAmount(value: unknown): string {
  return roundCurrency(value).toFixed(2);
}

function buildAddressXml(address: Record<string, unknown> | undefined): string {
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

function buildPartyTaxSchemeXml(vatNumber?: string): string {
  const normalized = normalizeBelgianVatNumber(vatNumber);
  if (!normalized) {
    return "";
  }
  return `<cac:PartyTaxScheme>
    <cbc:CompanyID schemeID="VAT">${xmlEscape(normalized)}</cbc:CompanyID>
    <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
  </cac:PartyTaxScheme>`;
}

function buildContactXml(contact: Record<string, unknown> | undefined): string {
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

function buildPartyXml(party: ScradaParty, role: string): string {
  const endpoint = ensurePartyEndpoint(party);
  const addressXml = buildAddressXml(party.address as Record<string, unknown>);
  const taxXml = buildPartyTaxSchemeXml(party.vatNumber as string | undefined);
  const contactXml = buildContactXml(party.contact as Record<string, unknown>);
  const registrationName = party.name || "Unknown party";
  const legalEntityParts = [`<cbc:RegistrationName>${xmlEscape(registrationName)}</cbc:RegistrationName>`];
  const enterpriseNumber =
    normalizeEnterpriseNumber(party.companyRegistrationNumber as string | undefined) ??
    normalizeEnterpriseNumber(endpoint.value) ??
    normalizeDigits(party.companyRegistrationNumber as string | undefined) ??
    normalizeDigits(endpoint.value);
  if (enterpriseNumber) {
    legalEntityParts.push(
      `<cbc:CompanyID schemeID="0208">${xmlEscape(enterpriseNumber)}</cbc:CompanyID>`
    );
  }
  const legalEntityXml = `<cac:PartyLegalEntity>${legalEntityParts.join("")}</cac:PartyLegalEntity>`;
  const identificationXml = party.vatNumber
    ? `<cac:PartyIdentification><cbc:ID>${xmlEscape(party.vatNumber)}</cbc:ID></cac:PartyIdentification>`
    : "";

  const endpointXml =
    endpoint.scheme && endpoint.value
      ? `<cbc:EndpointID schemeID="${xmlEscape(endpoint.scheme)}">${xmlEscape(endpoint.value)}</cbc:EndpointID>`
      : "";

  return `<cac:${role}>
    <cac:Party>
      ${endpointXml}
      <cac:PartyName><cbc:Name>${xmlEscape(party.name || "Unknown party")}</cbc:Name></cac:PartyName>
      ${identificationXml}
      ${addressXml}
      ${taxXml}
      ${legalEntityXml}
      ${contactXml}
    </cac:Party>
  </cac:${role}>`;
}

function buildInvoiceLineXml(line: ScradaInvoiceLine, currency: string): string {
  const quantity = Number.isFinite(line.quantity) && Number(line.quantity) > 0 ? line.quantity : 1;
  const lineAmount = (line.lineExtensionAmount as Record<string, unknown> | undefined)?.value ?? 0;
  const unitPrice =
    (line.unitPrice as Record<string, unknown> | undefined)?.value ??
    (line.unitPrice as unknown as number | undefined) ??
    0;
  const vatRate = line.vat?.rate ?? DEFAULT_VAT_RATE;
  const vatAmount =
    line.vat?.taxAmount?.value ?? roundCurrency((Number(lineAmount) * vatRate) / 100);

  return `<cac:InvoiceLine>
    <cbc:ID>${xmlEscape(line.id || "1")}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${xmlEscape(line.unitCode || "EA")}">${formatAmount(quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${xmlEscape(currency)}">${formatAmount(lineAmount)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>${xmlEscape(line.description || "Invoice line")}</cbc:Description>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${xmlEscape(line.vat?.taxCategoryCode || DEFAULT_TAX_CATEGORY)}</cbc:ID>
        <cbc:Percent>${formatAmount(vatRate)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${xmlEscape(currency)}">${formatAmount(unitPrice)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
}

function buildTaxTotalXml(totals: ScradaInvoiceTotals, currency: string): string {
  const taxTotal = totals.taxTotals?.[0];
  if (!taxTotal) {
    return "";
  }
  const taxableAmount = taxTotal.taxableAmount?.value ?? totals.taxExclusiveAmount.value;
  const taxAmount = taxTotal.taxAmount?.value ?? 0;
  return `<cac:TaxTotal>
    <cbc:TaxAmount currencyID="${xmlEscape(currency)}">${formatAmount(taxAmount)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${xmlEscape(currency)}">${formatAmount(taxableAmount)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${xmlEscape(currency)}">${formatAmount(taxAmount)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${xmlEscape(taxTotal.taxCategoryCode || DEFAULT_TAX_CATEGORY)}</cbc:ID>
        <cbc:Percent>${formatAmount(taxTotal.rate ?? DEFAULT_VAT_RATE)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>`;
}

function buildLegalMonetaryTotalXml(totals: ScradaInvoiceTotals, currency: string): string {
  const legal = totals.legalMonetaryTotal ?? totals;
  return `<cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${xmlEscape(currency)}">${formatAmount(
      legal.lineExtensionAmount?.value ?? totals.lineExtensionAmount.value
    )}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${xmlEscape(currency)}">${formatAmount(
      legal.taxExclusiveAmount?.value ?? totals.taxExclusiveAmount.value
    )}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${xmlEscape(currency)}">${formatAmount(
      legal.taxInclusiveAmount?.value ?? totals.taxInclusiveAmount.value
    )}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${xmlEscape(currency)}">${formatAmount(
      legal.payableAmount?.value ?? totals.payableAmount.value
    )}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`;
}

function isoDateString(offsetDays = 0): string {
  const date = new Date();
  if (Number.isFinite(offsetDays) && offsetDays !== 0) {
    date.setUTCDate(date.getUTCDate() + offsetDays);
  }
  return date.toISOString().slice(0, 10);
}

function addDaysToIsoDate(baseDate: string | undefined, offsetDays: number): string {
  if (!baseDate || typeof baseDate !== "string") {
    return isoDateString(offsetDays);
  }
  const date = new Date(baseDate);
  if (Number.isNaN(date.getTime())) {
    return isoDateString(offsetDays);
  }
  if (Number.isFinite(offsetDays) && offsetDays !== 0) {
    date.setUTCDate(date.getUTCDate() + offsetDays);
  }
  return date.toISOString().slice(0, 10);
}

function generateInvoiceId(seedId?: string): string {
  if (seedId && seedId.trim().length > 0) {
    return seedId.trim();
  }
  const datePart = isoDateString().replace(/-/g, "");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `SCRADA-${datePart}-${suffix}`;
}

function createPlaceholderTotals(currency: string): ScradaInvoiceTotals {
  const normalizedCurrency = (currency || DEFAULT_CURRENCY).trim().toUpperCase() || DEFAULT_CURRENCY;
  const makeAmount = (value = 0) => ({ currency: normalizedCurrency, value });
  return {
    lineExtensionAmount: makeAmount(),
    taxExclusiveAmount: makeAmount(),
    taxInclusiveAmount: makeAmount(),
    payableAmount: makeAmount(),
    taxTotals: [
      {
        rate: DEFAULT_VAT_RATE,
        taxCategoryCode: DEFAULT_TAX_CATEGORY,
        taxableAmount: makeAmount(),
        taxAmount: makeAmount()
      }
    ],
    legalMonetaryTotal: {
      lineExtensionAmount: makeAmount(),
      taxExclusiveAmount: makeAmount(),
      taxInclusiveAmount: makeAmount(),
      payableAmount: makeAmount()
    }
  };
}

function extractAmountValue(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (typeof value === "object") {
    const amountRecord = value as Record<string, unknown>;
    if (typeof amountRecord.value === "number" || typeof amountRecord.value === "string") {
      return extractAmountValue(amountRecord.value);
    }
  }
  return undefined;
}

function buildLineFromSeed(
  seed: Partial<ScradaInvoiceLine> | undefined,
  currency: string,
  index: number
): ScradaInvoiceLine {
  const normalizedCurrency = (currency || DEFAULT_CURRENCY).trim().toUpperCase() || DEFAULT_CURRENCY;
  const id =
    typeof seed?.id === "string" && seed.id.trim().length > 0 ? seed.id.trim() : String(index + 1);
  const description =
    typeof seed?.description === "string" && seed.description.trim().length > 0
      ? seed.description.trim()
      : "Integration smoke test line";
  const quantityValue =
    typeof seed?.quantity === "number" && Number.isFinite(seed.quantity) && seed.quantity > 0
      ? seed.quantity
      : 1;
  const unitPriceValue = extractAmountValue(seed?.unitPrice) ?? 100;
  const normalizedUnitPrice = roundCurrency(unitPriceValue);
  const rawLineExtension = extractAmountValue(seed?.lineExtensionAmount);
  const lineExtensionValue =
    rawLineExtension !== undefined
      ? roundCurrency(rawLineExtension)
      : roundCurrency(normalizedUnitPrice * quantityValue);
  const vatSeed = (seed?.vat ?? {}) as Partial<ScradaVatDetail>;
  const vatRate =
    typeof vatSeed.rate === "number" && Number.isFinite(vatSeed.rate)
      ? vatSeed.rate
      : DEFAULT_VAT_RATE;
  const vatAmountValue =
    extractAmountValue(vatSeed.taxAmount) ?? roundCurrency((lineExtensionValue * vatRate) / 100);

  return {
    id,
    description,
    quantity: quantityValue,
    unitCode: seed?.unitCode ?? DEFAULT_UNIT_CODE,
    unitPrice: { currency: normalizedCurrency, value: normalizedUnitPrice },
    lineExtensionAmount: { currency: normalizedCurrency, value: lineExtensionValue },
    vat: {
      rate: vatRate,
      taxCategoryCode: vatSeed.taxCategoryCode ?? DEFAULT_TAX_CATEGORY,
      taxableAmount: { currency: normalizedCurrency, value: lineExtensionValue },
      taxAmount: { currency: normalizedCurrency, value: vatAmountValue }
    }
  };
}

function ensurePaymentTerms(invoice: ScradaSalesInvoice, issueDate: string): void {
  const paymentTermsRaw =
    invoice.paymentTerms && typeof invoice.paymentTerms === "object"
      ? (invoice.paymentTerms as Record<string, unknown>)
      : {};
  const dueDate = addDaysToIsoDate(issueDate, DEFAULT_PAYMENT_TERM_DAYS);
  if (!invoice.dueDate) {
    invoice.dueDate = dueDate;
  }
  if (!paymentTermsRaw.paymentDueDate) {
    paymentTermsRaw.paymentDueDate = invoice.dueDate ?? dueDate;
  }
  if (!paymentTermsRaw.paymentId) {
    paymentTermsRaw.paymentId = invoice.externalReference ?? invoice.id;
  }
  if (!paymentTermsRaw.paymentMeansCode) {
    paymentTermsRaw.paymentMeansCode = "31";
  }
  if (!paymentTermsRaw.note) {
    paymentTermsRaw.note = `Payment due ${DEFAULT_PAYMENT_TERM_DAYS} days after invoice date`;
  }
  invoice.paymentTerms = paymentTermsRaw as ScradaSalesInvoice["paymentTerms"];
}

function derivePartyOptionsFromEnv(
  env: NodeJS.ProcessEnv,
  overrides: PrepareOptions = {}
): PrepareOptions {
  const derived: PrepareOptions = { ...overrides };
  const receiverSchemeEnv = env.SCRADA_TEST_RECEIVER_SCHEME?.trim();
  const receiverValueEnv = env.SCRADA_TEST_RECEIVER_ID?.trim();
  const participantEnv = env.SCRADA_PARTICIPANT_ID?.trim();
  const supplierSchemeEnv =
    env.SCRADA_SUPPLIER_SCHEME?.trim() ?? env.SCRADA_SENDER_SCHEME?.trim();
  const supplierValueEnv =
    env.SCRADA_SUPPLIER_ID?.trim() ?? env.SCRADA_SENDER_ID?.trim();
  const receiverVatEnv = env.SCRADA_TEST_RECEIVER_VAT?.trim();
  const supplierVatEnv = env.SCRADA_SUPPLIER_VAT?.trim() ?? env.SCRADA_SENDER_VAT?.trim();
  const companyEnv = env.SCRADA_COMPANY_ID?.trim();

  if (!derived.receiverScheme && receiverSchemeEnv) {
    derived.receiverScheme = receiverSchemeEnv;
  }
  if (!derived.receiverValue && receiverValueEnv) {
    derived.receiverValue = receiverValueEnv;
  }
  if ((!derived.receiverScheme || !derived.receiverValue) && receiverValueEnv?.includes(":")) {
    const parsedInline = extractSchemeValue(receiverValueEnv);
    derived.receiverScheme ??= parsedInline.scheme;
    derived.receiverValue ??= parsedInline.value ?? receiverValueEnv;
  }
  if ((!derived.receiverScheme || !derived.receiverValue) && participantEnv) {
    const parsedParticipant = extractSchemeValue(participantEnv);
    derived.receiverScheme ??= parsedParticipant.scheme;
    derived.receiverValue ??= parsedParticipant.value ?? participantEnv;
  }

  if (!derived.senderScheme && supplierSchemeEnv) {
    derived.senderScheme = supplierSchemeEnv;
  }
  if (!derived.senderValue && supplierValueEnv) {
    derived.senderValue = supplierValueEnv;
  }

  if (!derived.receiverVat && receiverVatEnv) {
    derived.receiverVat = receiverVatEnv;
  }
  if (!derived.senderVat && supplierVatEnv) {
    derived.senderVat = supplierVatEnv;
  }

  if (companyEnv) {
    const companyParsed = extractSchemeValue(companyEnv);
    if (!derived.senderScheme && companyParsed.scheme) {
      derived.senderScheme = companyParsed.scheme;
    }
    if (!derived.senderValue && companyParsed.value) {
      derived.senderValue = companyParsed.value;
    }
  }

  return derived;
}

export function prepareScradaInvoice(
  invoice: ScradaSalesInvoice,
  options: PrepareOptions = {}
): ScradaSalesInvoice {
  const cloned: ScradaSalesInvoice = structuredClone(invoice);
  cloned.invoiceTypeCode = cloned.invoiceTypeCode || "380";
  const normalizedCurrency = (cloned.currency || DEFAULT_CURRENCY).trim().toUpperCase();
  cloned.currency = normalizedCurrency || DEFAULT_CURRENCY;
  cloned.issueDate = cloned.issueDate || new Date().toISOString().slice(0, 10);
  if (
    !cloned.customizationId ||
    cloned.customizationId.startsWith("urn:fdc:peppol.eu:poacc:billing:3")
  ) {
    cloned.customizationId = DEFAULT_CUSTOMIZATION_ID;
  }
  if (!cloned.profileId || cloned.profileId.startsWith("urn:fdc:peppol.eu:poacc:billing:3")) {
    cloned.profileId = DEFAULT_PROFILE_ID;
  }
  const buyer = ensureBuyer(cloned);
  const seller = ensureSeller(cloned);

  const buyerEndpoint = ensurePartyEndpoint(buyer, {
    scheme: options.receiverScheme,
    value: options.receiverValue
  });
  const sellerEndpoint = ensurePartyEndpoint(seller, {
    scheme: options.senderScheme,
    value: options.senderValue
  });

  applyPartyIdentifiers(buyer, buyerEndpoint, {
    vat: options.receiverVat?.trim() || DEFAULT_BUYER_VAT,
    enterprise: options.receiverValue ?? buyerEndpoint.value
  });
  applyPartyIdentifiers(seller, sellerEndpoint, {
    vat: options.senderVat?.trim() || DEFAULT_SELLER_VAT,
    enterprise: options.senderValue ?? sellerEndpoint.value
  });

  ensureTotals(cloned);
  cloned.buyerVat = (buyer.vatNumber as string | undefined) ?? cloned.buyerVat;
  cloned.sellerVat = (seller.vatNumber as string | undefined) ?? cloned.sellerVat;
  return cloned;
}

export function buildBis30Ubl(
  invoice: ScradaSalesInvoice,
  options: PrepareOptions = {}
): string {
  const prepared = prepareScradaInvoice(invoice, options);
  const currency = prepared.currency;
  const buyer = prepared.buyer as ScradaParty;
  const seller = prepared.seller as ScradaParty;
  const totals = prepared.totals;
  const lines = Array.isArray(prepared.lines) ? prepared.lines : [];
  const paymentTerms = prepared.paymentTerms as Record<string, unknown> | undefined;

  const invoiceLinesXml = lines.map((line) => buildInvoiceLineXml(line, currency)).join("\n");
  const taxTotalXml = buildTaxTotalXml(totals, currency);
  const legalMonetaryXml = buildLegalMonetaryTotalXml(totals, currency);

  const paymentTermsXml =
    paymentTerms && (paymentTerms.note || paymentTerms.paymentDueDate || paymentTerms.paymentId)
      ? `<cac:PaymentTerms>
    ${paymentTerms.note ? `<cbc:Note>${xmlEscape(paymentTerms.note)}</cbc:Note>` : ""}
    ${
      paymentTerms.paymentDueDate
        ? `<cbc:PaymentDueDate>${xmlEscape(paymentTerms.paymentDueDate)}</cbc:PaymentDueDate>`
        : ""
    }
    ${
      paymentTerms.paymentId ? `<cbc:ID>${xmlEscape(paymentTerms.paymentId)}</cbc:ID>` : ""
    }
  </cac:PaymentTerms>`
      : "";

  const paymentMeansXml =
    paymentTerms && paymentTerms.paymentId
      ? `<cac:PaymentMeans>
    <cbc:PaymentMeansCode>31</cbc:PaymentMeansCode>
    <cbc:PaymentID>${xmlEscape(paymentTerms.paymentId)}</cbc:PaymentID>
  </cac:PaymentMeans>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${xmlEscape(prepared.customizationId)}</cbc:CustomizationID>
  <cbc:ProfileID>${xmlEscape(prepared.profileId)}</cbc:ProfileID>
  <cbc:ID>${xmlEscape(prepared.id)}</cbc:ID>
  <cbc:IssueDate>${xmlEscape(prepared.issueDate)}</cbc:IssueDate>
  ${prepared.dueDate ? `<cbc:DueDate>${xmlEscape(prepared.dueDate)}</cbc:DueDate>` : ""}
  <cbc:InvoiceTypeCode>${xmlEscape(prepared.invoiceTypeCode || "380")}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${xmlEscape(currency)}</cbc:DocumentCurrencyCode>
  ${prepared.orderReference || prepared.externalReference ? `<cbc:BuyerReference>${xmlEscape(prepared.orderReference || prepared.externalReference || "")}</cbc:BuyerReference>` : ""}
  ${buildPartyXml(seller, "AccountingSupplierParty")}
  ${buildPartyXml(buyer, "AccountingCustomerParty")}
  ${taxTotalXml}
  ${legalMonetaryXml}
  ${invoiceLinesXml}
  ${paymentMeansXml}
  ${paymentTermsXml}
</Invoice>`;
}

export function jsonFromEnv(
  seed: ScradaInvoiceSeed = {},
  options: JsonFromEnvOptions = {}
): ScradaSalesInvoice {
  const env = options.env ?? process.env;
  const currency = (seed.currency || DEFAULT_CURRENCY).trim().toUpperCase() || DEFAULT_CURRENCY;
  const invoiceId = generateInvoiceId(seed.id);
  const issueDate = seed.issueDate ?? isoDateString();
  const dueDate = seed.dueDate ?? addDaysToIsoDate(issueDate, DEFAULT_PAYMENT_TERM_DAYS);

  const seedLines = Array.isArray(seed.lines) && seed.lines.length > 0 ? seed.lines : [undefined];
  const lines = seedLines.map((line, index) => buildLineFromSeed(line, currency, index));

  const buyerSeed = seed.buyer ? structuredClone(seed.buyer) : {};
  const sellerSeed = seed.seller ? structuredClone(seed.seller) : {};
  const paymentTermsSeed =
    seed.paymentTerms && typeof seed.paymentTerms === "object"
      ? structuredClone(seed.paymentTerms)
      : {};

  const baseInvoice: ScradaSalesInvoice = {
    profileId: seed.profileId,
    customizationId: seed.customizationId,
    id: invoiceId,
    issueDate,
    dueDate,
    currency,
    invoiceTypeCode: seed.invoiceTypeCode ?? "380",
    buyer: buyerSeed as ScradaParty,
    seller: sellerSeed as ScradaParty,
    totals: (seed.totals as ScradaInvoiceTotals) ?? createPlaceholderTotals(currency),
    lines,
    paymentTerms: paymentTermsSeed as ScradaSalesInvoice["paymentTerms"],
    orderReference: seed.orderReference,
    externalReference: seed.externalReference ?? invoiceId,
    note: seed.note
  };

  const partyOptions = derivePartyOptionsFromEnv(env, options.overrides ?? {});
  const prepared = prepareScradaInvoice(baseInvoice, partyOptions);
  ensurePaymentTerms(prepared, prepared.issueDate);
  prepared.buyerVat = (prepared.buyer as ScradaParty).vatNumber as string | undefined;
  prepared.sellerVat = (prepared.seller as ScradaParty).vatNumber as string | undefined;

  return prepared;
}

export function ublFromEnv(
  seed: ScradaInvoiceSeed = {},
  options: JsonFromEnvOptions = {}
): string {
  const invoice = jsonFromEnv(seed, options);
  return buildBis30Ubl(invoice);
}
