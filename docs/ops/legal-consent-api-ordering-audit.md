# Legal Consent API Ordering Audit

This audit traces authenticated mutation handlers before Phase 4A2 integration. The authoritative method inventory is `tests/fixtures/legal-consent-api-methods.mjs`; deterministic batch construction is `tests/fixtures/legal-consent-api-trace-batches.mjs`; validation runs with `npm run test:legal-consent-trace-batches`.

Methods are sorted by source file then `GET`, `POST`, `PUT`, `PATCH`, `DELETE` and divided into six pending batches. A completed trace must identify handler and helper chain, authenticated actor, role/ownership checks, privileged-client first use, database/R2/external effects, validation/rate/idempotency, response, and the future consent insertion point.

Checkpoint progress: 0/66 fully traced; 66 pending. Phase 4A1 remains NO_GO. No production endpoint is protected by this checkpoint, and direct API bypass remains possible for all 37 normal consent-required mutations.

## Phase 4A1 Batch 1F - admin/moderation/approve.ts

POST requires `requireModerator`, validates a post/comment UUID action payload, reads the target for already-applied protection, updates the target moderation fields, then records a moderation action. The verified actor is passed as `moderatorId`; no client identity replaces it. Future consent belongs after `requireModerator`, before payload parsing and target lookup.

## Parent Batch 1 closure

All 11 Batch 1 method records are traced. Parent Batch 1 is complete; batches 2 through 6 remain pending. Cumulative progress is 11/66 traced and 55 pending. No endpoint enforcement is active.

## Phase 4A1 Batch 2A - admin/moderation/hide.ts POST

POST verifies moderator identity, validates target type and UUID, reads the target for already-hidden protection, updates its moderation state, and then inserts the moderation action record. Future consent belongs after `requireModerator`, before payload parsing and target lookup. The action record may fail after target update, so this is a documented Phase 4B transactional-hardening concern, not a pre-authorization side effect.

## Phase 4A1 Batch 2B - admin/moderation/lexicon-health.ts GET

GET requires moderator authentication and then calls `getSensitiveLexiconHealth`. The loader reads the configured R2 object when available, otherwise reads the generated local file or uses the emergency in-memory lexicon. Caching is process-memory only; no persistent write, RPC mutation, audit event, notification, email, or telemetry side effect exists.

## Phase 4A1 Batch 2C - admin/moderation/queue.ts GET

GET requires moderator authentication, bounds the queue limit, selects matching post and comment moderation rows, and sorts mapped results in memory. No persistent or external side effect occurs.

## Phase 4A1 Batch 2D - admin/moderation/reject.ts POST

POST requires moderator identity, validates the post/comment target payload, reads the target for already-rejected protection, updates target moderation state, then inserts the moderation action record. The verified actor supplies `moderatorId`; target fields cannot replace it. The audit record can fail after target mutation, so transactional compensation is Phase 4B hardening. Future consent belongs immediately after `requireModerator`.

## Phase 4A1 Batch 2E - admin/news.ts

GET delegates only to read-only admin news queries and does not synchronize external news or mutate a cache. POST/PATCH validate all article fields, build a unique slug, and write `news_articles` with the verified moderator as author. DELETE validates the target id and deletes the article. Future consent belongs immediately after `requireModerator` for each mutation; no R2, email, notification, provider, or cache-persistence side effect exists.

## Phase 4A1 Batch 2F - admin/reports.ts GET

GET requires moderator authentication, bounds and allowlists filters, and calls `fetchAdminReportsQueue` for report and target preview reads. It does not update report state, targets, events, notifications, cache, email, or external services.

## Phase 4A1 Batch 2G - admin/reports/[id].ts GET

GET validates a non-empty dynamic report id, requires moderator authentication, then calls `fetchAdminReportDetail` for report, target preview, reporter, count, event, and actor reads. The dynamic id never supplies the acting moderator and no status/event/target/notification/cache mutation occurs. The route only checks that the id is non-empty, and its generic 500 branch returns the caught `Error.message` rather than sanitizing helper errors.

