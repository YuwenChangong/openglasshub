# OpenGlass Hub Verified Session v1 Design

**Status:** Design review candidate, 2026-09-23. No implementation or Production authorization is implied.

## 1. Context and decision

The product needs password plus an email code for every fresh login, while a successfully verified Supabase session continues through normal token refresh. A Supabase password sign-in already issues a usable session, so navigation-only code entry is not an authorization control. The header also currently renders account actions while its profile summary is unavailable, and login/callback/legal gates require a 16+ attestation that the product no longer wants.

Use a private, session-keyed verification record, checked dynamically at every protected database and Worker boundary. Do not add a custom access-token hook in v1. Supabase-authenticated `sub` and `session_id` claims identify the session only after cryptographic verification under the project's actual signing configuration, or inside a database request context where Supabase/PostgREST has already verified the user token. Neither `user_metadata` nor a browser flag is an authorization source. The new gate does not replace existing owner, moderator, catalog-admin, or policy-consent checks.

**Repository baseline:** `origin/main` `e6c2141be8827d961fc49462d66be8da9b4993eb`; isolated branch `feature/auth-verified-session-v1`. The dirty `D:\OpenGlass Hub` checkout is not modified.

## 2. Product contract and non-goals

- Anonymous: default avatar plus `未登录` is one link to `/login/?next=...`; no profile menu or statistics.
- Pending: a valid Supabase session without a verified-session record can only access public reads, auth recovery, its own challenge endpoints, and terms-consent bootstrap. It cannot use normal protected APIs, PostgREST, Storage, Realtime, or admin operations.
- Verified: a live Supabase session with a matching verified record can use existing protected features, still subject to existing ownership, moderation, admin, and current policy-consent rules. A profile-summary failure is a degraded authenticated UI, not a sign-out.
- Fresh login: password succeeds, a session becomes pending, a bounded email code is sent to the confirmed account address, correct code atomically verifies only that session, then a sanitized internal `next` is used.
- Normal refresh/reopen: the same `session_id` remains verified, with no email. Explicit logout revokes verification and signs out locally; a later new session requires a new code.
- Signup: terms/community acceptance without age attestation, Supabase signup confirmation **code**, and session verification after the signup code succeeds. Signup confirmation is not the fresh-login challenge.
- No trusted-device registry, risk score, SMS, paid service, new Product Detail, Compare v2, or frontend framework migration.

## 3. Current architecture, with evidence

| Area | Current code and consequence |
| --- | --- |
| Login/signup | `src/pages/login/index.astro` mounts `src/components/forum/AuthPanel.tsx`; the panel calls `signInWithPassword` and navigates after `recordLegalConsent`. Signup uses `signUp` and an email callback. Both modes require the 16+ checkbox before any auth call. |
| Callback | `src/pages/auth/callback.astro` mounts `src/components/auth/AuthCallback.tsx`; it exchanges an auth code, then sends a non-current or unavailable consent result to `/legal-consent/?reason=callback`. |
| Resend/reset | `src/pages/api/auth/resend-confirmation.ts` uses `auth.resend({type:"signup"})` with a server IP rate limit. `src/components/auth/ResetPasswordForm.tsx` is a separate recovery flow. Neither is password-followed-by-email verification. |
| Browser/session | `src/lib/supabase-browser.ts` persists and auto-refreshes the browser Supabase session. `src/lib/supabase-server.ts` creates an anon-only, non-persisting SSR client; no shared server cookie session is established by the current product routes. |
| Header | `src/components/site/SiteHeader.astro` hydrates `HeaderUserMenu.tsx`; `useBrowserAuthState.ts` calls `getSession()` and marks any session user signed in. HeaderUserMenu shows actions and zero-fallback stats even when `/api/users/me/summary` fails or has not loaded. The summary API separately calls `auth.getUser(token)`. |
| Authorization | Many Worker routes call `auth.getUser(token)` and `requireAuthenticatedLegalConsent`; direct Supabase access is independently governed by RLS. `src/lib/server/admin-auth.ts`, `circle-management.ts`, and route-local helpers are separate entry points. |
| Legal | `src/lib/legal-policy.ts` has `minimumAge:16`; `src/lib/server/legal-consent.server.ts` currently compares that age in the current-bundle check. `CommunityLayout.astro`, `LegalConsentGate.tsx`, `LegalConsentPage.tsx`, callback, and protected mutation guards rely on it. `supabase/migrations/20260712_legal_policy_acceptances.sql` persists historical `minimum_age` and grants only a narrow server writer. |
| Email | `docs/public-preview-launch-checklist.md` specifies Supabase Auth custom SMTP via Brevo. No current Worker code sends a fresh-login code; signup confirmation/resend and password reset use the Supabase Auth delivery path. |

