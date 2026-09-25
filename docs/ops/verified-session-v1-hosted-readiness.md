# Verified Session v1 Hosted Release Readiness

## Status

READINESS_STATUS=BLOCKED_NO_SAFE_CUTOVER
AUTH_RELEASE_STATUS=NO_GO

This is a repository-only, non-executable review. No hosted access, deploy, migration, email, test identity, or authorization was performed. The current feature artifact and the current database migration cannot be ordered safely against the old runtime without a separately reviewed intermediate cutover mechanism. The configured preview Worker is not an isolated Auth/database target.

## Reviewed artifact identity

| Artifact | SHA-256 |
| --- | --- |
| `supabase/migrations/20260923000000_ogh_verified_session_v1.sql` | `7a63681acf541cd9b895d2af92e2c3fc345a21957bbb753ad09048f329ace8ae` |
| `supabase/migrations/20260925012231_lock_verification_email_resend_limit.sql` | `87a124e9ee0113eeedb81be670fe1235f165d3fa2dfdfe25ac2b99535a3a0a56` |
| `package-lock.json` | `4014fa5046e955c58dc676dcbb2b90cbc70140e154841809b3b42028a855d982` |
| `wrangler.toml` | `d100aff387782a281f320694ab11048c42fb3da2f459adf311a7fa6c2ac450e7` |
| `astro.config.mjs` | `3409251b7bdb69b42121228e3b637edb4117afb8a8c60a01aba6367f970df7a2` |
| `scripts/build-workers.mjs` | `43e0fabd8e28f275d1a92242da0aa0d10ff185694041b9611f01339585c04b94` |
| `docs/ops/verified-session-v1-release-gates.md` | `2fc501a3169dbcace43f674cb16c3c86e0b7e92d687939c26e51e721a9cf1d6a` |

```text
SOURCE_COMMIT=54a56b9b9a7b106e8925efea7e1d6164e04b8614
BRANCH=feature/auth-verified-session-v1
SPEC_COMMIT=251ff339766b10a67731cfcc2ff97c705c3e6c78
PLAN_COMMIT=612e2de47d41f7337a8f42afe3280d5c9a0ca668
ORIGIN_MAIN_AT_REVIEW=e6c2141be8827d961fc49462d66be8da9b4993eb
BASE_DRIFT=NONE_FROM_PRIOR_REVIEWED_BASELINE
```

The future authorization must fail if the source commit, any listed hash, build artifact, target project, or target Worker differs. No secret value belongs in the evidence record.

## Deployment topology

| Conclusion | Repository evidence |
| --- | --- |
| Canonical Production origin is `https://openglasshub.ogh.workers.dev`; Worker name is `openglasshub`, with `production` and `preview` environments. | `wrangler.toml` `name`, `[env.production.vars]` `SITE_ORIGIN`, `[env.preview]`; `scripts/qa/test-workers-production-origin-cutover.mjs` |
| Current build produces a native Cloudflare Worker with static assets, not the old Pages build contract. Pages deployment instructions are legacy and must not be used for this release. | `package.json` `build`; `scripts/build-workers.mjs`; `astro.config.mjs`; `scripts/qa/test-workers-native-config.mjs`; compare older `docs/ops/deployment-playbook.md` and `docs/forum-ssr-deployment.md` |
| `preview` and `production` are configured with the same Supabase project origin; a preview Worker does not provide separate Auth/database state. | `wrangler.toml` `[env.preview.vars]` and `[env.production.vars]` `SUPABASE_URL` / `PUBLIC_SUPABASE_URL` (project reference compared without reproducing key values) |
| Preview and Production name the same R2 bucket; KV namespace IDs differ in source configuration. Effective deployed bindings and secret inheritance are not proven offline. A preview that shares the Production Supabase project is production-backed even if its URL differs. | `wrangler.toml` R2/KV sections; `docs/ops/preview-qa-safety.md` |
| SSR/browser Supabase access, post-media Storage, notification Postgres Changes, Worker service-role calls, and Auth signup/reset all depend on the configured Supabase project. | `src/lib/supabase-server.ts`, `src/lib/supabase-browser.ts`, `src/lib/server/verified-session.server.ts`, `src/pages/api/auth/signup-confirm.ts`, `docs/ops/verified-session-v1-release-gates.md` |
| Fresh-login challenge uses Worker-to-Brevo HTTPS; signup/recovery uses Supabase Auth-to-Brevo SMTP. Runtime bindings by name: `BREVO_API_KEY`, `BREVO_VERIFIED_SENDER_EMAIL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT`, and `OGH_LOGIN_CODE_PEPPER`. | `src/lib/server/brevo-challenge.server.ts`, `src/lib/server/login-challenge.server.ts`, `src/pages/api/auth/resend-confirmation.ts`, `docs/superpowers/specs/2026-09-23-auth-verified-session-v1-design.md` |
| Actual deployed commit, effective secrets, deployed preview URL, provider signing mode, SMTP template, and current plan/quota are `UNKNOWN_FROM_REPOSITORY`. | No provider query was authorized; `wrangler.toml` and docs are source intent, not hosted observation. |