## Phase 4A1 Batch 2H - admin/reports/[id]/action.ts POST

POST validates runtime env and a non-empty report id, authenticates and derives the moderator from the bearer token through `requireModerator`, then parses JSON and allowlists `dismiss`, `reviewing`, `hide_target`, `reject_target`, `warn_user`, `suspend_user`, and `ban_user`. It does not check the id format, content type, request size, or rate limit. A future consent guard can be awaited in `POST` immediately after `requireModerator(request, env)` and before `request.json()`; this needs no refactor beyond passing the verified `auth.user.id` to the guard.

`applyAdminReportAction` reads the report and target after authentication. Reviewing and dismiss update `reports` before inserting the report event. Post/comment hide or reject reads the target again, updates the target, inserts `moderation_actions`, updates the report, inserts the report event, then starts a notification RPC without awaiting it. Circle hide updates the circle, then follows the report/event sequence; circle reject and user hide are rejected. User warn/suspend/ban read user safety state, upsert it, insert a user-safety event, attempt a notification, optionally attempt and swallow a supplemental note failure, then update the report and insert the report event.

Findings: raw helper `Error.message` values are returned to clients through both non-ok results and the generic 500 branch (Phase 4B hardening). The target/state, moderation-action, report-state, report-event, and notification writes are not transactional; each later failure can leave earlier writes committed (Phase 4B hardening). There is no report-resolved gate or action idempotency key, so repeated requests can duplicate report events and some target/user-safety actions; target post/comment moderation suppresses only an already-desired target update, not the later report event (Phase 4B hardening). Missing request-size, content-type, rate-limit, and UUID controls are Phase 4B hardening. These findings do not block this Phase 4A1 source trace.

## Phase 4A1 Batch 1E - admin/forum/reports.ts

GET is a moderator-only report read. It bounds the limit, selects post reports, and reads linked posts, circles, and profiles for response formatting. No report status/event, target, notification, email, external-service, or other state mutation occurs. Parent Batch 1 remains pending.

## Phase 4A1 Batch 1D - admin/forum/posts.ts

GET is a moderator-only read. PATCH validates post id and action before status update. DELETE validates and loads the target post, soft-deletes it, then invokes `deletePostMediaObjects` for storage and media-row cleanup. Future consent belongs immediately after `requireModerator`, before resource lookup and any mutation. Parent Batch 1 remains pending.

## Phase 4A1 Batch 1A - admin/forum/circles.ts

`GET`, `POST`, and `PATCH` were inspected through `requireModerator`. The helper derives the actor from `auth.getUser`, creates an RLS client from that verified bearer session, and checks moderator/admin role before returning. GET is read-only. POST and PATCH can receive future consent enforcement immediately after `requireModerator`, before payload work and before their first Postgres update/insert. POST has duplicate-name checking and moderation before insertion; PATCH validates the target id and update fields before moderation and update. No service-role client or email path was found in this endpoint. Parent Batch 1 remains pending because its other source files are not traced.

## Phase 4A1 Batch 1B - admin/forum/me.ts

GET is an authenticated admin read. `requireModerator` obtains the bearer credential, creates the RLS user client, verifies `auth.getUser`, and checks the profile role before the handler returns selected actor/profile fields. No mutation, R2 access, email, privileged client, ownership lookup, or external side effect exists. Parent Batch 1 remains pending.

## Phase 4A1 Batch 1C - admin/forum/media.ts

GET is a moderator-only read with bounded list filters and no mutation. DELETE verifies moderator role, validates the target media UUID, reads the media row, invokes `deleteMediaObject` for managed R2 or Supabase storage cleanup, then deletes the Postgres row. Future consent belongs after `requireModerator` and before the media lookup, so it precedes the first irreversible storage deletion. Parent Batch 1 remains pending.
