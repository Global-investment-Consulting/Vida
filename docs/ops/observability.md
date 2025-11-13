# Observability

## Health endpoints

| Path | Description |
| --- | --- |
| `/healthz` | Basic liveness probe (existing) |
| `/health/ready` | Readiness results with `history_dir`, `sentry`, and `stackdriver` checks |

`/health/ready` returns:

```json
{
  "ok": true,
  "checks": [
    { "name": "history_dir", "status": "ok" },
    { "name": "sentry", "status": "warn", "details": "disabled" },
    { "name": "stackdriver", "status": "ok" }
  ]
}
```

## Sentry

Configure the following environment variables:

| Name | Description |
| --- | --- |
| `SENTRY_DSN` | Project DSN |
| `SENTRY_ENVIRONMENT` | Optional environment tag (`production`, `staging`, etc.) |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional float between 0 and 1 for traces |

When `SENTRY_DSN` is set the server auto-initializes Sentry and captures every 5xx response plus unhandled exceptions.

## Stackdriver Logging

Logs are streamed to Google Cloud Logging (Stackdriver) using structured severity fields. Toggle via:

| Name | Description |
| --- | --- |
| `VIDA_STACKDRIVER_ENABLED` | `false` disables the Stackdriver sink (default: enabled) |
| `VIDA_STACKDRIVER_LOG` | Override log name (`vida-app` default) |

All console output is sanitized automatically. The following secrets are redacted whenever they appear in logs:

`VIDA_API_KEYS`, `VIDA_PUBLIC_API_KEY`, `VIDA_PROD_API_KEYS`, `AP_WEBHOOK_SECRET`, `SHOPIFY_WEBHOOK_SECRET`, `SCRADA_API_KEY`, `SCRADA_API_PASSWORD`, `JWT_SECRET`, and their prod counterparts.