No existing application code was found using `verifyOtp`, `signInWithOtp`, or Supabase MFA as a fresh-login second step. `getSafeNext` in `src/lib/auth-redirect.ts` rejects external and repeatedly encoded unsafe destinations and is reused unchanged.

## 4. Architecture alternatives

| Option | Security | Complexity | Free tier | RLS | Migration/operations | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| A. Frontend-only code screen after password | Fails: password token already accesses APIs and PostgREST | Low UI, false assurance | Yes | No enforcement | Low initial work, high incident risk | Reject. |
| B. Session table plus Custom Access Token Hook and `verified` JWT claim | Strong only with additional live-session/revocation checks; otherwise an old true JWT remains true until expiry | High | Custom hook is Free | Can check claim, but logout still needs live state | Hook enablement, refresh sequencing, claim rollout | Not selected for v1. |
| C. Session table plus a narrow live database predicate | Strong if every protected API/RLS/Storage path is covered and the predicate checks a live session | Moderate/high authorization audit | Existing Free database/Worker | Direct, fail-closed | More DB reads; no hook configuration or claim refresh race | **Recommended.** |

Supabase documents `session_id` as a required signed JWT claim and identifies it with `auth.sessions.id`; sign-out removes affected session rows. A Custom Access Token Hook is available on Free, but no hook is necessary for option C. Supabase's email OTP is passwordless sign-in and must not be mistaken for this session-bound second step. Sources: [session lifecycle](https://supabase.com/docs/guides/auth/sessions), [JWT claims](https://supabase.com/docs/guides/auth/jwt-fields), [auth hooks](https://supabase.com/docs/guides/auth/auth-hooks), [email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless).

## 5. State machine and source of truth

The public UI state is `ANONYMOUS | PENDING_VERIFICATION | VERIFIED_AUTHENTICATED`; policy consent is a **separate** axis (`CURRENT | NEEDS_ACCEPTANCE | UNAVAILABLE`). Invalid, missing, expired, or unverifiable tokens are anonymous for authorization. A valid session without a verified record is pending. A verified row for the same `user_id/session_id` **and a still-live `auth.sessions` row** is verified. Database lookup failure fails closed. The browser may temporarily show a checking state but must never render verified actions from a cached user object alone.

Allowed transitions: anonymous -> pending after password; pending -> verified only through the atomic code-verification transaction; verified -> verified on refresh of the same session; verified/pending -> anonymous on logout/expiry; any new session -> pending. A verified record can never migrate to a different session ID. Separate signup-code verification can create the initial verified signup session only after locally proven provider signup-confirmation provenance and terms acceptance. A generic OTP, magic link, recovery, or email-change session is not signup proof.

## 6. Data, JWT, and challenge lifecycle

Create a **new forward migration**, not edits to historical migrations:

