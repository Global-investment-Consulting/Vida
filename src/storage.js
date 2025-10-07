// src/storage.js
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve('./data');
const INVOICES_FILE = path.join(DATA_DIR, 'invoices.json');

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(INVOICES_FILE)) fs.writeFileSync(INVOICES_FILE, JSON.stringify({ invoices: [] }, null, 2));
}
ensureFiles();

function readAll() {
  try {
    const raw = fs.readFileSync(INVOICES_FILE, 'utf8');
    const json = JSON.parse(raw || '{}');
    return Array.isArray(json.invoices) ? json.invoices : [];
  } catch {
    return [];
  }
}

function writeAll(invoices) {
  fs.writeFileSync(INVOICES_FILE, JSON.stringify({ invoices }, null, 2));
}

export function listInvoices({ limit = 10, starting_after } = {}) {
  const all = readAll().sort((a, b) => b.createdAt - a.createdAt);
  let startIdx = 0;
  if (starting_after) {
    const idx = all.findIndex(i => i.id === starting_after);
    startIdx = idx >= 0 ? idx + 1 : 0;
  }
  const data = all.slice(startIdx, startIdx + Number(limit || 10));
  const last = data[data.length - 1];
  const has_more = startIdx + data.length < all.length;
  const next_starting_after = has_more ? last.id : null;
  return { data, has_more, next_starting_after, total: all.length };
}

export function getInvoice(id) {
  return readAll().find(i => i.id === id) || null;
}

export function upsertInvoice(inv) {
  const all = readAll();
  const idx = all.findIndex(i => i.id === inv.id);
  if (idx >= 0) all[idx] = inv;
  else all.push(inv);
  writeAll(all);
  return inv;
}
