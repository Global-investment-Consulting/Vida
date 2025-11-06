import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import axios, { type AxiosError, type AxiosInstance } from "axios";
import dotenv from "dotenv";
import { getScradaClient } from "../lib/http.js";
import { saveArchiveObject, type SaveResult } from "../lib/storage.js";
import {
  buildScradaJsonInvoice,
  createScradaInvoiceArtifacts,
  generateInvoiceId,
  type ScradaInvoiceContext
} from "../scrada/payload.js";
import type {
  RegisterCompanyInput,
  ScradaOutboundInfo,
  ScradaParticipantLookupResponse,
  ScradaParticipantLookupResult,
  ScradaSalesInvoice
} from "../types/scrada.js";

dotenv.config();

type Channel = "json" | "ubl";

const DEFAULT_ARTIFACT_ROOT = path.resolve(process.cwd(), ".data", "scrada");
const JSON_ARTIFACT_NAME = "json-sent.json";
const UBL_ARTIFACT_NAME = "ubl-sent.xml";
const UBL_HEADERS_ARTIFACT_NAME = "headers-sent.txt";
const ERROR_ARTIFACT_NAME = "error-body.txt";
const RECEIVER_HEADER_SCHEME = "iso6523-actorid-upis";
const RECEIVER_ENDPOINT_SCHEME = "0208";
const RECEIVER_ENDPOINT_ID = "0755799452";
const RECEIVER_HEADER_ID = `${RECEIVER_ENDPOINT_SCHEME}:${RECEIVER_ENDPOINT_ID}`;

const REQUIRED_UBL_HEADER_NAMES = [
  "content-type",
  "x-scrada-external-reference",
  "x-scrada-peppol-c1-country-code",
  "x-scrada-peppol-document-type-scheme",
  "x-scrada-peppol-document-type-value",
  "x-scrada-peppol-process-scheme",
  "x-scrada-peppol-process-value",
  "x-scrada-peppol-receiver-scheme",
  "x-scrada-peppol-receiver-id"
] as const;
const OPTIONAL_UBL_HEADER_NAMES = [
  "x-scrada-peppol-sender-scheme",
  "x-scrada-peppol-sender-id"
] as const;

const ALLOWED_UBL_HEADER_NAMES = [
  ...REQUIRED_UBL_HEADER_NAMES,
  ...OPTIONAL_UBL_HEADER_NAMES
] as const;

const REQUIRED_UBL_HEADER_NAMES_SET = new Set<string>(REQUIRED_UBL_HEADER_NAMES);
const OPTIONAL_UBL_HEADER_NAMES_SET = new Set<string>(OPTIONAL_UBL_HEADER_NAMES);
const ALLOWED_UBL_HEADER_NAMES_SET = new Set<string>(ALLOWED_UBL_HEADER_NAMES);
const REQUIRED_SANITIZED_UBL_HEADER_NAMES = REQUIRED_UBL_HEADER_NAMES.filter(
  (name) => name !== "content-type"
);

const RECEIVER_VAT = "BE0755799452";
const SENDER_SCHEME = "iso6523-actorid-upis";
const SENDER_ID = "0208:0755799452";
const COUNTRY_CODE = "BE";
const DOC_TYPE_SCHEME = "busdox-docid-qns";
const DOC_TYPE_VALUE =
  "urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1";
const PROCESS_SCHEME = "cenbii-procid-ubl";
const PROCESS_VALUE = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const HEADER_SWEEP_DOC_VALUES = [DOC_TYPE_VALUE] as const;
const HEADER_SWEEP_PROCESS_VALUES = [PROCESS_VALUE] as const;

const SUCCESS_STATUSES = new Set([
  "DELIVERED",
  "DELIVERY_CONFIRMED",
  "SUCCESS",
  "ACCEPTED",
  "COMPLETED"
]);
const FAILURE_STATUSES = new Set([
  "FAILED",
  "ERROR",
  "REJECTED",
  "DELIVERY_FAILED",
  "DECLINED",
  "CANCELLED"
]);
const PENDING_STATUSES = new Set([
  "QUEUED",
  "PENDING",
  "RECEIVED",
  "PROCESSING",
  "SENT",
  "SENT_TO_PEPPOL",
  "DISPATCHED"
]);

