import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import axios from "axios";
import {
  getOutboundStatus,
  getOutboundUbl,
  lookupParticipantById,
  sendSalesInvoiceJson,
  sendUbl
} from "../src/adapters/scrada.ts";
import { prepareScradaInvoice, buildBis30Ubl } from "../src/scrada/payload.ts";

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

  const explicitParticipant = process.env.SCRADA_PARTICIPANT_ID?.trim();
  const receiverSchemeVar = process.env.SCRADA_TEST_RECEIVER_SCHEME?.trim();
  const receiverIdVar = process.env.SCRADA_TEST_RECEIVER_ID?.trim();
  const combinedReceiver =
    receiverSchemeVar && receiverIdVar ? `${receiverSchemeVar}:${receiverIdVar}` : undefined;
  const billitReceiver =
    process.env.BILLIT_RX_SCHEME && process.env.BILLIT_RX_VALUE
      ? `${process.env.BILLIT_RX_SCHEME}:${process.env.BILLIT_RX_VALUE}`.trim()
      : undefined;

  const normalizedReceiverId =
    (explicitParticipant && explicitParticipant.length > 0 && explicitParticipant) ??
    (combinedReceiver && combinedReceiver.length > 0 && combinedReceiver) ??
    (process.env.SCRADA_RECEIVER_PEPPOL_ID?.trim() || undefined) ??
    billitReceiver ??
    process.env.SCRADA_COMPANY_ID?.trim() ??
    "";

  let receiverScheme: string | undefined;
  let receiverValue: string | undefined;

  if (normalizedReceiverId.includes(":")) {
    [receiverScheme, receiverValue] = normalizedReceiverId.split(":", 2);
  } else {
    receiverScheme = receiverSchemeVar;
    receiverValue = normalizedReceiverId;
  }

  const participantId =
    receiverScheme && receiverValue ? `${receiverScheme}:${receiverValue}` : receiverValue ?? "";

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

  if (receiverScheme && receiverValue) {
    buyer.peppolScheme = receiverScheme;
    buyer.peppolId = receiverValue;
    buyer.schemeId = receiverScheme;
    buyer.endpointId = `${receiverScheme}:${receiverValue}`;
    buyer.participantId = `${receiverScheme}:${receiverValue}`;
  } else if (participantId) {
    buyer.peppolId = participantId;
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
      const envScheme = process.env.SCRADA_TEST_RECEIVER_SCHEME?.trim();
      const envReceiverId = process.env.SCRADA_TEST_RECEIVER_ID?.trim();
      const rawSenderScheme = process.env.SCRADA_SENDER_SCHEME?.trim();
      const rawSenderValue = process.env.SCRADA_SENDER_ID?.trim();
      const companyIdEnv = process.env.SCRADA_COMPANY_ID?.trim();
      let senderScheme = rawSenderScheme;
      let senderValue = rawSenderValue;
      if ((!senderScheme || !senderValue) && companyIdEnv && companyIdEnv.includes(":")) {
        const [companyScheme, companyValue] = companyIdEnv.split(":", 2);
        senderScheme = senderScheme || companyScheme;
        senderValue = senderValue || companyValue;
      }
      const preparedInvoice = prepareScradaInvoice(invoice, {
        receiverScheme: envScheme,
        receiverValue: envReceiverId,
        senderScheme,
        senderValue
      });

      const buyerEndpointScheme =
        (preparedInvoice.buyer?.endpointScheme as string | undefined) ??
        (preparedInvoice.buyer?.peppolScheme as string | undefined) ??
        (preparedInvoice.buyer?.schemeId as string | undefined);
      const buyerEndpointValue =
        (preparedInvoice.buyer?.endpointValue as string | undefined) ??
        (preparedInvoice.buyer?.peppolId as string | undefined);

      const participantId =
        buyerEndpointScheme && buyerEndpointValue
          ? `${buyerEndpointScheme}:${buyerEndpointValue}`
          : buyerEndpointValue;

      if (!participantId) {
        throw new Error(
          "SCRADA_TEST_RECEIVER_ID (or SCRADA_COMPANY_ID including scheme) must be configured to run the integration test"
        );
      }

      try {
        const lookup = await lookupParticipantById(participantId);
        // eslint-disable-next-line no-console
        console.log(
          `[scrada-integration] participant ${participantId} lookup exists=${lookup.exists}`
        );
      } catch (lookupError) {
        // eslint-disable-next-line no-console
        console.warn("[scrada-integration] participant lookup failed:", lookupError);
      }

      let documentId: string | undefined;
      let fallbackUsed = false;
      try {
        ({ documentId } = await sendSalesInvoiceJson(preparedInvoice, {
          externalReference: preparedInvoice.id
        }));
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
        const status = direct?.response?.status ?? null;
        if (status !== 400) {
          throw error;
        }
        fallbackUsed = true;
        const ublXml = buildBis30Ubl(preparedInvoice, {
          receiverScheme: envScheme,
          receiverValue: envReceiverId,
          senderScheme,
          senderValue
        });
        try {
          const result = await sendUbl(ublXml, { externalReference: preparedInvoice.id });
          documentId = result.documentId;
        } catch (ublError) {
          const ublRoot =
            ublError instanceof Error && axios.isAxiosError(ublError.cause) ? ublError.cause : null;
          const ublDirect = axios.isAxiosError(ublError) ? ublError : ublRoot;
          if (ublDirect?.response?.data) {
            // eslint-disable-next-line no-console
            console.error(
              "[scrada-integration] sendUbl failure response:",
              typeof ublDirect.response.data === "string"
                ? ublDirect.response.data
                : JSON.stringify(ublDirect.response.data, null, 2)
            );
          }
          // eslint-disable-next-line no-console
          console.error("[scrada-integration] sendUbl error", ublError);
          throw ublError;
        }
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

      // eslint-disable-next-line no-console
      console.log(`[scrada-integration] fallback used=${fallbackUsed}`);

      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "scrada-"));
      const filePath = path.join(tmpDir, `${documentId}.xml`);
      await writeFile(filePath, ublXml, "utf8");
    },
    90_000
  );
});
