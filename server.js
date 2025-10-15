// server.js
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// simple CORS for local dev/CI
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// paths
const dataDir = path.join(__dirname, "data");
const dbPath  = path.join(dataDir, "db.json");

// load or init DB
function loadDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({ invoices: [] }, null, 2));
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}
function saveDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

// health endpoint for CI waiters
app.get("/healthz", (req, res) => res.status(200).json({ ok: true }));

// create a new invoice (accepts partial payload; fills in defaults)
app.post("/api/invoices", (req, res) => {
  const body = req.body || {};
  const db = loadDb();

  const inv = {
    id: cryptoRandomId(),
    number: body.number ?? `INV-${Date.now()}`,
    currency: body.currency ?? "EUR",
    buyer: body.buyer ?? { name: "Test Buyer", vatId: "BE0999999999" },
    createdAt: body.createdAt ?? new Date().toISOString(),
    lines: Array.isArray(body.lines) && body.lines.length
      ? body.lines
      : [{ description: "Test line", quantity: 1, unitPriceMinor: 1000 }],
  };

  inv.totalMinor = inv.lines.reduce((s, l) => s + Number(l.quantity || 1) * Number(l.unitPriceMinor || 0), 0);

  db.invoices.push(inv);
  saveDb(db);
  res.status(201).json(inv);
});

// fetch latest invoice
app.get("/api/invoices/latest", (req, res) => {
  const db = loadDb();
  const inv = db.invoices.at(-1);
  if (!inv) return res.status(404).json({ error: "No invoices yet" });
  res.json(inv);
});

// serve data/db.json (debug)
app.get("/api/db", (req, res) => {
  res.type("application/json").send(fs.readFileSync(dbPath, "utf8"));
});

const PORT = Number(process.env.PORT || 3001);
const server = app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

// tiny id helper without pulling in a dep
function cryptoRandomId() {
  // 8 bytes hex
  const n = 8, buf = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256);
  return [...buf].map(b => b.toString(16).padStart(2, "0")).join("");
}

export default server;
