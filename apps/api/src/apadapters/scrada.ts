import { getOutboundStatus, sendUbl } from "../adapters/scrada.js";
import type { ApAdapter, ApDeliveryStatus, ApSendResult } from "./types.js";

const QUEUED_STATUSES = new Set(["QUEUED", "PENDING", "RECEIVED", "PROCESSING"]);
const SENT_STATUSES = new Set(["SENT", "SENT_TO_PEPPOL", "DISPATCHED"]);
const DELIVERED_STATUSES = new Set([
  "DELIVERED",
  "DELIVERY_CONFIRMED",
  "ACCEPTED",
  "COMPLETED",
  "SUCCESS"
]);

function normalizeStatus(status: string | undefined): string {
  return status?.toUpperCase().replace(/\s+/g, "_") ?? "";
}

function mapScradaStatus(status: string | undefined): ApDeliveryStatus {
  const normalized = normalizeStatus(status);
  if (DELIVERED_STATUSES.has(normalized)) {
    return "delivered";
  }
  if (SENT_STATUSES.has(normalized)) {
    return "sent";
  }
  if (QUEUED_STATUSES.has(normalized)) {
    return "queued";
  }
  return "error";
}

export const scradaAdapter: ApAdapter = {
  name: "scrada",
  async send({ ublXml, invoiceId }): Promise<ApSendResult> {
    const response = await sendUbl(ublXml, { externalReference: invoiceId });
    return {
      providerId: response.documentId,
      status: "queued"
    };
  },
  async getStatus(providerId: string): Promise<ApDeliveryStatus> {
    const info = await getOutboundStatus(providerId);
    const status = mapScradaStatus(info.status);
    if (status === "error") {
      return "error";
    }
    return status;
  }
};
