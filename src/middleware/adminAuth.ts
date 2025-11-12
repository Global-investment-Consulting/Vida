import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import {
  ADMIN_DASHBOARD_KEY,
  resolveDashboardBasicCredentials,
  type DashboardBasicCredentials
} from "../config.js";

const ADMIN_KEY_HEADER = "x-admin-key";
const SESSION_COOKIE_NAME = "ops_admin_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60; // 1 hour
const COOKIE_PATH = "/ops";

export type AdminAuthContext = {
  mode: "header" | "basic" | "cookie";
  subject: string;
};

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Locals extends Record<string, unknown> {
      adminAuth?: AdminAuthContext;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

function constantTimeEquals(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function respondUnauthorized(res: Response): void {
  res.setHeader("WWW-Authenticate", 'Basic realm="Vida Ops Dashboard"');
  res.status(401).json({ error: "unauthorized" });
}

function computeSessionToken(creds: DashboardBasicCredentials): string {
  return createHash("sha256").update(`${creds.username}:${creds.password}`).digest("hex");
}

function shouldUseSecureCookies(): boolean {
  return (process.env.NODE_ENV ?? "").trim().toLowerCase() !== "development";
}

function setSessionCookie(res: Response, token: string): void {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${token}`,
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    `Path=${COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict"
  ];
  if (shouldUseSecureCookies()) {
    attributes.push("Secure");
  }
  const value = attributes.join("; ");
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", value);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, value]);
    return;
  }
  res.setHeader("Set-Cookie", [existing as string, value]);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) {
    return null;
  }
  const entries = header.split(";").map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    const [key, ...rest] = entry.split("=");
    if (!key || key !== name) {
      continue;
    }
    const value = rest.join("=");
    return value ? decodeURIComponent(value) : "";
  }
  return null;
}

function tryHeaderAuth(req: Request): AdminAuthContext | null {
  const configuredKey = ADMIN_DASHBOARD_KEY.trim();
  if (!configuredKey) {
    return null;
  }
  const provided = req.header(ADMIN_KEY_HEADER)?.trim();
  if (!provided) {
    return null;
  }
  if (!constantTimeEquals(configuredKey, provided)) {
    throw new Error("invalid_admin_key");
  }
  return { mode: "header", subject: "api-key" };
}

function tryCookieAuth(req: Request, creds: DashboardBasicCredentials | null): AdminAuthContext | null {
  if (!creds) {
    return null;
  }
  const expected = computeSessionToken(creds);
  const provided = readCookie(req, SESSION_COOKIE_NAME);
  if (!provided) {
    return null;
  }
  if (!constantTimeEquals(expected, provided)) {
    throw new Error("invalid_admin_cookie");
  }
  return { mode: "cookie", subject: creds.username };
}

function tryBasicAuth(req: Request, res: Response, creds: DashboardBasicCredentials | null): AdminAuthContext | null {
  if (!creds) {
    return null;
  }
  const header = req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("basic ")) {
    return null;
  }
  const encodedCredentials = header.slice(6).trim();
  if (!encodedCredentials) {
    throw new Error("invalid_basic_auth");
  }
  const decoded = Buffer.from(encodedCredentials, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) {
    throw new Error("invalid_basic_auth");
  }
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  if (!constantTimeEquals(creds.username, username) || !constantTimeEquals(creds.password, password)) {
    throw new Error("invalid_basic_auth");
  }
  const sessionToken = computeSessionToken(creds);
  setSessionCookie(res, sessionToken);
  return { mode: "basic", subject: creds.username };
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const creds = resolveDashboardBasicCredentials();
  try {
    const headerAuth = tryHeaderAuth(req);
    if (headerAuth) {
      res.locals.adminAuth = headerAuth;
      next();
      return;
    }
  } catch (error) {
    console.warn("[adminAuth] api-key rejected", error);
    respondUnauthorized(res);
    return;
  }

  try {
    const cookieAuth = tryCookieAuth(req, creds);
    if (cookieAuth) {
      res.locals.adminAuth = cookieAuth;
      next();
      return;
    }
  } catch (error) {
    console.warn("[adminAuth] cookie rejected", error);
    respondUnauthorized(res);
    return;
  }

  try {
    const basicAuth = tryBasicAuth(req, res, creds);
    if (basicAuth) {
      res.locals.adminAuth = basicAuth;
      next();
      return;
    }
  } catch (error) {
    console.warn("[adminAuth] basic auth rejected", error);
    respondUnauthorized(res);
    return;
  }

  if (!creds && !ADMIN_DASHBOARD_KEY.trim()) {
    res.status(503).json({ error: "dashboard_auth_unconfigured" });
    return;
  }

  respondUnauthorized(res);
}
