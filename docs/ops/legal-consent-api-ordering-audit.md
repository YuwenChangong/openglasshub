# Legal Consent API Ordering Audit

This audit traces authenticated mutation handlers before Phase 4A2 integration. The authoritative method inventory is `tests/fixtures/legal-consent-api-methods.mjs`; deterministic batch construction is `tests/fixtures/legal-consent-api-trace-batches.mjs`; validation runs with `npm run test:legal-consent-trace-batches`.

Methods are sorted by source file then `GET`, `POST`, `PUT`, `PATCH`, `DELETE` and divided into six pending batches. A completed trace must identify handler and helper chain, authenticated actor, role/ownership checks, privileged-client first use, database/R2/external effects, validation/rate/idempotency, response, and the future consent insertion point.

Checkpoint progress: 0/66 fully traced; 66 pending. Phase 4A1 remains NO_GO. No production endpoint is protected by this checkpoint, and direct API bypass remains possible for all 37 normal consent-required mutations.
