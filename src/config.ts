import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const normalizeBoolean = (value: string | undefined, defaultValue = false): boolean => {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const normalizeNumber = (value: string | undefined, defaultValue: number): number => {
  if (!value) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
};

const normalizeCsv = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const resolveDir = (value: string | undefined, fallback: string): string =>
  value ? path.resolve(value) : fallback;

export const VIDA_API_KEYS = normalizeCsv(process.env.VIDA_API_KEYS); // migrated
export const PORT = normalizeNumber(process.env.PORT, 3001); // migrated
export const NODE_ENV = process.env.NODE_ENV ?? "development"; // migrated
export const LOG_LEVEL = process.env.LOG_LEVEL ?? "info"; // migrated

export const getVidaApiKeys = (): string[] => normalizeCsv(process.env.VIDA_API_KEYS); // migrated
export const isUblValidationEnabled = (): boolean => normalizeBoolean(process.env.VIDA_VALIDATE_UBL); // migrated
export const isPeppolSendEnabled = (): boolean => normalizeBoolean(process.env.VIDA_PEPPOL_SEND); // migrated
export const resolvePeppolApMode = (): string => (process.env.VIDA_PEPPOL_AP ?? "stub").toLowerCase(); // migrated
export const resolvePeppolOutboxDir = (): string =>
  resolveDir(process.env.VIDA_PEPPOL_OUTBOX_DIR, path.resolve(process.cwd(), "data", "ap-outbox")); // migrated
export const resolveHistoryDir = (): string =>
  resolveDir(process.env.VIDA_HISTORY_DIR, path.resolve(process.cwd(), "data", "history")); // migrated
export const resolveInvoiceRequestLogDir = (): string =>
  resolveDir(
    process.env.VIDA_INVOICE_REQUEST_LOG_DIR,
    path.resolve(process.cwd(), "data", "invoice-requests")
  ); // migrated
