// src/ubl.js
// Build a minimal UBL 2.1 (EN16931/Peppol BIS 3.0 profile) XML string for an invoice

function fmt2(n) {
  const x = Number(n || 0);
  return x.toFixed(2);
}

function ymd(dateish) {
  // Accept ISO string or Date
  const d = (dateish instanceof Date) ? dateish : new Date(dateish || Date.now());
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function makeInvoiceXml(inv) {
  // defensives
  const currency = String(inv.currency || 'EUR').toUpperCase();
  const buyer = inv.buyer || {};
  const lines = Array.isArray(inv.lines) ? inv.lines : [];

  const taxPercent = Number(inv.vatRate || 0) * 100; // e.g. 0.21 -> 21
  const taxCategory = inv.taxCategory || 'S';
  const exemptionReason = inv?.meta?.exemptionReason || '';

  const issueDate = ymd(inv.issueDate || Date.now());

  const buyerCountry = String(buyer.country || '').toUpperCase();
  const buyerVatId = (buyer.vat_id || '').trim();

  // Lines XML
  const linesXml = lines.map((l, idx) => {
    const qty = Number(l.qty || 0);
    const price = Number(l.price || 0);
    const lineExt = qty * price;

    // Tax category per line mirrors invoice totals for this MVP
    const taxCatBlock = (taxCategory === 'AE' || taxCategory === 'E')
      ? `
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${taxCategory}</cbc:ID>
        <cbc:Percent>${fmt2(taxPercent)}</cbc:Percent>
        <cbc:TaxExemptionReason>${xmlEscape(exemptionReason)}</cbc:TaxExemptionReason>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>`
      : `
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${taxCategory}</cbc:ID>
        <cbc:Percent>${fmt2(taxPercent)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>`;

    return `
  <cac:InvoiceLine>
    <cbc:ID>${idx + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="EA">${qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${fmt2(lineExt)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${xmlEscape(l.name || 'Item')}</cbc:Name>
      ${taxCatBlock}
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${fmt2(price)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
  }).join('');

  // Buyer tax block (only if VAT id present)
  const buyerTaxXml = buyerVatId ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${xmlEscape(buyerVatId)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>` : '';

  // Tax total block
  const taxSubtotalBlock = (taxCategory === 'AE' || taxCategory === 'E')
    ? `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${fmt2(inv.tax)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${fmt2(inv.net)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${fmt2(inv.tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${taxCategory}</cbc:ID>
        <cbc:Percent>${fmt2(taxPercent)}</cbc:Percent>
        <cbc:TaxExemptionReason>${xmlEscape(exemptionReason)}</cbc:TaxExemptionReason>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>`
    : `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${fmt2(inv.tax)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${fmt2(inv.net)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${fmt2(inv.tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${taxCategory}</cbc:ID>
        <cbc:Percent>${fmt2(taxPercent)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>`;

  // Build full XML
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:poacc:billing:3.0</cbc:ProfileID>
  <cbc:ID>${xmlEscape(inv.number)}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>

  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="0088">1234567890123</cbc:EndpointID>
      <cac:PartyName><cbc:Name>Demo Seller Ltd</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:CityName>Brussels</cbc:CityName>
        <cbc:PostalZone>1000</cbc:PostalZone>
        <cbc:CountrySubentity>Brussels-Capital</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>BE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>BE0123456789</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${xmlEscape(buyer.name || '')}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cac:Country><cbc:IdentificationCode>${buyerCountry || 'BE'}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${buyerTaxXml}
    </cac:Party>
  </cac:AccountingCustomerParty>

  ${linesXml}

  ${taxSubtotalBlock}

  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${fmt2(inv.net)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${fmt2(inv.net)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${fmt2(inv.gross)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${fmt2(inv.gross)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;
}