- `private.ogh_verified_sessions`: `(session_id uuid primary key, user_id uuid not null, verified_at timestamptz not null, verification_kind text not null)`; no browser table grants. A row is authoritative only while the corresponding `auth.sessions` row is live and owned by `user_id`.
- `private.ogh_login_challenges`: opaque challenge ID, user ID, session ID, HMAC-SHA256 digest of `{challenge_id,user_id,session_id,code}` using a Worker-only pepper, creation/expiry timestamps, attempt counter, resend count/cooldown, delivery state, and consumed/superseded timestamps. No plaintext code, no public grants.
- `private.ogh_email_send_budget`: transactional daily counters keyed by UTC day plus per-user/session/IP-hash limits, changed atomically before a send. No email address or IP in budget logs.
- `private.ogh_policy_acceptances`: user ID, Terms/Privacy/Guidelines versions, acceptance source, and timestamps; no age column and no direct browser grants. A narrow server writer records a user's explicit policy acceptance after identity validation.
- Narrow fixed-`search_path` SQL functions: a no-argument `ogh_is_verified_session()` predicate for RLS, and service-role-only atomic reserve/consume/revoke operations. The predicate reads `auth.uid()`/`auth.jwt()->>'session_id'` only in an already-verified Supabase/PostgREST user-token database context, plus the verified row and `auth.sessions`; it never accepts a client-supplied user or session ID. The `SECURITY DEFINER` owner and exact grants require local ACL tests; ordinary users receive no write or direct select privilege on private state. These four private tables are the v1 model; no signup-intent persistence is specified.

Worker auth challenge endpoints may use `session_id` and `amr` only from a cryptographically verified Supabase-authenticated source. Preferred class A is an official/current Supabase mechanism that verifies access-token claims under this project's actual signing configuration. Class B is a narrow user-token database RPC/function that derives identity and session from `auth.uid()`/`auth.jwt()` in an already-verified Postgres request context and returns only the minimum server-side session-verification result. The implementation plan must inspect the actual repository and Supabase signing setup, choose the smallest supported class, and prove it locally. Calling `getUser(token)` can validate the user, but does **not** authenticate claims from a separately raw-decoded JWT. Raw base64 JWT payload decoding, client-supplied `session_id` or `amr`, and `user_metadata` are prohibited as authorization sources. If neither class can be proven locally, set `BLOCKED_SIGNED_SESSION_CLAIMS=true`, stop implementation, and return to architecture review; never downgrade to decoded-but-unverified claims. Start requires a verified password authentication method, non-anonymous user, confirmed email from the provider (never an arbitrary request email), and a still-live pending session. If `amr` is missing or does not prove password, start fails closed and asks for a fresh password login. A six-digit cryptographic code expires after 10 minutes; five incorrect attempts consume a challenge. Verification compares HMAC digests and inserts the verified row in one database transaction, with a unique session binding. Wrong, expired, superseded, consumed, or exhausted challenges cannot verify any session.

Only one current challenge may exist per session. Concurrent start/resend requests use a unique key and row lock; duplicates receive the same generic pending state without another send. Resend waits at least 60 seconds, permits at most three sends per session and five per account per UTC day, supersedes the earlier code, and retains the attempt budget. IP-hash and global limits also apply. On an ambiguous provider response, do not automatically retry or mark the challenge verified. A sent code whose state cannot be finalized is unusable; return retry-later, not success.

The fresh-login code is sent from the Worker through **Brevo's free transactional HTTPS API**, using a new server-only API key and the already verified sender. Existing Supabase Auth -> Brevo SMTP remains unchanged for signup confirmation/reset. Do not switch to Supabase's default mailer, add another vendor, or log the code/password/API key. Brevo's [transactional endpoint](https://developers.brevo.com/reference/send-transac-email) is available with a [300-email/day Free quota](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan); the design caps custom challenge sends at 100/day to reserve headroom for existing Auth mail. This cap is not a guarantee that shared SMTP volume stays below 300: provider quota/queue uncertainty fails closed, and expired delayed codes are rejected. No automatic paid fallback or other security/login-success email is added.

## 7. User journeys

