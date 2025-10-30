import type { Order } from "../peppol/convert.js";

export type ApAdapterName = "mock" | "mock_error" | "banqup" | "billit";

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
  name: ApAdapterName;
  send(params: ApSendParams): Promise<ApSendResult>;
  getStatus(providerId: string): Promise<ApDeliveryStatus>;
}

export type ApProviderLifecycle = "available" | "stub" | "deprecated";

export interface ApProviderMetadata {
  name: ApAdapterName;
  label: string;
  status: ApProviderLifecycle;
  description?: string;
}

export const apProviderCatalog: Record<ApAdapterName, ApProviderMetadata> = {
  mock: {
    name: "mock",
    label: "Mock (default)",
    status: "available",
    description: "In-memory adapter used for local development and CI."
  },
  mock_error: {
    name: "mock_error",
    label: "Mock (error)",
    status: "available",
    description: "Deterministic mock that always fails for resilience testing."
  },
  banqup: {
    name: "banqup",
    label: "Banqup",
    status: "stub",
    description: "Placeholder integration; awaiting credentials and shared contract."
  },
  billit: {
    name: "billit",
    label: "Billit",
    status: "available",
    description: "Production adapter backed by the Billit API."
  }
};

export const apProviderList = Object.freeze(Object.values(apProviderCatalog));
