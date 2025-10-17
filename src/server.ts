import cors from "cors";
import express, { type Request, type Response } from "express";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { shopifyToOrder } from "./connectors/shopify";
import { wooToOrder } from "./connectors/woocommerce";
import { orderToInvoiceXml } from "./peppol/convert";
import { parseOrder, type OrderT } from "./schemas/order";

type SupportedSource = "shopify" | "woocommerce" | "order";

function buildOrderFromSource(
  source: SupportedSource | undefined,
  payload: unknown,
  supplier: OrderT["supplier"] | undefined,
  options: { defaultVatRate?: number; currencyMinorUnit?: number }
): OrderT {
  const normalizedSource = source?.toLowerCase() as SupportedSource | undefined;

  if (!payload) {
    throw new Error("payload is required");
  }

  if (normalizedSource === "shopify") {
    if (!supplier?.name) {
      throw new Error("supplier.name is required for Shopify orders");
    }
    return shopifyToOrder(payload as Parameters<typeof shopifyToOrder>[0], {
      supplier,
      defaultVatRate: options.defaultVatRate,
      currencyMinorUnit: options.currencyMinorUnit
    });
  }

  if (normalizedSource === "woocommerce") {
    if (!supplier?.name) {
      throw new Error("supplier.name is required for WooCommerce orders");
    }
    return wooToOrder(payload as Parameters<typeof wooToOrder>[0], {
      supplier,
      defaultVatRate: options.defaultVatRate,
      currencyMinorUnit: options.currencyMinorUnit
    });
  }

  return parseOrder(payload);
}

export const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok");
});

app.get("/", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.post("/webhook/order-created", async (req: Request, res: Response) => {
  try {
    const { source, payload, supplier, defaultVatRate, currencyMinorUnit } = req.body ?? {};

    const order = buildOrderFromSource(source, payload, supplier, {
      defaultVatRate,
      currencyMinorUnit
    });

    const xml = await orderToInvoiceXml(order);

    const outputDir = path.resolve(process.cwd(), "output");
    await mkdir(outputDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputPath = path.join(outputDir, `invoice_${timestamp}.xml`);

    await writeFile(outputPath, xml, "utf8");
    console.log(`[webhook] Generated invoice at ${outputPath}`);

    res.json({ path: outputPath, xmlLength: xml.length });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ error: "Invalid order payload", details: error.errors });
      return;
    }

    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Failed to generate invoice" });
  }
});

const HOST = "0.0.0.0";

export function startServer(port = Number(process.env.PORT ?? 3001)) {
  const server = app.listen(port, HOST, () => {
    console.log(`Server listening on ${HOST}:${port}`);
  });

  const stop = () => {
    server.close(() => process.exit(0));
  };

  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  return server;
}

const currentFile = fileURLToPath(import.meta.url);
const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined;

if (entryPoint === currentFile) {
  startServer();
}
