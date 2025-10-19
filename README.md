# VIDA MVP (file store)
[![CI](https://github.com/Global-investment-Consulting/Vida/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Global-investment-Consulting/Vida/actions/workflows/ci.yml)

## Run
```bash
cp .env.example .env
npm install
npm start
```

## Configuration
| Variable | Purpose |
| --- | --- |
| `VIDA_API_KEYS` | Comma-separated API keys allowed to access POST endpoints (e.g. `/webhook/order-created`). |
| `VIDA_HISTORY_DIR` | Override directory for JSONL history logs (defaults to `./data/history`). |
| `VIDA_PEPPOL_SEND` | When `true`, enables Access Point delivery (stub integration scaffold). |
| `VIDA_PEPPOL_AP` | Access Point mode (defaults to `stub`). |

## Useful Commands
- `npm run history:list` – print the most recent webhook history entries.

## Docker

Build an image and run it locally:

```bash
docker build -t vida:dev .
VIDA_API_KEYS=dev-key docker run --rm -p 8080:3001 vida:dev
```

Or with Compose for persistent history:

```bash
docker compose up --build
```

The container exposes the API on port `8080` and mounts `./data` for history logs.

## Cloud Run
- Staging deploys run via `.github/workflows/deploy-staging.yml`, which builds with Cloud Build, pushes to Artifact Registry (`europe-west1-docker.pkg.dev/$GCP_PROJECT_ID/vida/vida:staging`), and deploys the `vida-staging` service.
- The health probe responds with `ok` at `/health`, `/_health`, `/healthz`, and `/healthz/`.
