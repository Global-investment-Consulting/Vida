import type { Order } from "../peppol/convert.js";

export type ApSendStatus = "queued" | "sent" | "error";

export type ApDeliveryStatus = "queued" | "sent" | "delivered" | "error";

export interface ApSendParams {
  tenant: string;
  invoiceId: string;
  ublXml: string;
  order?: Order;
}

export interface ApSendResult {
  providerId: string;
  status: ApSendStatus;
  message?: string;
}

export interface ApAdapter {
  name: string;
  send(params: ApSendParams): Promise<ApSendResult>;
  getStatus(providerId: string): Promise<ApDeliveryStatus>;
}