| Journey | Required sequence |
| --- | --- |
| Signup | Show Terms and Community Guidelines acceptance without age declaration. Supabase `signUp` sends a signup code via the existing Brevo SMTP path, using a reviewed email template. A server endpoint calls `verifyOtp({email,token,type:"email"})`, requires locally proven signup-confirmation provenance from the actual supported provider flow/verified session claims and behavior, records non-age policy acceptance, and marks only that session verified before releasing it to the browser. Direct provider verification outside this endpoint still yields a pending session, not access. Generic OTP, magic link, recovery, and email-change flows must never activate signup. If local integration cannot distinguish the actual signup confirmation safely from these flows, set `BLOCKED_SIGNUP_PROVENANCE=true`, stop implementation, and return to architecture review; do not add a signup-intent subsystem without a separate reviewed design change. |
| Fresh login | Browser `signInWithPassword`; the resulting token is pending by default. Call start once, show code entry, verify server-side, then navigate to `getSafeNext(next)`. Failure leaves the session pending and exposes only recovery or sign-out. |
| Continuing session | Browser refreshes/reloads normally. Same signed `session_id` finds the live verified row; no challenge creation or email send on token refresh, tab reopen, or daily return. |
| Logout | Revoke this session's verification record first, then `auth.signOut({scope:'local'})`; clear browser UI. If either step fails, do not report a successful logout. Other independently verified sessions remain unaffected. The predicate checks `auth.sessions` existence so direct provider sign-out also invalidates a verified row for authorization; cleanup of orphan records can be bounded later. |
| Password reset/email change/magic link | Keep current recovery flows distinct. Any new provider session starts pending unless it is the explicitly reviewed signup-code case. Recovery links and generic OTP/magic-link sign-in do **not** mark a fresh-login challenge complete. After password reset, require a fresh password + email challenge for normal access. |

- `SIGNUP_VERIFICATION=Supabase signup code; server-side provider verification and session-bound activation`
- `FRESH_LOGIN_VERIFICATION=Worker/Brevo code bound to a password-created Supabase session`
- `PASSWORD_RESET=existing recovery link, then new password login challenge`
- `EMAIL_CHANGE=existing provider confirmation, no verification transfer to a new session`
- `MAGIC_LINK=not a v1 full-access path`
- `OTP=signup code or custom fresh-login code, never interchangeable`

## 8. Authorization surface matrix

This is an inventory and implementation acceptance matrix, not a claim that current guards already enforce the new state. Each route requires an explicit test of `PENDING` denial and `VERIFIED` existing behavior. Public GETs remain public.

| Surface | Representative code | V1 enforcement |
| --- | --- | --- |
| Public content/SSR | `src/pages/products/*`, feed/news public routes, `src/lib/supabase-server.ts` | Preserve anonymous public reads; client route guard is UX only. |
| Private SSR/UI | `CommunityLayout.astro`, `LegalConsentGate.tsx`, `/me/`, `/notifications/`, `/admin/` | Route pending users to code flow; do not render private data or rely on this for security. |
| Header/session/summary | `HeaderUserMenu.tsx`, `HeaderNotifications.tsx`, `/api/users/me/summary`, `/api/users/me/notifications` | `/api/auth/session-state` reports server-validated state; summary/private notifications deny pending; verified summary failure shows deliberate identity fallback and no fabricated counters. |
| User profile writes | `/api/users/me/profile`, profile/media helpers | Check verified before existing owner/consent/media checks. |
| Community writes | `/api/forum/posts`, `/comments`, `/circles`, `/circles/[slug]/{posts,comments,manage}`, `/reports` | Check verified before existing actor, moderation, ownership, visibility, and consent checks. Includes reactions/votes embedded in these routes. |
| Media/external upload | `/api/forum/{post-media,media-upload-guard,external-video-upload}`, signed upload paths, R2 mediation | Check verified before signing/upload or cleanup; preserve existing provenance and ownership checks. |
| Admin/catalog/news/moderation | `/api/admin/{devices,news,forum/*,moderation/*,reports/*,users/*}` | Check verified **and** existing admin/role/consent guards; service-role operations remain server-only. |
| Direct PostgREST/RPC | RLS on `profiles`, `posts`, `comments`, `post_votes`, `bookmarks`, `comment_reactions`, `circles`, `post_media`, `forum_notifications`, `reports`, `devices`, `news_articles`, safety/admin data and callable mutating RPCs | Add restrictive verified-session condition to authenticated writes and private reads without removing existing policies; review all grants and functions, including security-definer RPCs. Public published/read-only policies stay available. |
| Storage/Realtime | `storage.objects` policies for post-media, circle cover, profile avatar/banner and news media; browser Realtime auth | Authenticated writes/private reads require verified session; public media reads remain public. Realtime private channel access follows the same RLS or channel authorization, tested directly. |
| Bootstrap exceptions | `/api/auth/*`, `/api/legal/consent`, public read-only GETs | Challenge/verification and terms acceptance are narrowly authenticated but exempt from the verified gate to avoid deadlock; never grant unrelated writes. |

