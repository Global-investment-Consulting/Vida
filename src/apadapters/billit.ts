import process from "node:process";
import { type ApAdapter, type ApDeliveryStatus, type ApSendResult } from "./types.js";

type BillitConfig = {
  baseUrl: string;
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
};

type OAuthTokenCache = {
  accessToken: string;
  tokenType: string;
  expiresAt: number;
  baseUrl: string;
  clientId: string;
};

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number | string;
};

const ADAPTER_NAME = "billit";
const TOKEN_SAFETY_WINDOW_MS = 30_000;
const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
let cachedToken: OAuthTokenCache | undefined;

function resolveConfig(): BillitConfig {
  const baseUrl = process.env.AP_BASE_URL?.trim();
  const apiKey = process.env.AP_API_KEY?.trim();
  const clientId = process.env.AP_CLIENT_ID?.trim();
  const clientSecret = process.env.AP_CLIENT_SECRET?.trim();

  if (!baseUrl) {
    throw new Error("AP_BASE_URL must be configured for the Billit AP adapter");
  }

  if (!apiKey && (!clientId || !clientSecret)) {
    throw new Error("Billit AP adapter requires AP_API_KEY or both AP_CLIENT_ID and AP_CLIENT_SECRET");
  }

  return {
    baseUrl,
    apiKey,
    clientId,
    clientSecret
  };
}

function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${normalizedBase}/${normalizedPath}`;
}

async function resolveAuthHeader(config: BillitConfig): Promise<string> {
  if (config.apiKey) {
    return `Bearer ${config.apiKey}`;
  }
  const token = await getOAuthToken(config);
  const tokenType = token.tokenType.length > 0 ? token.tokenType : "Bearer";
  return `${tokenType} ${token.accessToken}`;
}

async function getOAuthToken(config: BillitConfig): Promise<OAuthTokenCache> {
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

  const tokenUrl = joinUrl(config.baseUrl, "oauth/token"); // TODO: Confirm Billit OAuth endpoint path.
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
      `Billit OAuth token request failed (${response.status} ${response.statusText}): ${errorBody}`
    );
  }

  const json = (await parseJson(response)) as TokenResponse;
  const accessToken = json.access_token?.trim();
  if (!accessToken) {
    throw new Error("Billit OAuth token response did not include access_token");
  }
  const tokenType = (json.token_type ?? "Bearer").trim() || "Bearer";

  const expiresIn = normalizeExpires(json.expires_in);
  const expiresAt = Date.now() + (expiresIn ?? DEFAULT_TOKEN_TTL_MS);

  cachedToken = {
    accessToken,
    tokenType,
    expiresAt,
    baseUrl: config.baseUrl,
    clientId: config.clientId
  };

  return cachedToken;
}

function normalizeExpires(expires: number | string | undefined): number | undefined {
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

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text.length > 0 ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text || "<empty>";
  } catch (error) {
    return `failed to read body: ${(error as Error)?.message ?? "unknown error"}`;
  }
}

type ProviderResponse = {
  providerId: string;
  status: string | undefined;
  message?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function extractProviderResponse(payload: unknown): ProviderResponse {
  if (payload && typeof payload === "object") {
    const candidate = payload as Record<string, unknown>;
    const nested = asRecord(candidate.data) ?? asRecord(candidate.payload);
    const invoiceRecord = asRecord(candidate.invoice);

    const providerId =
      pickString(candidate.providerId) ??
      pickString(candidate.id) ??
      pickString(candidate.invoiceId) ??
      (nested && (pickString(nested.providerId) ?? pickString(nested.id))) ??
      (invoiceRecord && (pickString(invoiceRecord.providerId) ?? pickString(invoiceRecord.id)));

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
      (invoiceRecord && (pickString(invoiceRecord.message) ?? pickString(invoiceRecord.error)));

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

function pickString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function mapProviderSendStatus(status: string | undefined): ApSendResult["status"] {
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

function mapProviderDeliveryStatus(status: string | undefined): ApDeliveryStatus {
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

export const billitAdapter: ApAdapter = {
  name: ADAPTER_NAME,
  async send({ tenant, invoiceId, ublXml }): Promise<ApSendResult> {
    const config = resolveConfig();
    const authHeader = await resolveAuthHeader(config);
    const targetUrl = joinUrl(config.baseUrl, "api/invoices"); // TODO: Confirm Billit invoice endpoint path.

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/xml",
        Accept: "application/json"
      },
      body: ublXml // TODO: Confirm if Billit requires multipart/form-data payload.
    });

    if (!response.ok) {
      const errorBody = await safeReadBody(response);
      throw new Error(
        `Billit send failed (${response.status} ${response.statusText}) invoice=${invoiceId} tenant=${tenant}: ${errorBody}`
      );
    }

    const payload = extractProviderResponse(await parseJson(response));
    const status = mapProviderSendStatus(payload.status);

    return {
      providerId: payload.providerId,
      status,
      message: payload.message
    };
  },
  async getStatus(providerId: string): Promise<ApDeliveryStatus> {
    const config = resolveConfig();
    const authHeader = await resolveAuthHeader(config);
    const targetUrl = joinUrl(
      config.baseUrl,
      `api/invoices/${encodeURIComponent(providerId)}/status`
    ); // TODO: Confirm Billit status endpoint path.

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

    if (!response.ok) {
      const errorBody = await safeReadBody(response);
      throw new Error(
        `Billit status lookup failed (${response.status} ${response.statusText}) providerId=${providerId}: ${errorBody}`
      );
    }

    const payload = extractProviderResponse(await parseJson(response));
    return mapProviderDeliveryStatus(payload.status);
  }
};

export function resetBillitAuthCache(): void {
  cachedToken = undefined;
}
