import { randomUUID } from "node:crypto";
import process from "node:process";

import type { Order } from "../peppol/convert.js";
import type { ApAdapter, ApDeliveryStatus, ApSendResult } from "./types.js";

type BillitEnvironment = "sandbox" | "production";

type BillitBaseConfig = {
  baseUrl: string;
  environment: BillitEnvironment;
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  partyId?: string;
  contextPartyId?: string;
  registrationId?: string;
  transportType: string;
};

type OAuthTokenCache = {
  accessToken: string;
  tokenType: string;
  expiresAt: number;
  baseUrl: string;
  clientId: string;
};

type CachedRegistration = {
  baseUrl: string;
  partyId?: string;
  registrationId: string;
  fetchedAt: number;
};

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number | string;
};

type ProviderResponse = {
  providerId: string;
  status?: string;
  message?: string;
};

type AuthHeaders = {
  headers: Record<string, string>;
  mode: "api-key" | "oauth";
};

const ADAPTER_NAME = "billit";
const SANDBOX_BASE_URL = "https://api.sandbox.billit.be";
const PRODUCTION_BASE_URL = "https://api.billit.be";
const TOKEN_SAFETY_WINDOW_MS = 30_000;
const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1_000;
const REGISTRATION_CACHE_TTL_MS = 15 * 60 * 1_000;

let cachedToken: OAuthTokenCache | undefined;
let cachedRegistration: CachedRegistration | undefined;

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function resolveEnvironment(baseUrlHint: string | undefined): BillitEnvironment {
  if (baseUrlHint?.includes("sandbox")) {
    return "sandbox";
  }
  const envHint =
    readEnv("BILLIT_ENV") ??
    readEnv("AP_ENVIRONMENT") ??
    readEnv("AP_ENV") ??
    readEnv("VIDA_AP_ENV") ??
    "";
  const normalized = envHint.trim().toLowerCase();
  if (normalized.includes("prod") || normalized.includes("live")) {
    return "production";
  }
  if (normalized.includes("sandbox") || normalized.includes("test") || normalized === "sb") {
    return "sandbox";
  }
  const sandboxFlag =
    normalizeBoolean(process.env.BILLIT_SANDBOX) ??
    normalizeBoolean(process.env.AP_SANDBOX) ??
    normalizeBoolean(process.env.VIDA_AP_SANDBOX);
  if (sandboxFlag === true) {
    return "sandbox";
  }
  if (sandboxFlag === false) {
    return "production";
  }
  const nodeEnv = readEnv("NODE_ENV")?.toLowerCase();
  if (nodeEnv === "production" || nodeEnv === "prod") {
    return "production";
  }
  return "sandbox";
}

function normalizeTransportType(value: string | undefined): string {
  if (!value) {
    return "Peppol";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "Peppol";
  }
  const lower = trimmed.toLowerCase();
  if (lower === "peppol") {
    return "Peppol";
  }
  if (lower === "smtp") {
    return "SMTP";
  }
  if (lower === "letter") {
    return "Letter";
  }
  if (lower === "sdi") {
    return "SDI";
  }
  return trimmed;
}

function resolveBaseUrl(): { url: string; environment: BillitEnvironment } {
  const explicit = readEnv("AP_BASE_URL") ?? readEnv("BILLIT_BASE_URL");
  const environment = resolveEnvironment(explicit);
  const raw = explicit ?? (environment === "sandbox" ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL);
  const trimmed = raw.replace(/\/+$/, "");
  const url = trimmed.replace(/\/api\/?$/i, "");
  return { url, environment };
}

