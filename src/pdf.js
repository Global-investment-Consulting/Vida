// src/pdf.js
import PDFDocument from 'pdfkit';

export function buildPdf(inv) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const fmt = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);
      const currency = inv.currency || 'EUR';

      doc.fontSize(20).text('INVOICE', { align: 'right' });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Invoice #: ${inv.number}`, { align: 'right' });
      doc.text(`Date: ${inv.issuedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10)}`, { align: 'right' });
      doc.moveDown(1);

      doc.fontSize(12).text('Seller', { underline: true });
      doc.fontSize(10).text('VIDA SRL');
      doc.text('BE');
      doc.text('VAT: BE0123.456.789');
      doc.moveDown(0.75);

      doc.fontSize(12).text('Buyer', { underline: true });
      doc.fontSize(10).text(inv.buyer?.name || '—');
      doc.text(inv.buyer?.country || '—');
      doc.moveDown(1);

      doc.fontSize(11).text('Description', 50, undefined, { continued: true });
      doc.text('Qty', 250, undefined, { continued: true });
      doc.text('Price', 320, undefined, { continued: true });
      doc.text('Amount', 400);
      doc.moveDown(0.5);

      (inv.lines || []).forEach((l) => {
        const amount = (Number(l.qty || 0) * Number(l.price || 0));
        doc.fontSize(10).text(l.name || '', 50, undefined, { continued: true });
        doc.text(l.qty || '', 250, undefined, { continued: true });
        doc.text(fmt(l.price || 0), 320, undefined, { continued: true });
        doc.text(fmt(amount), 400);
      });

      doc.moveDown(1);
      doc.text(`Net: ${fmt(inv.net)} ${currency}`, { align: 'right' });
      doc.text(`Tax: ${fmt(inv.tax)} ${currency}`, { align: 'right' });
      doc.text(`Total: ${fmt(inv.gross)} ${currency}`, { align: 'right' });
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
