import {
  getOutboundStatus,
  sendInvoiceWithFallback,
  type ScradaSendAttempt,
  type ScradaSendResult
} from "../../apps/api/src/adapters/scrada.js";
import type { ScradaOutboundInfo } from "../../apps/api/src/types/scrada.js";

export type ScradaSendPayload = {
  invoiceId: string;
  externalReference?: string;
};

export async function sendInvoiceThroughScrada(payload: ScradaSendPayload): Promise<ScradaSendResult> {
  return sendInvoiceWithFallback({
    invoiceId: payload.invoiceId,
    externalReference: payload.externalReference
  });
}

export async function fetchScradaStatus(documentId: string): Promise<ScradaOutboundInfo> {
  return getOutboundStatus(documentId);
}

export type { ScradaSendResult, ScradaOutboundInfo, ScradaSendAttempt };