function resolveConfig(): BillitBaseConfig {
  const base = resolveBaseUrl();
  const apiKey = readEnv("AP_API_KEY") ?? readEnv("BILLIT_API_KEY");
  const clientId = readEnv("AP_CLIENT_ID") ?? readEnv("BILLIT_CLIENT_ID");
  const clientSecret = readEnv("AP_CLIENT_SECRET") ?? readEnv("BILLIT_CLIENT_SECRET");

  if (!apiKey && (!clientId || !clientSecret)) {
    throw new Error("Billit AP adapter requires AP_API_KEY or both AP_CLIENT_ID and AP_CLIENT_SECRET");
  }

  const registrationId =
    readEnv("AP_REGISTRATION_ID") ?? readEnv("BILLIT_REGISTRATION_ID") ?? readEnv("AP_PARTY_ID");
  const partyId = readEnv("AP_PARTY_ID") ?? readEnv("BILLIT_PARTY_ID") ?? registrationId;
  const contextPartyId = readEnv("AP_CONTEXT_PARTY_ID") ?? readEnv("BILLIT_CONTEXT_PARTY_ID");
  const transportType = normalizeTransportType(
    readEnv("AP_TRANSPORT_TYPE") ?? readEnv("BILLIT_TRANSPORT_TYPE")
  );

  return {
    baseUrl: base.url,
    environment: base.environment,
    apiKey,
    clientId,
    clientSecret,
    registrationId: registrationId?.trim(),
    partyId: partyId?.trim(),
    contextPartyId: contextPartyId?.trim(),
    transportType
  };
}

