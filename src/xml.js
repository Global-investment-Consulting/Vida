export function buildUblXml(inv) {
  const issueDate =
    (inv.issuedAt && !isNaN(Date.parse(inv.issuedAt)))
      ? new Date(inv.issuedAt).toISOString().slice(0,10)
      : new Date().toISOString().slice(0,10);

  const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const linesXml = (inv.lines || []).map((l, idx) => `
  <cac:InvoiceLine>
    <cbc:ID>${idx + 1}</cbc:ID>
    <cbc:InvoicedQuantity>${Number(l.qty || 0)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount>${(Number(l.qty || 0) * Number(l.price || 0)).toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>${esc(l.name || "")}</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount>${Number(l.price || 0).toFixed(2)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${esc(inv.number || "")}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>${esc(inv.currency || "EUR")}</cbc:DocumentCurrencyCode>

  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:Name>VIDA SRL</cbc:Name>
      <cac:PostalAddress><cbc:Country>BE</cbc:Country></cac:PostalAddress>
      <cac:PartyTaxScheme><cbc:CompanyID>BE0123.456.789</cbc:CompanyID></cac:PartyTaxScheme>
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