Every API response to a pending session uses a stable `VERIFICATION_REQUIRED` status with a safe internal destination. Failed proof is `401`; temporary verification service failure is `503`, not success. Existing permission denials remain `403` after verification. Where current code constructs service-role clients, the verified check must occur before the privileged operation and be proven by call-log tests. Direct database routes cannot rely on the Worker check alone.

## 9. Legal and age separation

The login/signup UI, callback, layout gate, footer account-status text, and `LegalConsentPage` must not request or imply 16+ attestation as an auth condition. Terms/Privacy/Guidelines/Safety routes remain. A policy-only acceptance page may still appear when policy versions genuinely require acceptance, but it must contain **no age checkbox** and must not be represented as authentication.

Retain the historical `legal_policy_acceptances.minimum_age` column/rows and historical migrations untouched. Create `private.ogh_policy_acceptances` and its narrow writer in a forward migration. The read model recognizes an existing historical record as current when its Terms/Privacy/Guidelines versions match, ignoring `minimum_age`; new acceptances write only the new table. On version changes, new policy-only consent is requested. Separate `requireCurrentPolicyConsent` from `requireVerifiedSession`; both apply to protected community mutations, while the bootstrap consent endpoint remains reachable to a pending session. No new auth decision reads age. Existing legal documents are not silently rewritten; any continuing age eligibility language in Terms requires a separate policy-owner decision before public rollout.

## 10. Threat model

