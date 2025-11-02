import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import axios from "axios";
import { getScradaClient } from "../lib/http.js";
import { buildBis30Ubl } from "../scrada/payload.js";
import type { PrepareOptions } from "../scrada/payload.js";
import type {
  RegisterCompanyInput,
  ScradaOutboundInfo,
  ScradaParticipantLookupResponse,
  ScradaParticipantLookupResult,
  ScradaSalesInvoice
} from "../types/scrada.js";

dotenv.config();

function requireCompanyId(): string {
  const raw = process.env.SCRADA_COMPANY_ID;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      "[scrada] Missing required environment variable SCRADA_COMPANY_ID. Add it to your environment (e.g. .env)."
    );
  }
  return raw.trim();
}

function companyPath(path: string): string {
  const companyId = requireCompanyId();
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `/company/${companyId}/${normalizedPath}`;
}

function serializeParams(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    search.append(key, String(value));
  }
  return search.toString();
}

function extractDocumentId(payload: unknown): string {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }
  if (payload && typeof payload === "object") {
    const candidate =
      (payload as Record<string, unknown>).documentId ??
      (payload as Record<string, unknown>).documentID ??
      (payload as Record<string, unknown>).id;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  throw new Error("[scrada] Response did not include a documentId");
}

function withExternalReference<T extends object>(body: T, externalReference: string | undefined): T {
  if (!externalReference) {
    return body;
  }
  return Object.assign({}, body, { externalReference }) as T;
}

interface ArtifactPaths {
  directory: string;
  json: string;
  error: string;
  ubl: string;
}

export interface SendSalesInvoiceOptions {
  externalReference?: string;
  artifactDir?: string;
  maskValues?: string[];
  ublOptions?: PrepareOptions;
}

export interface SendSalesInvoiceResult {
  documentId: string;
  deliveryPath: "json" | "ubl";
  fallback: {
    triggered: boolean;
    status: number | null;
    message: string | null;
  };
  artifacts: {
    json: string;
    error: string | null;
    ubl: string | null;
  };
  externalReference?: string;
}

function sanitizeArtifactSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]/g, "_");
  return sanitized.length > 0 ? sanitized.slice(0, 80) : `invoice-${Date.now()}`;
}

function relativeToCwd(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath);
  return relative || filePath;
}

