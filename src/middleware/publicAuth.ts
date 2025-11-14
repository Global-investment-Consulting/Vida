import type { NextFunction, Request, Response } from "express";
import { getVidaApiKeys } from "../config.js";

const API_KEY_HEADER = "x-api-key";

type ApiKeyRecord = {
  tenant: string;
  token: string;
};

let cachedSignature: string | null = null;
let cachedRecords: ApiKeyRecord[] = [];

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Locals {
      publicApi?: ApiKeyRecord;
      apiKey?: string;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

function normalizeTenant(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.toLowerCase() : "default";
}

function normalizeToken(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseConfiguredKeys(): ApiKeyRecord[] {
  const configured = getVidaApiKeys();
  const signature = configured.join(",");
  if (cachedSignature === signature) {
    return cachedRecords;
  }

  const parsed: ApiKeyRecord[] = [];
  for (const entry of configured) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) {
      const token = normalizeToken(trimmed);
      if (token) {
        parsed.push({ tenant: "default", token });
      }
      continue;
    }

    const tenant = normalizeTenant(trimmed.slice(0, colonIndex));
    const token = normalizeToken(trimmed.slice(colonIndex + 1));
    if (token) {
      parsed.push({ tenant, token });
    }
  }

  cachedRecords = parsed;
  cachedSignature = signature;
  return parsed;
}

function respondUnauthorized(res: Response, code: "missing" | "invalid"): void {
  res.status(401).json({
    error: code === "missing" ? "missing_api_key" : "invalid_api_key"
  });
}

export function requirePublicApiKey(req: Request, res: Response, next: NextFunction): void {
  const records = parseConfiguredKeys();
  if (records.length === 0) {
    res.status(503).json({ error: "public_api_unavailable" });
    return;
  }

  const provided = req.header(API_KEY_HEADER)?.trim();
  if (!provided) {
    respondUnauthorized(res, "missing");
    return;
  }

  const match = records.find((record) => record.token === provided);
  if (!match) {
    respondUnauthorized(res, "invalid");
    return;
  }

  res.locals.publicApi = match;
  res.locals.apiKey = match.token;
  next();
}
