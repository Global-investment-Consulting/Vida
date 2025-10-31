import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import axios from "axios";
import {
  getOutboundStatus,
  getOutboundUbl,
  lookupParticipantById,
  sendSalesInvoiceJson
} from "../src/adapters/scrada.ts";

const RUN_INTEGRATION = process.env.RUN_SCRADA_INTEGRATION === "true";
const SUCCESS_STATUSES = new Set(["DELIVERED", "DELIVERY_CONFIRMED", "SUCCESS", "ACCEPTED"]);
const ERROR_STATUSES = new Set(["ERROR", "FAILED", "REJECTED"]);

const describeIfEnabled = RUN_INTEGRATION ? describe : describe.skip;

function isoDate(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function buildInvoice() {
  const invoiceId = `IT-${Date.now()}`;
  const currency = "EUR";
  const netAmount = 50;
  const vatRate = 21;
  const vatAmount = Number((netAmount * (vatRate / 100)).toFixed(2));
  const grossAmount = Number((netAmount + vatAmount).toFixed(2));

  const receiverId =
    process.env.SCRADA_TEST_RECEIVER_ID ??
    process.env.SCRADA_RECEIVER_PEPPOL_ID ??
    (process.env.BILLIT_RX_SCHEME && process.env.BILLIT_RX_VALUE
      ? `${process.env.BILLIT_RX_SCHEME}:${process.env.BILLIT_RX_VALUE}`
      : undefined) ??
    process.env.SCRADA_COMPANY_ID ??
    "";

  const [receiverScheme, receiverValue] =
    typeof receiverId === "string" && receiverId.includes(":")
      ? receiverId.split(":", 2)
      : [undefined, receiverId];

  const buyer = {
    name: "Integration Buyer",
    vatNumber: "BE0123456789",
    address: {
      streetName: "Integrationstraat",
      buildingNumber: "99",
      postalZone: "1000",
      cityName: "Brussels",
      countryCode: "BE"
    },
    contact: {
      name: "Integration Buyer AP",
      email: "ap+integration@example.test"
    }
  } as Record<string, unknown>;

  if (receiverValue && receiverValue.length > 0) {
    buyer.peppolId = receiverId;
    if (receiverScheme) {
      buyer.schemeId = receiverScheme;
    }
    buyer.endpointId = receiverValue;
  }

  const seller = {
    name: "Vida Integration Seller",
    vatNumber: "BE9876543210",
    address: {
      streetName: "Devlaan",
      buildingNumber: "1",
      postalZone: "9000",
      cityName: "Ghent",
      countryCode: "BE"
    },
    contact: {
      name: "Vida Integration Finance",
      email: "billing+integration@vida.example"
    }
  } as Record<string, unknown>;

  const senderId = process.env.SCRADA_COMPANY_ID ?? "";
  if (typeof senderId === "string" && senderId.includes(":")) {
    const [scheme, value] = senderId.split(":", 2);
    seller.peppolId = senderId;
    seller.schemeId = scheme;
    seller.endpointId = value;
  }

  const invoice = {
    profileId: "urn:fdc:peppol.eu:poacc:billing:3",
    customizationId: "urn:fdc:peppol.eu:poacc:billing:3:01:1.0",
    id: invoiceId,
    externalReference: invoiceId,
    issueDate: isoDate(),
    dueDate: isoDate(30),
    currency,
    buyer,
    seller,
    totals: {
      lineExtensionAmount: { currency, value: netAmount },
      taxExclusiveAmount: { currency, value: netAmount },
      taxInclusiveAmount: { currency, value: grossAmount },
      payableAmount: { currency, value: grossAmount },
      taxTotals: [
        {
          rate: vatRate,
          taxableAmount: { currency, value: netAmount },
          taxAmount: { currency, value: vatAmount }
        }
      ]
    },
    lines: [
      {
        id: "1",
        description: "Integration test line",
        quantity: 1,
        unitCode: "DAY",
        unitPrice: { currency, value: netAmount },
        lineExtensionAmount: { currency, value: netAmount },
        vat: {
          rate: vatRate,
          taxableAmount: { currency, value: netAmount },
          taxAmount: { currency, value: vatAmount }
        }
      }
    ],
    paymentTerms: {
      note: "Payment due 30 days after invoice date",
      paymentDueDate: isoDate(30),
      paymentId: invoiceId
    }
  };

  return invoice;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describeIfEnabled("Scrada integration", () => {
  beforeAll(() => {
    for (const envVar of [
      "SCRADA_API_KEY",
      "SCRADA_API_PASSWORD",
      "SCRADA_COMPANY_ID"
    ]) {
      if (!process.env[envVar]) {
        throw new Error(`${envVar} must be set for Scrada integration test`);
      }
    }
  });

  it(
    "sends an invoice and fetches the delivered UBL",
    async () => {
      const invoice = buildInvoice();
      if (!invoice.buyer.peppolId) {
        throw new Error(
          "SCRADA_TEST_RECEIVER_ID (or SCRADA_COMPANY_ID including scheme) must be configured to run the integration test"
        );
      }

      try {
        const lookup = await lookupParticipantById(invoice.buyer.peppolId as string);
        // eslint-disable-next-line no-console
        console.log(
          `[scrada-integration] participant ${invoice.buyer.peppolId} lookup exists=${lookup.exists}`
        );
      } catch (lookupError) {
        // eslint-disable-next-line no-console
        console.warn("[scrada-integration] participant lookup failed:", lookupError);
      }

      let documentId: string | undefined;
      try {
        ({ documentId } = await sendSalesInvoiceJson(invoice, { externalReference: invoice.id }));
      } catch (error) {
        const root = error instanceof Error && axios.isAxiosError(error.cause) ? error.cause : null;
        const direct = axios.isAxiosError(error) ? error : root;
        if (direct?.response?.data) {
          // eslint-disable-next-line no-console
          console.error(
            "[scrada-integration] sendSalesInvoiceJson failure response:",
            typeof direct.response.data === "string"
              ? direct.response.data
              : JSON.stringify(direct.response.data, null, 2)
          );
        }
        throw error;
      }

      const deadline = Date.now() + 60_000;
      let attempts = 0;
      let statusInfo;

      while (Date.now() < deadline) {
        attempts += 1;
        statusInfo = await getOutboundStatus(documentId!);
        const normalizedStatus = statusInfo.status?.toUpperCase() ?? "";

        if (SUCCESS_STATUSES.has(normalizedStatus)) {
          break;
        }
        if (ERROR_STATUSES.has(normalizedStatus)) {
          throw new Error(`Scrada reported error status: ${statusInfo.status}`);
        }
        await wait(Math.min(5_000, 1_000 * attempts));
      }

      if (!statusInfo || !SUCCESS_STATUSES.has((statusInfo.status ?? "").toUpperCase())) {
        throw new Error("Scrada status did not reach a terminal success state within timeout");
      }

      const ublXml = await getOutboundUbl(documentId!);
      expect(ublXml.length).toBeGreaterThan(0);

      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "scrada-"));
      const filePath = path.join(tmpDir, `${documentId}.xml`);
      await writeFile(filePath, ublXml, "utf8");
    },
    90_000
  );
});