async function resolveArtifactPaths(
  invoice: ScradaSalesInvoice,
  artifactDir?: string
): Promise<ArtifactPaths> {
  const baseDir = artifactDir ? path.resolve(artifactDir) : path.resolve(process.cwd(), "scrada-artifacts");
  const candidate = invoice.externalReference ?? invoice.id ?? `invoice-${Date.now()}`;
  const segment = `${sanitizeArtifactSegment(candidate)}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(baseDir, segment);
  await mkdir(directory, { recursive: true });
  return {
    directory,
    json: path.join(directory, "json-sent.json"),
    error: path.join(directory, "error-body.txt"),
    ubl: path.join(directory, "ubl-sent.xml")
  };
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function collectSensitiveValues(
  invoice: ScradaSalesInvoice,
  additional: string[] = []
): string[] {
  const collected = new Set(
    [
      process.env.SCRADA_API_KEY,
      process.env.SCRADA_API_PASSWORD,
      process.env.SCRADA_COMPANY_ID,
      process.env.SCRADA_WEBHOOK_SECRET,
      invoice?.seller?.vatNumber,
      invoice?.buyer?.vatNumber,
      invoice?.buyer?.endpointId as string | undefined,
      invoice?.seller?.endpointId as string | undefined,
      ...(additional ?? [])
    ].filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  return Array.from(collected);
}

function serializeErrorBody(body: unknown): string {
  if (!body) {
    return "";
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof Uint8Array) {
    try {
      return Buffer.from(body).toString("utf8");
    } catch {
      return "[binary-response]";
    }
  }
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

function maskScradaErrorBody(
  rawBody: unknown,
  invoice: ScradaSalesInvoice,
  additionalMasks: string[] = []
): string {
  let masked = serializeErrorBody(rawBody);
  for (const secret of collectSensitiveValues(invoice, additionalMasks)) {
    masked = masked.split(secret).join("***");
  }
  return masked;
}

function extractHttpStatus(error: unknown): number | null {
  if (!error) {
    return null;
  }
  if (typeof (error as { status?: number }).status === "number") {
    return (error as { status: number }).status;
  }
  if (axios.isAxiosError(error) && error.response) {
    return error.response.status ?? null;
  }
  if (error instanceof Error && error.cause) {
    return extractHttpStatus(error.cause);
  }
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { status?: number } }).response;
    if (response && typeof response.status === "number") {
      return response.status;
    }
  }
  return null;
}

function extractResponseData(error: unknown): unknown {
  if (!error) {
    return null;
  }
  if (axios.isAxiosError(error) && error.response) {
    return error.response.data;
  }
  if (error instanceof Error && error.cause) {
    return extractResponseData(error.cause);
  }
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: unknown } }).response;
    if (response && "data" in response) {
      return (response as { data?: unknown }).data;
    }
  }
  return null;
}

export async function sendSalesInvoiceJson(
  payload: ScradaSalesInvoice,
  opts: SendSalesInvoiceOptions = {}
): Promise<SendSalesInvoiceResult> {
  const endpoint = companyPath("peppol/outbound/salesInvoice");
  const requestBody = withExternalReference(payload, opts.externalReference);
  const artifacts = await resolveArtifactPaths(requestBody, opts.artifactDir);
  await writeJsonFile(artifacts.json, requestBody);

  try {
    const response = await getScradaClient().post(endpoint, requestBody, {
      headers: {
        "Content-Type": "application/json"
      }
    });

    return {
      documentId: extractDocumentId(response.data),
      deliveryPath: "json",
      fallback: {
        triggered: false,
        status: null,
        message: null
      },
      artifacts: {
        json: relativeToCwd(artifacts.json),
        error: null,
        ubl: null
      },
      externalReference: requestBody.externalReference
    };
  } catch (error) {
    const status = extractHttpStatus(error);
    if (status !== 400) {
      throw wrapAxiosError(error, "send sales invoice JSON");
    }

    const maskValues = Array.isArray(opts.maskValues) ? opts.maskValues : [];
    const responseBody = extractResponseData(error);
    const maskedError = maskScradaErrorBody(responseBody, requestBody, maskValues);
    await writeFile(artifacts.error, `${maskedError}\n`, "utf8");

    const ublPayload = buildBis30Ubl(requestBody, opts.ublOptions);
    await writeFile(artifacts.ubl, `${ublPayload}\n`, "utf8");

    const ublResult = await sendUbl(ublPayload, {
      externalReference: requestBody.externalReference
    });

    return {
      documentId: ublResult.documentId,
      deliveryPath: "ubl",
      fallback: {
        triggered: true,
        status,
        message: error instanceof Error ? error.message : String(error)
      },
      artifacts: {
        json: relativeToCwd(artifacts.json),
        error: relativeToCwd(artifacts.error),
        ubl: relativeToCwd(artifacts.ubl)
      },
      externalReference: requestBody.externalReference
    };
  }
}

export async function sendUbl(
  ublXml: string,
  opts?: { externalReference?: string }
): Promise<{ documentId: string }> {
  const path = companyPath("peppol/outbound/document");
  try {
    const response = await getScradaClient().post(path, ublXml, {
      headers: {
        "Content-Type": "application/xml"
      },
      params: opts?.externalReference ? { externalReference: opts.externalReference } : undefined
    });
    return { documentId: extractDocumentId(response.data) };
  } catch (error) {
    throw wrapAxiosError(error, "send UBL document");
  }
}

export async function getOutboundStatus(documentId: string): Promise<ScradaOutboundInfo> {
  const normalizedId = documentId.trim();
  if (!normalizedId) {
    throw new Error("[scrada] documentId is required");
  }
  const path = companyPath(`peppol/outbound/document/${encodeURIComponent(normalizedId)}/info`);
  try {
    const response = await getScradaClient().get<ScradaOutboundInfo>(path);
    const data = response.data;
    if (!data || typeof data !== "object") {
      throw new Error("[scrada] Unexpected response when fetching outbound status");
    }
    return data;
  } catch (error) {
    throw wrapAxiosError(error, "fetch outbound status");
  }
}

export async function getOutboundUbl(documentId: string): Promise<string> {
  const normalizedId = documentId.trim();
  if (!normalizedId) {
    throw new Error("[scrada] documentId is required");
  }
  const path = companyPath(`peppol/outbound/document/${encodeURIComponent(normalizedId)}/ubl`);
  try {
    const response = await getScradaClient().get<string>(path, {
      responseType: "text",
      headers: {
        Accept: "application/xml"
      }
    });
    if (typeof response.data !== "string" || response.data.trim().length === 0) {
      throw new Error("[scrada] Received empty UBL payload");
    }
    return response.data;
  } catch (error) {
    throw wrapAxiosError(error, "fetch outbound UBL");
  }
}

function normalizeLookupResponse(
  body: ScradaParticipantLookupResponse | boolean
): ScradaParticipantLookupResponse {
  if (typeof body === "boolean") {
    return { exists: body };
  }

  const normalized: ScradaParticipantLookupResponse = { ...body };
  if (typeof normalized.exists !== "boolean" && typeof normalized.participantExists === "boolean") {
    normalized.exists = normalized.participantExists;
  }

  if (typeof normalized.exists !== "boolean" && Array.isArray(normalized.participants)) {
    normalized.exists = normalized.participants.length > 0;
  }

  return normalized;
}

export async function lookupParticipantById(peppolId: string): Promise<ScradaParticipantLookupResult> {
  const trimmed = peppolId.trim();
  if (!trimmed) {
    throw new Error("[scrada] peppolId is required");
  }
  try {
    const response = await getScradaClient().get("/peppol/participantLookup", {
      params: { peppolID: trimmed },
      paramsSerializer: {
        serialize: serializeParams
      }
    });

    const body = response.data as ScradaParticipantLookupResponse | boolean;
    const normalized = normalizeLookupResponse(body);
    const exists =
      typeof normalized.exists === "boolean"
        ? normalized.exists
        : Array.isArray(normalized.participants) && normalized.participants.length > 0;

    return {
      peppolId: trimmed,
      exists: Boolean(exists),
      response: normalized
    };
  } catch (error) {
    throw wrapAxiosError(error, "lookup participant");
  }
}

export async function lookupPartyBySchemeValue(
  scheme: string,
  value: string,
  options: { countryCode?: string } = {}
): Promise<ScradaParticipantLookupResult> {
  const trimmedScheme = scheme.trim();
  const trimmedValue = value.trim();
  if (!trimmedScheme) {
    throw new Error("[scrada] participant scheme is required for party lookup");
  }
  if (!trimmedValue) {
    throw new Error("[scrada] participant value is required for party lookup");
  }
  const countryCode = options.countryCode?.trim() || "BE";
  try {
    const response = await getScradaClient().post("/peppol/partyLookup", {
      countryCode,
      identifiers: [
        {
          scheme: trimmedScheme,
          value: trimmedValue
        }
      ]
    });

    const payload = response.data as ScradaParticipantLookupResponse | boolean | undefined;
    const normalized = payload ? normalizeLookupResponse(payload) : { exists: true };
    let exists: boolean;
    if (typeof normalized.exists === "boolean") {
      exists = normalized.exists;
    } else if (Array.isArray(normalized.participants)) {
      exists = normalized.participants.length > 0;
    } else {
      exists = true;
    }

    return {
      peppolId: `${trimmedScheme}:${trimmedValue}`,
      exists,
      response: normalized
    };
  } catch (error) {
    throw wrapAxiosError(error, "party lookup");
  }
}

export async function registerForInbound(input: RegisterCompanyInput): Promise<void> {
  try {
    await getScradaClient().post("/peppol/inbound/register", {
      company: input.companyName,
      vatNumber: input.vatNumber,
      countryCode: input.countryCode,
      endpointUrl: input.endpointUrl,
      contactEmail: input.contactEmail,
      contactName: input.contactName
    });
  } catch (error) {
    throw wrapAxiosError(error, "register inbound endpoint");
  }
}

export async function deregisterInbound(): Promise<void> {
  try {
    await getScradaClient().delete("/peppol/inbound/register");
  } catch (error) {
    throw wrapAxiosError(error, "deregister inbound endpoint");
  }
}

export function getScradaCompanyId(): string {
  return requireCompanyId();
}

function wrapAxiosError(error: unknown, action: string): Error {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data;
    let detail: string | undefined;
    if (typeof data === "string") {
      detail = data;
    } else if (Array.isArray(data)) {
      try {
        detail = JSON.stringify(data);
      } catch {
        detail = "[unserializable-response]";
      }
    } else if (data instanceof Uint8Array) {
      try {
        detail = Buffer.from(data).toString("utf8");
      } catch {
        detail = "[binary-response]";
      }
    } else if (data && typeof data === "object") {
      try {
        detail = JSON.stringify(data);
      } catch {
        detail = "[unserializable-response]";
      }
    }
    const messageParts = [`[scrada] Failed to ${action}`];
    if (typeof status === "number") {
      messageParts.push(`(HTTP ${status})`);
    }
    if (detail) {
      const snippet = detail.length > 500 ? `${detail.slice(0, 500)}…` : detail;
      messageParts.push(`: ${snippet}`);
    }
    const message = messageParts.join(" ");
    const wrapped = new Error(message, { cause: error });
    wrapped.name = "ScradaHttpError";
    return wrapped;
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(`[scrada] Failed to ${action}: ${String(error)}`);
}
