This directory contains the legacy JavaScript implementation that previously powered the MVP API.

- The active runtime lives in `src/` and is fully TypeScript.
- Nothing under `legacy/` is loaded at runtime or in the current Vitest suites.
- Keep these files around for historical reference or to port individual features later.

Updates during Sprint 0 moved the operational code to TypeScript only; the `.js` sources here are parked to avoid accidental imports.
