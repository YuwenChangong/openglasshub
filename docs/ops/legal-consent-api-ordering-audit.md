# Legal Consent API Ordering Audit

This audit traces authenticated mutation handlers before Phase 4A2 integration. The authoritative method inventory is `tests/fixtures/legal-consent-api-methods.mjs`; deterministic batch construction is `tests/fixtures/legal-consent-api-trace-batches.mjs`; validation runs with `npm run test:legal-consent-trace-batches`.

Methods are sorted by source file then `GET`, `POST`, `PUT`, `PATCH`, `DELETE` and divided into six pending batches. A completed trace must identify handler and helper chain, authenticated actor, role/ownership checks, privileged-client first use, database/R2/external effects, validation/rate/idempotency, response, and the future consent insertion point.

Checkpoint progress: 0/66 fully traced; 66 pending. Phase 4A1 remains NO_GO. No production endpoint is protected by this checkpoint, and direct API bypass remains possible for all 37 normal consent-required mutations.

## Phase 4A1 Batch 1D - admin/forum/posts.ts

GET is a moderator-only read. PATCH validates post id and action before status update. DELETE validates and loads the target post, soft-deletes it, then invokes `deletePostMediaObjects` for storage and media-row cleanup. Future consent belongs immediately after `requireModerator`, before resource lookup and any mutation. Parent Batch 1 remains pending.

## Phase 4A1 Batch 1A - admin/forum/circles.ts

`GET`, `POST`, and `PATCH` were inspected through `requireModerator`. The helper derives the actor from `auth.getUser`, creates an RLS client from that verified bearer session, and checks moderator/admin role before returning. GET is read-only. POST and PATCH can receive future consent enforcement immediately after `requireModerator`, before payload work and before their first Postgres update/insert. POST has duplicate-name checking and moderation before insertion; PATCH validates the target id and update fields before moderation and update. No service-role client or email path was found in this endpoint. Parent Batch 1 remains pending because its other source files are not traced.

## Phase 4A1 Batch 1B - admin/forum/me.ts

GET is an authenticated admin read. `requireModerator` obtains the bearer credential, creates the RLS user client, verifies `auth.getUser`, and checks the profile role before the handler returns selected actor/profile fields. No mutation, R2 access, email, privileged client, ownership lookup, or external side effect exists. Parent Batch 1 remains pending.

## Phase 4A1 Batch 1C - admin/forum/media.ts

GET is a moderator-only read with bounded list filters and no mutation. DELETE verifies moderator role, validates the target media UUID, reads the media row, invokes `deleteMediaObject` for managed R2 or Supabase storage cleanup, then deletes the Postgres row. Future consent belongs after `requireModerator` and before the media lookup, so it precedes the first irreversible storage deletion. Parent Batch 1 remains pending.
