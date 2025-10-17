# VIDA MVP (file store)
[![CI](https://github.com/Global-investment-Consulting/Vida/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Global-investment-Consulting/Vida/actions/workflows/ci.yml)

## Run
```bash
cp .env.example .env
npm install
npm start
```

## Configuration
- Set `VIDA_API_KEYS` to a comma-separated list of API keys (for example `VIDA_API_KEYS=dev-key-1,dev-key-2`) to unlock POST routes such as `/webhook/order-created`.
- Set `VIDA_VALIDATE_UBL=true` to enforce UBL validation before delivery.

## Useful Commands
- `npm run history:list` – print the most recent webhook history entries.
