// scripts/to-ubl.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jsonToUblInvoice } from "../src/ubl/jsonToUbl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "..", "data", "db.json");
const db = fs.existsSync(dbPath)
  ? JSON.parse(fs.readFileSync(dbPath, "utf8"))
  : { invoices: [] };

const inv = db.invoices?.[db.invoices.length - 1];
if (!inv) {
  console.error("No invoices in data/db.json. Create one first via the API.");
  process.exit(1);
}

const xml = jsonToUblInvoice(inv);
const out = path.join(__dirname, "..", `${inv.number || inv.id}.ubl.xml`);
fs.writeFileSync(out, xml, "utf8");
console.log("Wrote", out);
