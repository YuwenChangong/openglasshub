# Verified Session v1 release gates

**NON-EXECUTABLE review packet. Status: NO_GO.** This document records future gates; it is not approval to run a release stage. Each future Production mutation, hosted configuration change, deploy, email test, or verification stage needs separate authorization and an operator-owned evidence record. There is no default-open fallback. A failed, unknown, or incomplete gate stops the sequence and leaves Verified Session v1 inactive.

AUTH_RELEASE_STATUS=NO_GO

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

- **Local/preview schema gate:** Before activation, prove all four private tables and all eight SQL functions exist with exact ACLs. Record PASS/FAIL for each object and attach the effective owner, schema exposure, table grants, function EXECUTE grants, fixed search path, and RLS evidence. A missing or extra object, ACL mismatch, or missing evidence is FAIL and a stop; local/preview PASS is required before any separately authorized Production stage.
  - Tables: `private.ogh_verified_sessions`, `private.ogh_login_challenges`, `private.ogh_email_send_budget`, `private.ogh_policy_acceptances`.
  - Functions: `public.ogh_is_verified_session()`, `public.ogh_reserve_login_challenge(p_user_id uuid, p_session_id uuid, p_challenge_id uuid, p_digest bytea, p_ip_hash text, p_resend boolean)`, `public.ogh_finalize_login_delivery(p_user_id uuid, p_session_id uuid, p_challenge_id uuid, p_accepted boolean)`, `public.ogh_consume_login_challenge(p_user_id uuid, p_session_id uuid, p_challenge_id uuid, p_digest bytea)`, `public.ogh_activate_signup_session(p_user_id uuid, p_session_id uuid)`, `public.ogh_revoke_verified_session(p_user_id uuid, p_session_id uuid)`, `public.ogh_record_policy_acceptance(p_user_id uuid, p_bundle text, p_terms text, p_privacy text, p_guidelines text, p_source text)`, `public.ogh_has_current_policy_acceptance(p_bundle text, p_terms text, p_privacy text, p_guidelines text)`.
- Prove the hosted signing configuration with official `getClaims` for genuine and tampered password JWTs. For asymmetric signing, verify the JWKS path; for symmetric signing, verify the hosted Auth verification path. Confirm signed `session_id`, password `amr`, stable ID through refresh, new ID on new login, owned live `auth.sessions` row, and old JWT denial after logout. `getUser` checks liveness after signed claims; a separately decoded JWT or editable `user_metadata` is never authority. Missing claim, Auth, DB, or session result fails closed.
- Prove deployed provider-native signup with a genuine six-digit template `{{ .Token }}` code and server-hardcoded `type:"signup"`. Confirm returned identity/session, replay and superseded-code rejection, and negative generic OTP, magic link, recovery, email-change, cross-email, and client-selected-type controls. `type:"email"` or `amr=otp` alone does not prove signup. Keep Supabase Auth -> Brevo SMTP for signup/reset separate from Worker -> Brevo HTTPS fresh-login challenge.
- Confirm the already verified sender and server-only transactional API key on the existing Brevo Free account. Review the shared daily quota with signup/reset mail, the custom challenge budget of 100 global/day, five user/day, three session sends, IP-hash bound, and 60-second resend cooldown. Free exhaustion or provider uncertainty returns retry-later/fail closed; no paid service or automatic upgrade is part of this plan. Do not record API keys, addresses, codes, passwords, bearer tokens, or request logs in this packet.
- Policy owner reviews public Terms/Privacy/Guidelines wording, including retained 16+ text, and signs off on historical versioned acceptance without new age attestation. Authorization has no 16+ auth gate. Preserve public legal pages until that content decision is approved.
- Run the local/preview matrix under separately owned, bounded test identities: anonymous, pending password, verified A, fresh B, staff, service role, and old signed A after logout. Cover direct PostgREST/RPC/Storage/Realtime, every ledger row, public reads, wrong/expired/reused/cross-session code, concurrency/quota races, signup negative artifacts, consent independent from session state, and summary failure. Local/preview proof is a prerequisite, not hosted or Production proof. Capture login, code, resend, and header views at 390px, 430px, and desktop in authorized preview.

## Task 13 residual decisions

- **Realtime bounded observation:** The local harness subscribes a pending actor and a distinct verified recipient concurrently, requires a verified readiness event after startup, then emits eight private notification sentinel rows over a 10-15 second observation. Disposable local full SQL regression result: `OBSERVATION_WINDOW_MS=12043`, `SENTINEL_EVENT_COUNT=8`, `PENDING_EVENTS_RECEIVED=0`, `VERIFIED_EVENTS_RECEIVED=4` (all four verified-recipient sentinels). Missing positive control fails closed. Local evidence does not prove hosted behavior or absence at arbitrary delay. A later authorized hosted/preview bounded observation and effective publication/RLS audit remain required before closeout.
- **Resend repository remediation:** A forward migration makes `consume_verification_email_resend_limit` a service-role-only resend limiter: anon and authenticated `EXECUTE` revoked; fixed effective 5/24 policy ignores compatibility max/window arguments. The route derives the IP hash from server `RATE_LIMIT_SALT` and the Cloudflare-provided request IP, failing closed when the trusted header is absent. It invokes a narrow server-only service-role helper with timeout and fail-closed behavior, and keeps the Auth resend client anon-key based. Disposable local direct-RPC regression covers denied browser roles and fixed policy. This resolves the repository caller-controlled resend-hash residual, but hosted effective ACL proof is still required before activation. An unknown or divergent hosted grant is a stop gate.

