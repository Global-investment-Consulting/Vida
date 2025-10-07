// src/tax.js

// Tiny utils
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pct    = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000; // keep 4dp intermediate

// EU list for a minimal rule-set
const EU = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
  'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'
]);

// Decide VAT category/rate from buyer data.
// Minimal rules for MVP:
// - Seller is BE.
// - If buyer country = BE and no VAT ID  -> S (21%)
// - If buyer country in EU (not BE) and has VAT ID -> AE (0% reverse charge)
// - Otherwise -> S (21%)   (you can refine later)
export function determineTaxRule(buyer) {
  const sellerCountry = 'BE'; // static for MVP
  const country = (buyer?.country || '').toUpperCase();
  const vatId   = (buyer?.vat_id || buyer?.vatId || '').trim();

  if (country === sellerCountry && !vatId) {
    return { category: 'S', rate: 0.21, reason: null };
  }
  if (country !== sellerCountry && EU.has(country) && vatId) {
    return { category: 'AE', rate: 0.0, reason: 'Intra-Community supply — reverse charge' };
  }
  // default local standard rate
  return { category: 'S', rate: 0.21, reason: null };
}

// Totals from lines and rule
export function calcTotals(lines, rule) {
  const netRaw = lines.reduce((sum, l) => sum + Number(l.qty) * Number(l.price), 0);
  const net = round2(netRaw);
  const taxRaw = net * pct(rule.rate);
  const tax = round2(taxRaw);
  const gross = round2(net + tax);
  return { net, tax, gross, vatRate: rule.rate };
}
