import * as Sentry from "@sentry/node";
import type { Request } from "express";

let sentryReady = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    sentryReady = false;
    return;
  }
  if (sentryReady) {
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    tracesSampleRate: normalizeSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE),
    release: process.env.npm_package_version ?? undefined
  });
  sentryReady = true;
}

function normalizeSampleRate(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }
  return Math.min(parsed, 1);
}

export function captureServerException(error: unknown, req?: Request): void {
  if (!sentryReady) {
    return;
  }
  Sentry.captureException(error, {
    extra: req
      ? {
          path: req.path,
          method: req.method,
          requestId: req.header("x-request-id")
        }
      : undefined
  });
}

export function isSentryEnabled(): boolean {
  return sentryReady;
}
