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

const normalizeAdapterName = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.toLowerCase();
};

const normalizeSecret = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const VIDA_API_KEYS = normalizeCsv(process.env.VIDA_API_KEYS); // migrated
export const PORT = normalizeNumber(process.env.PORT, 3001); // migrated
export const NODE_ENV = process.env.NODE_ENV ?? "development"; // migrated
export const LOG_LEVEL = process.env.LOG_LEVEL ?? "info"; // migrated
export const AP_PROVIDER = process.env.AP_PROVIDER ?? "";
export const AP_BASE_URL = process.env.AP_BASE_URL ?? "";
export const AP_CLIENT_ID = process.env.AP_CLIENT_ID ?? "";
export const AP_CLIENT_SECRET = process.env.AP_CLIENT_SECRET ?? "";
export const AP_API_KEY = process.env.AP_API_KEY ?? "";

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
export const resolveInvoiceStatusDir = (): string =>
  resolveDir(process.env.VIDA_INVOICE_STATUS_DIR, path.resolve(process.cwd(), "data", "invoice-status"));
export const resolveDlqPath = (): string =>
  process.env.VIDA_DLQ_PATH
    ? path.resolve(process.env.VIDA_DLQ_PATH)
    : path.resolve(process.cwd(), "data", "dlq.jsonl");
export const resolveApAdapterName = (): string =>
  normalizeAdapterName(process.env.VIDA_AP_ADAPTER) ?? "mock";
export const isApSendOnCreateEnabled = (): boolean =>
  normalizeBoolean(process.env.VIDA_AP_SEND_ON_CREATE, false);
export const resolveApWebhookSecret = (): string | undefined => {
  const secret = process.env.AP_WEBHOOK_SECRET;
  if (!secret) {
    return undefined;
  }
  const trimmed = secret.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};
export const resolvePublicApiKey = (): string | undefined => normalizeSecret(process.env.VIDA_PUBLIC_API_KEY);
export const resolveShopifyWebhookSecret = (): string | undefined =>
  normalizeSecret(process.env.SHOPIFY_WEBHOOK_SECRET);
export const VIDA_PUBLIC_RATE_LIMIT =
  Number.parseInt(process.env.VIDA_PUBLIC_RATE_LIMIT ?? "", 10) || 120;
export const VIDA_PUBLIC_RATE_LIMIT_WINDOW_MS =
  Number.parseInt(process.env.VIDA_PUBLIC_RATE_LIMIT_WINDOW_MS ?? "", 10) || 60000;
export const OPS_DASHBOARD_ENABLED = normalizeBoolean(process.env.OPS_DASHBOARD_ENABLED, false);
export const ADMIN_DASHBOARD_KEY = process.env.ADMIN_DASHBOARD_KEY ?? "";
export const OPS_DASHBOARD_IPS = (process.env.OPS_DASHBOARD_IPS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);

export type DashboardBasicCredentials = {
  username: string;
  password: string;
};

export const resolveDashboardBasicCredentials = (): DashboardBasicCredentials | null => {
  const username = normalizeSecret(process.env.DASHBOARD_ADMIN_USER);
  const password = normalizeSecret(process.env.DASHBOARD_ADMIN_PASS);
  if (!username || !password) {
    return null;
  }
  return { username, password };
};

export const isStagingEnv = (): boolean => (process.env.NODE_ENV ?? "").trim().toLowerCase() === "staging";
