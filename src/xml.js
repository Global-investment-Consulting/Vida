// src/xml.js
import { SELLER } from "./config.js";

export function buildUblXml(inv) {
  // Ensure issuedAt is a date string compatible with toISOString
  const issued = inv.issuedAt ? new Date(inv.issuedAt) : new Date();
  const issueDate = issued.toISOString().slice(0, 10);

  const esc = (s = "") => String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

  const linesXml = (inv.lines || [])
    .map(
      (l) => `
  <cac:InvoiceLine>
    <cbc:ID>${l.id}</cbc:ID>
    <cbc:InvoicedQuantity>${l.qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount>${(l.qty * l.price).toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>${esc(l.name)}</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount>${Number(l.price).toFixed(2)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${esc(inv.number)}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>${esc(inv.currency)}</cbc:DocumentCurrencyCode>

  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:Name>${esc(SELLER.name)}</cbc:Name>
      <cac:PostalAddress><cbc:Country>${esc(SELLER.country)}</cbc:Country></cac:PostalAddress>
      <cac:PartyTaxScheme><cbc:CompanyID>${esc(SELLER.vat)}</cbc:CompanyID></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:Name>${esc(inv.buyer?.name || "")}</cbc:Name>
      <cac:PostalAddress><cbc:Country>${esc(inv.buyer?.country || "")}</cbc:Country></cac:PostalAddress>
      <cac:PartyTaxScheme><cbc:CompanyID>${esc(inv.buyer?.vat || "")}</cbc:CompanyID></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingCustomerParty>

  <cac:TaxTotal>
    <cbc:TaxAmount>${Number(inv.tax || 0).toFixed(2)}</cbc:TaxAmount>
  </cac:TaxTotal>

  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount>${Number(inv.net || 0).toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount>${Number(inv.net || 0).toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount>${Number(inv.gross || 0).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount>${Number(inv.gross || 0).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  ${linesXml}
</Invoice>`;
}
