import { randomUUID } from "node:crypto";
import type { InvoiceStatusResponse, InvoiceSubmission, InvoiceSubmissionResponse } from "./types.js";

export type VidaClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  defaultIdempotencyKeyPrefix?: string;
};

export type SubmitInvoiceOptions = {
  idempotencyKey?: string;
};

export class VidaApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, payload: unknown, message?: string) {
    super(message ?? `Vida API request failed with status ${status}`);
    this.status = status;
    this.payload = payload;
  }
}

const DEFAULT_BASE_URL = "https://api.vida.build";
const IDEMPOTENCY_HEADER = "Idempotency-Key";
const API_KEY_HEADER = "X-Api-Key";

export class VidaPublicApiClient {
  private readonly baseUrl: string;

  private readonly apiKey: string;

  private readonly fetchImpl: typeof globalThis.fetch;

  private readonly idempotencyPrefix: string;

  constructor(options: VidaClientOptions) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw new Error("apiKey is required to use the Vida SDK");
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey.trim();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("Fetch API is not available in this runtime. Provide a fetch implementation.");
    }
    this.idempotencyPrefix = options.defaultIdempotencyKeyPrefix ?? "vida-sdk";
  }

  async submitInvoice(
    payload: InvoiceSubmission,
    options: SubmitInvoiceOptions = {}
  ): Promise<InvoiceSubmissionResponse> {
    const idempotencyKey = options.idempotencyKey ?? this.generateIdempotencyKey();
    const response = await this.request("/v0/invoices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [IDEMPOTENCY_HEADER]: idempotencyKey
      },
      body: JSON.stringify(payload)
    });
    return response as InvoiceSubmissionResponse;
  }

  async getInvoiceStatus(invoiceId: string): Promise<InvoiceStatusResponse> {
    if (!invoiceId || invoiceId.trim().length === 0) {
      throw new Error("invoiceId is required");
    }
    const response = await this.request(`/v0/invoices/${encodeURIComponent(invoiceId)}`, {
      method: "GET"
    });
    return response as InvoiceStatusResponse;
  }

  private generateIdempotencyKey(): string {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `${this.idempotencyPrefix}-${crypto.randomUUID()}`;
      }
    } catch {
      // ignore
    }
    return `${this.idempotencyPrefix}-${randomUUID()}`;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const target = new URL(path, `${this.baseUrl}/`).toString();
    const headers = new Headers(init.headers);
    headers.set(API_KEY_HEADER, this.apiKey);
    const response = await this.fetchImpl(target, {
      ...init,
      headers
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = await (contentType.includes("application/json") ? response.json() : response.text());
    if (!response.ok) {
      throw new VidaApiError(response.status, body);
    }
    return body;
  }
}

export function createVidaClient(options: VidaClientOptions): VidaPublicApiClient {
  return new VidaPublicApiClient(options);
}
