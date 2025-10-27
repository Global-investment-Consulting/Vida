// scripts/billit_send_smoke.mjs
// Manual sandbox smoke that performs a LIVE send against Billit.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { jsonToUblInvoice } from "../src/ubl/jsonToUbl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPORT_DIR = path.resolve(__dirname, "..", "reports");
const INVOICE_PATH = path.join(REPORT_DIR, "invoice.sb.json");
const REPORT_PATH = path.join(REPORT_DIR, "billit-sandbox-live.json");

const TOKEN_SAFETY_WINDOW_MS = 30_000;
const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
let cachedToken;

run().catch((error) => {
  console.error("Billit sandbox smoke failed:", error.message);
  process.exit(1);
});

async function run() {
  const report = {
    requestShape: {},
    response: undefined,
    poll: [],
    errors: []
  };

  try {
    ensureReportDir();
    const config = resolveConfig();
    const authHeader = await resolveAuthHeader(config);

    const invoiceDraft = loadInvoiceDraft();
    const normalizedInvoice = normalizeInvoice(invoiceDraft);
    const ublXml = jsonToUblInvoice(normalizedInvoice);

    const targetUrl = joinUrl(config.baseUrl, "api/invoices");
    console.log("Sending invoice to Billit sandbox…", sanitizeUrl(targetUrl));

    report.requestShape = {
      url: sanitizeUrl(targetUrl),
      method: "POST",
      headers: {
        Authorization: redactAuthHeader(authHeader),
        "Content-Type": "application/xml",
        Accept: "application/json"
      },
      bodyBytes: Buffer.byteLength(ublXml, "utf8"),
      invoiceNumber: normalizedInvoice.number
    };

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/xml",
        Accept: "application/json"
      },
      body: ublXml
    });

    const payload = await parseJson(response);

    if (!response.ok) {
      const errorBody = await safeReadBody(response, payload);
      throw new Error(
        `Billit send failed (${response.status} ${response.statusText}): ${errorBody}`
      );
    }

    const provider = extractProviderResponse(payload);
    const sendStatus = mapProviderSendStatus(provider.status);
    report.response = { id: provider.providerId, status: sendStatus };

    console.log(
      "Send response:",
      JSON.stringify(
        {
          id: provider.providerId,
          status: sendStatus,
          message: provider.message ?? null
        },
        null,
        2
      )
    );

    if (provider.providerId) {
      const pollDelays = [5_000, 15_000];
      for (const delay of pollDelays) {
        await sleep(delay);
        try {
          const pollStatus = await pollStatusOnce(config, provider.providerId);
          report.poll.push({ t: nowIso(), status: pollStatus });
          console.log("Poll status:", pollStatus);
          if (pollStatus === "delivered" || pollStatus === "error") {
            break;
          }
        } catch (pollError) {
          const message =
            pollError instanceof Error ? pollError.message : String(pollError);
          console.error("Status poll failed:", message);
          report.errors.push(`poll: ${message}`);
          report.poll.push({ t: nowIso(), status: "unknown" });
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.errors.push(message);
    if (!report.response) {
      report.response = { id: null, status: "error" };
    }
    throw error;
  } finally {
    if (report.errors && report.errors.length === 0) {
      delete report.errors;
    }
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  }
}

function ensureReportDir() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function resolveConfig() {
  const baseUrl = requireEnv("AP_BASE_URL");
  const apiKey = optionalEnv("AP_API_KEY");
  const clientId = optionalEnv("AP_CLIENT_ID");
  const clientSecret = optionalEnv("AP_CLIENT_SECRET");

  if (!apiKey && (!clientId || !clientSecret)) {
    throw new Error("AP_API_KEY or both AP_CLIENT_ID and AP_CLIENT_SECRET must be provided");
  }

  return {
    baseUrl,
    apiKey,
    clientId,
    clientSecret
  };
}

function requireEnv(name) {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optionalEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : undefined;
}

function sanitizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function redactAuthHeader(value) {
  if (!value) return value;
  const [scheme, token] = value.split(/\s+/, 2);
  if (!token) {
    return `${scheme ?? "Bearer"} ***`;
  }
  return `${scheme} ***redacted***`;
}

async function resolveAuthHeader(config) {
  if (config.apiKey) {
    return `Bearer ${config.apiKey}`;
  }
  const token = await getOAuthToken(config);
  const tokenType = token.tokenType.length > 0 ? token.tokenType : "Bearer";
  return `${tokenType} ${token.accessToken}`;
}

async function getOAuthToken(config) {
  if (!config.clientId || !config.clientSecret) {
    throw new Error("AP_CLIENT_ID and AP_CLIENT_SECRET are required when AP_API_KEY is not set");
  }

  if (
    cachedToken &&
    cachedToken.baseUrl === config.baseUrl &&
    cachedToken.clientId === config.clientId &&
    cachedToken.expiresAt > Date.now() + TOKEN_SAFETY_WINDOW_MS
  ) {
    return cachedToken;
  }

  const tokenUrl = joinUrl(config.baseUrl, "oauth/token");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: body.toString()
  });

  if (!response.ok) {
    const errorBody = await safeReadBody(response);
    throw new Error(
      `OAuth token request failed (${response.status} ${response.statusText}): ${errorBody}`
    );
  }

  const json = await parseJson(response);
  const accessToken = pickString(json?.access_token);
  if (!accessToken) {
    throw new Error("OAuth token response missing access_token");
  }
  const tokenType = pickString(json?.token_type) ?? "Bearer";
  const expiresAt = Date.now() + (normalizeExpires(json?.expires_in) ?? DEFAULT_TOKEN_TTL_MS);

  cachedToken = {
    accessToken,
    tokenType,
    expiresAt,
    baseUrl: config.baseUrl,
    clientId: config.clientId
  };

  return cachedToken;
}