## Preview-target conclusion

```text
HOSTED_PREVIEW_TARGET=WORKER_PREVIEW_ONLY_PRODUCTION_BACKEND
PREVIEW_USES_SEPARATE_SUPABASE=false
```

The `preview` Worker configuration points at the same Supabase Auth/database project as `production`. It is unsuitable for unapproved Auth, migration, Realtime-sentinel, or email tests. No separate zero-cost hosted Supabase target is proven. A future bounded Production campaign needs its own authorization, but first needs a safe cutover design.

## Cutover ordering proof

PRE_DB_CODE_DEPLOY_SAFE=false. At this commit, `src/lib/server/verified-session.server.ts` calls `ogh_is_verified_session` on protected requests; `src/pages/api/auth/session-state.ts` returns 503 for an authenticated session if that RPC is absent. Signup and challenge paths also call new `ogh_*` functions. Anonymous public reads may continue, but ordinary login/protected flows cannot be called backward-compatible. There is no reviewed default-off enforcement flag.

DB_BEFORE_NEW_WORKER_SAFE=false. `supabase/migrations/20260923000000_ogh_verified_session_v1.sql` adds restrictive `ogh_is_verified_session()` gates to 24 public table mutation surfaces, private reads, and selected Storage operations. The old Worker (as represented by `origin/main`) validates `getUser` but does not create a verified-session row, so existing password sessions fail those new gates. The subsequent resend-lock migration revokes anon/authenticated EXECUTE while the old `src/pages/api/auth/resend-confirmation.ts` still invokes the RPC with an anon client. Public SELECT branches are deliberately preserved, but that alone does not preserve authenticated behavior. The actual deployed commit is unknown, so a hosted inventory is also mandatory.

RECOMMENDED_CUTOVER_ORDER=NONE_UNTIL_REVIEWED_INTERMEDIATE_ARTIFACT. The design's five stages are not executable as written. Conditional future sequence: P0 lock source and hosted baseline; P1 design, implement, locally prove, and independently review a backward-compatible intermediate runtime or other safe activation mechanism; P2 separately authorize that exact intermediate artifact; P3 separately authorize DB migration with effective-ACL stop gates; P4 separately authorize final Worker enforcement; P5 separately authorize bounded hosted verification; P6 owner closeout. P1 has no artifact today, so P2-P6 are blocked. Never treat a 503 loop or a blanket default-open fallback as a safe intermediate state.

| Conditional stage | Preconditions and artifact | Allowed future action and expected mutation | Stop, rollback, evidence |
| --- | --- | --- | --- |
| P0 | Reconfirm hashes, target, deployed commit, free quotas, operator/reviewer | Repository/approved hosted inventory only; no mutation in this task | Drift or unknown target stops. Record exact reviewed artifacts. |
| P1 | New reviewed cutover artifact not yet available | Separate repository work and local proof only | Must prove both intermediate orders, public reads, login, writes, resend, and failure behavior before any deploy. |
| P2 | P1 proven and separately approved | At most one explicitly scoped runtime deployment | Stop on mismatch; rollback only to an artifact proven compatible with the current DB. Record artifact and smoke evidence. |
| P3 | Compatible runtime live, catalog preflight authorized, migration hashes locked | Explicitly authorized forward DB migrations, exact two artifacts | Stop on drift/failure/ambiguous commit. No blind down-migration; require reviewed compensating plan. |
| P4 | DB effective ACL/RLS passes, final Worker artifact locked | One explicitly authorized runtime activation | Stop on 5xx/login/public regression; rollback must preserve deny-by-default and DB compatibility. |
| P5 | Runtime and DB proven, owned test identities, bounded budgets authorized | Explicit test rows, Auth sessions and bounded email sends only | Stop at first failed positive/negative control or cap. Clean only owned fixtures under authorization. |
| P6 | All evidence passes and owner approves | Documentation/status decision only | NO_GO remains until a distinct release decision. |

## Required hosted evidence

