# Storage Backends

VIDA supports two interchangeable storage implementations for invoice history, delivery status tracking, and the dead-letter queue.

- **File backend (`VIDA_STORAGE_BACKEND=file`)** – persists JSONL files under `./data`. This is the default for local development, CI, and staging.
- **Prisma backend (`VIDA_STORAGE_BACKEND=prisma`)** – uses Prisma Client with SQLite by default and is ready for Postgres when a connection URL is supplied.

## File Backend (default)
- No extra setup is required.
- History, status, and DLQ files live inside `./data` unless overridden with `VIDA_HISTORY_DIR`, `VIDA_INVOICE_STATUS_DIR`, or `VIDA_DLQ_PATH`.
- Appropriate when running locally or in staging without a managed database.

## Prisma Backend

1. Configure environment variables:
   - `VIDA_STORAGE_BACKEND=prisma`
   - `DATABASE_URL=file:./dev.db` for SQLite (local/CI) or a Postgres URL such as `postgresql://user:pass@host:5432/db`.
2. Generate the Prisma client and apply migrations:

```bash
npm run prisma:generate
DATABASE_URL="file:./dev.db" npm run prisma:migrate
```

3. Start the application normally (`npm run dev` or `npm start`).

- SQLite stores JSON payloads as serialized strings; the Prisma layer parses them transparently. For Postgres, use the dedicated schema file and regenerate the client:

```bash
PRISMA_SCHEMA_PATH=prisma/schema.postgres.prisma npm run prisma:generate
PRISMA_SCHEMA_PATH=prisma/schema.postgres.prisma DATABASE_URL="postgresql://user:pass@host:5432/db" npm run prisma:migrate
```

### Helpful commands
- `npm run prisma:generate` – sync the Prisma client with `schema.prisma`.
- `npm run prisma:migrate` – apply the latest migrations to the configured `DATABASE_URL`.
- `npm run db:reset` – reset the database (drops data) and reapplies migrations; useful for local development.

## Switching Backends Safely
- **Local/CI**: toggle `VIDA_STORAGE_BACKEND` as needed, adjust `DATABASE_URL`, then run `npm run prisma:generate` and `npm run prisma:migrate` before starting services or tests.
- **Staging**: remains on the file backend by default. Only change to Prisma after provisioning the database and confirming migrations run successfully.
- **Runtime toggling**: call the `/health` endpoint to verify the server after any change, and ensure the old `data` directory or database is backed up before switching.