async function pollStatusOnce(config, providerId) {
  const authHeader = await resolveAuthHeader(config);
  const targetUrl = joinUrl(config.baseUrl, `api/invoices/${encodeURIComponent(providerId)}/status`);

  const response = await fetch(targetUrl, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "application/json"
    }
  });

  if (response.status === 404) {
    return "error";
  }

  const payload = await parseJson(response);
  if (!response.ok) {
    const errorBody = await safeReadBody(response, payload);
    throw new Error(
      `Status check failed (${response.status} ${response.statusText}): ${errorBody}`
    );
  }

  const provider = extractProviderResponse(payload);
  return mapProviderDeliveryStatus(provider.status);
}

function joinUrl(base, suffix) {
  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = suffix.startsWith("/") ? suffix.slice(1) : suffix;
  return `${normalizedBase}/${normalizedPath}`;
}

function normalizeInvoice(draft) {
  const now = Date.now();
  const number = `SB-LIVE-${now}`;

  const lines = Array.isArray(draft.lines) ? draft.lines : [];
  const normalizedLines = lines.map((line, idx) => {
    const quantity = Number(line.qty ?? line.quantity ?? 1) || 1;
    const price = Number(line.price ?? line.unitPrice ?? 0);
    return {
      description: line.desc ?? line.description ?? `Line ${idx + 1}`,
      quantity,
      unitPriceMinor: Math.round(price * 100)
    };
  });

  const totalMinor = normalizedLines.reduce(
    (sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPriceMinor || 0),
    0
  );

  return {
    id: draft.id ?? number,
    number,
    currency: draft.currency ?? "EUR",
    buyer: {
      name: draft.buyer?.name ?? "Sandbox Buyer",
      vatId: draft.buyer?.vatId
    },
    totalMinor,
    lines: normalizedLines
  };
}

function loadInvoiceDraft() {
  if (!fs.existsSync(INVOICE_PATH)) {
    throw new Error(`Missing invoice draft at ${INVOICE_PATH}`);
  }
  const raw = fs.readFileSync(INVOICE_PATH, "utf8");
  return JSON.parse(raw);
}

async function parseJson(response) {
  const text = await response.text();
  try {
    return text.length > 0 ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function safeReadBody(response, parsed) {
  if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
    try {
      return JSON.stringify(parsed);
    } catch {
      // fall back to text
    }
  }
  try {
    const text = await response.text();
    return text || "<empty>";
  } catch (error) {
    return `failed to read body: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function pickString(value) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function normalizeExpires(expires) {
  if (typeof expires === "number" && Number.isFinite(expires)) {
    return expires * 1000;
  }
  if (typeof expires === "string") {
    const parsed = Number.parseInt(expires, 10);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed * 1000;
    }
  }
  return undefined;
}

function extractProviderResponse(payload) {
  if (payload && typeof payload === "object") {
    const candidate = payload;
    const nested = asRecord(candidate.data) ?? asRecord(candidate.payload);
    const invoiceRecord = asRecord(candidate.invoice);

    const providerId =
      pickString(candidate.providerId) ??
      pickString(candidate.id) ??
      pickString(candidate.invoiceId) ??
      (nested && (pickString(nested.providerId) ?? pickString(nested.id))) ??
      (invoiceRecord &&
        (pickString(invoiceRecord.providerId) ?? pickString(invoiceRecord.id)));

    const status =
      pickString(candidate.status) ??
      pickString(candidate.state) ??
      pickString(candidate.integrationStatus) ??
      (nested && (pickString(nested.status) ?? pickString(nested.state)));

    const message =
      pickString(candidate.message) ??
      pickString(candidate.error) ??
      pickString(candidate.detail) ??
      (nested && (pickString(nested.message) ?? pickString(nested.error))) ??
      (invoiceRecord &&
        (pickString(invoiceRecord.message) ?? pickString(invoiceRecord.error)));

    if (providerId) {
      return {
        providerId,
        status,
        message
      };
    }
  }

  throw new Error("Billit response did not include a provider identifier");
}

function asRecord(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return undefined;
}

function mapProviderSendStatus(status) {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) {
    return "queued";
  }
  if (["queued", "pending", "processing", "received", "created", "accepted"].includes(normalized)) {
    return "queued";
  }
  if (["sent", "submitted", "transmitted", "completed", "processed", "success"].includes(normalized)) {
    return "sent";
  }
  if (["failed", "error", "rejected", "declined"].includes(normalized)) {
    return "error";
  }
  return "queued";
}

function mapProviderDeliveryStatus(status) {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) {
    return "queued";
  }
  if (["queued", "pending", "processing", "received", "accepted"].includes(normalized)) {
    return "queued";
  }
  if (["sent", "submitted", "transmitted"].includes(normalized)) {
    return "sent";
  }
  if (["delivered", "completed", "processed", "success", "done"].includes(normalized)) {
    return "delivered";
  }
  if (["failed", "error", "rejected", "declined"].includes(normalized)) {
    return "error";
  }
  return "sent";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}