const DEFAULT_MAX_WAIT_MINUTES = Number.parseFloat(
  process.env.SCRADA_STATUS_MAX_WAIT_MINUTES ?? "30"
);
const DEFAULT_POLL_INTERVAL_SECONDS = Number.parseFloat(
  process.env.SCRADA_STATUS_POLL_INTERVAL_SECONDS ?? "45"
);

export interface ScradaSendAttempt {
  attempt: number;
  channel: Channel;
  vatVariant: string;
  statusCode?: number | null;
  success: boolean;
  errorMessage?: string;
  docValueIndex?: number;
  processValueIndex?: number;
}

export interface ScradaSendArtifacts {
  directory: string;
  jsonPath: string;
  ublPath: string | null;
  ublHeadersPath: string;
  errorPath: string;
}

interface ScradaSendFailureDetails {
  attempts: ScradaSendAttempt[];
  artifacts: ScradaSendArtifacts;
  invoiceId: string;
  externalReference: string;
  vatVariant: string;
  headerSweep: boolean;
  docValueIndex: number | null;
  processValueIndex: number | null;
  cause?: unknown;
}

export class ScradaSendFailure extends Error {
  readonly attempts: ScradaSendAttempt[];
  readonly artifacts: ScradaSendArtifacts;
  readonly invoiceId: string;
  readonly externalReference: string;
  readonly vatVariant: string;
  readonly headerSweep: boolean;
  readonly docValueIndex: number | null;
  readonly processValueIndex: number | null;

  constructor(message: string, details: ScradaSendFailureDetails) {
    super(message, {
      cause: details.cause instanceof Error ? details.cause : undefined
    });
    this.name = "ScradaSendFailure";
    this.attempts = details.attempts;
    this.artifacts = details.artifacts;
    this.invoiceId = details.invoiceId;
    this.externalReference = details.externalReference;
    this.vatVariant = details.vatVariant;
    this.headerSweep = details.headerSweep;
    this.docValueIndex = details.docValueIndex;
    this.processValueIndex = details.processValueIndex;
  }
}

export interface ScradaSendResult {
  invoice: ScradaSalesInvoice;
  documentId: string;
  invoiceId: string;
  externalReference: string;
  vatVariant: string;
  channel: Channel;
  headerSweep: boolean;
  docValueIndex: number | null;
  processValueIndex: number | null;
  attempts: ScradaSendAttempt[];
  artifacts: ScradaSendArtifacts;
}

export interface ScradaSendOptions {
  artifactDir?: string;
  externalReference?: string;
  invoiceId?: string;
  vatVariants?: string[];
  client?: AxiosInstance;
}

export interface PollHistoryEntry {
  attempt: number;
  fetchedAt: string;
  status: string;
  normalizedStatus: string;
  classification: "pending" | "success" | "failure" | "unknown";
}

export interface PollResult {
  info: ScradaOutboundInfo;
  classification: "success" | "failure";
  history: PollHistoryEntry[];
  elapsedMs: number;
}

export interface PollOptions {
  maxWaitMinutes?: number;
  pollIntervalSeconds?: number;
  logger?: (message: string) => void;
}

function requireCompanyId(): string {
  const raw = process.env.SCRADA_COMPANY_ID;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      "[scrada] Missing required environment variable SCRADA_COMPANY_ID. Add it to your environment (e.g. .env)."
    );
  }
  return raw.trim();
}

