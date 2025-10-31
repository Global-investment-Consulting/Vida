## Scrada API integration adjustments

- Participant lookup responses can return `{ exists: boolean }`, `{ participantExists: boolean }`, or arrays of `participants`. The adapter now normalises these shapes and returns structured lookup metadata.
- Outbound status and webhook payload types accept additional `statusInfo` metadata from Scrada without failing type checks.
- Scrada webhook signatures may be delivered as raw hex, `sha256=` prefixed values, or base64. Verification now tolerates all formats while continuing to reject unsigned payloads unless explicitly allowed via `SCRADA_ALLOW_UNSIGNED_WEBHOOK`.
