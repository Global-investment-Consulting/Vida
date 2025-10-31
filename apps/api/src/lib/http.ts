import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import process from "node:process";
import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from "axios";
import dotenv from "dotenv";

dotenv.config();

type RetryMetadata = {
  attempt: number;
};

type AugmentedAxiosConfig = AxiosRequestConfig & {
  __retry?: RetryMetadata;
};

const DEFAULT_BASE_URL = "https://apitest.scrada.be/v1/";
const USER_AGENT = "vida-scrada-adapter/1.0";
const DEFAULT_LANGUAGE = "EN";
const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 4;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 5_000;

const httpAgent = new HttpAgent({
  keepAlive: true,
  timeout: CONNECT_TIMEOUT_MS
});

const httpsAgent = new HttpsAgent({
  keepAlive: true,
  timeout: CONNECT_TIMEOUT_MS
});

export interface ScradaClientConfig {
  baseUrl: string;
  apiKey: string;
  password: string;
  language: string;
}

let cachedConfig: ScradaClientConfig | null = null;
let cachedClient: AxiosInstance | null = null;

function requireEnv(name: string): string {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      `[scrada] Missing required environment variable ${name}. Add it to your environment (e.g. .env).`
    );
  }
  return raw.trim();
}

function optionalEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return DEFAULT_BASE_URL;
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function jitter(delay: number): number {
  const spread = Math.min(250, delay / 2);
  const offset = Math.random() * spread;
  return delay - spread / 2 + offset;
}

function parseRateLimitReset(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const numeric = Number.parseFloat(trimmed);
  if (Number.isNaN(numeric)) {
    return null;
  }

  const now = Date.now();
  if (numeric > 1_000_000_000_000) {
    // Likely milliseconds since epoch.
    return Math.max(0, numeric - now);
  }
  if (numeric > 1_000_000_000) {
    // Likely seconds since epoch.
    return Math.max(0, numeric * 1_000 - now);
  }
  // Otherwise treat value as seconds from now.
  return Math.max(0, numeric * 1_000);
}

function shouldRetry(error: AxiosError): boolean {
  if (error.response) {
    const status = error.response.status;
    if (status === 429) {
      return true;
    }
    if (status >= 500 && status < 600) {
      return true;
    }
  }

  if (error.code) {
    const transientCodes = new Set(["ECONNABORTED", "ECONNRESET", "ETIMEDOUT", "EPIPE"]);
    if (transientCodes.has(error.code)) {
      return true;
    }
  }

  return false;
}

function scrubSensitiveHeaders(config: AxiosRequestConfig | undefined): void {
  if (!config || !config.headers) {
    return;
  }
  const headerKeys = Object.keys(config.headers);
  for (const key of headerKeys) {
    if (typeof key !== "string") {
      continue;
    }
    const normalized = key.toLowerCase();
    if (normalized === "x-api-key" || normalized === "x-password") {
      config.headers[key] = "[scrubbed]";
    }
  }
}

async function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function resolveConfig(): ScradaClientConfig {
  if (cachedConfig) {
    return cachedConfig;
  }
  const base = optionalEnv("SCRADA_API_BASE") ?? DEFAULT_BASE_URL;
  const config = {
    baseUrl: normalizeBaseUrl(base),
    apiKey: requireEnv("SCRADA_API_KEY"),
    password: requireEnv("SCRADA_API_PASSWORD"),
    language: optionalEnv("SCRADA_LANGUAGE") ?? DEFAULT_LANGUAGE
  };
  cachedConfig = config;
  return config;
}

function createClient(): AxiosInstance {
  if (cachedClient) {
    return cachedClient;
  }

  const config = resolveConfig();
  const instance = axios.create({
    baseURL: config.baseUrl,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      "User-Agent": USER_AGENT
    },
    httpAgent,
    httpsAgent,
    transitional: {
      clarifyTimeoutError: true
    }
  });

  instance.interceptors.request.use((requestConfig) => {
    const resolvedConfig = resolveConfig();
    const headers = requestConfig.headers ?? {};
    headers["X-API-KEY"] = resolvedConfig.apiKey;
    headers["X-PASSWORD"] = resolvedConfig.password;
    headers["Language"] = resolvedConfig.language;
    headers["User-Agent"] = USER_AGENT;
    requestConfig.headers = headers;
    requestConfig.timeout = REQUEST_TIMEOUT_MS;
    return requestConfig;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      scrubSensitiveHeaders(error.config);
      if (!error.config || !shouldRetry(error)) {
        throw error;
      }

      const configWithMeta = error.config as AugmentedAxiosConfig;
      const currentAttempt = configWithMeta.__retry?.attempt ?? 0;
      if (currentAttempt >= MAX_RETRIES) {
        throw error;
      }

      const nextAttempt = currentAttempt + 1;
      const resetHeader =
        typeof error.response?.headers === "object"
          ? (error.response?.headers["x-ratelimit-reset"] as string | undefined) ??
            (error.response?.headers["X-RateLimit-Reset"] as string | undefined)
          : undefined;

      let delay = Math.min(
        BASE_RETRY_DELAY_MS * Math.pow(2, currentAttempt),
        MAX_RETRY_DELAY_MS
      );
      const resetDelay = parseRateLimitReset(resetHeader);
      if (resetDelay && resetDelay > delay) {
        delay = resetDelay;
      }
      delay = jitter(delay);

      configWithMeta.__retry = { attempt: nextAttempt };

      await wait(delay);
      return instance(configWithMeta);
    }
  );

  cachedClient = instance;
  return instance;
}

export function getScradaClient(): AxiosInstance {
  return createClient();
}

export function getScradaConfig(): ScradaClientConfig {
  return resolveConfig();
}
