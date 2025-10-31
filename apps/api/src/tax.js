export function calcTotals(lines, vatRate = 0.21) {
  const net = lines.reduce((sum, l) => sum + Number(l.qty || 0) * Number(l.price || 0), 0);
  const tax = Math.round(net * vatRate * 100) / 100;
  const gross = Math.round((net + tax) * 100) / 100;
  return { net, tax, gross };
}
