export type ApSendStatus = "queued" | "sent" | "error";

export type ApDeliveryStatus = "queued" | "sent" | "delivered" | "error";

export interface ApSendResult {
  providerId: string;
  status: ApSendStatus;
  message?: string;
}

export interface ApAdapter {
  name: string;
  send(params: { tenant: string; invoiceId: string; ublXml: string }): Promise<ApSendResult>;
  getStatus(providerId: string): Promise<ApDeliveryStatus>;
}
