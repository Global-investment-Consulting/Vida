# Deployment Secrets

## Common variables

| Secret / Var | Description |
| --- | --- |
| `VIDA_API_KEYS` | CSV of internal API keys (staging) |
| `VIDA_PROD_API_KEYS` | CSV of internal API keys (production) |
| `VIDA_PUBLIC_API_KEY` | Public single-tenant API key for staging |
| `VIDA_PUBLIC_API_KEY_PROD` | Public API key for production tenants |
| `SHOPIFY_WEBHOOK_SECRET` | Staging Shopify HMAC secret |
| `SHOPIFY_WEBHOOK_SECRET_PROD` | Production Shopify HMAC secret |
| `JWT_SECRET` / `JWT_SECRET_PROD` | Token signing secrets |
| `GCP_SA_KEY` / `GCP_SA_KEY_PROD` | Base64-encoded service-account JSON |
| `VIDA_STACKDRIVER_ENABLED` | Optional override to disable Stackdriver |

## Workflows

- `.github/workflows/deploy-staging.yml`
  - Vars: `GCP_PROJECT_ID`, `REGION`, `SERVICE`, `CLOUD_BUILD_BUCKET`
  - Secrets: `GCP_SA_KEY`, `VIDA_STAGING_API_KEYS`, `AP_WEBHOOK_SECRET`, `VIDA_PUBLIC_API_KEY`, `SHOPIFY_WEBHOOK_SECRET`, `JWT_SECRET`

- `.github/workflows/deploy-prod.yml`
  - Vars: `GCP_PROJECT_ID_PROD`, `REGION_PROD`, `SERVICE_PROD`
  - Secrets: `GCP_SA_KEY_PROD`, `VIDA_PROD_API_KEYS`, `AP_WEBHOOK_SECRET_PROD`, `VIDA_PUBLIC_API_KEY_PROD`, `SHOPIFY_WEBHOOK_SECRET_PROD`, `JWT_SECRET_PROD`

Both workflows set `VIDA_AP_ADAPTER=scrada` to ensure the Scrada AP backend is active in production.
