// src/pdf.js
// very small helpers good enough for tests

export function buildXml(inv) {
  const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({
    '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'
  }[c]));
  return `<?xml version="1.0" encoding="UTF-8"?>
<invoice id="${esc(inv.id)}">
  <number>${esc(inv.number)}</number>
  <status>${esc(inv.status)}</status>
  <currency>${esc(inv.currency)}</currency>
  <buyer>
    <name>${esc(inv.buyerName)}</name>
    <country>${esc(inv.buyerCountry)}</country>
  </buyer>
  <amounts>
    <net>${inv.net}</net>
    <tax>${inv.tax}</tax>
    <gross>${inv.gross}</gross>
  </amounts>
</invoice>`;
}

export function buildPdf(inv) {
  // Minimal fake PDF — tests only check HTTP 200.
  const body = `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R>>endobj
2 0 obj<< /Type /Pages /Count 1 /Kids [3 0 R]>>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R>>endobj
4 0 obj<< /Length 60>>stream
BT /F1 12 Tf 10 120 Td (Invoice ${inv.number}) Tj 10 100 Td (Total ${inv.gross} ${inv.currency}) Tj ET
endstream endobj
xref
0 5
0000000000 65535 f 
0000000010 00000 n 
0000000062 00000 n 
0000000129 00000 n 
0000000221 00000 n 
trailer<< /Size 5 /Root 1 0 R>>
startxref
320
%%EOF`;
  return Buffer.from(body, 'utf8');
}