| Threat | Current risk | Mitigation | Enforcement layer / test |
| --- | --- | --- | --- |
| 1. Password token used before code | Full Supabase session exists immediately | No verified row by default | RLS/API: password-only direct calls denied. |
| 2. Direct PostgREST bypass | Frontend guard irrelevant | Restrictive policies and private predicate | Raw REST with pending JWT denied. |
| 3. Direct Worker API bypass | `getUser` currently suffices | Shared verified check before actions | Call-log test: zero downstream calls. |
| 4. Refresh before code | Refresh could be mistaken for approval | State keyed to stable session ID | Refresh remains pending. |
| 5. Code replay | Reused proof could mark another session | Atomic consume, session binding | Concurrent verify: one success only. |
| 6. Brute force | Six digits are guessable | Five attempts, expiry, IP/user limits | Sixth guess denied. |
| 7. Resend abuse | Free mail quota finite | 60s/3-session/5-account/100-global limits | Concurrent duplicate sends <=1. |
| 8. Simultaneous logins | Codes could cross sessions | Distinct session IDs and challenge rows | Code A cannot verify B. |
| 9. Old code after resend | Old email may arrive late | Supersede/consume previous challenge | Old code denied. |
| 10. Session fixation / claim spoofing | Client chooses state IDs or supplies raw-decoded JWT claims | Only cryptographically verified Supabase claims or verified user-token DB context; no client `session_id`/`amr`/`user_metadata` | Forged claims and `getUser` plus separately decoded payload rejected. |
| 11. Stolen pending token | Attacker may use it | No protected privilege; code delivered to provider email | Pending direct API/RLS denied. |
| 12. Logout then old JWT | JWT remains cryptographically valid briefly | Verified-row revocation and live `auth.sessions` check | Old token denied after logout. |
| 13. Stale browser session | Cached user can render menu | Server session-state result controls header | Invalid/stale fixture anonymous. |
| 14. Expired code | Late delivery possible | DB expiry checked atomically | Late code denied. |
| 15. Account enumeration | Send endpoints reveal address | Require validated password session; generic responses | Unknown-email response parity. |
| 16. Malicious `next` | Open redirect | Existing `getSafeNext` at every sink | Encoded/external inputs fall back. |
| 17. User metadata tampering | Client can edit it | Do not read it for authorization | Tampering has no effect. |
| 18. Summary failure | Fake empty account with actions | Auth state separate; deliberate degraded verified UI | Summary 500 does not fabricate stats. |
| 19. Age removal weakens policy | Single old consent guard mixes both | New policy-only decision, existing moderation/RLS retained | Terms required where applicable; no age gate. |
| 20. Historical users | No verified-session record exists | One-time fresh password+code; no grandfather bypass | Existing account pending until verified. |
| 21. Signup flow confused with generic OTP | `verifyOtp` success alone may not identify original purpose | Require locally proven signup-confirmation provenance; otherwise `BLOCKED_SIGNUP_PROVENANCE=true` | Generic OTP/magic link/recovery/email change never activate signup. |
| 22. Partial Production activation | One layer could still accept password-only access | Reviewed phased cutover; no full-active claim until DB and Worker/API gates pass | Pending JWT denied on both direct database and privileged Worker paths. |

Additional failure cases: missing Brevo secret/quota, database outage, malformed `amr`, missing session row, unknown hook/config state, or partial challenge writes all fail closed. Email provider acceptance does not prove delivery. No OTP, password, token, raw IP, HMAC pepper, or full address is logged.

## 11. Compatibility, migration, rollout, and rollback

Before Production approval, prove locally: grants, policy coverage, function ownership, live auth-session lookup, trusted claim extraction, signup provenance, provider template, and free-tier behavior. In local/preview, exercise every authorization matrix row with anonymous, pending, verified, staff, and direct REST/Storage actors; preserve public reads and bound Brevo sends to test mailboxes. The Production migration, RLS/RPC/Storage grants, API-key binding, template, and exact order require separate review and authorization. The implementation plan must derive the cutover mechanism from the repository rather than assume a particular feature gate.

1. **Backward-compatible code ready:** Deploy challenge/session-state capability in a mode that does not claim full Verified Session enforcement and makes no Production database assumption before its migration exists. Public reads and existing app availability remain intact; incomplete infrastructure must not be labeled fully active.
2. **Database security layer:** Apply the separately reviewed forward migration for private state, predicates/functions, grants, and restrictive RLS/RPC/Storage protections. Confirm direct client/PostgREST pending-JWT bypass is blocked before moving on. A failed prerequisite is a stop, not a reason to weaken policy.
3. **Worker/API enforcement activation:** Activate verified-session checks before every privileged Worker/API/service-role operation through a separately reviewed repository-appropriate mechanism. No new paid infrastructure is implied. Existing owner/role/policy checks remain in force.
4. **Bounded auth verification:** Prove anonymous public read; password-only/pending denial; verified access; direct PostgREST pending-JWT denial; privileged Worker/service-role pending denial; logout invalidation; challenge and signup flows; policy consent separate from auth; and absence of an age gate. Include direct Storage/RPC and any private Realtime paths in the matrix audit. Existing pre-v1 sessions may require a one-time fresh password plus email code; v1 has no grandfather bypass.
5. **Release closeout:** Declare Verified Session v1 fully active only after all database and Worker/API enforcement layers pass the bounded checks. There must never be a state described as fully active while any direct database or Worker/API path still accepts an unverified password-only session. Record evidence and obtain the release authorization required for activation.

