import { create } from "xmlbuilder2";
import type { XMLBuilder } from "xmlbuilder2/lib/interfaces.js";
import type { OrderLineT, OrderT } from "../schemas/order.js";

type ComputedLine = {
  line: OrderLineT;
  lineNumber: number;
  quantity: number;
  unitCode: string;
  unitPriceMinor: number;
  discountMinor: number;
  lineExtensionMinor: number;
  vatRate: number;
  vatCategory: string;
  vatExemptionReason?: string;
  taxAmountMinor: number;
};

type TaxSummary = {
  rate: number;
  category: string;
  exemptionReason?: string;
  taxableMinor: number;
  taxMinor: number;
};

export type Order = OrderT;

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatAmount(minor: number, minorUnit: number): string {
  const divider = 10 ** minorUnit;
  return (minor / divider).toFixed(minorUnit);
}

function formatQuantity(quantity: number): string {
  if (Number.isInteger(quantity)) {
    return quantity.toString();
  }
  return (Math.round(quantity * 1_000_000) / 1_000_000).toString();
}

function formatPercent(rate: number): string {
  return rate.toFixed(2);
}

function deriveVatCategory(rate: number, provided?: string, exemptionReason?: string): string {
  if (provided) {
    return provided;
  }

  if (rate === 0) {
    return exemptionReason ? "E" : "Z";
  }

  if (rate === 6) {
    return "AA";
  }

  if (rate === 12) {
    return "AE";
  }

  return "S";
}

function computeLines(order: Order): ComputedLine[] {
  const defaultRate = order.defaultVatRate ?? 0;

  return order.lines.map((line, index) => {
    const quantity = line.quantity;
    const unitPriceMinor = line.unitPriceMinor;
    const discountMinor = line.discountMinor ?? 0;
    const grossMinor = Math.round(quantity * unitPriceMinor);
    const netMinor = Math.max(grossMinor - discountMinor, 0);
    const vatRate = line.vatRate ?? defaultRate;
    const vatCategory = deriveVatCategory(vatRate, line.vatCategory, line.vatExemptionReason);
    const taxAmountMinor = vatRate === 0 ? 0 : Math.round((netMinor * vatRate) / 100);

    return {
      line,
      lineNumber: index + 1,
      quantity,
      unitCode: line.unitCode ?? "EA",
      unitPriceMinor,
      discountMinor,
      lineExtensionMinor: netMinor,
      vatRate,
      vatCategory,
      vatExemptionReason: line.vatExemptionReason,
      taxAmountMinor
    };
  });
}

function summarizeTax(lines: ComputedLine[]): TaxSummary[] {
  const summaries = new Map<string, TaxSummary>();

  for (const line of lines) {
    const key = `${line.vatRate}|${line.vatCategory}|${line.vatExemptionReason ?? ""}`;
    const existing = summaries.get(key);

    if (existing) {
      existing.taxableMinor += line.lineExtensionMinor;
      existing.taxMinor += line.taxAmountMinor;
    } else {
      summaries.set(key, {
        rate: line.vatRate,
        category: line.vatCategory,
        exemptionReason: line.vatExemptionReason,
        taxableMinor: line.lineExtensionMinor,
        taxMinor: line.taxAmountMinor
      });
    }
  }

  return Array.from(summaries.values());
}

