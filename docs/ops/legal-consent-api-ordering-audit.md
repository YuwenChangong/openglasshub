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

## Phase 4A1 Batch 3A - admin/users.ts GET

GET requires a verified moderator or administrator before parsing `q` and `limit`. It clamps `limit` to 1 through 200, lists profile identity/display/role fields, then reads safety rows for only those returned profile ids. Missing safety rows are represented by `createDefaultUserSafetyState`, and expired suspensions are normalized in memory; neither operation writes state. There is no auth-admin call, target action, self-action path, profile or role mutation, notification, email, audit, analytics, cache, or other side effect. The acting administrator comes only from `requireModerator`; response profile ids are not action inputs.

Findings: profile and safety query errors, plus generic caught errors, return raw `Error.message` values (Phase 4B hardening). `q` is embedded directly in the PostgREST `or` filter without a length bound or filter-grammar escaping, and the endpoint has no cursor pagination or read-rate limit (Phase 4B hardening). This is a read-only method, so no legal-consent insertion point applies and no mutation-specific partial-failure, idempotency, self-target, or privilege-escalation path exists.

## Phase 4A1 Batch 3B re-audit - admin/users/[id]/ban.ts POST

`POST` validates runtime env and a non-empty `[id]`, authenticates with `requireModerator`, then parses and bounds the reason. The route passes `auth.user.id` as actor and `[id]` only as the target resource; body, query, and headers cannot supply an actor id or role. The verified bearer produces an anon-key RLS client and the route rejects non-moderator/admin actors before JSON parsing.

Historical blocker: the former helper read only target `id`, allowing a moderator to target staff. Remediation commit `56af1cf6b7c4e0aa5df8f35539d5e4cceea80217` adds server-side actor and target `id,role` reads. Self-targeting is rejected first; missing or unknown roles deny; moderators may target only users; administrators may target users or moderators but never administrators. All authorization failures occur before `getUserSafetyState`, the first safety-state read, and before every write or notification.

After authorization, the method reads current safety state, upserts the state as its first irreversible effect, inserts the safety event, and attempts the notification RPC. An already-banned state returns `USER_ALREADY_BANNED` before writes, but no request idempotency key or transaction spans state/event/notification, and later helper errors can still reach the route's generic `Error.message` branch. Those are Phase 4B hardening findings. Future consent belongs immediately after `requireModerator` and before `request.json()`. The privilege blocker is cleared by this re-audit; Batch 3 remains pending at 24/66 traced and 42 pending, and Phase 4A1 remains NO_GO.

## Phase 4A1 Batch 3C - admin/users/[id]/clear-warning.ts POST

POST validates runtime env and a non-empty route target id, verifies the bearer moderator/admin before parsing its optional reason, then calls the shared safety helper with only `auth.user.id` as actor. The helper rejects self-targeting, reads both server-side profile roles, and applies the same fail-closed hierarchy before any safety-state read: moderators may target only users; administrators may target users or moderators but never administrators.

Clear warning rejects suspended or banned states. It decrements one warning and emits a `note` event with the verified actor when a warning exists; an active zero-warning state returns a no-op success without state write, event, or notification. There is no separate warning metadata to erase, and no clear-warning notification/email/external branch. The state upsert precedes the event, so event failure can leave committed state; concurrent requests have no idempotency key beyond the normal no-op path. Content type, body-size, rate limit, route UUID validation, and later raw helper-error exposure remain Phase 4B hardening. Future consent belongs after `requireModerator` and before JSON parsing. Batch 3 remains pending at 25/66 traced and 41 pending.

## Phase 4A1 Batch 3D - admin/users/[id]/safety.ts GET

GET validates runtime env and only a non-empty target id, then requires a verified moderator/admin before reading the target profile. It concurrently loads normalized safety state and the 100 most recent safety events ordered newest first, then reads profiles for distinct event actors. It does not invoke the user-safety action or privilege hierarchy helper because no mutation is attempted; there is no self-target or target-hierarchy action authorization path to apply.

The staff-only response includes the target role, full normalized state including `ban_reason` and `updated_by`, plus each event's actor id, reason, metadata, and actor profile. It does not select email. No safety-state, last-viewed, audit, event, notification, cache, RPC, email, external-service, or privileged-client mutation occurs. Raw database/helper `Error.message` values can reach 500 responses, and the endpoint has no UUID validation, cursor pagination, or read-rate limit; these are Phase 4B hardening findings. No consent insertion point applies to this read-only route. Batch 3 remains pending at 26/66 traced and 40 pending.

## Phase 4A1 Batch 3E - admin/users/[id]/suspend.ts POST

POST validates runtime env and a non-empty route target id, authenticates the bearer moderator/admin, parses a required sanitized reason, and passes `auth.user.id` plus the target id to the shared helper. The helper rejects self-targeting, re-reads actor and target roles through the RLS client, and completes the fail-closed hierarchy before safety-state access: moderators may target only users; administrators may target users or moderators but never administrators.

After a safety-state read, suspension rejects banned or effectively suspended targets and requires a valid future deadline. The first irreversible effect is the safety-state upsert, followed by the verified-actor safety event and a notification RPC attempt. A notification failure is swallowed; event insertion failure can follow a committed state update. An effective existing suspension returns `USER_ALREADY_SUSPENDED` before writes, but there is no request idempotency key or transaction for concurrent retries. Route UUID/content-type/body-size/rate validation and later raw helper-error exposure remain Phase 4B hardening. Future consent belongs after `requireModerator` and before JSON parsing. Batch 3 remains pending at 27/66 traced and 39 pending.

