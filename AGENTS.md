# Repository Guidelines

## Project Structure & Module Organization
- Application code lives in `src/`, with domain schemas in `src/schemas/` and API wiring under `peppol/`.
- Front-end assets are served from `public/`, while integration fixtures reside in `tests/peppol/fixtures/`.
- Configuration lives alongside scripts (`eslint.config.js`, `vitest.config.mjs`, `scripts/`) and infrastructure data in `data/` or `prisma/`.
- Backups preserved under `backup_*` are read-only references—avoid editing or linting them.

## Build, Test, and Development Commands
- `npm run lint` – runs ESLint across the repo; fails on warnings to keep debt low.
- `CI=1 npm test` – executes Vitest suites using the `vmThreads` pool configured in `vitest.config.mjs`.
- `npm start` – launches the Node server with `server.js`; use `npm run wait:api` for health checks during automation.

## Coding Style & Naming Conventions
- TypeScript/ESM throughout; prefer named exports in modules under `src/` and `peppol/`.
- Follow ESLint and TypeScript defaults enforced by `eslint.config.js`; run lint before pushing.
- Use lower camelCase for variables/functions, PascalCase for types (`OrderLineT`), SCREAMING_SNAKE_CASE for constants (`VAT_RATES`).
- Keep comments brief and only where intent is non-obvious.

## Testing Guidelines
- Vitest supplies the test runner; suites live in `tests/` mirroring the source tree (e.g., `tests/peppol/order.test.ts`).
- Name tests with behavior-driven descriptions and cover edge cases around VAT, totals, and XML output.
- Keep fixtures small and reusable; prefer JSON fixtures under `tests/peppol/fixtures/`.

## Commit & Pull Request Guidelines
- Use conventional commits (`feat:`, `fix:`, `chore:`) mirroring the existing history; scope with a slash when useful (`chore/order-schema:`).
- Rebase or merge `origin/main` before opening a PR to surface conflicts locally.
- PRs should link the relevant issue, summarize behavior changes, list test evidence (`npm run lint`, `CI=1 npm test`), and note any follow-up debt.
- Push feature branches to `origin/<type>/<short-description>` to keep history consistent.

## Agent Usage Rules
- Always run `npm run lint` and `CI=1 npm test` immediately after making edits.
- Use conventional commits, and never bundle unrelated changes in a single commit.
- Keep edits minimal unless the task explicitly requires a broader refactor.
- Do not modify the `backup_*` directories; treat them as read-only records.
- Feel free to run `git push` without requesting additional confirmation.
