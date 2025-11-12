import { loadHistoryJson } from "../lib/history.js";
import type { InvoiceDTO } from "../types/public.js";
import { submitInvoiceFromDto, type InvoiceSubmissionContext, type InvoiceSubmissionResult } from "../routes/invoicesV0.js";

type RequestArtifact = {
  payload: InvoiceDTO;
};

export async function resendInvoiceFromHistory(
  invoiceId: string,
  context: InvoiceSubmissionContext
): Promise<InvoiceSubmissionResult> {
  const history = await loadHistoryJson<RequestArtifact>(invoiceId, "request");
  if (!history?.payload) {
    throw new Error(`request payload unavailable for invoice ${invoiceId}`);
  }
  return submitInvoiceFromDto(history.payload, context);
}