function joinUrl(base: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${base.replace(/\/+$/, "")}/${normalizedPath}`;
}

async function resolveAuthHeaders(config: BillitBaseConfig): Promise<AuthHeaders> {
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers.ApiKey = config.apiKey;
    appendPartyHeaders(headers, config);
    return { headers, mode: "api-key" };
  }

  const token = await getOAuthToken(config);
  const scheme = token.tokenType && token.tokenType.length > 0 ? token.tokenType : "Bearer";
  headers.Authorization = `${scheme} ${token.accessToken}`;
  appendPartyHeaders(headers, config);
  return { headers, mode: "oauth" };
}

function appendPartyHeaders(headers: Record<string, string>, config: BillitBaseConfig): void {
  if (config.partyId) {
    headers.PartyID = config.partyId;
  }
  if (config.contextPartyId) {
    headers.ContextPartyID = config.contextPartyId;
  }
}

async function getOAuthToken(config: BillitBaseConfig): Promise<OAuthTokenCache> {
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
    throw new Error(`Billit OAuth token request failed (${response.status} ${response.statusText}): ${errorBody}`);
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

async function resolveRegistrationId(config: BillitBaseConfig, auth: AuthHeaders): Promise<string> {
  const now = Date.now();

  if (config.registrationId) {
    const trimmed = config.registrationId.trim();
    if (!trimmed) {
      throw new Error("AP_REGISTRATION_ID cannot be empty");
    }
    cachedRegistration = {
      baseUrl: config.baseUrl,
      partyId: config.partyId,
      registrationId: trimmed,
      fetchedAt: now
    };
    return trimmed;
  }

  if (
    cachedRegistration &&
    cachedRegistration.baseUrl === config.baseUrl &&
    cachedRegistration.partyId === (config.partyId ?? undefined) &&
    now - cachedRegistration.fetchedAt < REGISTRATION_CACHE_TTL_MS
  ) {
    return cachedRegistration.registrationId;
  }

  const url = joinUrl(config.baseUrl, "v1/einvoices/registrations");
  const response = await fetch(url, {
    method: "GET",
    headers: {
      ...auth.headers,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const errorBody = await safeReadBody(response);
    throw new Error(
      `Billit registrations lookup failed (${response.status} ${response.statusText}): ${errorBody}`
    );
  }

  const payload = await parseJson(response);
  const registrationId = extractRegistrationId(payload, config.partyId, config.transportType);
  if (!registrationId) {
    throw new Error(
      "Unable to determine Billit registration id. Provide AP_REGISTRATION_ID or ensure the account has an active registration."
    );
  }

  cachedRegistration = {
    baseUrl: config.baseUrl,
    partyId: config.partyId,
    registrationId,
    fetchedAt: now
  };

  return registrationId;
}

function extractRegistrationId(
  payload: unknown,
  preferred: string | undefined,
  transportType: string
): string | undefined {
  const root = asRecord(payload);
  if (!root) {
    return undefined;
  }

  const direct = selectRegistrationId(root, preferred, transportType);
  if (direct) {
    return direct;
  }

  const collections: unknown[] = [];
  const collectionKeys = ["Companies", "companies", "Registrations", "registrations", "data", "items", "results"];
  for (const key of collectionKeys) {
    const value = root[key];
    if (Array.isArray(value)) {
      collections.push(...value);
    }
  }

  for (const entry of collections) {
    const candidate = selectRegistrationId(entry, preferred, transportType);
    if (candidate) {
      return candidate;
    }
  }

  for (const value of Object.values(root)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const candidate = selectRegistrationId(entry, preferred, transportType);
        if (candidate) {
          return candidate;
        }
      }
    }
  }

  return undefined;
}

function selectRegistrationId(
  entry: unknown,
  preferred: string | undefined,
  transportType: string
): string | undefined {
  const record = asRecord(entry);
  if (!record) {
    return undefined;
  }

  const ids = collectCandidateIds(record);
  if (preferred) {
    const normalized = preferred.trim();
    const match = ids.find((id) => id === normalized);
    if (match) {
      return match;
    }
  }

  const integrations = asArray(record.Integrations ?? record.integrations);
  if (integrations.length > 0) {
    const normalizedTransport = transportType.trim().toLowerCase();
    for (const integrationEntry of integrations) {
      const integration = asRecord(integrationEntry);
      if (!integration) {
        continue;
      }
      const integrationName = pickString(
        integration.Integration ??
          integration.integration ??
          integration.ExternalProvider ??
          integration.externalProvider ??
          integration.Provider ??
          integration.provider
      );
      if (integrationName && integrationName.trim().toLowerCase() === normalizedTransport) {
        if (ids.length > 0) {
          return ids[0];
        }
      }
    }
  }

  if (ids.length > 0) {
    return ids[0];
  }

  return undefined;
}

function collectCandidateIds(record: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  const keys = [
    "RegistrationID",
    "registrationID",
    "RegistrationId",
    "registrationId",
    "registration_id",
    "CompanyID",
    "companyID",
    "CompanyId",
    "companyId",
    "PartyID",
    "partyID",
    "PartyId",
    "partyId",
    "id",
    "ID"
  ];

  for (const key of keys) {
    const value = record[key];
    const id = pickId(value);
    if (id && !candidates.includes(id)) {
      candidates.push(id);
    }
  }

  return candidates;
}

function pickId(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pickString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  return undefined;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

async function safeReadBody(response: Response, parsed?: unknown): Promise<string> {
  if (parsed && typeof parsed === "object") {
    try {
      const serialized = JSON.stringify(parsed);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // fall through to raw read
    }
  }

  try {
    const text = await response.text();
    return text || "<empty>";
  } catch (error) {
    return `failed to read body: ${(error as Error)?.message ?? "unknown error"}`;
  }
}

function toAmount(minor: number, minorUnit: number): number {
  const divider = 10 ** minorUnit;
  return Number((minor / divider).toFixed(minorUnit));
}

function pruneEmpty<T extends Record<string, unknown>>(input: T): T {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }
      output[key] = trimmed;
      continue;
    }
    if (Array.isArray(value)) {
      const prunedArray = value
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return entry;
          }
          return pruneEmpty(entry as Record<string, unknown>);
        })
        .filter((entry) => {
          if (entry === undefined || entry === null) {
            return false;
          }
          if (typeof entry === "object" && Object.keys(entry as Record<string, unknown>).length === 0) {
            return false;
          }
          return true;
        });
      if (prunedArray.length === 0) {
        continue;
      }
      output[key] = prunedArray;
      continue;
    }
    if (typeof value === "object") {
      const nested = pruneEmpty(value as Record<string, unknown>);
      if (Object.keys(nested).length === 0) {
        continue;
      }
      output[key] = nested;
      continue;
    }
    output[key] = value;
  }

  return output as T;
}

function buildBillitSendPayload(
  order: Order,
  config: BillitBaseConfig,
  invoiceId: string,
  registrationId?: string
): Record<string, unknown> {
  const minorUnit = order.currencyMinorUnit ?? 2;
  const defaultVatRate = order.defaultVatRate ?? 0;
  const lines = order.lines.map((line, index) => {
    const unitPriceMinor = line.unitPriceMinor;
    const description = line.description ?? line.itemName ?? `Line ${index + 1}`;

    const entry: Record<string, unknown> = {
      description,
      quantity: line.quantity,
      unitPrice: toAmount(unitPriceMinor, minorUnit)
    };

    const vatRate = line.vatRate ?? defaultVatRate;
    if (vatRate !== undefined) {
      entry.vatRate = vatRate;
    }
    if (line.buyerAccountingReference) {
      entry.buyerReference = line.buyerAccountingReference;
    }
    return pruneEmpty(entry);
  });

  const document = pruneEmpty({
    invoiceNumber: order.orderNumber ?? invoiceId,
    buyer: pruneEmpty({
      name: order.buyer?.name
    }),
    seller: pruneEmpty({
      name: order.supplier?.name
    }),
    lines
  });

  const payload: {
    registrationId?: string;
    transportType: string;
    documents: Array<Record<string, unknown>>;
  } = {
    transportType: config.transportType ?? "Peppol",
    documents: [document]
  };

  if (registrationId) {
    payload.registrationId = registrationId;
  }

  return payload;
}

function buildIdempotencyKey(
  config: BillitBaseConfig,
  invoiceId: string,
  tenant?: string
): string {
  const parts = [config.environment, tenant?.trim() || "default", invoiceId];
  const raw = parts.join(":").replace(/\s+/g, "-").slice(0, 255);
  return raw || randomUUID();
}

function extractDocumentDeliveryStatus(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }

  const details =
    asRecord(record.CurrentDocumentDeliveryDetails ?? record.currentDocumentDeliveryDetails) ??
    asRecord(record.DocumentDeliveryDetails ?? record.documentDeliveryDetails);

  if (details) {
    return (
      pickString(
        details.DocumentDeliveryStatus ??
          details.documentDeliveryStatus ??
          details.Status ??
          details.status
      ) ??
      (details.IsDocumentDelivered ? "Delivered" : undefined)
    );
  }

  const fallbacks = ["order", "Order", "data", "payload", "result", "response"];
  for (const key of fallbacks) {
    const nested = record[key];
    if (nested) {
      const status = extractDocumentDeliveryStatus(nested);
      if (status) {
        return status;
      }
    }
  }

  return undefined;
}

function pickFirstError(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const record = asRecord(entry);
      if (record) {
        const message = pickString(
          record.Description ??
            record.description ??
            record.Detail ??
            record.detail ??
            record.Message ??
            record.message
        );
        if (message) {
          return message;
        }
      }
      const text = pickString(entry);
      if (text) {
        return text;
      }
    }
    return undefined;
  }
  const record = asRecord(value);
  if (record) {
    return (
      pickString(
        record.Description ?? record.description ?? record.Detail ?? record.detail ?? record.Message ?? record.message
      ) ?? undefined
    );
  }
  return pickString(value);
}

function extractProviderResponse(payload: unknown): ProviderResponse {
  const candidate = asRecord(payload);
  if (!candidate) {
    throw new Error("Billit response did not include a JSON object");
  }

  const nested =
    asRecord(candidate.data) ??
    asRecord(candidate.payload) ??
    asRecord(candidate.result) ??
    asRecord(candidate.response);

  const orderRecord =
    asRecord(candidate.order) ??
    asRecord(candidate.Order) ??
    (nested && (asRecord(nested.order) ?? asRecord(nested.Order)));

  const providerId =
    pickId(candidate.OrderID ?? candidate.orderID ?? candidate.orderId) ??
    pickId(orderRecord?.OrderID ?? orderRecord?.orderId) ??
    pickId(nested?.OrderID ?? nested?.orderId) ??
    pickId(candidate.providerId) ??
    pickId(candidate.id) ??
    pickId(orderRecord?.Id) ??
    pickId(nested?.id) ??
    extractOrderIdFromList(candidate.orders) ??
    extractOrderIdFromList(nested?.orders);

  if (!providerId) {
    throw new Error("Billit response did not include an order identifier");
  }

  const status =
    pickString(candidate.status ?? candidate.Status) ??
    pickString(orderRecord?.status ?? orderRecord?.Status) ??
    pickString(nested?.status ?? nested?.Status) ??
    extractDocumentDeliveryStatus(candidate) ??
    extractDocumentDeliveryStatus(orderRecord) ??
    extractDocumentDeliveryStatus(nested);

  const message =
    pickString(candidate.message ?? candidate.Message) ??
    pickString(candidate.detail ?? candidate.Detail) ??
    pickFirstError(candidate.errors ?? candidate.Errors) ??
    pickFirstError(orderRecord?.Errors ?? orderRecord?.errors) ??
    pickFirstError(nested?.Errors ?? nested?.errors);

  return {
    providerId,
    status,
    message
  };
}

function extractOrderIdFromList(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const id = pickId(record.OrderID ?? record.orderID ?? record.orderId ?? record.id ?? record.ID);
    if (id) {
      return id;
    }
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

type BillitSendParams = Parameters<ApAdapter["send"]>[0];

export const billitAdapter: ApAdapter = {
  name: ADAPTER_NAME,
  async send({ tenant, invoiceId, ublXml: _ignored, order }: BillitSendParams): Promise<ApSendResult> {
    if (!order) {
      throw new Error("Billit adapter requires order details to build the JSON payload");
    }

    const config = resolveConfig();
    const auth = await resolveAuthHeaders(config);
    const idempotencyKey = buildIdempotencyKey(config, invoiceId, tenant);
    const requestId = randomUUID();

    const baseHeaders: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-Request-ID": requestId,
      ...auth.headers
    };
    const configuredRegistration = config.registrationId?.trim() || undefined;
    const makeBody = (registration?: string) =>
      JSON.stringify(buildBillitSendPayload(order, config, invoiceId, registration));

    const sendOnce = async (path: string, body: string): Promise<Response> => {
      const url = joinUrl(config.baseUrl, path);
      return fetch(url, {
        method: "POST",
        headers: baseHeaders,
        body
      });
    };

    let response = await sendOnce("/v1/commands/send", makeBody(configuredRegistration));

    if (response.status === 404) {
      let fallbackRegistration = configuredRegistration;
      if (!fallbackRegistration) {
        try {
          fallbackRegistration = await resolveRegistrationId(config, auth);
        } catch {
          fallbackRegistration = undefined;
        }
      }
      if (fallbackRegistration) {
        response = await sendOnce(
          `/v1/einvoices/registrations/${encodeURIComponent(fallbackRegistration)}/commands/send`,
          makeBody(fallbackRegistration)
        );
      }
    }

    const parsed = await parseJson(response);

    if (!response.ok) {
      const errorBody = await safeReadBody(response, parsed);
      throw new Error(
        `Billit send failed (${response.status} ${response.statusText}) invoice=${invoiceId} tenant=${tenant ?? "default"}: ${errorBody}`
      );
    }

    const provider = extractProviderResponse(parsed);
    const status = mapProviderSendStatus(provider.status);

    return {
      providerId: provider.providerId,
      status,
      message: provider.message
    };
  },
  async getStatus(providerId: string): Promise<ApDeliveryStatus> {
    const config = resolveConfig();
    const auth = await resolveAuthHeaders(config);
    const registrationId = await resolveRegistrationId(config, auth);
    const targetUrl = joinUrl(
      config.baseUrl,
      `/v1/einvoices/registrations/${encodeURIComponent(registrationId)}/orders/${encodeURIComponent(providerId)}`
    );

    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        ...auth.headers,
        Accept: "application/json"
      }
    });

    const parsed = await parseJson(response);

    if (response.status === 404) {
      return "error";
    }

    if (!response.ok) {
      const errorBody = await safeReadBody(response, parsed);
      throw new Error(
        `Billit status lookup failed (${response.status} ${response.statusText}) providerId=${providerId}: ${errorBody}`
      );
    }

    const provider = extractProviderResponse(parsed);
    const directStatus = mapProviderDeliveryStatus(provider.status);
    if (directStatus !== "queued") {
      return directStatus;
    }

    const deliveryStatus = extractDocumentDeliveryStatus(parsed);
    return mapProviderDeliveryStatus(deliveryStatus);
  }
};

export function resetBillitAuthCache(): void {
  cachedToken = undefined;
  cachedRegistration = undefined;
}