function appendParty(invoice: XMLBuilder, parentTag: "cac:AccountingSupplierParty" | "cac:AccountingCustomerParty", order: Order) {
  const party = parentTag === "cac:AccountingSupplierParty" ? order.supplier : order.buyer;
  const partyContainer = invoice.ele(parentTag).ele("cac:Party");

  if (party.endpoint?.id && party.endpoint.scheme) {
    partyContainer
      .ele("cbc:EndpointID", { schemeID: party.endpoint.scheme })
      .txt(party.endpoint.id)
      .up();
  }

  partyContainer.ele("cac:PartyName").ele("cbc:Name").txt(party.name).up().up();

  if (party.registrationName) {
    partyContainer.ele("cac:PartyLegalEntity").ele("cbc:RegistrationName").txt(party.registrationName).up().up();
  }

  if (party.companyId) {
    partyContainer.ele("cac:PartyIdentification").ele("cbc:ID").txt(party.companyId).up().up();
  }

  if (party.vatId) {
    const taxScheme = partyContainer.ele("cac:PartyTaxScheme");
    taxScheme.ele("cbc:CompanyID").txt(party.vatId).up();
    taxScheme.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
  }

  if (party.address) {
    const address = partyContainer.ele("cac:PostalAddress");
    if (party.address.streetName) {
      address.ele("cbc:StreetName").txt(party.address.streetName).up();
    }
    if (party.address.additionalStreetName) {
      address.ele("cbc:AdditionalStreetName").txt(party.address.additionalStreetName).up();
    }
    if (party.address.buildingNumber) {
      address.ele("cbc:BuildingNumber").txt(party.address.buildingNumber).up();
    }
    if (party.address.cityName) {
      address.ele("cbc:CityName").txt(party.address.cityName).up();
    }
    if (party.address.postalZone) {
      address.ele("cbc:PostalZone").txt(party.address.postalZone).up();
    }
    if (party.address.countryCode) {
      address.ele("cac:Country").ele("cbc:IdentificationCode").txt(party.address.countryCode).up().up();
    }
    address.up();
  }

  if (party.contact) {
    const contact = partyContainer.ele("cac:Contact");
    if (party.contact.name) {
      contact.ele("cbc:Name").txt(party.contact.name).up();
    }
    if (party.contact.telephone) {
      contact.ele("cbc:Telephone").txt(party.contact.telephone).up();
    }
    if (party.contact.electronicMail) {
      contact.ele("cbc:ElectronicMail").txt(party.contact.electronicMail).up();
    }
    contact.up();
  }

  partyContainer.up().up();
}

