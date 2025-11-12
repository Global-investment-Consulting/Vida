import type { Log } from "@google-cloud/logging";
import { Logging } from "@google-cloud/logging";

type LogLevel = "log" | "info" | "warn" | "error";

const SECRET_ENV_KEYS = [
  "VIDA_API_KEYS",
  "VIDA_PUBLIC_API_KEY",
  "VIDA_PUBLIC_API_KEYS",
  "AP_WEBHOOK_SECRET",
  "SHOPIFY_WEBHOOK_SECRET",
  "SHOPIFY_WEBHOOK_SECRET_PROD",
  "SCRADA_API_KEY",
  "SCRADA_API_PASSWORD",
  "GCP_SA_KEY",
  "GCP_SA_KEY_PROD",
  "JWT_SECRET",
  "JWT_SECRET_PROD",
  "VIDA_PROD_API_KEYS"
] as const;

let patched = false;
let logClient: Log | null = null;

export function isStackdriverEnabled(): boolean {
  return logClient !== null;
}

const levelSeverity: Record<LogLevel, string> = {
  log: "INFO",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR"
};

const redactTokens = buildRedactions();

function buildRedactions(): string[] {
  const values: string[] = [];
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      values.push(value.trim());
    }
  }
  return values;
}

function redactString(input: string): string {
  let output = input;
  for (const token of redactTokens) {
    const escaped = token.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    output = output.replace(new RegExp(escaped, "gi"), "[REDACTED]");
  }
  return output;
}

function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value as object)) {
      return "[Circular]";
    }
    seen.add(value as object);
    const clone: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      clone[key] = sanitizeValue(entry, seen);
    }
    return clone;
  }
  return value;
}

function maybeInitStackdriver(originalWarn: (...args: unknown[]) => void): void {
  if (logClient || process.env.VIDA_STACKDRIVER_ENABLED === "false") {
    return;
  }
  const projectId =
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.PROJECT_ID ||
    undefined;
  try {
    const logging = new Logging({ projectId });
    logClient = logging.log(process.env.VIDA_STACKDRIVER_LOG || "vida-app");
  } catch (error) {
    originalWarn("[logging] Stackdriver initialization skipped", error);
    logClient = null;
  }
}

function emitStackdriver(level: LogLevel, message: string, originalWarn: (...args: unknown[]) => void): void {
  if (!logClient) {
    return;
  }
  const metadata = {
    resource: { type: "global" },
    severity: levelSeverity[level] ?? "INFO"
  };
  try {
    const entry = logClient.entry(metadata, {
      message,
      timestamp: new Date().toISOString()
    });
    void logClient.write(entry);
  } catch (error) {
    originalWarn("[logging] failed to emit stackdriver entry", error);
  }
}

function formatMessage(args: unknown[]): string {
  return args
    .map((entry) => {
      if (typeof entry === "string") {
        return redactString(entry);
      }
      if (entry instanceof Error) {
        return `${entry.name}: ${redactString(entry.message)}${entry.stack ? `\n${redactString(entry.stack)}` : ""}`;
      }
      try {
        return redactString(JSON.stringify(entry));
      } catch {
        return "[Unserializable]";
      }
    })
    .join(" ");
}

function wrapConsole(method: LogLevel, original: (...args: unknown[]) => void, originalWarn: (...args: unknown[]) => void) {
  return (...args: unknown[]): void => {
    const sanitized = args.map((entry) => sanitizeValue(entry));
    const line = formatMessage(args);
    emitStackdriver(method, line, originalWarn);
    original(...sanitized);
  };
}

export function patchLogging(): void {
  if (patched) {
    return;
  }
  const originalWarn = console.warn.bind(console);
  maybeInitStackdriver(originalWarn);
  /* eslint-disable no-console */
  console.log = wrapConsole("log", console.log.bind(console), originalWarn);
  console.info = wrapConsole("info", console.info.bind(console), originalWarn);
  console.warn = wrapConsole("warn", originalWarn, originalWarn);
  console.error = wrapConsole("error", console.error.bind(console), originalWarn);
  /* eslint-enable no-console */
  patched = true;
}
