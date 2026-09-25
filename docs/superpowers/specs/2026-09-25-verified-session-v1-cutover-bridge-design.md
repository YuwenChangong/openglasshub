# OpenGlass Hub Verified Session v1 Cutover Bridge Design

## 1. Status and intent

Status: ready for architecture review; release remains `NO_GO`. This design selects an additive Foundation database stage, the already reviewed Verified Session Worker, and a final Enforcement database stage. It authorizes no implementation or hosted action. The stage contracts below are acceptance criteria for a later plan, not evidence that a hosted environment has already reached any stage.

## 2. Current blocker

Neither direct ordering is safe. The new Worker calls `ogh_is_verified_session()` from `src/lib/server/verified-session.server.ts` and `src/pages/api/auth/session-state.ts`; a missing RPC produces fail-closed `503` for an otherwise valid session. Its login challenge (`ogh_reserve_login_challenge`, `ogh_finalize_login_delivery`, `ogh_consume_login_challenge`), signup activation (`ogh_activate_signup_session`), policy acceptance (`ogh_record_policy_acceptance`, `ogh_has_current_policy_acceptance`), logout (`ogh_revoke_verified_session`), and service-role resend helper likewise require database interfaces absent before v1. Thus new Worker/pre-v1 DB is prohibited.

Conversely, the full first v1 migration creates restrictive Verified Session policies on 24 public mutation tables, selected private reads, and `storage.objects`. The old Worker checks Supabase `getUser` but never inserts `private.ogh_verified_sessions`; its password sessions cannot satisfy those policies. The second migration removes anon/authenticated EXECUTE on `consume_verification_email_resend_limit`, while the old resend endpoint calls that RPC with an anon-key client. Thus old Worker/full Enforcement DB is prohibited. See `docs/ops/verified-session-v1-hosted-readiness.md`; its hosted inventory remains unperformed and the actual deployed Worker must be proven before release.

## 3. Constraints and non-goals

One existing Supabase project serves the Worker preview and Production backend; the preview is not isolated staging. No new paid infrastructure, feature flag, second Worker variant, data backfill of verified rows, forced logout, broad privilege grant, or destructive database rollback is part of this design. Public read behavior stays public. A database stage is not inferred solely from a migration filename. No Production authorization is implied.

## 4. Current runtime/database dependency graph

| Runtime path | Database dependency | Pre-v1 behavior |
| --- | --- | --- |
| Protected API/mutations | authenticated `ogh_is_verified_session()` plus live provider user/claims | RPC missing; new Worker returns `503`, never allows by default |
| Session-state UI | authenticated predicate and `ogh_has_current_policy_acceptance` | missing predicate causes `503`, not pending |
| Login challenge | three service-role challenge RPCs, private challenge/budget/session tables, live `auth.sessions` | RPCs missing |
| Signup confirmation | service-role `ogh_record_policy_acceptance` and `ogh_activate_signup_session` | RPCs missing |
| Logout | service-role `ogh_revoke_verified_session` before local sign-out | RPC missing |
| New resend | service-role `consume_verification_email_resend_limit(text, integer, integer)` | baseline service-role EXECUTE is revoked |
| Old resend | anon-key call to same RPC | baseline anon/authenticated EXECUTE exists |
| Direct PostgREST/Storage/Realtime | existing RLS and grants | password-session baseline until Enforcement |

The predicate checks authenticated JWT user/session identity against live `auth.sessions` and an unrevoked verified row. A valid JWT alone does not create that row.

## 5. Approaches considered

| Approach | Benefit | Cost/risk | Decision |
| --- | --- | --- | --- |
| A. Foundation -> Worker -> Enforcement | Additive first stage; old Worker can operate and be restored before Enforcement; one Worker artifact; no paid staging | Temporary direct-DB baseline in State C; strict ordering and short bounded transition required | Select |
| B. Prepare/enforce runtime flag | Can separate code and enforcement mode | Cloudflare config/secret mutation, default-open and drift risk, two-mode test matrix, persistent rollback ambiguity | Reject absent proof A fails |
| C. Maintenance/read-only atomic cutover | Could reduce overlap time | User outage; DB and Worker cannot become atomic together; partial failure leaves a harder recovery boundary | Reject |

## 6. Selected architecture

`PRE_V1 + OLD_WORKER` -> `FOUNDATION + OLD_WORKER` -> `FOUNDATION + VERIFIED_SESSION_WORKER` -> `ENFORCEMENT + VERIFIED_SESSION_WORKER`.

