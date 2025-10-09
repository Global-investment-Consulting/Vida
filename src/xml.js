// src/xml.js
import { VAT_RATE } from './config.js';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

export function buildUblXml(inv) {
  const issueDate = (inv.issuedAt ? new Date(inv.issuedAt) : new Date()).toISOString().slice(0, 10);

  const net = inv.lines.reduce((sum, l) => sum + l.qty * l.price, 0);
  const tax = round2(net * VAT_RATE);
  const gross = round2(net + tax);

  const line = inv.lines[0] || { name: 'Service', qty: 1, price: net };
  const lineExt = round2(line.qty * line.price);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${esc(inv.number)}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>${esc(inv.currency)}</cbc:DocumentCurrencyCode>

  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:Name>VIDA SRL</cbc:Name>
      <cac:PostalAddress>
        <cbc:Country>BE</cbc:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>BE0123.456.789</cbc:CompanyID>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:Name>${esc(inv.buyer?.name || '')}</cbc:Name>
      <cac:PostalAddress><cbc:Country>${esc(inv.buyer?.country || 'BE')}</cbc:Country></cac:PostalAddress>
      <cac:PartyTaxScheme><cbc:CompanyID>${esc(inv.buyer?.vat || '')}</cbc:CompanyID></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingCustomerParty>

  <cac:TaxTotal><cbc:TaxAmount>${tax.toFixed(2)}</cbc:TaxAmount></cac:TaxTotal>

  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount>${net.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount>${net.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount>${gross.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount>${gross.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity>${line.qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount>${lineExt.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>${esc(line.name)}</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount>${Number(line.price).toFixed(2)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;
}
