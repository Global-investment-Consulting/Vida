import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const normalizeBoolean = (value, defaultValue = false) => {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const normalizeNumber = (value, defaultValue) => {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
};

const normalizeCsv = (value) =>
  String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const resolveDir = (value, fallback) => (value ? path.resolve(value) : fallback);

export const VIDA_API_KEYS = normalizeCsv(process.env.VIDA_API_KEYS);
export const PORT = normalizeNumber(process.env.PORT, 3001);
export const NODE_ENV = process.env.NODE_ENV ?? "development";
export const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

export const getVidaApiKeys = () => normalizeCsv(process.env.VIDA_API_KEYS);
export const isUblValidationEnabled = () => normalizeBoolean(process.env.VIDA_VALIDATE_UBL);
export const isPeppolSendEnabled = () => normalizeBoolean(process.env.VIDA_PEPPOL_SEND);
export const resolvePeppolApMode = () => (process.env.VIDA_PEPPOL_AP ?? "stub").toLowerCase();
export const resolvePeppolOutboxDir = () =>
  resolveDir(
    process.env.VIDA_PEPPOL_OUTBOX_DIR,
    path.resolve(process.cwd(), "data", "ap-outbox")
  );
export const resolveHistoryDir = () =>
  resolveDir(process.env.VIDA_HISTORY_DIR, path.resolve(process.cwd(), "data", "history"));
export const resolveInvoiceRequestLogDir = () =>
  resolveDir(
    process.env.VIDA_INVOICE_REQUEST_LOG_DIR,
    path.resolve(process.cwd(), "data", "invoice-requests")
  );
export const resolveInvoiceStatusDir = () =>
  resolveDir(
    process.env.VIDA_INVOICE_STATUS_DIR,
    path.resolve(process.cwd(), "data", "invoice-status")
  );
export const resolveDlqPath = () =>
  process.env.VIDA_DLQ_PATH
    ? path.resolve(process.env.VIDA_DLQ_PATH)
    : path.resolve(process.cwd(), "data", "dlq.jsonl");
export const resolveApAdapterName = () =>
  (process.env.VIDA_AP_ADAPTER ?? "mock").trim().toLowerCase();
export const isApSendOnCreateEnabled = () =>
  normalizeBoolean(process.env.VIDA_AP_SEND_ON_CREATE, false);
export const resolveApWebhookSecret = () => {
  const secret = process.env.AP_WEBHOOK_SECRET;
  if (!secret) {
    return undefined;
  }
  const trimmed = String(secret).trim();
  return trimmed.length > 0 ? trimmed : undefined;
};
