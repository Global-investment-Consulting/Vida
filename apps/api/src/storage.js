import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const seed = {
      seq: 1,
      invoices: {},
      payments: {},
      idem: { create: {}, pay: {} }
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), "utf8");
  }
}

export function loadDb() {
  ensure();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

export function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}