Rollback after activation is fail-closed: disable new challenge issuance if needed and keep public reads available, but do not drop the verified gate while password-issued sessions exist. There is no automatic fallback to single-factor auth. Reverting that security contract requires its own explicit security decision and release authorization. Orphan challenge/verified rows can be cleaned through a separately reviewed bounded job; they never authorize a new session.

## 12. Testing, observability, and cost

Use pure state-machine tests, mocked Brevo transport, transactional local Postgres concurrency tests, signed local Supabase sessions, direct PostgREST/Storage bypass tests, and route call-log tests. Local integration must prove the selected official verification mechanism under the actual signing setup or the narrow user-token DB context; test that `getUser` plus raw JWT decoding, client-provided `session_id`/`amr`, and `user_metadata` cannot grant access. Exercise actual signup confirmation against generic OTP, magic link, recovery, and email-change behavior and claims; if provenance is not provable, set `BLOCKED_SIGNUP_PROVENANCE=true` and stop. Cover wrong/expired/reused/cross-session code, duplicate requests, refresh, logout, legacy users, legal-policy compatibility, safe redirects, header states, and profile-summary degradation. Run existing auth/legal/header/RLS suites, full `npm test`, build, and `git diff --check` at implementation completion. Use 390px, 430px, and desktop local/authorized preview screenshots for login, code, resend, and header; no Production mutation or canary is authorized by this spec.

Observe only aggregate counters and reason codes: pending starts, accepted/failed deliveries, verification success/failure/expiry, quota refusal, authorization denials, and hook-free session lookup failures. Correlate with random request IDs; do not log challenge values or bearer tokens. Rate-limit and storage are existing free Postgres/Worker capacity, but availability is bounded by Supabase Free, Workers Free, and Brevo Free quotas. Free exhaustion is retry-later/fail-closed, never an upgrade or automatic paid fallback. See [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/) and [Brevo Free limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan).

## 13. Review assumptions and future work

- Product/policy owner must confirm that historical Terms/Privacy/Guidelines acceptance without re-attesting age is valid for the current versions, and review any retained 16+ wording in legal documents. This is a release approval condition, not a code placeholder.
- Operator must confirm the existing Brevo Free account exposes a transactional API key for the already verified sender and that the shared daily budget is acceptable. The API key is server-only and requires separately authorized Production configuration.
- Local integration must prove the Supabase deployment exposes cryptographically verified password `amr`, stable `session_id`, and an `auth.sessions` row readable by a narrowly owned predicate. The implementation plan must inspect the real signing setup and prove class A or B from section 6; otherwise `BLOCKED_SIGNED_SESSION_CLAIMS=true` and this design returns for review without weakening the check.
- Local integration must prove the actual Supabase signup-confirmation flow can be distinguished safely from generic OTP/magic link, recovery, and email-change using supported provider/session claims and behavior before signup activation. Supabase documents the confirmation template's `{{ .Token }}` and `verifyOtp({email,token,type:"email"})`, but neither documentation alone nor endpoint success is proof of provenance. If proof fails, `BLOCKED_SIGNUP_PROVENANCE=true`; stop and return for architecture review, with no implicit fifth table. See [email templates](https://supabase.com/docs/guides/auth/auth-email-templates) and [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp).
- Local/preview audit must enumerate every effective Production grant/policy/RPC and media path, including drift from repository migrations. Unknown effective privileges block rollout.

Future risk-aware login may add a separate policy deciding **when** to require a challenge, using explicit reviewed signals and the same session-bound verification primitive. It must not alter v1's universal fresh-login challenge, introduce device tracking now, or make an unverified session privileged by default.

After this auth system is approved, implemented, separately released, and verified, the **next mandatory development task is Product Detail v2**: replace the `/products/{brand}/#product-{slug}` “查看产品” anchor with a real normalized Schema v1 device detail page while preserving legacy redirects. Compare v2 and unrelated features remain later.