The following is a *future planning matrix*, not permission to execute. `P` means Production Supabase/Worker; even metadata reads require authorization. `A/B/C` are three owned test identities. A shared prerequisite is counted once; zero in later rows means no additional mutation. Proposed campaign ceilings are 3 users, 5 sessions, 24 Auth API state-changing calls, 64 explicitly test-owned database rows, 9 emails, and 10 notification inserts including two readiness/startup rows. Provider-internal Auth row amplification is unknown and must be measured or given a separate cap before authorization.

| Check | Target | Read/write | Expected mutation; max additional mutations | Email sends | Identities | Cleanup / rollback | Authorization |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A `getClaims()` signing | P Auth/Worker | W | Password login A creates session; 1 Auth call | 0 | A | Sign out A / stop on claim failure | Yes |
| B signed `session_id` | P Auth token | R | Derive from A; 0 | 0 | A | None | Yes |
| C password `amr` | P Auth token | R | Derive from A; 0 | 0 | A | None | Yes |
| D refresh identity | P Auth | W | Refresh A; 1 Auth call | 0 | A | Sign out refreshed session | Yes |
| E second login new session | P Auth | W | Second login A; 1 Auth call | 0 | A | Sign out second session | Yes |
| F logout / old JWT | P Auth/DB | W | Revoke then provider sign-out; 2 calls | 0 | A | Verify old token denied, no retry | Yes |
| G live `auth.sessions` | P DB | R | Owned A session lookup only; 0 | 0 | A | No raw IDs in evidence | Yes |
| H four private tables | P catalog | R | 0 | 0 | None | None | Yes |
| I eight SQL functions | P catalog | R | 0 | 0 | None | None | Yes |
| J owners/search_path/ACL | P catalog | R | 0 | 0 | None | None | Yes |
| K resend service-only ACL | P catalog | R | 0 | 0 | None | None | Yes |
| L restrictive RLS | P catalog + bounded actor probes | R/W | Catalog 0; actor probe writes only if separately counted/approved, proposed max 4 | 0 | A/B | Remove owned probe rows | Yes |
| M Storage policies | P catalog + owned objects | R/W | Catalog 0; optional owned object create/delete max 2 | 0 | A/B | Remove owned object | Yes |
| N Realtime publication | P catalog | R | 0 | 0 | None | None | Yes |
| O private Realtime observation | P DB/Realtime | W | 2 startup/readiness + 8 timed sentinel inserts, then 10 deletes; max 20 row mutations | 0 | pending A, verified B | Delete exact 10 owned IDs; failure requires cleanup authority | Yes |
| P signup six-digit token | P Auth/SMTP | W | Sign up C; 1 Auth call | 1 | C | Delete C after evidence | Yes |
| Q hardcoded `type:"signup"` | P Auth/Worker/DB | W | Exchange once, accept policy, activate session; max 3 calls | 0 | C | Revoke C session and delete C | Yes |
| R signup replay | P Auth/Worker | R/W | Reuse code rejected; max 1 attempted call, zero accepted writes | 0 | C | None | Yes |
| S signup resend supersession | P Auth/Worker | W | Route resend once, then new-code verify; max 2 calls | 1 | C | Delete C | Yes |
| T generic OTP negative | P Auth/SMTP | W | One OTP request and rejected signup attempt; max 2 calls | 1 | A | Revoke any resulting session | Yes |
| U recovery/email-change negatives | P Auth/SMTP | W | One recovery and one email-change request, rejected signup attempts; max 4 calls | Up to 3 | A/C | Revert owned test email state; delete users | Yes |
| V Brevo fresh-login challenge | P Worker/Brevo/DB | W | One challenge send for A and one for B; max 2 sends plus bounded challenge rows | 2 | A/B | Expire/revoke owned challenge rows | Yes |
| W resend-confirmation | P Worker/Auth | W | Uses S's one resend; max 0 additional calls | 0 additional | C | Same as S | Yes |
| X anonymous public reads | P Worker/DB | R | 0 | 0 | None | None | Yes |
| Y pending Worker/API denial | P Worker | R | 0 privileged downstream writes | 0 | A | None | Yes |
| Z verified Worker/API success | P Worker | R | GET-only success; 0 | 0 | B/C | None | Yes |
| AA legal policy acceptance | P Worker/DB | W | Shared with Q; max 0 additional rows | 0 | C | Retain only if policy requires, otherwise owned cleanup | Yes |
| AB no age Auth gate | P UI/Worker | R | 0 | 0 | A/B/C | None | Yes |
| AC logout UI/revocation | P UI/Worker/Auth | W | Shared with F; max 0 additional calls | 0 | A | Confirm old JWT denied | Yes |