export async function orderToInvoiceXml(order: Order): Promise<string> {
  const currencyMinorUnit = order.currencyMinorUnit ?? 2;
  const lines = computeLines(order);

  const lineExtensionTotalMinor = lines.reduce((sum, line) => sum + line.lineExtensionMinor, 0);
  const taxTotalMinor = lines.reduce((sum, line) => sum + line.taxAmountMinor, 0);
  const taxSummaries = summarizeTax(lines);
  const payableAmountMinor = lineExtensionTotalMinor + taxTotalMinor;

  const document = create({ version: "1.0", encoding: "UTF-8" });
  const invoice = document.ele("Invoice", {
    xmlns: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    "xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  });

  invoice.ele("cbc:CustomizationID").txt("urn:peppol.eu:poacc:billing:3.0").up();
  invoice.ele("cbc:ProfileID").txt("urn:fdc:peppol.eu:2017:poacc:billing:01:1.0").up();
  invoice.ele("cbc:ID").txt(order.orderNumber).up();
  invoice.ele("cbc:IssueDate").txt(formatDate(order.issueDate)).up();
  if (order.dueDate) {
    invoice.ele("cbc:DueDate").txt(formatDate(order.dueDate)).up();
  }
  invoice.ele("cbc:InvoiceTypeCode").txt("380").up();
  invoice.ele("cbc:DocumentCurrencyCode").txt(order.currency).up();

  appendParty(invoice, "cac:AccountingSupplierParty", order);
  appendParty(invoice, "cac:AccountingCustomerParty", order);

  const taxTotal = invoice.ele("cac:TaxTotal");
  taxTotal
    .ele("cbc:TaxAmount", { currencyID: order.currency })
    .txt(formatAmount(taxTotalMinor, currencyMinorUnit))
    .up();

  for (const summary of taxSummaries) {
    const taxSubtotal = taxTotal.ele("cac:TaxSubtotal");
    taxSubtotal
      .ele("cbc:TaxableAmount", { currencyID: order.currency })
      .txt(formatAmount(summary.taxableMinor, currencyMinorUnit))
      .up();
    taxSubtotal
      .ele("cbc:TaxAmount", { currencyID: order.currency })
      .txt(formatAmount(summary.taxMinor, currencyMinorUnit))
      .up();

    const taxCategory = taxSubtotal.ele("cac:TaxCategory");
    taxCategory.ele("cbc:ID").txt(summary.category).up();
    taxCategory.ele("cbc:Percent").txt(formatPercent(summary.rate)).up();
    if (summary.exemptionReason) {
      taxCategory.ele("cbc:TaxExemptionReason").txt(summary.exemptionReason).up();
    }
    taxCategory.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
    taxSubtotal.up();
  }

  taxTotal.up();

  const monetaryTotal = invoice.ele("cac:LegalMonetaryTotal");
  monetaryTotal
    .ele("cbc:LineExtensionAmount", { currencyID: order.currency })
    .txt(formatAmount(lineExtensionTotalMinor, currencyMinorUnit))
    .up();
  monetaryTotal
    .ele("cbc:TaxExclusiveAmount", { currencyID: order.currency })
    .txt(formatAmount(lineExtensionTotalMinor, currencyMinorUnit))
    .up();
  monetaryTotal
    .ele("cbc:TaxInclusiveAmount", { currencyID: order.currency })
    .txt(formatAmount(payableAmountMinor, currencyMinorUnit))
    .up();
  monetaryTotal
    .ele("cbc:PayableAmount", { currencyID: order.currency })
    .txt(formatAmount(payableAmountMinor, currencyMinorUnit))
    .up();
  monetaryTotal.up();

  for (const line of lines) {
    const lineNode = invoice.ele("cac:InvoiceLine");
    lineNode.ele("cbc:ID").txt(String(line.lineNumber)).up();
    lineNode
      .ele("cbc:InvoicedQuantity", { unitCode: line.unitCode })
      .txt(formatQuantity(line.quantity))
      .up();
    lineNode
      .ele("cbc:LineExtensionAmount", { currencyID: order.currency })
      .txt(formatAmount(line.lineExtensionMinor, currencyMinorUnit))
      .up();

    const taxTotalNode = lineNode.ele("cac:TaxTotal");
    taxTotalNode
      .ele("cbc:TaxAmount", { currencyID: order.currency })
      .txt(formatAmount(line.taxAmountMinor, currencyMinorUnit))
      .up();
    const taxSubtotal = taxTotalNode.ele("cac:TaxSubtotal");
    taxSubtotal
      .ele("cbc:TaxableAmount", { currencyID: order.currency })
      .txt(formatAmount(line.lineExtensionMinor, currencyMinorUnit))
      .up();
    taxSubtotal
      .ele("cbc:TaxAmount", { currencyID: order.currency })
      .txt(formatAmount(line.taxAmountMinor, currencyMinorUnit))
      .up();
    const taxCategory = taxSubtotal.ele("cac:TaxCategory");
    taxCategory.ele("cbc:ID").txt(line.vatCategory).up();
    taxCategory.ele("cbc:Percent").txt(formatPercent(line.vatRate)).up();
    if (line.vatExemptionReason) {
      taxCategory.ele("cbc:TaxExemptionReason").txt(line.vatExemptionReason).up();
    }
    taxCategory.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
    taxSubtotal.up();
    taxTotalNode.up();

    const item = lineNode.ele("cac:Item");
    item.ele("cbc:Description").txt(line.line.description).up();
    item.ele("cbc:Name").txt(line.line.itemName ?? line.line.description).up();
    item.up();

    const price = lineNode.ele("cac:Price");
    price
      .ele("cbc:PriceAmount", { currencyID: order.currency })
      .txt(formatAmount(line.unitPriceMinor, currencyMinorUnit))
      .up();
    price.up();

    lineNode.up();
  }

  return invoice.doc().end({ prettyPrint: true });
}
