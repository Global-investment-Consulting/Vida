import { create } from "xmlbuilder2";
import type { XMLBuilder } from "xmlbuilder2/lib/interfaces";
import type { InvoiceAllowance, InvoiceLine, NormalizedInvoice } from "../src/schemas/invoice.ts";
import { parseInvoice } from "../src/schemas/invoice.ts";

type BuildOptions = {
  pretty?: boolean;
};

type TaxGroupKey = string;

interface ComputedInvoiceLine {
  source: InvoiceLine;
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
}

interface TaxGroup {
  key: TaxGroupKey;
  rate: number;
  category: string;
  exemptionReason?: string;
  taxableMinor: number;
  taxMinor: number;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatAmount(minor: number, minorUnit: number): string {
  const divider = 10 ** minorUnit;
  return (minor / divider).toFixed(minorUnit);
}

function formatPercent(value: number): string {
  return value.toFixed(2);
}

function formatQuantity(quantity: number): string {
  if (Number.isInteger(quantity)) {
    return quantity.toString();
  }
  return (Math.round(quantity * 1_000_000) / 1_000_000).toString();
}

function deriveVatCategory(rate: number, provided?: string, hasExemptionReason?: boolean): string {
  if (provided) return provided;
  if (rate === 0) {
    return hasExemptionReason ? "E" : "Z";
  }
  if (rate === 6) return "AA"; // reduced rate (example)
  if (rate === 12) return "AE"; // intermediate rate placeholder
  return "S"; // standard rate
}

function computeLine(invoice: NormalizedInvoice, line: InvoiceLine, index: number): ComputedInvoiceLine {
  const quantity = line.quantity;
  const unitPriceMinor = line.unitPriceMinor;
  const discountMinor = line.discountMinor ?? 0;
  const grossMinor = Math.round(quantity * unitPriceMinor);
  const netMinor = Math.max(grossMinor - discountMinor, 0);
  const vatRate = line.vatRate ?? invoice.defaultVatRate;
  const invoiceMeta = (invoice.meta ?? {}) as Record<string, unknown>;
  const metaReason = typeof invoiceMeta.taxExemptionReason === "string" ? invoiceMeta.taxExemptionReason : undefined;
  const exemptionReason = line.vatExemptionReason ?? metaReason;
  const category = deriveVatCategory(vatRate, line.vatCategory, Boolean(exemptionReason));
  const taxAmountMinor = vatRate === 0 ? 0 : Math.round((netMinor * vatRate) / 100);

  return {
    source: line,
    lineNumber: index + 1,
    quantity,
    unitCode: line.unitCode ?? "EA",
    unitPriceMinor,
    discountMinor,
    lineExtensionMinor: netMinor,
    vatRate,
    vatCategory: category,
    vatExemptionReason: exemptionReason,
    taxAmountMinor
  };
}

function computeTaxGroups(lines: ComputedInvoiceLine[]): Map<TaxGroupKey, TaxGroup> {
  const groups = new Map<TaxGroupKey, TaxGroup>();

  for (const line of lines) {
    const key = `${line.vatRate}|${line.vatCategory}|${line.vatExemptionReason ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.taxableMinor += line.lineExtensionMinor;
      existing.taxMinor += line.taxAmountMinor;
    } else {
      groups.set(key, {
        key,
        rate: line.vatRate,
        category: line.vatCategory,
        exemptionReason: line.vatExemptionReason,
        taxableMinor: line.lineExtensionMinor,
        taxMinor: line.taxAmountMinor
      });
    }
  }

  return groups;
}

function distributeAllowancesAcrossTaxGroups(groups: Map<TaxGroupKey, TaxGroup>, allowanceTotalMinor: number): void {
  if (allowanceTotalMinor <= 0 || groups.size === 0) {
    return;
  }

  const totalTaxable = Array.from(groups.values()).reduce((sum, group) => sum + group.taxableMinor, 0);
  if (totalTaxable <= 0) {
    return;
  }

  let remaining = allowanceTotalMinor;
  const entries = Array.from(groups.values());

  entries.forEach((group, idx) => {
    const proportional =
      idx === entries.length - 1
        ? remaining
        : Math.min(group.taxableMinor, Math.round((group.taxableMinor / totalTaxable) * allowanceTotalMinor));

    const allocated = Math.min(group.taxableMinor, Math.max(proportional, 0));
    group.taxableMinor = Math.max(group.taxableMinor - allocated, 0);
    remaining -= allocated;
  });
}

function recalculateTax(group: TaxGroup): void {
  group.taxMinor = group.rate === 0 ? 0 : Math.round((group.taxableMinor * group.rate) / 100);
}

function computeTotals(
  invoice: NormalizedInvoice,
  lines: ComputedInvoiceLine[],
  allowances: InvoiceAllowance[]
) {
  const currencyMinorUnit = invoice.currencyMinorUnit ?? 2;
  const taxGroups = computeTaxGroups(lines);

  const lineExtensionTotalMinor = lines.reduce((sum, line) => sum + line.lineExtensionMinor, 0);
  const allowanceTotalMinor = allowances.reduce((sum, entry) => sum + entry.amountMinor, 0);

  distributeAllowancesAcrossTaxGroups(taxGroups, allowanceTotalMinor);
  taxGroups.forEach((group) => recalculateTax(group));

  const taxExclusiveAfterAllowances = Array.from(taxGroups.values()).reduce(
    (sum, group) => sum + group.taxableMinor,
    0
  );
  const taxTotalMinor = Array.from(taxGroups.values()).reduce((sum, group) => sum + group.taxMinor, 0);
  const roundingMinor = invoice.roundingMinor ?? invoice.totals?.roundingMinor ?? 0;

  const computedPayable = taxExclusiveAfterAllowances + taxTotalMinor + roundingMinor;
  const payableAmountMinor = invoice.totals?.payableAmountMinor ?? computedPayable;

  return {
    currencyMinorUnit,
    lineExtensionTotalMinor,
    allowanceTotalMinor,
    taxTotalMinor,
    taxExclusiveAfterAllowances,
    roundingMinor,
    payableAmountMinor: Math.max(payableAmountMinor, 0),
    taxGroups
  };
}

function appendParty(partyContainer: XMLBuilder, role: "supplier" | "customer", invoice: NormalizedInvoice) {
  const party = role === "supplier" ? invoice.supplier : invoice.buyer;
  const legalName = party.registrationName ?? party.name;

  if (party.endpoint) {
    partyContainer
      .ele("cbc:EndpointID", { schemeID: party.endpoint.scheme })
      .txt(party.endpoint.id)
      .up();
  }

  partyContainer.ele("cac:PartyName").ele("cbc:Name").txt(party.name).up().up();

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
    address
      .ele("cac:Country")
      .ele("cbc:IdentificationCode")
      .txt(party.address.countryCode)
      .up()
      .up();
    address.up();
  }

  if (party.companyId) {
    partyContainer
      .ele("cac:PartyIdentification")
      .ele("cbc:ID")
      .txt(party.companyId)
      .up()
      .up();
  }

  const legalEntity = partyContainer.ele("cac:PartyLegalEntity");
  legalEntity.ele("cbc:RegistrationName").txt(legalName).up();
  if (party.legalRegistrationId) {
    legalEntity.ele("cbc:CompanyID").txt(party.legalRegistrationId).up();
  }
  legalEntity.up();

  if (party.vatId) {
    const taxScheme = partyContainer.ele("cac:PartyTaxScheme");
    taxScheme.ele("cbc:CompanyID").txt(party.vatId).up();
    taxScheme.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
    taxScheme.up();
  }

  if (party.contact && (party.contact.name || party.contact.telephone || party.contact.electronicMail)) {
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
}

function appendLine(root: XMLBuilder, line: ComputedInvoiceLine, currency: string, currencyMinorUnit: number) {
  const lineNode = root.ele("cac:InvoiceLine");
  lineNode.ele("cbc:ID").txt(line.source.id ?? String(line.lineNumber)).up();
  lineNode
    .ele("cbc:InvoicedQuantity", { unitCode: line.unitCode })
    .txt(formatQuantity(line.quantity))
    .up();
  lineNode
    .ele("cbc:LineExtensionAmount", { currencyID: currency })
    .txt(formatAmount(line.lineExtensionMinor, currencyMinorUnit))
    .up();

  if (line.discountMinor > 0) {
    const gross = Math.round(line.quantity * line.unitPriceMinor);
    const allowance = lineNode.ele("cac:AllowanceCharge");
    allowance.ele("cbc:ChargeIndicator").txt("false").up();
    allowance
      .ele("cbc:Amount", { currencyID: currency })
      .txt(formatAmount(line.discountMinor, currencyMinorUnit))
      .up();
    allowance
      .ele("cbc:BaseAmount", { currencyID: currency })
      .txt(formatAmount(gross, currencyMinorUnit))
      .up();
    allowance.up();
  }

  const item = lineNode.ele("cac:Item");
  item.ele("cbc:Description").txt(line.source.description).up();
  if (line.source.itemName) {
    item.ele("cbc:Name").txt(line.source.itemName).up();
  }

  const taxCategory = item.ele("cac:ClassifiedTaxCategory");
  taxCategory.ele("cbc:ID").txt(line.vatCategory).up();
  taxCategory.ele("cbc:Percent").txt(formatPercent(line.vatRate)).up();
  if (line.vatExemptionReason && line.vatRate === 0) {
    taxCategory.ele("cbc:TaxExemptionReason").txt(line.vatExemptionReason).up();
  }
  taxCategory.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
  taxCategory.up();
  item.up();

  const price = lineNode.ele("cac:Price");
  const unitNetMinor = line.quantity === 0 ? 0 : Math.round(line.lineExtensionMinor / line.quantity);
  price
    .ele("cbc:PriceAmount", { currencyID: currency })
    .txt(formatAmount(unitNetMinor, currencyMinorUnit))
    .up();
  price.up();

  lineNode.up();
}

function appendAllowance(root: XMLBuilder, allowance: InvoiceAllowance, currency: string, currencyMinorUnit: number) {
  const node = root.ele("cac:AllowanceCharge");
  node.ele("cbc:ChargeIndicator").txt("false").up();
  if (allowance.reason) {
    node.ele("cbc:AllowanceChargeReason").txt(allowance.reason).up();
  }
  node
    .ele("cbc:Amount", { currencyID: currency })
    .txt(formatAmount(allowance.amountMinor, currencyMinorUnit))
    .up();
  if (allowance.baseAmountMinor !== undefined) {
    node
      .ele("cbc:BaseAmount", { currencyID: currency })
      .txt(formatAmount(allowance.baseAmountMinor, currencyMinorUnit))
      .up();
  }
  node.up();
}

export function invoiceToUbl(invoice: NormalizedInvoice, options: BuildOptions = {}): string {
  const computedLines = invoice.lines.map((line, index) => computeLine(invoice, line, index));
  const allowances = invoice.allowances ?? [];
  const totals = computeTotals(invoice, computedLines, allowances);

  const root = create({ version: "1.0", encoding: "UTF-8" }).ele("Invoice", {
    xmlns: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    "xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  });

  root.ele("cbc:CustomizationID").txt("urn:cen.eu:en16931:2017").up();
  root.ele("cbc:ProfileID").txt("urn:fdc:peppol.eu:poacc:billing:3.0").up();
  root.ele("cbc:ID").txt(invoice.invoiceNumber).up();
  root.ele("cbc:IssueDate").txt(formatDate(invoice.issueDate)).up();
  if (invoice.dueDate) {
    root.ele("cbc:DueDate").txt(formatDate(invoice.dueDate)).up();
  }
  root.ele("cbc:InvoiceTypeCode").txt("380").up();
  root.ele("cbc:DocumentCurrencyCode").txt(invoice.currency).up();

  if (invoice.buyerReference) {
    root.ele("cbc:BuyerReference").txt(invoice.buyerReference).up();
  }

  if (invoice.orderReference) {
    const orderReference = root.ele("cac:OrderReference");
    orderReference.ele("cbc:ID").txt(invoice.orderReference).up();
    orderReference.up();
  }

  if (invoice.notes) {
    invoice.notes.forEach((note) => {
      if (note.trim().length > 0) {
        root.ele("cbc:Note").txt(note).up();
      }
    });
  }

  if (invoice.paymentReference) {
    root.ele("cbc:PaymentReference").txt(invoice.paymentReference).up();
  }

  if (invoice.paymentTerms) {
    const paymentTerms = root.ele("cac:PaymentTerms");
    paymentTerms.ele("cbc:Note").txt(invoice.paymentTerms).up();
    paymentTerms.up();
  }

  if (invoice.taxPointDate) {
    root.ele("cbc:TaxPointDate").txt(formatDate(invoice.taxPointDate)).up();
  }

  const supplierParty = root.ele("cac:AccountingSupplierParty").ele("cac:Party");
  appendParty(supplierParty, "supplier", invoice);
  supplierParty.up().up();

  const customerParty = root.ele("cac:AccountingCustomerParty").ele("cac:Party");
  appendParty(customerParty, "customer", invoice);
  customerParty.up().up();

  allowances.forEach((allowance) => appendAllowance(root, allowance, invoice.currency, totals.currencyMinorUnit));

  computedLines.forEach((line) => appendLine(root, line, invoice.currency, totals.currencyMinorUnit));

  const taxTotalNode = root.ele("cac:TaxTotal");
  taxTotalNode
    .ele("cbc:TaxAmount", { currencyID: invoice.currency })
    .txt(formatAmount(totals.taxTotalMinor, totals.currencyMinorUnit))
    .up();

  totals.taxGroups.forEach((group) => {
    const subtotal = taxTotalNode.ele("cac:TaxSubtotal");
    subtotal
      .ele("cbc:TaxableAmount", { currencyID: invoice.currency })
      .txt(formatAmount(group.taxableMinor, totals.currencyMinorUnit))
      .up();
    subtotal
      .ele("cbc:TaxAmount", { currencyID: invoice.currency })
      .txt(formatAmount(group.taxMinor, totals.currencyMinorUnit))
      .up();
    const taxCategory = subtotal.ele("cac:TaxCategory");
    taxCategory.ele("cbc:ID").txt(group.category).up();
    taxCategory.ele("cbc:Percent").txt(formatPercent(group.rate)).up();
    if (group.exemptionReason && group.rate === 0) {
      taxCategory.ele("cbc:TaxExemptionReason").txt(group.exemptionReason).up();
    }
    taxCategory.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT").up().up();
    taxCategory.up();
    subtotal.up();
  });

  taxTotalNode.up();

  const monetaryTotal = root.ele("cac:LegalMonetaryTotal");
  monetaryTotal
    .ele("cbc:LineExtensionAmount", { currencyID: invoice.currency })
    .txt(formatAmount(totals.lineExtensionTotalMinor, totals.currencyMinorUnit))
    .up();
  monetaryTotal
    .ele("cbc:TaxExclusiveAmount", { currencyID: invoice.currency })
    .txt(formatAmount(totals.taxExclusiveAfterAllowances, totals.currencyMinorUnit))
    .up();
  monetaryTotal
    .ele("cbc:TaxInclusiveAmount", { currencyID: invoice.currency })
    .txt(
      formatAmount(
        totals.taxExclusiveAfterAllowances + totals.taxTotalMinor,
        totals.currencyMinorUnit
      )
    )
    .up();
  if (totals.allowanceTotalMinor > 0) {
    monetaryTotal
      .ele("cbc:AllowanceTotalAmount", { currencyID: invoice.currency })
      .txt(formatAmount(totals.allowanceTotalMinor, totals.currencyMinorUnit))
      .up();
  }
  if (totals.roundingMinor !== 0) {
    monetaryTotal
      .ele("cbc:PayableRoundingAmount", { currencyID: invoice.currency })
      .txt(formatAmount(totals.roundingMinor, totals.currencyMinorUnit))
      .up();
  }
  monetaryTotal
    .ele("cbc:PayableAmount", { currencyID: invoice.currency })
    .txt(formatAmount(totals.payableAmountMinor, totals.currencyMinorUnit))
    .up();
  monetaryTotal.up();

  return root.end({ prettyPrint: options.pretty ?? true });
}

export function buildInvoiceXml(invoice: unknown, options: BuildOptions = {}): string {
  const parsed = parseInvoice(invoice);
  return invoiceToUbl(parsed, options);
}
