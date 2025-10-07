// src/xml.js
//
// Minimal UBL-ish XML builder used by /v1/invoices/:id/xml
// Exports: buildUbl(invoice) -> string (application/xml)

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function money(n) {
  const v = Number(n || 0);
  return v.toFixed(2);
}

export function buildUbl(inv) {
  const seller = inv.seller || {
    name: "VIDA SRL",
    country: "BE",
    vat_id: "BE0123.456.789",
  };
  const buyer = inv.buyer || { name: "", country: "", vat_id: "" };

  const number = inv.number || inv.id || "";
  const issueDate = (inv.issuedAt || new Date().toISOString()).slice(0, 10);
  const currency = inv.currency || "EUR";

  // totals expected from store
  const net = money(inv.net);
  const tax = money(inv.tax);
  const gross = money(inv.gross);

  // single-line items as in the MVP
  const lines = Array.isArray(inv.lines) ? inv.lines : [];

  // Namespaces (simple)
  const nsInvoice = `urn:oasis:names:specification:ubl:schema:xsd:Invoice-2`;
  const nsCAC = `urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2`;
  const nsCBC = `urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2`;

  // Build XML
  let xml = "";
  xml += `<Invoice xmlns="${nsInvoice}" xmlns:cac="${nsCAC}" xmlns:cbc="${nsCBC}">`;
  xml += `<cbc:ID>${esc(number)}</cbc:ID>`;
  xml += `<cbc:IssueDate>${esc(issueDate)}</cbc:IssueDate>`;
  xml += `<cbc:DocumentCurrencyCode>${esc(currency)}</cbc:DocumentCurrencyCode>`;

  // Seller
  xml += `<cac:AccountingSupplierParty><cac:Party>`;
  if (seller.name) xml += `<cbc:Name>${esc(seller.name)}</cbc:Name>`;
  xml += `<cac:PostalAddress>`;
  if (seller.country) xml += `<cbc:Country>${esc(seller.country)}</cbc:Country>`;
  xml += `</cac:PostalAddress>`;
  xml += `<cac:PartyTaxScheme><cbc:CompanyID>${esc(seller.vat_id || "")}</cbc:CompanyID></cac:PartyTaxScheme>`;
  xml += `</cac:Party></cac:AccountingSupplierParty>`;

  // Buyer
  xml += `<cac:AccountingCustomerParty><cac:Party>`;
  if (buyer.name) xml += `<cbc:Name>${esc(buyer.name)}</cbc:Name>`;
  xml += `<cac:PostalAddress>`;
  if (buyer.country) xml += `<cbc:Country>${esc(buyer.country)}</cbc:Country>`;
  xml += `</cac:PostalAddress>`;
  xml += `<cac:PartyTaxScheme><cbc:CompanyID>${esc(buyer.vat_id || "")}</cbc:CompanyID></cac:PartyTaxScheme>`;
  xml += `</cac:Party></cac:AccountingCustomerParty>`;

  // Tax & totals
  xml += `<cac:TaxTotal><cbc:TaxAmount>${tax}</cbc:TaxAmount></cac:TaxTotal>`;
  xml += `<cac:LegalMonetaryTotal>`;
  xml += `<cbc:LineExtensionAmount>${net}</cbc:LineExtensionAmount>`;
  xml += `<cbc:TaxExclusiveAmount>${net}</cbc:TaxExclusiveAmount>`;
  xml += `<cbc:TaxInclusiveAmount>${gross}</cbc:TaxInclusiveAmount>`;
  xml += `<cbc:PayableAmount>${gross}</cbc:PayableAmount>`;
  xml += `</cac:LegalMonetaryTotal>`;

  // Lines
  lines.forEach((ln, i) => {
    const qty = Number(ln.qty || 0);
    const price = Number(ln.price || 0);
    const lineTotal = money(qty * price);
    xml += `<cac:InvoiceLine>`;
    xml += `<cbc:ID>${i + 1}</cbc:ID>`;
    xml += `<cbc:InvoicedQuantity>${qty}</cbc:InvoicedQuantity>`;
    xml += `<cbc:LineExtensionAmount>${lineTotal}</cbc:LineExtensionAmount>`;
    xml += `<cac:Item><cbc:Name>${esc(ln.name || "")}</cbc:Name></cac:Item>`;
    xml += `<cac:Price><cbc:PriceAmount>${money(price)}</cbc:PriceAmount></cac:Price>`;
    xml += `</cac:InvoiceLine>`;
  });

  xml += `</Invoice>`;
  return xml;
}
