/**
 * Minimal JSON -> UBL 2.1 Invoice XML mapper (A1 scaffold)
 * NOTE: This is intentionally small; we’ll expand to full compliance in the PR.
 */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function jsonToUblInvoice(inv) {
  const issueDate = (inv.createdAt ? new Date(inv.createdAt) : new Date())
    .toISOString().slice(0,10); // YYYY-MM-DD

  const buyer = inv.buyer || {};
  const supplierName = "ViDA Demo Ltd.";
  const supplierVat  = "BE0123456789";

  const lines = Array.isArray(inv.lines) ? inv.lines : [];

  const lineXml = lines.map((l, idx) => {
    const qty  = Number(l.quantity || 1);
    const unit = Number(l.unitPriceMinor || 0);
    const total = qty * unit;
    return `
  <cac:InvoiceLine>
    <cbc:ID>${idx+1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="EA">${qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${esc(inv.currency || "EUR")}">${total}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>${esc(l.description || `Item ${idx+1}`)}</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${esc(inv.currency || "EUR")}">${unit}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`.trim();
  }).join("\n");

  const total = inv.totalMinor || lines.reduce((s,l)=> s + Number(l.quantity||1)*Number(l.unitPriceMinor||0),0);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice
 xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:fdc:peppol.eu:poacc:billing:3</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:poacc:billing:3.0</cbc:ProfileID>
  <cbc:ID>${esc(inv.number || inv.id)}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>

  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(supplierName)}</cbc:RegistrationName></cac:PartyLegalEntity>
      <cac:PartyTaxScheme><cbc:CompanyID>${esc(supplierVat)}</cbc:CompanyID></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(buyer.name || inv.buyerName || "Unknown")}</cbc:RegistrationName></cac:PartyLegalEntity>
      ${buyer.vatId ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(buyer.vatId)}</cbc:CompanyID></cac:PartyTaxScheme>` : ``}
    </cac:Party>
  </cac:AccountingCustomerParty>

  ${lineXml}

  <cac:LegalMonetaryTotal>
    <cbc:PayableAmount currencyID="${esc(inv.currency || "EUR")}">${total}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;
}
