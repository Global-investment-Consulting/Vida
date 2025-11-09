import type { NextFunction, Request, Response } from "express";
import { resolvePublicApiKey } from "../config.js";

const AUTH_HEADER = "authorization";

function extractBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null;
  }
  const trimmed = headerValue.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith("bearer ")) {
    return null;
  }
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function requirePublicApiKey(req: Request, res: Response, next: NextFunction): void {
  const configuredKey = resolvePublicApiKey();
  if (!configuredKey) {
    res.status(503).json({ error: "public_api_unavailable" });
    return;
  }

  const token = extractBearerToken(req.header(AUTH_HEADER));
  if (!token || token !== configuredKey) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
}
