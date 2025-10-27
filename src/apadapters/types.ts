export type ApSendStatus = "queued" | "sent" | "error";

export type ApDeliveryStatus = "queued" | "sent" | "delivered" | "error";

type Order = import("../peppol/convert.js").Order;

export interface ApSendResult {
  providerId: string;
  status: ApSendStatus;
  message?: string;
}

export interface ApSendParams {
  tenant: string;
  invoiceId: string;
  ublXml: string;
  order?: Order;
}

export interface ApAdapter {
  name: string;
  send(params: ApSendParams): Promise<ApSendResult>;
  getStatus(providerId: string): Promise<ApDeliveryStatus>;
}