Foundation installs all new primitives but no final restrictive policies. The already reviewed Worker then enforces verification at its own API boundary. Enforcement closes the remaining direct database/Storage bypasses and the legacy resend grant. State C is a bounded compatibility bridge, **not** `VERIFIED_SESSION_FULLY_ACTIVE`. Its direct access is no weaker than the current pre-v1 Production baseline; Worker/API paths become stricter, while direct paths retain the baseline until Enforcement. `DOES_STATE_C_REDUCE_SECURITY_BELOW_CURRENT_PRODUCTION=false`, conditional on local catalog and ACL proof that Foundation only makes the scoped changes specified here.

## 7. Four-state compatibility matrix

| State | Worker | DB | Supported | Security/operational meaning |
| --- | --- | --- | --- | --- |
| A baseline | Old | Pre-v1 | Yes, current baseline | Existing auth model |
| B Foundation | Old | Foundation | Yes, required | Existing auth/write/resend behavior remains functional |
| C bridge | New Verified Session | Foundation | Yes, required | Worker/API verified; direct DB/Storage still baseline; not full v1 |
| D final | New Verified Session | Enforcement | Yes, required | Full reviewed v1 boundary |
| Prohibited | New Verified Session | Pre-v1 | No | Missing RPCs; fail-closed `503` |
| Prohibited | Old | Enforcement | No | Restrictive RLS and resend ACL break old behavior |

Tooling must refuse either prohibited pairing before any external mutation and stop on uncertain stage identity.

## 8. Foundation database contract

Statement/category decomposition of `20260923000000_ogh_verified_session_v1.sql`:

| Current statements | Destination | Contract |
| --- | --- | --- |
| `create schema if not exists private`; four `private.ogh_*` tables, their constraints/indexes and table owners (lines 1, 6-66) | Foundation | Additive objects; preserve existing `private` schema ownership and unrelated grants if the schema already exists |
| Broad `alter schema private owner`, schema-wide revoke/grant, interim direct service-role table grants (lines 2-4, 68-73) | Unrelated / should not move verbatim | Scope ACLs to the new objects; do not rewrite privileges on pre-existing private objects. New tables end with no browser or direct service-role table access |
| Eight `public.ogh_*` functions, owner/grants (lines 75-410) | Foundation | Exact signatures/logic and reviewed grants: `ogh_is_verified_session` and `ogh_has_current_policy_acceptance` authenticated boolean reads; six service-role-only mutation functions |
| Final new-table and `private` schema service-role revokes (lines 412-414) | Foundation for new-table grants; schema-wide revoke only if proven harmless | SECURITY DEFINER functions own access; avoid changing pre-existing private schema consumers |
| 24-table mutation, mixed/private SELECT, Storage restrictive policies (lines 416-488) | Enforcement | No such policy in Foundation |
| Resend function body and ACL (lines 490-527) | Split | Fixed body in Foundation; temporary dual-generation grants there; final revoke in Enforcement |

All eight functions retain `SECURITY DEFINER`, fixed empty `search_path`, postgres ownership, schema-qualified object references, database-owned time, and the current live-session and atomic challenge semantics. The four private tables preserve their exact constraints, indexes, TTL/counter semantics, and no direct browser access. New function `PUBLIC` EXECUTE must be revoked explicitly before narrow grants. Do not change baseline public table/Storage/Realtime policies or existing mutating RPC ACLs here. If the `private` schema pre-exists with conflicting owner/grants, Foundation must not silently alter them; fail preflight and review the narrowest safe object-level treatment.

## 9. Resend compatibility contract

Keep the existing `public.consume_verification_email_resend_limit(text, integer, integer)` identity and return shape. In Foundation, replace its body with the reviewed SQL implementation: ignore caller-supplied quota arguments, require a 64-character lowercase hash, use `clock_timestamp()`, a per-hash transaction advisory lock, and fixed 5 attempts per 24 hours against `forum_upload_attempts`. Keep only baseline anon/authenticated EXECUTE for the old Worker and add service-role EXECUTE for the new helper; revoke `PUBLIC`. The new Worker supplies a server-derived IP hash and never trusts a browser-supplied bucket. Legacy callers remain limited by the SQL-owned quota, so this is equal-or-better than the current caller-adjustable baseline, not the final ACL.