function companyPath(pathname: string): string {
  const companyId = requireCompanyId();
  const normalized = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return `/company/${companyId}/${normalized}`;
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

function scrubbedStringify(payload: unknown): string | undefined {
  if (typeof payload === "string") {
    return payload;
  }
  if (payload instanceof Uint8Array) {
    try {
      return Buffer.from(payload).toString("utf8");
    } catch {
      return "[binary-response]";
    }
  }
  if (Array.isArray(payload) || (payload && typeof payload === "object")) {
    try {
      return JSON.stringify(payload);
    } catch {
      return "[unserializable-response]";
    }
  }
  if (typeof payload !== "undefined" && payload !== null) {
    return String(payload);
  }
  return undefined;
}

function wrapAxiosError(error: unknown, action: string): Error {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const detail = scrubbedStringify(error.response?.data);
    const headerHint = headersToHint(error.response?.headers);
    const messageParts = [`[scrada] Failed to ${action}`];
    if (typeof status === "number") {
      messageParts.push(`(HTTP ${status})`);
    }
    if (detail) {
      const snippet = detail.length > 500 ? `${detail.slice(0, 500)}…` : detail;
      messageParts.push(`: ${snippet}`);
    }
    if (!detail && headerHint) {
      messageParts.push(`: ${headerHint}`);
    } else if (headerHint) {
      messageParts.push(`(${headerHint})`);
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

function sanitizeArtifactText(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length <= 5000) {
    return trimmed;
  }
  return `${trimmed.slice(0, 5000)}…`;
}

function unwrapAxiosError(error: unknown): AxiosError | null {
  if (axios.isAxiosError(error)) {
    return error;
  }
  if (error instanceof Error && axios.isAxiosError(error.cause)) {
    return error.cause;
  }
  return null;
}

function headersToHint(headers: unknown): string | undefined {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }
  const entries = Object.entries(headers as Record<string, unknown>);
  if (entries.length === 0) {
    return undefined;
  }
  const interesting = new Set([
    "x-error-message",
    "x-error-code",
    "x-scrada-error",
    "x-scrada-trace",
    "x-request-id"
  ]);
  const hints: string[] = [];
  for (const [key, value] of entries) {
    if (!key) {
      continue;
    }
    const normalized = key.toLowerCase();
    if (interesting.has(normalized)) {
      hints.push(`${normalized}=${String(value)}`);
    }
  }
  if (hints.length === 0) {
    return undefined;
  }
  return hints.join(", ");
}

function stringifyErrorBody(error: unknown): string {
  const axiosError = unwrapAxiosError(error);
  if (!axiosError) {
    return error instanceof Error ? error.message : String(error ?? "");
  }
  const detail = scrubbedStringify(axiosError.response?.data) ?? axiosError.message;
  const headerHint = headersToHint(axiosError.response?.headers);
  const combined = headerHint ? `${detail}\n${headerHint}` : detail;
  return sanitizeArtifactText(combined);
}

async function ensureArtifactDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function writeJsonArtifact(filePath: string, payload: ScradaSalesInvoice): Promise<void> {
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function writeTextArtifact(filePath: string, contents: string): Promise<void> {
  await writeFile(filePath, contents, "utf8");
}

async function appendTextArtifact(filePath: string, contents: string): Promise<void> {
  await writeFile(filePath, contents, { encoding: "utf8", flag: "a" });
}

async function writeHeaderPreview(filePath: string, headers: Record<string, string>): Promise<void> {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.trim(), value.trim()] as const)
    .filter(([name, value]) => name.length > 0 && value.length > 0)
    .sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase(), "en"));
  const lines = entries.map(([name, value]) => `${name}: ${value}`);
  await writeTextArtifact(filePath, lines.join("\n"));
  if (lines.length > 0) {
    console.log(`[scrada-ubl] header preview: ${lines.join(" | ")}`);
  } else {
    console.warn("[scrada-ubl] header preview: <empty>");
  }
}

function detectForbiddenUblHeaders(headerNames: string[]): string[] {
  const forbidden: string[] = [];
  const allowedReceiverHeaders = new Set([
    "x-scrada-peppol-receiver-scheme",
    "x-scrada-peppol-receiver-id"
  ]);
  for (const name of headerNames) {
    const normalized = name.toLowerCase();
    if (
      normalized.startsWith("x-scrada-peppol-sender-") &&
      !OPTIONAL_UBL_HEADER_NAMES_SET.has(normalized)
    ) {
      forbidden.push(normalized);
      continue;
    }
    if (
      normalized.startsWith("x-scrada-peppol-receiver-") &&
      !allowedReceiverHeaders.has(normalized)
    ) {
      forbidden.push(normalized);
    }
  }
  return forbidden.sort();
}

function enforceUblHeaderAllowList(headers: Record<string, string>): string[] {
  const normalizedNames = Object.keys(headers)
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);

  const forbidden = detectForbiddenUblHeaders(normalizedNames);
  if (forbidden.length > 0) {
    throw new Error(
      `[scrada] Unsupported UBL headers detected: ${forbidden.join(", ")}`
    );
  }

  const normalizedSet = new Set(normalizedNames);
  const missing = Array.from(REQUIRED_UBL_HEADER_NAMES_SET).filter(
    (name) => !normalizedSet.has(name)
  );
  const extra = Array.from(normalizedSet).filter(
    (name) => !ALLOWED_UBL_HEADER_NAMES_SET.has(name)
  );

  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `[scrada] UBL header set mismatch. Missing: ${
        missing.length > 0 ? missing.join(", ") : "none"
      }; Extra: ${extra.length > 0 ? extra.join(", ") : "none"}`
    );
  }

  return Array.from(normalizedSet).sort();
}

