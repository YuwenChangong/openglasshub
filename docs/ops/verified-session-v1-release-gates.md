# Verified Session v1 release gates

**NON-EXECUTABLE review packet. Status: NO_GO.** This document records future gates; it is not approval to run a release stage. Each future Production mutation, hosted configuration change, deploy, email test, or verification stage needs separate authorization and an operator-owned evidence record. There is no default-open fallback. A failed, unknown, or incomplete gate stops the sequence and leaves Verified Session v1 inactive.

## Reviewed baseline

- Review the exact commit, diff, dependency lockfile, migration checksum, and owning operators before any stage. `@supabase/supabase-js` and `@supabase/auth-js` resolve to 2.112.4 in the lockfile; Supabase CLI resolves to 2.115.0. Revalidate if the deployed artifact differs.
- Preserve four private tables only: `private.ogh_verified_sessions`, `private.ogh_login_challenges`, `private.ogh_email_send_budget`, `private.ogh_policy_acceptances`. No fifth signup-intent table, client-selected signup type, or Custom Access Token Hook belongs to v1.
- Review these eight exact SQL interfaces, owners, search paths, effective EXECUTE grants, and callers. The two user-token predicates expose booleans only; the six mutation functions are service-role only:
  - `public.ogh_is_verified_session()`
  - `public.ogh_reserve_login_challenge(p_user_id uuid, p_session_id uuid, p_challenge_id uuid, p_digest bytea, p_ip_hash text, p_resend boolean)`
  - `public.ogh_finalize_login_delivery(p_user_id uuid, p_session_id uuid, p_challenge_id uuid, p_accepted boolean)`
  - `public.ogh_consume_login_challenge(p_user_id uuid, p_session_id uuid, p_challenge_id uuid, p_digest bytea)`
  - `public.ogh_activate_signup_session(p_user_id uuid, p_session_id uuid)`
  - `public.ogh_revoke_verified_session(p_user_id uuid, p_session_id uuid)`
  - `public.ogh_record_policy_acceptance(p_user_id uuid, p_bundle text, p_terms text, p_privacy text, p_guidelines text, p_source text)`
  - `public.ogh_has_current_policy_acceptance(p_bundle text, p_terms text, p_privacy text, p_guidelines text)`
- The private schema and tables have no browser-role direct grants. Function owner is `postgres`, `search_path` is empty, and `SECURITY DEFINER` grants are narrow. Compare effective Production ACL/RLS, exposed schemas, functions, storage policy, publication membership, and drift against the reviewed migration before any Production change. Repository text or a local replay alone is insufficient.

## Authorization surface ledger

