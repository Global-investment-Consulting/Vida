// src/pdf.js
import PDFDocument from "pdfkit";
import { SELLER } from "./config.js";

export function buildPdfStream(inv) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });

  doc.fontSize(18).text("INVOICE", { align: "right" });
  doc.moveDown();

  doc.fontSize(12).text(SELLER.name);
  doc.text(`VAT: ${SELLER.vat}`);
  doc.text(`Country: ${SELLER.country}`);
  doc.moveDown();

  doc.text(`Invoice #: ${inv.number}`);
  doc.text(`Issued: ${new Date(inv.issuedAt || Date.now()).toISOString().slice(0, 10)}`);
  doc.moveDown();

  doc.text(`Bill To: ${inv.buyer?.name || ""}`);
  doc.text(`Country: ${inv.buyer?.country || ""}`);
  if (inv.buyer?.vat) doc.text(`Buyer VAT: ${inv.buyer.vat}`);
  doc.moveDown();

  doc.text("Items:");
  doc.moveDown(0.5);

  (inv.lines || []).forEach((l) => {
    doc.text(`${l.id}. ${l.name} — qty ${l.qty} × ${l.price.toFixed(2)}`);
  });

  doc.moveDown();
  doc.text(`Net:   ${inv.net.toFixed(2)} ${inv.currency}`);
  doc.text(`Tax:   ${inv.tax.toFixed(2)} ${inv.currency}`);
  doc.text(`Gross: ${inv.gross.toFixed(2)} ${inv.currency}`, { underline: true });

  doc.end();
  return doc; // readable stream
}