| State | Caller role | RPC EXECUTE | Hash source | Effective max/window | Expected result |
| --- | --- | --- | --- | --- | --- |
| A | old Worker anon client | anon/authenticated | old Worker server-derived IP hash | caller parameters, normally 5/24h | baseline resend |
| B | old Worker anon client | anon/authenticated plus service_role | old Worker server-derived IP hash | fixed SQL 5/24h | old resend still works |
| C | new Worker service-role helper | anon/authenticated temporary plus service_role | new Worker server-derived IP hash | fixed SQL 5/24h | new resend works; legacy grant retained for rollback |
| D | new Worker service-role helper | service_role only | new Worker server-derived IP hash | fixed SQL 5/24h | browser/anon/authenticated direct call denied |

`20260925012231_lock_verification_email_resend_limit.sql` provides the final body/ACL model, but its service-role-only revoke must be deferred to Enforcement. Foundation must not add a new broad RPC grant.

## 10. Bridge Worker contract

The current Worker implementation descended from reviewed artifact `54a56b9b9a7b106e8925efea7e1d6164e04b8614` already separates Worker/API verification from DB RLS: it calls the eight RPCs and the service-role resend helper; it does not require restrictive policies to exist. Foundation provides all of those interfaces with the signatures/grants it expects. No Worker code change solely to tolerate Foundation is identified. The **exact deployable Worker build/source commit and digest must be locked at AUTH-C**, since the branch HEAD includes later changes; do not deploy by an unpinned historical label. The same locked Worker runs in C and D. `SINGLE_WORKER_ARTIFACT=true`; `AUTH_ENFORCEMENT_FEATURE_FLAG=false`. A local C/D compatibility failure blocks release and returns to architecture review rather than introducing an implicit flag.

## 11. Enforcement database contract

Only after the reviewed Worker is active, add the current first migration's restrictive policies: authenticated INSERT/UPDATE/DELETE on the 24 listed public tables; mixed SELECT gates that retain public branches (`circles`, `posts`, `comments`, `post_media`, `news_articles`, `devices`); private SELECT gates on the 14 listed tables; and `storage.objects` post-media mutations/private reads while preserving public media branches. Retain permissive owner/staff policies as the other half of the RLS conjunction. Existing historical legal-consent bootstrap reads stay available to their owners. Realtime/private visibility must follow the same protected table RLS; no separate broader subscription grant is introduced.

Direct PostgREST writes and direct RPC paths must be checked against the reviewed Task 13 bypass matrix. The present migration adds RLS but does not broadly rewrite unrelated RPC ACLs; implementation must preserve its reviewed function-level protections and prove no SECURITY DEFINER mutator bypass remains, without inventing a broad revocation that breaks public reads. Final resend ACL is `PUBLIC/anon/authenticated` denied, `service_role` EXECUTE only, with the same fixed SQL body. Enforcement is forward-only and the final catalog must be semantically equivalent to the reviewed v1 migration plus resend hardening. Any discovered unclosed direct bypass blocks D acceptance, not a rationale to call State C active.

## 12. Unreleased migration artifact policy

`UNRELEASED_FEATURE_MIGRATIONS_CAN_BE_SUPERSEDED=true` for the two v1 feature-branch files: both are absent from `origin/main`, the reviewed readiness record reports zero Production/hosted migrations, and no execution is authorized in this task. A later implementation may replace these **unreleased** files before merge with exactly one Foundation and one Enforcement migration, incorporating resend body/ACL across the two stages. `FOUNDATION_DB_ARTIFACT_COUNT=1`, `ENFORCEMENT_DB_ARTIFACT_COUNT=1`, `TOTAL_NEW_V1_DB_ARTIFACT_COUNT=2`.

This is conditional repository policy, not proof of the unseen hosted migration ledger. AUTH-A must verify the actual hosted migration history and catalog before any rewrite is treated as deployable. If either feature migration was applied anywhere in the release target, stop: it is a deployed historical migration and must never be rewritten; devise a reviewed forward-only reconciliation instead. Existing unrelated historical migrations remain immutable.

## 13. Existing-session behavior

At Worker cutover, a live Supabase password session remains cryptographically valid but has no verified row, so it is `PENDING_VERIFICATION`, never grandfathered. A page reload or protected page resolves session state to pending; protected APIs return `403 VERIFICATION_REQUIRED`, not `503`, when the predicate succeeds with false. Only a missing/broken database interface or provider outage returns fail-closed `503`; UI must not redirect-loop on that status. Pending users can finish the email challenge; only the exact live `auth.sessions` session is activated. Existing background private notification subscriptions must be torn down or kept non-authoritative while pending; direct Realtime visibility is not fully closed until D. Public reads remain usable. Explicit logout revokes the verified row before local-only Supabase sign-out; revocation failure stops local sign-out. No automatic provider logout is needed solely for cutover.