| Surface | Future gate evidence |
| --- | --- |
| Auth routes | `/api/auth/session-state`, `/api/auth/login-challenge/start`, `/api/auth/login-challenge/resend`, `/api/auth/login-challenge/verify`, `/api/auth/signup-confirm`, `/api/auth/logout`, `/api/auth/resend-confirmation`: signed identity, password versus signup provenance, live session, no-store responses, bounded sends, and revoke-before-signout. Pending can use only the narrow bootstrap/challenge paths. |
| Legal route | `/api/legal/consent`: explicit current Terms, Privacy, and Guidelines acceptance bound to signed current user; narrow pending bootstrap only. Historical acceptance is policy currentness, not session verification. |
| Protected routes | `/api/users/me/` summary/profile/notifications; `/api/forum/` posts/comments/circles/reports/post-media/media-upload-guard/external-video-upload and `/api/forum/circles/[slug]/` posts/comments/manage; `/api/admin/` devices/news/reports (including `[id]` and `[id]/action`)/users, forum me/media/posts/reports/circles/purge, moderation approve/hide/reject/queue/lexicon-health, users `[id]` ban/unban/suspend/warn/clear-warning/safety, and trusted-runtime capability: verified-session check before owner/role/consent/rate-limit work and before any privileged service-role call. Existing role, ownership, moderation, catalog-admin, and legal rules still apply. |
| Public and media routes | `/api/news`, `/api/media/`, published products/feed/circles/search and public media remain anonymous. Caller-specific private media and R2 presigned upload need the verified gate. Public view counters retain public behavior. |
| Service-role paths | `legal-consent-repository.server.ts` has only the narrow pending consent writer; `consume-forum-rate-limit.server.ts`, `moderation-notifications.server.ts`, `supabase-admin-client.server.ts`, `admin-circle-purge.server.ts`, and `supabase-admin.server.ts` require verified caller and existing role/owner checks before construction or invocation. Pending call logs must show zero privileged downstream calls. |
| RLS tables | `profiles`, `circles`, `posts`, `comments`, `reports`, `report_events`, `moderation_actions`, `post_votes`, `bookmarks`, `comment_reactions`, `post_media`, `forum_upload_attempts`, `forum_notifications`, `user_safety_states`, `user_safety_events`, `legal_policy_acceptances`, `news_articles`, `devices`, `device_spec_definitions`, `device_specs`, `device_sources`, `device_source_links`, `device_spec_evidence`, `catalog_audit_events`: verify authenticated writes and private reads deny pending, with public SELECT branches retained and owner/role limits unchanged. |
| Direct RPC | Audit every effective EXECUTE grant, including `record_current_legal_policy_acceptance`, `consume_verification_email_resend_limit`, `increment_post_view_count`, `increment_news_article_view`, notification/rate-limit/admin purge/QA-role RPCs and the eight v1 interfaces. Consent/signup bootstrap and public counters are classified exceptions; ordinary mutators deny pending. |
| Storage | `storage.objects` policies for `post-media` post/cover, `profile-media` avatar/banner, and `news-media` cover/content: pending INSERT/UPDATE/DELETE and private SELECT deny; public media SELECT remains public. Test direct Storage as well as Worker routes. |
| Realtime | Direct Postgres Changes publication and RLS on `forum_notifications`, `comments`, `post_votes`, `comment_reactions`; pending private notifications deny, verified positive delivery works, client subscriptions start only after verification and tear down after logout or state loss. Public interaction visibility stays public where intended. |

## Hosted prerequisites and local/preview matrix

- Prove the hosted signing configuration with official `getClaims` for genuine and tampered password JWTs. For asymmetric signing, verify the JWKS path; for symmetric signing, verify the hosted Auth verification path. Confirm signed `session_id`, password `amr`, stable ID through refresh, new ID on new login, owned live `auth.sessions` row, and old JWT denial after logout. `getUser` checks liveness after signed claims; a separately decoded JWT or editable `user_metadata` is never authority. Missing claim, Auth, DB, or session result fails closed.
- Prove deployed provider-native signup with a genuine six-digit template `{{ .Token }}` code and server-hardcoded `type:"signup"`. Confirm returned identity/session, replay and superseded-code rejection, and negative generic OTP, magic link, recovery, email-change, cross-email, and client-selected-type controls. `type:"email"` or `amr=otp` alone does not prove signup. Keep Supabase Auth -> Brevo SMTP for signup/reset separate from Worker -> Brevo HTTPS fresh-login challenge.
- Confirm the already verified sender and server-only transactional API key on the existing Brevo Free account. Review the shared daily quota with signup/reset mail, the custom challenge budget of 100 global/day, five user/day, three session sends, IP-hash bound, and 60-second resend cooldown. Free exhaustion or provider uncertainty returns retry-later/fail closed; no paid service or automatic upgrade is part of this plan. Do not record API keys, addresses, codes, passwords, bearer tokens, or request logs in this packet.
- Policy owner reviews public Terms/Privacy/Guidelines wording, including retained 16+ text, and signs off on historical versioned acceptance without new age attestation. Authorization has no 16+ auth gate. Preserve public legal pages until that content decision is approved.
- Run the local/preview matrix under separately owned, bounded test identities: anonymous, pending password, verified A, fresh B, staff, service role, and old signed A after logout. Cover direct PostgREST/RPC/Storage/Realtime, every ledger row, public reads, wrong/expired/reused/cross-session code, concurrency/quota races, signup negative artifacts, consent independent from session state, and summary failure. Local/preview proof is a prerequisite, not hosted or Production proof. Capture login, code, resend, and header views at 390px, 430px, and desktop in authorized preview.