This matrix is not an executable cap enforcer. In particular, RLS/Storage probe write shape and provider-internal rows require a reviewed harness and explicit authorization. If that cannot be bounded before the external boundary, do not run them.

## Read-only catalog preflight

`docs/ops/verified-session-v1-hosted-catalog-preflight.sql` is an unexecuted, metadata-only packet. It inspects private `ogh_*` tables, public `ogh_*` functions, the resend function's effective role privileges and fixed policy markers, verified RLS and Storage policies, publication membership, and only the `id`/`user_id` column contract of `auth.sessions`. It selects no user/private rows, tokens, addresses, or OTPs. The future reviewer must compare exact four table names, exact eight v1 signatures (no extras), one resend identity, expected owner/SECURITY DEFINER/search path, denied anon/authenticated resend EXECUTE, service-role-only resend EXECUTE, table grants, RLS, and publication. A missing row or unexpected grant is FAIL, not a reason to continue. Running this SQL against Production is itself a Production connection and needs separate approval.

## Bounded test identities

Proposed identities: A and B are owned password accounts; C is a new signup account. At most three owned users and five sessions (A first/second, B, C, plus a possible generic-OTP session); no real user account may be reused. Ordered future test: password-login A and B; validate official `getClaims()` (`iss` equals the exact target Auth origin plus `/auth/v1`, authenticated `aud`/role, owned `sub`, signed `session_id`, password `amr`, expiry and non-anonymous status); refresh A and prove the same session ID; create A's second login and prove a different session ID; keep A pending and verify B via one challenge; perform the bounded Realtime observation; only then verify A with the second challenge and test logout/revocation. Compare only owned live `auth.sessions` rows via approved bounded queries. Old signed A JWT must fail the live predicate after logout; a valid signature alone is insufficient. Record boolean outcomes and counts only; no raw token, code, email, or session ID in evidence.

## Bounded email budget

Proposed maxima: `MAX_SIGNUP_EMAIL_SENDS=2` (initial and one route resend), `MAX_FRESH_LOGIN_EMAIL_SENDS=2` (A/B), `MAX_RECOVERY_EMAIL_SENDS=1`, `MAX_EMAIL_CHANGE_EMAIL_SENDS=2`, `MAX_GENERIC_OTP_EMAIL_SENDS=1`, `MAX_MAGIC_LINK_EMAIL_SENDS=1`, `MAX_TOTAL_EMAIL_SENDS=9`. The generic OTP and magic-link negative controls must use separate provider artifacts; cross-email/replay tests reuse owned codes and send no extra mail. If the provider emits more than the cap for any operation, stop rather than retry. Confirm the six-digit `{{ .Token }}` signup template, hardcoded Worker `type:"signup"`, sender binding, transactional key, shared SMTP/HTTPS Free quota, and no paid fallback in a separately authorized provider-readiness step. Source code and docs cannot prove current hosted template or quota.

## Realtime observation

Use Postgres Changes on `public.forum_notifications`, not a new Broadcast/Presence mechanism. Subscribe pending A and verified B; require subscription status and a verified readiness event after an uncounted startup event. Then insert four A-recipient and four B-recipient `post_like` rows at about 2.5-second intervals across a 10-15 second window. Report `OBSERVATION_WINDOW_MS`, `SENTINEL_EVENT_COUNT=8`, `PENDING_EVENTS_RECEIVED=0`, and `VERIFIED_EVENTS_RECEIVED=4` only if all four B row IDs arrive. Missing B positive control is FAIL. Preserve intended public comments/posts interaction visibility. Teardown both channels and delete the exact 10 owned notification IDs under approved cleanup authority; if teardown fails, record IDs securely for separately approved cleanup, not in public evidence.

## Exact expected writes

This review performs zero writes. Proposed future explicit test writes are at most 10 owned notification INSERTs and 10 matching DELETEs, up to four owned RLS-probe row operations, two Storage object operations, the bounded challenge/session/consent/resend-budget writes implied by the three-identity campaign, and at most 24 Auth API state-changing calls. `MAX_DATABASE_TEST_ROWS=64` is a proposed ceiling for explicitly harness-owned rows, not a claim that provider-managed `auth.*` internal writes are known. The future authorization must supply a measured, enforceable per-table/operation ledger; unknown amplification is a stop. No generic DELETE, migration-history mutation, or cleanup outside owned IDs is included.

Future public regression checks, all separately authorized: `/`, `/feed/`, `/circles/`, `/login/`, `/products/`, published device/product routes, and public news/media remain accessible anonymously; `/notifications/` redirects or denies appropriately for anonymous/pending and loads only for verified actors. The anonymous header shows the default avatar and `未登录`; pending has no authenticated menu; verified has its normal menu. No age-16 Auth gate may appear. A public-page 200 alone does not prove private-data denial.

