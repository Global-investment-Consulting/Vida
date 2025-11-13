#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { orderToInvoice, type ShopifyOrder } from "../src/mapper.js";

async function readJson(path?: string): Promise<ShopifyOrder> {
  if (path) {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as ShopifyOrder;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as ShopifyOrder;
}

async function main() {
  const filePath = process.argv[2];
  const order = await readJson(filePath);
  const payload = orderToInvoice(order);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((error) => {
  console.error("Failed to convert order:", error);
  process.exit(1);
});