## Task 13 residual decisions

- **Realtime bounded observation:** Local pending private-notification denial was observed in two one-second windows, with a separate newly subscribed verified positive control, plus direct RLS/REST denial. This does not prove absence at arbitrary delay; an upgraded-in-place subscription did not deliver a usable public or private marker. Require a reviewed longer/bounded hosted or preview observation design and effective publication/RLS audit before closeout. Do not label the current observation exhaustive.
- **caller-controlled resend-hash residual:** The public `consume_verification_email_resend_limit` RPC caps five attempts per 24 hours for one hash, but a caller can rotate that hash to create fresh buckets and attempt rows. Server application paths derive their hash; Task 13 did not establish a mail-send bypass. The route/RPC owner must document an explicit risk decision or a separately reviewed trusted-caller redesign, plus effective hosted EXECUTE exposure, before activation. Unknown risk disposition is a stop gate.

## Future staged gates

### 1. Backward-compatible code ready

Separately authorize and review a deployment mechanism against the actual repository and deployed topology. Establish which capabilities can be present before the database migration without claiming Verified Session enforcement or depending on absent tables. Preserve public reads and availability. If the mechanism cannot make this intermediate state safe, stop for architecture review; do not improvise a default-open fallback.

### 2. DB security layer

With separate Production authorization, review the forward migration, four-table/eight-function inventory, owners, ACLs, restrictive RLS/RPC/Storage policies, effective Production drift, and live-session predicate. Prove pending direct PostgREST/RPC/Storage and private Realtime denial before continuing. Failure or an unknown effective grant stops the sequence; never relax the gate to proceed.

### 3. Worker/API enforcement activation

With separate Production authorization, activate the reviewed verified-session checks before every protected route and service-role operation. Confirm no privileged path accepts a password-only pending session, and owner/role/current-policy checks remain. Use only a repository-appropriate, reviewed activation mechanism; this packet invents no flag or deploy procedure.

### 4. Bounded auth verification

With separate Production verification authorization, use operator-approved bounded identities and evidence handling. Prove public anonymous reads, pending denial at direct DB/RPC/Storage/Realtime and Worker/service-role boundaries, verified access, logout/old-JWT denial, fresh-login challenge and provider-native signup/resend negative controls, current policy consent as a separate axis, and no age auth gate. Review actual hosted signing, sender/quota, template, ACL, and both Task 13 residual decisions. A test exit code alone is not acceptance.

### 5. Release closeout

Only after every preceding gate is evidenced and separately approved may an authorized release owner decide whether Verified Session v1 is fully active. Record the decision, reviewers, exact artifacts, exceptions, and remaining risks. Any pending direct or privileged bypass, unexplained hosted difference, or unresolved residual keeps status NO_GO.

## Rollback

Rollback preserves the verified gate and public reads. An authorized operator may disable new challenge issuance if necessary, but must leave pending sessions without privileged access; there is no default-open fallback and no automatic single-factor mode. A security-contract reversal or cleanup of orphan records requires its own reviewed, bounded decision and authorization. Do not drop the RLS/Worker gate while password-issued sessions remain.

## Evidence record

For each future stage record: stage and authorization reference; operator and independent reviewer; timestamp and environment; commit, built artifact and migration checksum; exact effective ACL/RLS/function/publication snapshot and drift disposition; hosted signing/session/AMR proof; provider template/type and sender/quota proof; route, direct DB/RPC/Storage/Realtime matrix results with bounded observation windows; public-read and logout controls; legal owner wording decision; Task 13 residual risk decisions; redacted aggregate reason codes and request IDs only; stop or proceed decision and rollback owner. Never attach credential-derived values or raw logs. Until those records and authorizations exist, status remains NO_GO.
