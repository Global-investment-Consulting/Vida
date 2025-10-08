// src/storage.js
import fs from "fs/promises";
import { DB_PATH } from "./config.js";
import path from "path";

async function ensureDb() {
  const dir = path.dirname(DB_PATH);
  try { await fs.mkdir(dir, { recursive: true }); } catch {}
  try {
    await fs.access(DB_PATH);
  } catch {
    const seed = { seq: 1, invoices: {}, payments: {}, idem: { create: {}, pay: {} } };
    await fs.writeFile(DB_PATH, JSON.stringify(seed, null, 2), "utf8");
  }
}

export async function loadDb() {
  await ensureDb();
  const raw = await fs.readFile(DB_PATH, "utf8");
  return JSON.parse(raw);
}

export async function saveDb(db) {
  await ensureDb();
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}