function isTruthyFlag(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

export async function sendSalesInvoiceJson(
  payload: ScradaSalesInvoice,
  opts?: { externalReference?: string }
): Promise<{ documentId: string }> {
  const pathName = companyPath("peppol/outbound/salesInvoice");
  const requestBody = withExternalReference(payload, opts?.externalReference);
  try {
    const response = await getScradaClient().post(pathName, requestBody, {
      headers: {
        "Content-Type": "application/json"
      }
    });
    return { documentId: extractDocumentId(response.data) };
  } catch (error) {
    throw wrapAxiosError(error, "send sales invoice JSON");
  }
}

export async function sendUbl(
  ublXml: string,
  opts?: { headers?: Record<string, string>; externalReference?: string }
): Promise<{ documentId: string }> {
  const pathName = companyPath("peppol/outbound/document");
  try {
    const baseHeaders: Record<string, string> = {
      "Content-Type": "application/xml; charset=utf-8"
    };

    const sanitizedHeaders: Record<string, string> = {};
    if (opts?.headers) {
      for (const [name, value] of Object.entries(opts.headers)) {
        if (typeof value !== "string") {
          continue;
        }
        const trimmedName = name.trim();
        const trimmedValue = value.trim();
        if (!trimmedName || !trimmedValue) {
          continue;
        }
        const normalizedName = trimmedName.toLowerCase();
        if (normalizedName.startsWith("x-scrada-peppol-sender-")) {
          throw new Error(`[scrada] Unsupported sender header ${normalizedName} for UBL submission`);
        }
        if (
          normalizedName.startsWith("x-scrada-peppol-receiver-") &&
          normalizedName !== "x-scrada-peppol-receiver-party-id"
        ) {
          throw new Error(`[scrada] Unsupported receiver header ${normalizedName} for UBL submission`);
        }
        sanitizedHeaders[normalizedName] = trimmedValue;
      }
    }

    const resolvedExternalReference = opts?.externalReference?.trim();
    if (resolvedExternalReference && !sanitizedHeaders["x-scrada-external-reference"]) {
      sanitizedHeaders["x-scrada-external-reference"] = resolvedExternalReference;
    }

    for (const name of REQUIRED_SANITIZED_UBL_HEADER_NAMES) {
      if (!sanitizedHeaders[name] || sanitizedHeaders[name].trim().length === 0) {
        throw new Error(`[scrada] Missing required header ${name} for UBL submission`);
      }
    }

    const finalHeaders: Record<string, string> = {
      ...baseHeaders,
      ...sanitizedHeaders
    };

    enforceUblHeaderAllowList(finalHeaders);

    const response = await getScradaClient().post(pathName, ublXml, {
      headers: finalHeaders
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
  const pathName = companyPath(`peppol/outbound/document/${encodeURIComponent(normalizedId)}/info`);
  try {
    const response = await getScradaClient().get<ScradaOutboundInfo>(pathName);
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
  const pathName = companyPath(`peppol/outbound/document/${encodeURIComponent(normalizedId)}/ubl`);
  try {
    const response = await getScradaClient().get<string>(pathName, {
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
  payload: ScradaParticipantLookupResponse | boolean
): ScradaParticipantLookupResponse {
  if (typeof payload === "boolean") {
    return { exists: payload };
  }
  return payload;
}

export async function lookupParticipantById(peppolId: string): Promise<ScradaParticipantLookupResult> {
  const trimmed = peppolId.trim();
  if (!trimmed) {
    throw new Error("[scrada] peppolId is required");
  }
  const [schemePart, idPart] = trimmed.includes(":")
    ? trimmed.split(":", 2)
    : [RECEIVER_ENDPOINT_SCHEME, trimmed];
  const scheme = schemePart?.trim();
  const value = idPart?.trim();
  if (!scheme || !value) {
    throw new Error("[scrada] Unable to determine scheme and value for participant lookup");
  }
  try {
    const response = await getScradaClient().get<ScradaParticipantLookupResponse | boolean>(
      companyPath(`peppol/lookup/${encodeURIComponent(scheme)}/${encodeURIComponent(value)}`)
    );
    const normalized = normalizeLookupResponse(response.data ?? { exists: false });
    let exists: boolean;
    if (typeof normalized.exists === "boolean") {
      exists = normalized.exists;
    } else if (typeof normalized.participantExists === "boolean") {
      exists = normalized.participantExists;
    } else if (Array.isArray(normalized.participants)) {
      exists = normalized.participants.length > 0;
    } else {
      exists = false;
    }
    return {
      peppolId: `${scheme}:${value}`,
      exists,
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
    const response = await getScradaClient().post(
      companyPath("peppol/lookup"),
      {
        name: `${trimmedScheme}:${trimmedValue}`,
        peppolID: `${trimmedScheme}:${trimmedValue}`,
        address: {
          countryCode
        },
        extraIdentifiers: [
          {
            scheme: trimmedScheme,
            value: trimmedValue
          }
        ]
      }
    );

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
    await getScradaClient().post(
      companyPath("peppol/register"),
      {
        company: input.companyName,
        vatNumber: input.vatNumber,
        countryCode: input.countryCode,
        endpointUrl: input.endpointUrl,
        contactEmail: input.contactEmail,
        contactName: input.contactName
      }
    );
  } catch (error) {
    throw wrapAxiosError(error, "register inbound endpoint");
  }
}

export async function deregisterInbound(options: { scheme?: string; value?: string } = {}): Promise<void> {
  const scheme = options.scheme?.trim() || SENDER_SCHEME;
  const value = options.value?.trim() || SENDER_ID;
  if (!scheme || !value) {
    throw new Error("[scrada] Scheme and value are required to deregister inbound participant");
  }
  try {
    await getScradaClient().delete(
      companyPath(`peppol/deregister/${encodeURIComponent(scheme)}/${encodeURIComponent(value)}`)
    );
  } catch (error) {
    throw wrapAxiosError(error, "deregister inbound endpoint");
  }
}

export function getScradaCompanyId(): string {
  return requireCompanyId();
}

function determineArtifactDir(options: ScradaSendOptions, invoiceId: string): string {
  const userDir = options.artifactDir?.trim();
  if (userDir) {
    return path.resolve(userDir);
  }
  return path.join(DEFAULT_ARTIFACT_ROOT, invoiceId);
}

function buildScradaPeppolHeaders(
  context: ScradaInvoiceContext,
  overrides?: { docValue?: string; processValue?: string }
): Record<string, string> {
  const invoiceId = context.invoiceId?.trim();
  if (!invoiceId) {
    throw new Error("[scrada] Invoice ID is required to build Peppol headers");
  }

  if (overrides?.docValue && overrides.docValue.trim() !== DOC_TYPE_VALUE) {
    throw new Error("[scrada] Unsupported document type value override");
  }

  if (overrides?.processValue && overrides.processValue.trim() !== PROCESS_VALUE) {
    throw new Error("[scrada] Unsupported process value override");
  }

  const headers: Record<string, string> = {
    "x-scrada-peppol-document-type-scheme": DOC_TYPE_SCHEME,
    "x-scrada-peppol-document-type-value": DOC_TYPE_VALUE,
    "x-scrada-peppol-process-scheme": PROCESS_SCHEME,
    "x-scrada-peppol-process-value": PROCESS_VALUE,
    "x-scrada-peppol-receiver-scheme": RECEIVER_HEADER_SCHEME,
    "x-scrada-peppol-receiver-id": RECEIVER_HEADER_ID,
    "x-scrada-peppol-c1-country-code": COUNTRY_CODE,
    "x-scrada-peppol-sender-scheme": SENDER_SCHEME,
    "x-scrada-peppol-sender-id": SENDER_ID,
    "x-scrada-external-reference": invoiceId
  };

  for (const [name, value] of Object.entries(headers)) {
    if (!value || value.trim().length === 0) {
      throw new Error(`[scrada] Missing required header value for ${name}`);
    }
  }

  return headers;
}

export async function sendInvoiceWithFallback(
  options: ScradaSendOptions = {}
): Promise<ScradaSendResult> {
  const invoiceId =
    options.invoiceId?.trim() && options.invoiceId.trim().length > 0
      ? options.invoiceId.trim()
      : generateInvoiceId();
  const externalReference =
    options.externalReference?.trim() && options.externalReference.trim().length > 0
      ? options.externalReference.trim()
      : invoiceId;

  const artifactDir = determineArtifactDir(options, invoiceId);
  const jsonPath = path.join(artifactDir, JSON_ARTIFACT_NAME);
  const ublPath = path.join(artifactDir, UBL_ARTIFACT_NAME);
  const ublHeadersPath = path.join(artifactDir, UBL_HEADERS_ARTIFACT_NAME);
  const errorPath = path.join(artifactDir, ERROR_ARTIFACT_NAME);
  const artifacts: ScradaSendArtifacts = {
    directory: artifactDir,
    jsonPath,
    ublPath: null,
    ublHeadersPath,
    errorPath
  };

  await ensureArtifactDir(artifactDir);
  await writeTextArtifact(errorPath, "");
  await writeTextArtifact(ublPath, "");
  await writeTextArtifact(ublHeadersPath, "");

  const { context: invoiceContext, json: invoice, ubl: ublXml } = createScradaInvoiceArtifacts({
    invoiceId,
    externalReference
  });
  await writeJsonArtifact(jsonPath, invoice);
  await writeTextArtifact(ublPath, ublXml);

  const attempts: ScradaSendAttempt[] = [];
  const client = options.client ?? getScradaClient();
  const headerSweepEnabled = isTruthyFlag(process.env.SCRADA_HEADER_SWEEP);
  const vatVariant = RECEIVER_VAT;

  let lastError: unknown;
  let finalDocumentId: string | null = null;
  let finalChannel: Channel = "json";
  let finalDocIndex: number | null = null;
  let finalProcessIndex: number | null = null;
  let shouldAttemptUbl = false;

  const jsonAttempt: ScradaSendAttempt = {
    attempt: attempts.length + 1,
    channel: "json",
    vatVariant,
    success: false
  };
  attempts.push(jsonAttempt);

  try {
    const response = await client.post(
      companyPath("peppol/outbound/salesInvoice"),
      withExternalReference(invoice, externalReference),
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
    finalDocumentId = extractDocumentId(response.data);
    jsonAttempt.success = true;
  } catch (error) {
    const wrappedError = wrapAxiosError(error, "send sales invoice JSON");
    lastError = wrappedError;
    const axiosError = unwrapAxiosError(wrappedError);
    jsonAttempt.statusCode = axiosError?.response?.status ?? null;
    jsonAttempt.errorMessage =
      wrappedError instanceof Error ? wrappedError.message : String(wrappedError ?? "unknown error");
    const errorBody = stringifyErrorBody(wrappedError);
    const entryParts = [
      `[${new Date().toISOString()}] attempt=${jsonAttempt.attempt}`,
      "channel=json",
      `vatVariant=${vatVariant}`
    ];
    if (typeof jsonAttempt.statusCode === "number") {
      entryParts.push(`status=${jsonAttempt.statusCode}`);
    }
    if (jsonAttempt.errorMessage) {
      entryParts.push(`error=${jsonAttempt.errorMessage}`);
    }
    const rawData = scrubbedStringify(axiosError?.response?.data);
    if (rawData) {
      entryParts.push(`data=${rawData}`);
      console.error(`[scrada-json] response data: ${rawData}`);
    }
    const headerHint = headersToHint(axiosError?.response?.headers);
    if (headerHint) {
      entryParts.push(`headers=${headerHint}`);
      console.error(`[scrada] response headers: ${headerHint}`);
    }
    if (axiosError && typeof axiosError.toJSON === "function") {
      try {
        console.error(`[scrada] axios error: ${JSON.stringify(axiosError.toJSON())}`);
      } catch {
        // ignore serialization issues
      }
    }
    const entry = entryParts.join(" ");
    await appendTextArtifact(errorPath, `${entry}\n${errorBody}\n\n`);
  }

  if (!jsonAttempt.success && jsonAttempt.statusCode === 400) {
    shouldAttemptUbl = true;
  }

  if (!finalDocumentId && shouldAttemptUbl) {
    const docCandidates = headerSweepEnabled ? Array.from(HEADER_SWEEP_DOC_VALUES) : [DOC_TYPE_VALUE];
    const processCandidates = headerSweepEnabled ? Array.from(HEADER_SWEEP_PROCESS_VALUES) : [PROCESS_VALUE];

    let attemptIndex = 0;

    outer: for (let docIndex = 0; docIndex < docCandidates.length; docIndex += 1) {
      for (let processIndex = 0; processIndex < processCandidates.length; processIndex += 1) {
        attemptIndex += 1;

        const attemptRecord: ScradaSendAttempt = {
          attempt: attempts.length + 1,
          channel: "ubl",
          vatVariant,
          success: false,
          docValueIndex: headerSweepEnabled ? docIndex : undefined,
          processValueIndex: headerSweepEnabled ? processIndex : undefined
        };
        attempts.push(attemptRecord);

        const attemptUblPath = path.join(artifactDir, `ubl-sent-${attemptIndex}.xml`);
        const attemptHeadersPath = path.join(artifactDir, `header-names-${attemptIndex}.txt`);
        const attemptErrorPath = path.join(artifactDir, `error-body-${attemptIndex}.txt`);

        await writeTextArtifact(attemptUblPath, ublXml);

        try {
          const finalHeaders: Record<string, string> = {
            "Content-Type": "application/xml; charset=utf-8",
            ...buildScradaPeppolHeaders(invoiceContext, {
              docValue: docCandidates[docIndex],
              processValue: processCandidates[processIndex]
            })
          };

          const normalizedHeaderNames = enforceUblHeaderAllowList(finalHeaders);
          await writeTextArtifact(attemptHeadersPath, normalizedHeaderNames.join("\n"));
          await writeHeaderPreview(ublHeadersPath, finalHeaders);
          console.log(
            `[scrada-ubl] header allow-list verification passed: ${normalizedHeaderNames.join(", ")}`
          );

          const response = await client.post(
            companyPath("peppol/outbound/document"),
            ublXml,
            {
              headers: finalHeaders
            }
          );
          finalDocumentId = extractDocumentId(response.data);
          attemptRecord.success = true;
          finalChannel = "ubl";
          finalDocIndex = headerSweepEnabled ? docIndex : null;
          finalProcessIndex = headerSweepEnabled ? processIndex : null;
          artifacts.ublPath = ublPath;
          await writeTextArtifact(
            attemptErrorPath,
            `[${new Date().toISOString()}] attempt=${attemptRecord.attempt} channel=ubl result=success docIndex=${docIndex + 1} procIndex=${processIndex + 1}\n`
          );
          break outer;
        } catch (error) {
          const wrappedError = wrapAxiosError(error, "send UBL document");
          lastError = wrappedError;
          const axiosError = unwrapAxiosError(wrappedError);
          attemptRecord.statusCode = axiosError?.response?.status ?? null;
          attemptRecord.errorMessage =
            wrappedError instanceof Error ? wrappedError.message : String(wrappedError ?? "unknown error");
          const errorBody = stringifyErrorBody(wrappedError);
          const entryParts = [
            `[${new Date().toISOString()}] attempt=${attemptRecord.attempt}`,
            "channel=ubl",
            `vatVariant=${vatVariant}`,
            `docIndex=${docIndex + 1}`,
            `procIndex=${processIndex + 1}`
          ];
          if (typeof attemptRecord.statusCode === "number") {
            entryParts.push(`status=${attemptRecord.statusCode}`);
          }
          if (attemptRecord.errorMessage) {
            entryParts.push(`error=${attemptRecord.errorMessage}`);
          }
          const rawData = scrubbedStringify(axiosError?.response?.data);
          if (rawData) {
            entryParts.push(`data=${rawData}`);
            console.error(`[scrada-ubl] response data: ${rawData}`);
          }
          const headerHint = headersToHint(axiosError?.response?.headers);
          if (headerHint) {
            entryParts.push(`headers=${headerHint}`);
            console.error(`[scrada] response headers: ${headerHint}`);
          }
          if (axiosError && typeof axiosError.toJSON === "function") {
            try {
              console.error(`[scrada] axios error: ${JSON.stringify(axiosError.toJSON())}`);
            } catch {
              // ignore serialization issues
            }
          }
          const entry = entryParts.join(" ");
          await appendTextArtifact(errorPath, `${entry}\n${errorBody}\n\n`);
          await writeTextArtifact(attemptErrorPath, `${entry}\n${errorBody}\n`);

          if (attemptRecord.statusCode !== 400) {
            break outer;
          }
        }
      }
    }
  }

  if (!finalDocumentId) {
    const failureMessage =
      lastError instanceof Error ? lastError.message : "Unknown failure while sending Scrada invoice.";
    throw new ScradaSendFailure(
      `[scrada] Exhausted send attempts (${attempts.length}) without success: ${failureMessage}`,
      {
        attempts: attempts.slice(),
        artifacts,
        invoiceId,
        externalReference,
        vatVariant,
        headerSweep: headerSweepEnabled,
        docValueIndex: finalDocIndex,
        processValueIndex: finalProcessIndex,
        cause: lastError
      }
    );
  }

  return {
    invoice,
    documentId: finalDocumentId,
    invoiceId,
    externalReference,
    vatVariant,
    channel: finalChannel,
    headerSweep: headerSweepEnabled,
    docValueIndex: finalDocIndex,
    processValueIndex: finalProcessIndex,
    attempts,
    artifacts
  };
}

function normalizeStatus(status: string | undefined | null): string {
  return status?.toUpperCase().replace(/\s+/g, "_") ?? "";
}

function classifyStatus(status: string | undefined | null): PollHistoryEntry["classification"] {
  const normalized = normalizeStatus(status);
  if (SUCCESS_STATUSES.has(normalized)) {
    return "success";
  }
  if (FAILURE_STATUSES.has(normalized)) {
    return "failure";
  }
  if (PENDING_STATUSES.has(normalized)) {
    return "pending";
  }
  return "unknown";
}

function jitteredDelay(baseMs: number): number {
  if (baseMs <= 0) {
    return 0;
  }
  const spread = Math.min(20_000, Math.max(3_000, Math.floor(baseMs * 0.2)));
  const offset = Math.floor((Math.random() - 0.5) * spread);
  return Math.max(0, baseMs + offset);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollOutboundDocument(
  documentId: string,
  options: PollOptions = {}
): Promise<PollResult> {
  const normalizedId = documentId.trim();
  if (!normalizedId) {
    throw new Error("[scrada] documentId is required to poll status");
  }

  const maxWaitMinutes =
    typeof options.maxWaitMinutes === "number" && !Number.isNaN(options.maxWaitMinutes)
      ? options.maxWaitMinutes
      : DEFAULT_MAX_WAIT_MINUTES;
  const pollIntervalSeconds =
    typeof options.pollIntervalSeconds === "number" && !Number.isNaN(options.pollIntervalSeconds)
      ? options.pollIntervalSeconds
      : DEFAULT_POLL_INTERVAL_SECONDS;
  const logger = options.logger;

  const maxWaitMs = Math.max(1, Math.round(maxWaitMinutes * 60 * 1000));
  const pollIntervalMs = Math.max(1_000, Math.round(pollIntervalSeconds * 1_000));

  const history: PollHistoryEntry[] = [];
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < maxWaitMs) {
    try {
      const info = await getOutboundStatus(normalizedId);
      const classification = classifyStatus(info.status);
      const entry: PollHistoryEntry = {
        attempt: history.length + 1,
        fetchedAt: new Date().toISOString(),
        status: info.status ?? "unknown",
        normalizedStatus: normalizeStatus(info.status),
        classification
      };
      history.push(entry);

      if (classification === "success" || classification === "failure") {
        return {
          info,
          classification: classification === "success" ? "success" : "failure",
          history,
          elapsedMs: Date.now() - startedAt
        };
      }

      if (logger) {
        logger(
          `[scrada] Document ${normalizedId} status ${info.status ?? "unknown"} (classification=${classification})`
        );
      }
    } catch (error) {
      lastError = wrapAxiosError(error, "poll outbound status");
      const axiosError = unwrapAxiosError(lastError);
      const statusCode = axiosError?.response?.status ?? null;
      if (statusCode !== 400 && statusCode !== 404) {
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
      }
      if (logger) {
        logger(
          `[scrada] Status endpoint returned HTTP ${statusCode} for ${normalizedId}; retrying`
        );
      }
    }

    const delay = jitteredDelay(pollIntervalMs);
    await sleep(delay);
  }

  const timeoutError = new Error(
    `[scrada] Timed out after ${Math.round(
      (Date.now() - startedAt) / 1000
    )}s waiting for document ${normalizedId}`
  );
  if (lastError instanceof Error) {
    timeoutError.cause = lastError;
  }
  throw timeoutError;
}

export async function fetchAndArchiveOutboundUbl(
  documentId: string
): Promise<SaveResult> {
  const ublXml = await getOutboundUbl(documentId);
  const key = `archive/peppol/${documentId}.xml`;
  return saveArchiveObject(key, ublXml, {
    contentType: "application/xml",
    metadata: {
      documentId,
      archivedAt: new Date().toISOString()
    }
  });
}