## 14. Policy/legal bootstrap

Policy acceptance and verified-session status are independent axes. Foundation provides `ogh_has_current_policy_acceptance` and `ogh_record_policy_acceptance` and preserves the historical owner-scoped legal acceptance read. Pending users may reach only the narrow verification, current-policy acceptance, sign-out, and recovery routes. A current policy does not confer verification; verification does not waive a stale policy. Signup provenance remains server-hardcoded `type: "signup"`; no age-16 auth gate is added. Missing primitives fail closed instead of bypassing either axis.

## 15. Rollback state machine

| Point | Allowed rollback/stop | Old Worker usable? |
| --- | --- | --- |
| Before Foundation | Remain at A | Yes |
| After Foundation, before Worker | Leave additive Foundation installed and keep old Worker at B; no down-migration | Yes |
| After Worker, before Enforcement | Restore exact known-good old Worker against Foundation; retain Foundation | Yes |
| After Enforcement | Never restore old Worker; redeploy exact known-good Verified Session-capable Worker compatible with Foundation/Enforcement or apply reviewed forward fix | No |

`FOUNDATION_ROLLBACK=LEAVE_ADDITIVE_FOUNDATION_INSTALLED`. `POST_ENFORCEMENT_ROLLBACK_FLOOR` is a locked, known-good Worker artifact that checks live provider session plus the verified-session predicate and uses the service-role resend path, matching final RPC/ACL contracts. Do not drop RLS, recreate password-only access, re-enable browser resend EXECUTE, reset migration history, or manufacture verified rows to recover.

## 16. Failure matrix

Each failure stops the current stage; an uncertain DB commit is treated as unknown until a separately authorized read-only inventory establishes catalog state. No blind retry.

| Failure | State | Stop action | Safe runtime | Rollback or forward fix | Old Worker usable? |
| --- | --- | --- | --- | --- | --- |
| F1 Foundation migration partially fails | A/unknown | Stop before Worker; inspect transactional outcome | Old Worker if A/B proven | Forward repair only after catalog proof; leave additive objects | Yes if A/B proven |
| F2 Foundation succeeds, smoke fails | B | Stop Worker stage | Old Worker | Repair Foundation compatibility forward | Yes if B contract holds; otherwise block |
| F3 Worker deploy fails before activation | B | Stop | Old Worker | Leave Foundation; repair/redeploy only under new gate | Yes |
| F4 Worker active, challenge fails | C | Stop Enforcement and challenge issuance | New Worker fail closed | Restore old Worker at B or repair C | Yes |
| F5 Worker active, public reads regress | C | Stop Enforcement | New Worker fail closed on protected paths | Restore old Worker at B; repair public reads | Yes |
| F6 Enforcement preflight drift | C | Do not migrate | New Worker at C, not full v1 | Restore old Worker or review drift | Yes |
| F7 Enforcement migration partially fails | D/unknown | Stop; no old Worker deployment | Verified-capable Worker fail closed | Catalog proof, then reviewed forward repair | No until proof explicitly shows B/C |
| F8 Enforcement succeeds, bypass remains | D incomplete | Do not declare active | Verified-capable Worker; isolate affected path if possible | Reviewed forward closure | No |
| F9 Enforcement succeeds, Worker API fails | D | Stop release | Verified-capable Worker fail closed | Redeploy known-good verified-capable Worker or forward fix | No |
| F10 Brevo challenge unavailable | C/D | Stop challenge activation | Current Worker fail closed for pending | Restore old Worker only in C; otherwise repair provider path | C yes; D no |
| F11 Supabase Auth unavailable | B/C/D | Stop auth verification | Current compatible Worker fail closed | Wait/repair provider; no RLS rollback | B/C yes; D no |
| F12 Realtime hosted control fails | C/D | Stop acceptance; disable private subscription client-side if safe | Current compatible Worker | Restore old Worker only in C; otherwise forward fix | C yes; D no |
| F13 Resend ACL differs | B/C/D | Stop next stage; prevent resend if uncertain | Current compatible Worker, fail closed on resend | Restore expected stage ACL via reviewed forward change | B/C yes if legacy EXECUTE proven; D no |

## 17. Local proof matrix