## Cleanup

Teardown subscriptions; revoke/logout test sessions; delete only exact notification/probe/Storage artifacts and the three owned test users if authorized. Retain a redacted cleanup receipt with counts and reason codes. Cleanup is a separate allowed mutation in the future authorization, not implicit permission in this packet. On ambiguous write or failed cleanup, stop and seek a fresh authorization; do not retry the campaign.

## Rollback

The forward migrations add a deny-by-default security layer. Blind down-migration would reopen access and is not an approved rollback. Any future deployment rollback must be checked against the *current* DB state; the old Worker is not compatible with the new restrictive RLS/resend ACL. A failed or ambiguous DB migration requires an operator-reviewed state assessment and separately authorized compensating forward action. No automatic deploy, migration, email, or test retry is permitted.

## Stop conditions

Stop for artifact/target drift; no safe cutover artifact; preview pointing to Production backend; missing or unexpected ACL/table/function/publication; unknown signing mode or live-session semantics; unproven sender/template/Free quota; any positive-control failure; public-read regression; unexpected 5xx or privileged pending access; cap exhaustion; ambiguous mutation; or cleanup failure. `AUTH_RELEASE_STATUS` remains `NO_GO` throughout this packet.

## Legal wording decision

LEGAL_COPY_CHANGE_REQUIRED_BEFORE_AUTH_RELEASE=false (technical consistency assessment only; policy-owner signoff remains required). `src/pages/terms/index.astro` says the platform is for people aged `LEGAL_POLICY.minimumAge` and older; `src/pages/privacy/index.astro` calls the policy `${LEGAL_POLICY.minimumAge}+`. Neither text promises that Auth checks age or collects an age attestation. `src/components/legal/LegalConsentPage.tsx` requests policy acknowledgement without an age declaration, and the current Auth flow has no age gate. The retained 16+ product-policy wording must still be reviewed by the policy owner before release; this document does not give legal advice or approve copy. The Privacy page's older Pages wording is also a topology-content review item, not an Auth age-gate claim.

## Zero-paid-infrastructure audit

ZERO_PAID_INFRA_POLICY=true. The proposed design requires no paid Supabase branch/plan, paid Cloudflare plan, paid Brevo tier, SMS, phone MFA, paid risk/CAPTCHA service, temporary paid environment, or automatic overage. A separate hosted non-Production database is not proven, and current provider plan/quota cannot be confirmed offline. ZERO_PAID_INFRA_CONFIRMED=false for any actual hosted run until an authorized operator verifies current free capacity. A capacity shortfall stops; it never triggers an upgrade.

## Authorization template

The following is a template, NOT an approval. Leave every bracketed field unfilled until a new explicit authorization, after the cutover blocker is resolved. A single-use authorization is bound to exact commit, file hashes, built artifact, Worker and Supabase target, and numeric budgets; it expires on any drift and is consumed by one attempted external run. No automatic retry. It cannot approve a main merge, PR, Product Detail v2, or unrelated Production work. A failed external attempt needs a new authorization unless a narrowly documented pre-boundary resume is explicitly permitted.

```text
AUTHORIZATION_ID=<new-single-use-id>
AUTHORIZED_BY=<named-human-operator>
AUTHORIZED_AT_UTC=<machine-current-utc-at-authorization>
TARGET_ENVIRONMENT=<exact-hosted-environment>
TARGET_SUPABASE_PROJECT=<exact-project-reference>
TARGET_WORKER=<exact-worker-environment>
SOURCE_COMMIT=54a56b9b9a7b106e8925efea7e1d6164e04b8614
MIGRATION_1_SHA256=<reviewed-sha256>
MIGRATION_2_SHA256=<reviewed-sha256>
MAX_TEST_USERS=<approved-integer>
MAX_DATABASE_TEST_ROWS=<approved-integer-and-scope>
MAX_EMAIL_SENDS=<approved-integer>
MAX_REALTIME_SENTINELS=<approved-integer>
PRODUCTION_DEPLOY_AUTHORIZED=<true-or-false>
PRODUCTION_DB_MIGRATION_AUTHORIZED=<true-or-false>
PRODUCTION_TEST_WRITES_AUTHORIZED=<true-or-false>
PRODUCTION_EMAILS_AUTHORIZED=<true-or-false>
AUTOMATIC_RETRY=false
REUSABLE=false
```

NEXT_ACTION=RESOLVE_SAFE_CUTOVER_IN_REPOSITORY_AND_REVIEW_AGAIN. Do not execute the template.
