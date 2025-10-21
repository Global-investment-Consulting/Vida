import { type ApAdapter, type ApDeliveryStatus, type ApSendResult } from "./types.js";

type InternalStatus = {
  status: ApDeliveryStatus;
  queuedAt: number;
};

const QUEUE_DELAY_MS = 250;
const statusStore = new Map<string, InternalStatus>();

function resolveStatus(providerId: string): InternalStatus | undefined {
  const entry = statusStore.get(providerId);
  if (!entry) {
    return undefined;
  }

  if (entry.status === "queued" && Date.now() - entry.queuedAt >= QUEUE_DELAY_MS) {
    entry.status = "delivered";
    entry.queuedAt = Date.now();
    statusStore.set(providerId, entry);
  }

  return entry;
}

export const mockAdapter: ApAdapter = {
  name: "mock",
  async send({ invoiceId }): Promise<ApSendResult> {
    const providerId = `mock-${invoiceId}`;
    statusStore.set(providerId, { status: "queued", queuedAt: Date.now() });
    return {
      providerId,
      status: "queued"
    };
  },
  async getStatus(providerId: string) {
    const entry = resolveStatus(providerId);
    return entry?.status ?? "error";
  }
};

export function __resetMockAdapter(): void {
  statusStore.clear();
}
