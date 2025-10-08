import PDFDocument from "pdfkit";
import { PassThrough } from "node:stream";

export function buildPdfStream(inv) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const stream = new PassThrough();
  doc.pipe(stream);

  doc.fontSize(18).text("INVOICE", { align: "right" });
  doc.moveDown();

  doc.fontSize(12).text("VIDA SRL");
  doc.text("BE0123.456.789");
  doc.moveDown();

  doc.text(`Invoice #: ${inv.number}`);
  doc.text(`Date: ${new Date(inv.issuedAt || Date.now()).toISOString().slice(0,10)}`);
  doc.moveDown();

  doc.text(`Bill To: ${inv.buyer?.name || ""}`);
  if (inv.buyer?.country) doc.text(`Country: ${inv.buyer.country}`);
  doc.moveDown();

  doc.text("Items:");
  doc.moveDown(0.5);
  (inv.lines || []).forEach((l) => {
    doc.text(`- ${l.name}  x${l.qty}  @ ${Number(l.price).toFixed(2)}`);
  });
  doc.moveDown();

  doc.text(`Net:   ${Number(inv.net).toFixed(2)}`);
  doc.text(`Tax:   ${Number(inv.tax).toFixed(2)}`);
  doc.text(`Total: ${Number(inv.gross).toFixed(2)}`, { underline: true });

  doc.end();
  return stream;
}