## Phase 4A1 Batch 3F - admin/users/[id]/unban.ts POST

POST validates runtime env and a non-empty route target id, verifies moderator/admin bearer identity, parses an optional reason, and passes only `auth.user.id` plus the target resource id to the shared helper. Self-target and the server-side actor/target role hierarchy complete before safety-state access: moderators may target only users; administrators may target users or moderators but never administrators.

The `unban` transition is not limited to a banned state: it also clears suspended state, including an expired suspension whose stored status remains suspended. It preserves warning count, strike count, and reputation while resetting status from the warning count and clearing `suspended_until`, `banned_at`, and `ban_reason`. An unrestricted target returns `USER_NOT_RESTRICTED` before writes. The state upsert precedes the verified-actor unban event; there is no unban notification/email/external branch. Event failure can follow committed state, and concurrent retries have no idempotency key. Route UUID/content-type/body-size/rate validation and later raw helper-error exposure remain Phase 4B hardening. Future consent belongs after `requireModerator` and before JSON parsing. Batch 3 remains pending at 28/66 traced and 38 pending.

## Phase 4A1 Batch 3G - admin/users/[id]/warn.ts POST

POST validates runtime env and a non-empty route target id, verifies moderator/admin bearer identity, requires a sanitized reason, and passes only `auth.user.id` and the target resource id to the shared helper. Self-target and server-side actor/target role hierarchy checks complete before safety-state access: moderators may target only users; administrators may target users or moderators but never administrators.

Warning rejects effectively banned or suspended targets. Each successful call increments warning count by one and decreases reputation by one, leaves strike count unchanged, and does not automatically suspend or ban at any threshold. State upsert is the first irreversible effect, followed by a verified-actor warning event and notification RPC attempt; notification failure is swallowed, while event failure can follow committed state. No already-warned/idempotency guard exists, so repeated or concurrent requests can create duplicate warnings/events/notification attempts. Route UUID/content-type/body-size/rate validation and later raw helper-error exposure remain Phase 4B hardening. Future consent belongs after `requireModerator` and before JSON parsing. Batch 3 remains pending at 29/66 traced and 37 pending.

## Phase 4A1 Batch 3 blocker - auth/resend-confirmation.ts POST

`POST /api/auth/resend-confirmation` is expected to remain an unauthenticated auth/recovery exemption: it accepts a target email and a client-controlled JSON `next`, so requiring legal consent before confirmation would prevent an unconfirmed account from reaching the authenticated callback and consent flow. That exemption does not validate redirects.

The route passes `payload.next` to `getSafeNext`. In `src/lib/auth-redirect.ts`, `getSafeNext` rejects a leading `//` but immediately returns every value satisfying `candidate.startsWith("/")`; it neither rejects backslashes nor resolves that candidate against the trusted origin. The unsafe input `/\\evil.example` therefore survives the sanitizer. `buildAuthCallbackRedirect` then serializes it into the same-origin `/auth/callback/` URL. `src/pages/auth/callback.astro` passes callback `next` to `AuthCallback`, which calls `getSafeNext` again and passes the result to `browserNavigationAdapter.replace`. That adapter invokes `window.location.replace`, whose special-URL normalization interprets `/\\evil.example` as `https://evil.example/`.

This is arbitrary external redirect injection after confirmation/callback processing and is release-blocking. Consent enforcement cannot repair it because the unsafe value is already propagated through the callback metadata and is also used after consent. Batch 3 tracing is paused: `resend-confirmation.ts#POST` remains pending, no later Batch 3 method may be completed, and progress remains 29/66 traced and 37 pending. All `getSafeNext` callers require centralized remediation review before this method receives a separate re-audit.

Centralized remediation is now implemented in `getSafeNext`: it accepts only a canonical application-relative path/query/hash that remains at the trusted origin after URL resolution, and rejects raw or repeatedly decoded backslashes, controls, boundary whitespace, protocol-relative authority, malformed encodings, absolute URLs, and cross-origin resolution. `buildAuthCallbackRedirect` and `buildResetPasswordRedirect` now share trusted-origin parsing, and browser navigation plus the legal-consent gate sanitize again at the final sink. Login, register/signup, resend confirmation, callback, consent, header/menu, CTA, and recovery callers were reviewed.

Re-audit at remediation commit `eb92faf98dd0dd60c10fb6d770781b3a99c1e604` clears the active redirect blocker. `POST` performs runtime-env handling, JSON parsing, email normalization, `getSafeNext`, basic email validation, anon auth-client construction, salted request-IP hashing, the five-per-24-hour verification rate RPC, trusted callback URL construction, and `supabase.auth.resend` in that order. The rate RPC records the first persistent effect before the provider call; generic success covers both provider-return and provider-throw paths, while outer failures return a fixed code. `/\\evil.example` now yields `/`; the test matrix also proves the same fallback behavior for authority, encoded authority/backslash, absolute URL, scheme, malformed-percent, control, whitespace, and userinfo variants. The callback component, consent gate, and browser adapter all sanitize again before navigation, so the browser sink receives only canonical internal output.

This remains an auth/recovery exemption: it intentionally has no authenticated actor, and the request email identifies only the account to confirm. Legal consent cannot be required before the confirmation session can exist, so no future consent insertion applies. The trace preserves non-blocking Phase 4B observations: no content-type or body-size check, an IP-only server rate limit that fails open when its backend is unavailable, no source-proven request idempotency or per-email limit, and no explicit RPC serialization. Progress is 30/66 traced and 36 pending; parent Batch 3 remains pending.

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
