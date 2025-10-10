// src/xml.js
export function buildUblXml(inv) {
  const issueDate = (inv.issuedAt && String(inv.issuedAt).slice(0, 10)) || new Date().toISOString().slice(0, 10);
  const fmt = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

  const line = (l, idx) => `
  <cac:InvoiceLine>
    <cbc:ID>${idx + 1}</cbc:ID>
    <cbc:InvoicedQuantity>${l.qty || 0}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount>${fmt((l.qty || 0) * (l.price || 0))}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>${l.name || ''}</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount>${fmt(l.price || 0)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`.trim();

  const linesXml = (inv.lines || []).map(line).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${inv.number}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>${inv.currency || 'EUR'}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:Name>VIDA SRL</cbc:Name>
      <cac:PostalAddress><cbc:Country>BE</cbc:Country></cac:PostalAddress>
      <cac:PartyTaxScheme><cbc:CompanyID>BE0123.456.789</cbc:CompanyID></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:Name>${inv.buyer?.name || ''}</cbc:Name>
      <cac:PostalAddress><cbc:Country>${inv.buyer?.country || 'BE'}</cbc:Country></cac:PostalAddress>
      <cac:PartyTaxScheme><cbc:CompanyID>${inv.buyer?.vat || ''}</cbc:CompanyID></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount>${fmt(inv.tax)}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount>${fmt(inv.net)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount>${fmt(inv.net)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount>${fmt(inv.gross)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount>${fmt(inv.gross)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${linesXml}
</Invoice>`;
}