## Future staged gates

### AUTH-A. Hosted inventory and provenance

A separate single-use authorization permits only its bounded read-only inventory. Bind the actual deployed old Worker source/build/configuration, target identity, effective catalog and migration provenance to reviewed A/B/D expectations; the pinned local old Worker is not evidence of the hosted deployment. Review signing mode, provider template, sender and shared Free quota without disclosing secrets. Unknown provenance, target drift, or catalog stage UNKNOWN is a stop; no later authorization is implied.

### AUTH-B. Foundation

A separate single-use authorization may cover only the reviewed Foundation artifact and exact target after AUTH-A proves PRE_V1 and the old Worker pairing. Verify four private tables, eight functions, fixed 5/24 resend with temporary anon/authenticated/service_role EXECUTE, unchanged public policies and old Worker login/write/resend behavior. Ambiguous application, unexpected ACL, or old Worker regression is a stop. No automatic retry or destructive reversal.

### AUTH-C. Transient Worker

A separate single-use authorization may cover one locked Worker build paired with FOUNDATION only after A/B/C/D local matrix proof, matching build/environment/configuration fingerprints, the reviewed Enforcement hash and preflight, a prepared but NOT_EXECUTED AUTH-D packet, reviewed C smoke plan, and a proven old Worker rollback artifact. The State C window records UTC start and deadline no more than 60 minutes apart. State C is transient, not a release state. A failed C smoke or blocked D must trigger same-window B rollback; unknown pairing or an expired window is a stop. Do not enter C without a ready D path and rollback owner.

### AUTH-D. Enforcement

A separate single-use authorization may cover the exact Enforcement artifact only while the same Worker remains paired with FOUNDATION and the C window is valid. Verify the catalog prerequisite and migration provenance before the forward change; then require effective 24-table restrictive mutation policies, six mixed and 14 private SELECT policies, four Storage policies, publication and final service-role-only resend ACL. Direct PostgREST/RPC/Storage/Realtime pending denial and verified positive control must pass. Unknown or ambiguous application is a stop, never a retry. After D, rollback floor is a verified-capable Worker, not the old Worker.

### AUTH-E. Bounded hosted verification

A separate single-use authorization may cover only explicitly owned identities, sends, sentinel rows and cleanup with enforceable numeric caps after AUTH-D. Prove public anonymous reads, pending denial at direct DB/RPC/Storage/Realtime and Worker/service-role boundaries, verified access, logout/old-JWT denial, fresh-login challenge, provider-native signup/resend negative controls, and current policy consent independently. Hosted signing, template, sender and shared quota must be positively checked. A failed or unknown control is a stop and retains NO_GO; local success or a test exit code alone is insufficient.

### AUTH-F. Release closeout

A separate single-use authorization may cover only the owner/reviewer closeout decision after every earlier evidence packet and cleanup receipt is reviewed. Record actual deployment, catalog stage, matching artifact hashes, bounded verification, exceptions and rollback owner. Any pending bypass, suspect-row uncertainty, unexplained hosted difference, or missing proof is a stop and leaves AUTH_RELEASE_STATUS=NO_GO.

## Rollback

Before Enforcement, B rollback returns the pinned old Worker while FOUNDATION remains and baseline authenticated behavior is proven. C exit must advance to D or return to B in the same-window plan; record C start/end UTC and classify verification integrity. A suspect-row window requires an exact affected-row inventory, independent valid-row proof or separately authorized bounded revocation, and a separately authorized read-only postcondition before reentry. UI/public-read-only failure is not proof of row integrity without positive challenge/activation/signed-mapping/bypass evidence. After Enforcement, the rollback floor is the same verified-capable Worker; old Worker plus ENFORCEMENT is forbidden. No default-open fallback, automatic retry, destructive down-migration, or silent grandfathering.

## Evidence record

For each future stage record: stage and authorization reference; operator and independent reviewer; timestamp and environment; commit, built artifact and migration checksum; exact effective ACL/RLS/function/publication snapshot and drift disposition, including the resend RPC grant; hosted signing/session/AMR proof; provider template/type and sender/quota proof; route, direct DB/RPC/Storage/Realtime matrix results with bounded observation windows; public-read and logout controls; legal owner wording decision; redacted aggregate reason codes and request IDs only; stop or proceed decision and rollback owner. Never attach credential-derived values or raw logs. Until those records and authorizations exist, status remains NO_GO.