Before any hosted authorization, replay from the canonical historical local DB and prove all six pairings: (1) old/pre-v1 baseline; (2) old/Foundation auth, authenticated writes and resend; (3) new/Foundation public reads, pre-existing password session pending, challenge, signup, policy bootstrap, logout, protected Worker/API denial/allow; (4) new/Enforcement full Task 13 bypass/security matrix; (5) new/pre-v1 rejected by release gates; (6) old/Enforcement rejected by release gates. Test real catalog grants, function signatures, policy presence and ownership, not mocked labels alone.

Additional local proof: Foundation exact-once application and its replay/idempotence assumption; Enforcement requires Foundation and refuses partial/drifted Foundation; public-read parity; Storage private/public branches; Realtime private visibility and notification teardown; direct PostgREST/RPC bypasses; 5/24 resend under parallel calls and forged quota parameters; historical and current legal consent; old JWT/live-session mismatch/logout; fail-closed 503 versus pending 403; old Worker rollback from C. Any failing required pairing blocks release.

## 18. Release-stage guards

Before Foundation, require `PRE_V1`: exact historical migration baseline, absence of all four new tables/eight RPCs and v1 restrictive policies, baseline resend ACL, and reviewed old Worker identity. Before Worker, require `FOUNDATION`: exact four tables/eight function signatures/owners/grants, live-session predicate semantics, dual-generation resend ACL/fixed body, and absence of v1 restrictive policies; old Worker smoke green. Before Enforcement, require same Foundation catalog plus the exact reviewed deployed Worker source commit/build digest, successful C tests, and no conflicting drift. After Enforcement, require final policy inventory on all intended tables/Storage, final resend ACL, same Worker digest, and full D proof. A partial mixed stage is not a supported state. Semantic catalog predicates plus immutable artifact identities are the stage markers; no marker table or filename-only inference.

## 19. Future Production authorization boundaries

Separate single-use authorization by default: `AUTH-A` read-only hosted Worker/migration/catalog inventory; `AUTH-B` Foundation DB migration; `AUTH-C` exact Worker deployment; `AUTH-D` Enforcement DB migration; `AUTH-E` bounded hosted/Production auth verification; `AUTH-F` release closeout. Each stage consumes its own authorization and stops on drift or failure. Read-only observations within a stage can share that stage's bounded authorization, but no adjacent external mutation stages share one: each changes the rollback boundary. AUTH-E must explicitly bound test accounts, writes, email sends, Storage and Realtime controls. No authorization is granted by this document.

## 20. Zero-paid-infrastructure audit

`NEW_SUPABASE_PROJECTS=0`, `PAID_BRANCHES=0`, `NEW_CLOUDFLARE_PAID_RESOURCES=0`, `NEW_PAID_EMAIL_SERVICES=0`, `SMS=0`. Local DB/runtime matrix, additive Foundation, exact artifact locking, and individually authorized bounded Production stages replace a paid staging environment. Worker preview pointing at Production Supabase cannot be used as a safe isolated database test.

## 21. Security invariants

1. After Enforcement, password-only Supabase sessions never satisfy OpenGlass Hub protected authorization.
2. Never advertise v1 active while a direct protected DB, Storage, RPC or API bypass remains.
3. Foundation cannot weaken the current Production baseline.
4. Old Worker remains compatible through Foundation.
5. New Worker remains compatible with Foundation and Enforcement.
6. Old Worker is prohibited after Enforcement.
7. Never grandfather verified-session rows.
8. Missing predicates, provider errors, or stage uncertainty never default open.
9. No paid infrastructure is introduced.
10. Public reads remain public.
11. No age-16 authentication gate is introduced.
12. Signup provenance stays server-hardcoded `type: "signup"`.
13. Fresh-login challenge activation is bound to the exact live provider session.
14. Verified-session revocation precedes local-only sign-out.
15. Final Enforcement closes direct browser resend RPC EXECUTE.

## 22. Non-goals

No SQL/Worker implementation, migration execution, hosted probe, deploy, feature flag, extra staging project, data backfill, provider setting change, or PR/merge. This spec does not certify actual hosted migration history, deployed Worker version, email deliverability, or Realtime behavior; later local proof and separately authorized hosted gates must do so.

## 23. Open decisions requiring review

Architecture review must explicitly accept or reject the bounded State C interval: Worker/API verification is active, but direct database/Storage enforcement is still at the pre-v1 baseline until AUTH-D. The recommendation is to accept it only with the exact stage guards and stop/rollback rules above. No implementation detail is left to choose between two release architectures. If hosted inventory contradicts the recorded unshipped migration provenance, this design is blocked for that target and requires a new forward-only migration design before any mutation.
