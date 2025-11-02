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
}

interface EndpointSummary {
  scheme?: string;
  value?: string;
  id?: string;
}

function ensureBuyer(invoice: ScradaSalesInvoice): ScradaParty {
  if (!invoice.buyer || typeof invoice.buyer !== "object") {
    invoice.buyer = {
      name: "Unknown Buyer",
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
  if (!buyer.contact || typeof buyer.contact !== "object") {
    buyer.contact = {
      email: "ap@example.test"
    };
  }
  return buyer;
}

function ensureSeller(invoice: ScradaSalesInvoice): ScradaParty {
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
    value = party.vatNumber.replace(/^([A-Z]{2})/, "");
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

  const vat: ScradaVatDetail = {
    rate: typeof normalized.vat?.rate === "number" ? normalized.vat.rate : 21,
    taxableAmount: { currency, value: net },
    taxAmount: {
      currency,
      value:
        normalized.vat?.taxAmount?.value ??
        roundCurrency((net * (normalized.vat?.rate ?? 21)) / 100)
    },
    taxCategoryCode: normalized.vat?.taxCategoryCode ?? "S"
  };

  normalized.quantity = quantity;
  normalized.unitCode = normalized.unitCode || "EA";
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
      rate: 21,
      taxCategoryCode: "S",
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
  if (!vatNumber) {
    return "";
  }
  return `<cac:PartyTaxScheme>
    <cbc:CompanyID schemeID="VA">${xmlEscape(vatNumber)}</cbc:CompanyID>
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

function buildInvoiceLineXml(line: ScradaInvoiceLine, currency: string): string {
  const quantity = Number.isFinite(line.quantity) && Number(line.quantity) > 0 ? line.quantity : 1;
  const lineAmount = (line.lineExtensionAmount as Record<string, unknown> | undefined)?.value ?? 0;
  const unitPrice =
    (line.unitPrice as Record<string, unknown> | undefined)?.value ??
    (line.unitPrice as unknown as number | undefined) ??
    0;
  const vatRate = line.vat?.rate ?? 21;
  const vatAmount = line.vat?.taxAmount?.value ?? roundCurrency((Number(lineAmount) * vatRate) / 100);

  return `<cac:InvoiceLine>
    <cbc:ID>${xmlEscape(line.id || "1")}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${xmlEscape(line.unitCode || "EA")}">${formatAmount(quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${xmlEscape(currency)}">${formatAmount(lineAmount)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>${xmlEscape(line.description || "Invoice line")}</cbc:Description>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${xmlEscape(line.vat?.taxCategoryCode || "S")}</cbc:ID>
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
        <cbc:ID>${xmlEscape(taxTotal.taxCategoryCode || "S")}</cbc:ID>
        <cbc:Percent>${formatAmount(taxTotal.rate ?? 21)}</cbc:Percent>
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

export function prepareScradaInvoice(
  invoice: ScradaSalesInvoice,
  options: PrepareOptions = {}
): ScradaSalesInvoice {
  const cloned: ScradaSalesInvoice = structuredClone(invoice);
  cloned.invoiceTypeCode = cloned.invoiceTypeCode || "380";
  cloned.currency = (cloned.currency || "EUR").trim() || "EUR";
  cloned.issueDate = cloned.issueDate || new Date().toISOString().slice(0, 10);
  const buyer = ensureBuyer(cloned);
  const seller = ensureSeller(cloned);

  ensurePartyEndpoint(buyer, {
    scheme: options.receiverScheme,
    value: options.receiverValue
  });
  ensurePartyEndpoint(seller, {
    scheme: options.senderScheme,
    value: options.senderValue
  });

  ensureTotals(cloned);
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

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${xmlEscape(
    prepared.customizationId || "urn:fdc:peppol.eu:poacc:billing:3"
  )}</cbc:CustomizationID>
  <cbc:ProfileID>${xmlEscape(
    prepared.profileId || "urn:fdc:peppol.eu:poacc:billing:3.0"
  )}</cbc:ProfileID>
  <cbc:ID>${xmlEscape(prepared.id)}</cbc:ID>
  <cbc:IssueDate>${xmlEscape(prepared.issueDate)}</cbc:IssueDate>
  ${prepared.dueDate ? `<cbc:DueDate>${xmlEscape(prepared.dueDate)}</cbc:DueDate>` : ""}
  <cbc:InvoiceTypeCode>${xmlEscape(prepared.invoiceTypeCode || "380")}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${xmlEscape(currency)}</cbc:DocumentCurrencyCode>
  ${buildPartyXml(seller, "AccountingSupplierParty")}
  ${buildPartyXml(buyer, "AccountingCustomerParty")}
  ${taxTotalXml}
  ${legalMonetaryXml}
  ${invoiceLinesXml}
  ${paymentTermsXml}
</Invoice>`;
}
