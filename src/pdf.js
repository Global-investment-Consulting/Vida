// src/pdf.js
import PDFDocument from 'pdfkit';

export function buildPdfStream(inv) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.fontSize(18).text('Invoice', { align: 'right' });
  doc.moveDown();

  doc.fontSize(12).text(`Number: ${inv.number}`);
  doc.text(`Date: ${new Date(inv.issuedAt || inv.createdAt || Date.now()).toISOString().slice(0,10)}`);
  doc.text(`Currency: ${inv.currency}`);
  doc.moveDown();

  doc.text('Seller: VIDA SRL (BE0123.456.789)');
  doc.text(`Buyer: ${inv.buyer?.name || ''} (${inv.buyer?.country || 'BE'})`);
  doc.moveDown();

  doc.text('Lines:');
  inv.lines.forEach((l, i) => {
    doc.text(`${i + 1}. ${l.name} — qty ${l.qty} × ${l.price}`);
  });

  doc.moveDown();
  doc.text(`Net:   ${inv.net}`);
  doc.text(`Tax:   ${inv.tax}`);
  doc.text(`Gross: ${inv.gross}`);

  doc.end();
  return doc;
}
