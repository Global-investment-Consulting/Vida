import { getAdapter } from "../apadapters/index.js";
import { type ApAdapter, type ApDeliveryStatus } from "../apadapters/types.js";
import { resolveApAdapterName } from "../config.js";
import { setInvoiceStatus } from "../history/invoiceStatus.js";
import { getStorage } from "../storage/index.js";
import type { Order } from "../peppol/convert.js";
import {
  incrementApSendAttempts,
  incrementApSendFail,
  incrementApSendSuccess
} from "../metrics.js";

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 200;

async function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function appendDlq(entry: {
  tenant: string | undefined;
  invoiceId: string;
  error: string;
  payload?: unknown;
}): Promise<void> {
  const storage = getStorage();
  await storage.dlq.append({
    tenant: entry.tenant?.trim() && entry.tenant.trim().length > 0 ? entry.tenant.trim() : "__default__",
    invoiceId: entry.invoiceId,
    error: entry.error,
    payload: entry.payload,
    ts: new Date().toISOString()
  });
}

type SendParams = {
  tenant?: string;
  invoiceId: string;
  ublXml: string;
  requestId: string;
  adapterName?: string;
  logger?: Pick<typeof console, "info" | "error">;
  order?: Order;
};

export async function sendWithRetry(params: SendParams): Promise<void> {
  const adapter = resolveAdapter(params.adapterName);
  const tenant = params.tenant?.trim() || undefined;
  const { invoiceId, ublXml, requestId, order } = params;
  const logger = params.logger ?? console;
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    incrementApSendAttempts();
    try {
      logger.info(
        `[ap/send] requestId=${requestId} tenant=${tenant ?? "unknown"} invoiceId=${invoiceId} attempt=${attempt} adapter=${adapter.name}`
      );

      const result = await adapter.send({
        tenant: tenant ?? "default",
        invoiceId,
        ublXml,
        order
      });

      await setInvoiceStatus({
        tenant,
        invoiceId,
        providerId: result.providerId,
        status: mapSendStatus(result.status),
        attempts: attempt,
        lastError: result.message
      });

      logger.info(
        `[ap/send] requestId=${requestId} tenant=${tenant ?? "unknown"} invoiceId=${invoiceId} providerId=${result.providerId} status=${result.status}`
      );

      if (result.status === "error") {
        lastError = result.message ?? "Adapter returned error status";
        throw new Error(lastError);
      }

      incrementApSendSuccess();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown adapter error";
      logger.error(
        `[ap/send] requestId=${requestId} tenant=${tenant ?? "unknown"} invoiceId=${invoiceId} attempt=${attempt} adapter=${adapter.name} status=ERROR message="${lastError}"`
      );
      await setInvoiceStatus({
        tenant,
        invoiceId,
        status: "error",
        attempts: attempt,
        lastError
      });

      if (attempt === MAX_ATTEMPTS) {
        incrementApSendFail();
        await appendDlq({
          tenant,
          invoiceId,
          error: lastError
        });
        throw error instanceof Error ? error : new Error(lastError);
      }

      const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      await wait(backoff);
    }
  }
}

function resolveAdapter(name?: string): ApAdapter {
  const resolvedName = name ?? resolveApAdapterName();
  return getAdapter(resolvedName);
}

function mapSendStatus(status: ApDeliveryStatus | "sent" | "queued" | "delivered" | "error"): ApDeliveryStatus {
  if (status === "queued" || status === "sent" || status === "delivered" || status === "error") {
    return status;
  }
  return "queued";
}
