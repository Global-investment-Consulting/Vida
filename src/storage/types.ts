import type { ApDeliveryStatus } from "../apadapters/types.js";

export type InvoiceHistoryEntry = {
  requestId: string;
  timestamp: string;
  source?: string;
  orderNumber?: string;
  originalOrderId?: string | number;
  tenantId?: string;
  status: "ok" | "error";
  invoiceId?: string;
  invoicePath?: string;
  durationMs: number;
  error?: string;
  peppolStatus?: string;
  peppolId?: string;
  validationErrors?: { path: string; msg: string }[];
};

export type InvoiceStatusValue = {
  tenant: string;
  invoiceId: string;
  providerId?: string;
  status: ApDeliveryStatus;
  attempts: number;
  lastError?: string;
  updatedAt: string;
};

export type DlqItem = {
  tenant: string;
  invoiceId: string;
  error: string;
  payload?: unknown;
  ts: string;
};

export interface InvoiceHistoryStore {
  append(entry: InvoiceHistoryEntry): Promise<void>;
  list(tenant: string, limit?: number): Promise<InvoiceHistoryEntry[]>;
}

export interface StatusStore {
  get(tenant: string, invoiceId: string): Promise<InvoiceStatusValue | null>;
  set(
    tenant: string,
    invoiceId: string,
    value: {
      status: ApDeliveryStatus;
      providerId?: string;
      attempts?: number;
      lastError?: string;
      updatedAt: string;
    }
  ): Promise<void>;
  snapshot?(): Promise<InvoiceStatusValue[]>;
}

export interface DlqStore {
  append(item: DlqItem): Promise<void>;
  count?(): Promise<number>;
}

export interface StorageBundle {
  history: InvoiceHistoryStore;
  status: StatusStore;
  dlq: DlqStore;
}
