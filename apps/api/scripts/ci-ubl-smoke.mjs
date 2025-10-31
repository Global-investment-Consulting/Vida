// scripts/ci-ubl-smoke.mjs
// CI smoke: wait for API, create 1 invoice, generate UBL XML, assert file exists.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jsonToUblInvoice } from "../src/ubl/jsonToUbl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const base = process.env.CI_BASE_URL || "http://localhost:3001";

async function waitHealth(timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`API not reachable after ${timeoutMs}ms`);
}

async function main() {
  console.log("Waiting for API…", base);
  await waitHealth();

  console.log("Creating test invoice…");
  const r = await fetch(`${base}/api/invoices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      number: `INV-${Date.now()}`,
      currency: "EUR",
      buyer: { name: "Smoke Buyer", vatId: "BE0999999999" },
      lines: [{ description: "Smoke line", quantity: 2, unitPriceMinor: 500 }],
    }),
  });
  if (!r.ok) throw new Error(`POST /api/invoices failed: ${r.status}`);
  const inv = await r.json();

  console.log("Generating UBL XML…");
  const xml = jsonToUblInvoice(inv);
  const out = path.join(__dirname, "..", `${inv.number || inv.id}.ubl.xml`);
  fs.writeFileSync(out, xml, "utf8");

  if (!fs.existsSync(out)) throw new Error(`Expected XML file missing: ${out}`);
  console.log("✅ Smoke succeeded:", out);
}

main().catch((e) => {
  console.error("❌ Smoke failed:", e.message);
  process.exit(1);
});
