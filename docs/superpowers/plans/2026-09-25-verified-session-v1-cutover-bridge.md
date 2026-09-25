# OpenGlass Hub Verified Session v1 Cutover Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Locally prove a safe, forward-only Foundation DB -> Verified Session Worker -> Enforcement DB cutover without making State C a steady state or weakening the reviewed final security boundary.

**Architecture:** Supersede the two unreleased v1 migrations with one additive Foundation artifact and one final Enforcement artifact. Use one locked Verified Session Worker for C and D; retain a pinned old Worker only for A/B and pre-Enforcement rollback. Catalog-derived stage and artifact-pairing validators fail closed. Separately authorized hosted stages remain outside implementation.

**Tech Stack:** PostgreSQL/Supabase local CLI 2.115.0, Supabase Auth local v2.195.0, Node 24, `pg`, Astro 7/React 19, native Cloudflare Worker build, existing Supabase JS/Auth 2.112.4. No new dependency or paid service is needed.

**Spec:** `docs/superpowers/specs/2026-09-25-verified-session-v1-cutover-bridge-design.md` at `b4d9f3e3a0d1b4d382e109fa32a5cfcce208c85b`.

## Global Constraints

- This plan is local implementation only, not permission for Production/hosted reads, connections, migrations, emails, deployments, `qa:prod`, provider APIs, PR, or merge. `AUTH_RELEASE_STATUS=NO_GO` throughout local work.
- Review rulings are binding: State C is transient with a ready D path before entry; a suspect C verification window cannot be silently trusted after rollback. No fifth table, feature flag, grandfather rows, automatic retry, broad schema ACL rewrite, or destructive down-migration.
- The future execution method is subagent-driven development, but no task starts during plan writing. Each task below has its own RED/GREEN, regression, diff, exact-path staging, and commit gate. Use only disposable loopback Supabase/Worker fixtures with scrubbed hosted environment variables. Never point preview Worker at its configured Production-backed Supabase project for local proof.
- `NEW_SUPABASE_PROJECTS=0`, `PAID_BRANCHES=0`, `NEW_PAID_CLOUDFLARE_RESOURCES=0`, `NEW_PAID_EMAIL_SERVICES=0`, `SMS=0`. Preserve public reads, signed-session checks, server-hardcoded `type:"signup"`, independent current policy, no age auth gate, revoke-before-local-signout, and fail-closed uncertainty.
- `docs/superpowers/plans/2026-09-23-auth-verified-session-v1.md` documents implemented contracts but its former pre-DB deployment order is superseded by the approved cutover spec. No Product Detail work belongs here.

## Review Focus

1. Foundation must leave baseline authenticated write/read behavior intact, including old resend and old Worker rollback.
2. Narrow private-schema creation must not alter unrelated owner, grants, or objects.
3. Semantic classifier must label every partial/mixed catalog `UNKNOWN`, never `FOUNDATION` or `ENFORCEMENT`.
4. C-entry must have a locked Enforcement artifact, authorization packet, and rollback Worker; D blockage must exit C to B in the same coordinated window.
5. Suspect C-window verification rows must be proven safe or revoked under a separately reviewed bounded authorization before another C/D entry.

Additional review gates: final split-state equivalence, direct RPC/Storage/Realtime bypass closure, exact old Worker compatibility, and pre-action denial of forbidden Worker/DB pairings.

---

## Exact File Map

**REMOVE/REPLACE, unreleased feature migrations only**

- Remove `supabase/migrations/20260923000000_ogh_verified_session_v1.sql`; replace with `supabase/migrations/20260923000000_ogh_verified_session_v1_foundation.sql`.
- Remove `supabase/migrations/20260925012231_lock_verification_email_resend_limit.sql`; replace with `supabase/migrations/20260925012231_ogh_verified_session_v1_enforcement.sql`.
- Both timestamps retain ordering after `20260909195640_device_schema_v1_foundation.sql`; no deployed historical migration is rewritten. Future AUTH-A must prove neither old v1 version was applied to the target, or release is `BLOCKED_MIGRATION_PROVENANCE` and requires a new forward-only design.

**CREATE**

- `scripts/lib/verified-session-db-stage.mjs`: pure `classifyVerifiedSessionDbStage(snapshot, expected): PRE_V1|FOUNDATION|ENFORCEMENT|UNKNOWN`; `expected` is a locked canonical local catalog contract, never a runtime default.
- `scripts/lib/verified-session-cutover-guard.mjs`: pure `assertWorkerDbPairing({workerIdentity, dbStage, locks})`, `assertCanEnterStateC(evidence)`, `classifyStateCExit(evidence)`.
- `scripts/lib/verified-session-c-window.mjs`: pure `classifyCWindowIntegrity(evidence)` and `assertSafeToReenter(evidence)`; no database connection or mutator.
- `scripts/test-verified-session-db-stage.mjs`: positive/negative catalog snapshot and mutation tests for all four labels.
- `scripts/test-verified-session-migration-shape.mjs`: exact two-path inventory and static Foundation/Enforcement placement checks before behavioral suites are converted.
- `scripts/test-verified-session-cutover-guard.mjs`: six pairing cases, transient C readiness/exit and missing-authorization/lock failures.
- `scripts/test-verified-session-cutover-matrix.mjs`: pinned old baseline plus local A/B/C/D runtime/database matrix; owns disposable worktree and Supabase instance only.
- `scripts/test-verified-session-c-window.mjs`: suspect/proven classification, bounds, count reconciliation and reentry denial without executing cleanup.
- `scripts/test-verified-session-cutover-final.mjs`: local-only aggregate verifier that reruns focused suites and refuses stale proof files or non-loopback targets.
- `docs/ops/verified-session-v1-cutover-rollback.md`: non-executable C-window evidence and separately authorized narrow revocation/proof runbook; no secrets or row IDs in public evidence.

**MODIFY**

- `scripts/test-verified-session-sql.mjs`: replace both old path/replay copies; add `--stage foundation` and full Foundation/Enforcement checkpoints, private-schema fixtures, grants, fixed resend and final equivalence against pinned pre-split artifacts.
- `scripts/test-verified-session-signup.mjs`: replace its old single-migration replay copy with Foundation plus Enforcement where final DB is required.
- `scripts/test-legal-consent-persistence.mjs`: read Foundation for new policy objects instead of the removed path.
- `scripts/test-verified-session-release.mjs`: read two new paths, assert stage-specific ACLs and hashes, remove old single-migration/final-only assumptions, and validate updated release packet.
- `scripts/test-verified-session-bypass.mjs`: run existing final-state Task 13 bypass controls only at D, plus explicitly label C direct access as baseline; preserve positive-control Realtime assertions.
- `docs/ops/verified-session-v1-hosted-catalog-preflight.sql`: metadata-only catalog inventory sufficient for PRE_V1/Foundation/Enforcement classification; no user/private row reads.
- `docs/ops/verified-session-v1-release-gates.md`: AUTH-A through AUTH-F, stage guards, transient C, suspect-row rule, rollback floor, no executable Production commands.
- `docs/ops/verified-session-v1-hosted-readiness.md`: new artifact paths and SHA-256, cutover order, local evidence, stage/authorization prerequisites, `NO_GO` status.

**TEST/REGRESSION, existing paths**

- `scripts/test-verification-resend-helper.mjs`, `scripts/test-verification-resend-route.mjs`: new Worker service-role resend and server-derived hash.
- `scripts/test-verified-session-claims.mjs`, `scripts/test-verified-session-routes.mjs`, `scripts/test-verified-session-signup.mjs`, `scripts/test-verified-session-ui.mjs`, `scripts/test-verified-session-brevo.mjs`, `scripts/test-verified-session-service-role-audit.cjs`: C/D identity, route, signup, logout, UI, email and service-role behavior.
- `scripts/test-verified-session-sql.mjs`, `scripts/test-verified-session-bypass.mjs`, `scripts/test-legal-consent-persistence.mjs`, `scripts/test-verified-session-release.mjs` plus the six new cutover suites above: migration shape, database, catalog, pairing, C-window and aggregate release proof.
- `scripts/build-local-supabase-replay-mirror.mjs` supplies canonical historical replay; `package.json` and lockfiles remain unchanged unless a separately reviewed test runner integration proves essential. The exact focused commands below are sufficient without a new package script.

## Artifact And Stage Contracts

The two replacement migrations are the **only** new v1 DB artifacts after implementation. Foundation owns `private` schema creation if absent, four `ogh_*` tables, all eight `public.ogh_*` interfaces, narrow final private-table ACLs, and the fixed resend function with temporary `anon`, `authenticated`, and `service_role` EXECUTE (never `PUBLIC`). Enforcement owns the 24-table restrictive mutation policies, six mixed public/private SELECT policies, 14 private SELECT policies, four `storage.objects` policies, and final resend ACL (`PUBLIC`, `anon`, `authenticated` denied; `service_role` allowed). It does not recreate Foundation objects. Existing public reads and existing owner/staff permissive policies remain unchanged.

| Source statement family | New destination | Exact handling |
| --- | --- | --- |
| First migration schema creation; four tables, constraints, indexes and table owners (lines 1, 6-66) | FOUNDATION | Create only missing schema; preserve all four object definitions |
| First migration broad schema owner/revoke/grant (lines 2-4) | DROP_FROM_NEW_ARTIFACT / DO_NOT_COPY | Replace with narrow ACL checks on the new objects; preserve unrelated schema state |
| First migration temporary service-role direct table grants (lines 68-73) | DROP_FROM_NEW_ARTIFACT / DO_NOT_COPY | No direct table grants are needed for postgres-owned definers |
| First migration eight functions and their owner/EXECUTE directives (lines 75-410) | FOUNDATION | Preserve exact signatures, bodies, owners and reviewed narrow grants |
| First migration final four-table service-role revoke (lines 412-413) | FOUNDATION | Explicitly deny direct access to only these four new tables |
| First migration schema-wide service-role usage revoke (line 414) | DROP_FROM_NEW_ARTIFACT / DO_NOT_COPY | New schema starts narrow; existing schema grants remain untouched |
| First migration public and Storage restrictive policy blocks (lines 416-488) | ENFORCEMENT | Preserve exact target lists and qual/check expressions |
| First migration resend body and browser-only ACL (lines 490-527) | DROP_FROM_NEW_ARTIFACT / DO_NOT_COPY | Use the second migration's fixed body instead; browser-only ACL would break new Worker |
| Second migration fixed resend body/owner/search path (lines 1-35) | FOUNDATION | Keep same function identity, fixed SQL 5/24 and advisory lock |
| Second migration service-role-only ACL (lines 36-39) | ENFORCEMENT | Foundation first grants temporary anon/authenticated plus service_role; D revokes browser roles |

A newly created private schema starts with no browser usage; an existing one keeps unrelated ownership/ACLs. Explicitly revoke table privileges on only the four new tables and leave service-role table access denied after the definer functions are installed. Do not duplicate the second migration's function-body replacement in Enforcement.

The classifier's input is a read-only catalog snapshot: exact four table names/columns/constraints/indexes/owners and effective ACLs; eight function identities, return types, `SECURITY DEFINER`, owner, `search_path`, volatility, body digest and effective EXECUTE; resend identity, body digest and four role grants; exact policy name/table/command/role/permissive/qual/check inventory; Storage policy inventory; Realtime publication membership relevant to notifications. `expected` is derived from canonical local A, B, D replay and stored as reviewed non-secret constants in `scripts/test-verified-session-db-stage.mjs`, with no DB marker table. Catalog drift, an extra `ogh_*` object or missing fact, or conflicting policy/grant yields `UNKNOWN`. A stage label is never inferred from migration-history text alone. The local collector must reject non-loopback connection targets; the future AUTH-A inventory remains separately authorized and feeds the pure classifier after review. Final equivalence compares v1-owned objects and effective v1 access; preservation of unrelated pre-existing `private` schema ownership/grants is an intentional exception, never a privilege expansion on v1 objects.

Worker identities are immutable source commit plus built artifact SHA-256, environment and configuration fingerprint. The old baseline source is pinned `e6c2141be8827d961fc49462d66be8da9b4993eb`; no moving `origin/main` lookup during tests. The new identity is the reviewed implementation commit/build digest locked before future AUTH-C and shared by C/D. AUTH-A must prove the actual deployed old identity; mismatch is a stop, not an assumption that this local old baseline equals Production.

## Task 1: Supersede The Unreleased Migration Pair

**Files:** Remove the two old migration paths; create `supabase/migrations/20260923000000_ogh_verified_session_v1_foundation.sql`, `supabase/migrations/20260925012231_ogh_verified_session_v1_enforcement.sql`, `scripts/test-verified-session-migration-shape.mjs`.

**Interfaces:** Consumes reviewed spec and old SQL at pinned `b4d9f3e3`; produces exactly two ordered paths and a static statement-to-stage manifest in the focused test. Branch artifacts are superseded here; deployment is blocked until future AUTH-A proves neither old version was applied to the target.

- [ ] RED: add a static test that requires the two new paths, rejects both old paths and any third v1 artifact, and checks Foundation contains no `ogh_verified_*` restrictive policy and Enforcement contains no `create table private.ogh_*` or duplicate function body.
- [ ] Run RED: `node scripts/test-verified-session-migration-shape.mjs`; expect `NEW_MIGRATION_PAIR_MISSING` while old paths still exist.
- [ ] Minimal implementation: rename/split only the unreleased files, preserving the exact current table/function and policy source as input; put fixed resend body in Foundation, final ACL only in Enforcement. Do not change historical files.
- [ ] Focused GREEN: `node scripts/test-verified-session-migration-shape.mjs` passes the path/shape gate; behavioral SQL tests are owned by Tasks 2-3.
- [ ] Regression: `rg --files supabase/migrations | rg '20260923|20260925'` shows exactly the two new files; `git diff --check`.
- [ ] Inspect diff for no old-version duplicates and only the named paths.
- [ ] Stage the two removed paths, two new migration paths and `scripts/test-verified-session-migration-shape.mjs` explicitly with `git add --` (deletions included); commit `feat(auth): split unreleased verified-session migration pair`.

## Task 2: Foundation SQL And Baseline-Safe ACLs

**Files:** `supabase/migrations/20260923000000_ogh_verified_session_v1_foundation.sql`, `scripts/test-verified-session-sql.mjs` (replay first artifact and Foundation assertions), `scripts/test-legal-consent-persistence.mjs` (new policy-object path).

**Interfaces:** Consumes Task 1 paths and canonical historical replay. Produces four exact private tables, eight `ogh_*` RPCs, and fixed resend with `PUBLIC=false`, `anon=true`, `authenticated=true`, `service_role=true`; no final v1 restrictive policies.

- [ ] RED: extend local SQL suite to replay historical DB, then Foundation only. Assert absent/existing `private` schema fixtures, unrelated object owner/ACL unchanged, four table schemas/indexes, no browser/service direct table access, eight signatures/owner/empty search path/grants, live `auth.sessions` predicate, database clock/challenge race controls, public policy inventory unchanged, fixed 5/24 resend including forged max/window and parallel calls. Existing schema fixture must have a distinct unrelated object and grant; include a disposable mutant that adds a broad schema revoke or removes service-role resend EXECUTE.
- [ ] Run RED: `node scripts/test-verified-session-sql.mjs --stage foundation`; expect the new mutant controls to fail against the altered local copy, and any initial split defect to fail against the real artifact.
- [ ] Minimal implementation: create schema only when needed; scope grants/revokes to new objects; retain exact reviewed function logic and six service-role mutation grants/two authenticated boolean grants; use second migration's fixed body and transaction advisory lock; revoke resend from `PUBLIC`, grant temporary browser roles and service_role; omit all final restrictive policies. Make SQL suite's `--stage foundation` stop after Foundation checks, replace its unconditional private-schema service-role-usage assertion with absent-schema denial/existing-schema preservation cases, and update legal-consent test to read Foundation.
- [ ] Focused GREEN: `node scripts/test-verified-session-sql.mjs --stage foundation` passes Foundation checkpoint and repeated quota/concurrency cases on disposable loopback Supabase.
- [ ] Regression: `npm run test:legal-consent-persistence`, `node scripts/test-verification-resend-helper.mjs`, `node scripts/test-verification-resend-route.mjs` pass.
- [ ] Inspect diff for schema-wide operations, `PUBLIC` EXECUTE, direct table grants, client-controlled clock/quota, and final policy leakage.
- [ ] Stage `supabase/migrations/20260923000000_ogh_verified_session_v1_foundation.sql scripts/test-verified-session-sql.mjs scripts/test-legal-consent-persistence.mjs`; commit `feat(auth): add backward-compatible verified-session foundation`.

## Task 3: Enforcement SQL And Final Equivalence

**Files:** `supabase/migrations/20260925012231_ogh_verified_session_v1_enforcement.sql`, `scripts/test-verified-session-sql.mjs`, `scripts/test-verified-session-bypass.mjs`, `scripts/test-verified-session-signup.mjs`.

**Interfaces:** Consumes Foundation catalog and the pinned old pair from `b4d9f3e3` through local-only `git cat-file`. Produces final D catalog and a semantic equivalence report; use of the old pair is comparison-only, never a deployable migration.

- [ ] RED: run two disposable local replay branches: canonical history + pinned old pair versus canonical history + new Foundation/Enforcement. Compare four tables, eight functions, resend body, owners/grants/search paths, 24 mutation policy triples, six mixed/14 private SELECT, four Storage policies, notification publication facts and public reads. Assert Enforcement without Foundation fails predictably, Foundation drift refuses Enforcement, and final anon/authenticated resend EXECUTE is denied while service_role works. Run full direct PostgREST/RPC/Storage/Realtime positive/negative controls only on D; include a disposable mutant missing one restrictive policy.
- [ ] Run RED: `node scripts/test-verified-session-sql.mjs`; expect the missing-policy mutant to fail equivalence, and any incomplete real split to fail final ACL/policy checks.
- [ ] Minimal implementation: move only current reviewed restrictive policy SQL into Enforcement; add an early catalog prerequisite guard for four tables/eight functions/fixed resend/Foundation ACL and no conflicting `ogh_verified_*` policies, raising an error before any policy DDL on mismatch. Revoke resend EXECUTE from `PUBLIC`, `anon`, `authenticated`, and `service_role`, then grant only `service_role`. Do not recreate tables/functions or expand baseline exceptions.
- [ ] Focused GREEN: `node scripts/test-verified-session-sql.mjs` and `node scripts/test-verified-session-bypass.mjs` pass D and semantic equivalence checkpoints locally.
- [ ] Regression: `node scripts/test-verified-session-signup.mjs`, `npm run test:legal-consent-persistence`, `npm run test:products` pass with new replay paths.
- [ ] Inspect diff for full 24/6/14/4 policy counts, original qual/check logic, owner/staff/public branches, service-only resend and no extra tables.
- [ ] Stage the four exact paths; commit `feat(auth): add final verified-session enforcement stage`.

## Task 4: Fail-Closed Semantic DB Stage Classifier

**Files:** Create `scripts/lib/verified-session-db-stage.mjs`, `scripts/test-verified-session-db-stage.mjs`; modify `scripts/test-verified-session-sql.mjs` to feed local catalog snapshots.

**Interfaces:** Consumes canonical local A/B/D snapshots with the facts in Artifact And Stage Contracts; produces pure `classifyVerifiedSessionDbStage(snapshot, expected)` and exact `PRE_V1|FOUNDATION|ENFORCEMENT|UNKNOWN`. No hosted connector or mutation method is exposed.

- [ ] RED: test A/B/D positive labels; remove or mutate each object family, function body/owner/search path/grant, resend grant/body, policy count/qual, Storage policy, publication fact and one unrelated schema ACL. Partial Foundation, partial Enforcement, and mixed resend ACL must be `UNKNOWN`; no truthy fallback.
- [ ] Run RED: `node scripts/test-verified-session-db-stage.mjs`; expect missing classifier export.
- [ ] Minimal implementation: normalize/sort catalog facts into canonical keyed records, compare required inventories and digests to reviewed A/B/D expectations, reject extra `ogh_*` or duplicate policy signatures, and return `UNKNOWN` on absent evidence or conflict. Snapshot collection in SQL suite is local-loopback-only; never connect from classifier.
- [ ] Focused GREEN: `node scripts/test-verified-session-db-stage.mjs` passes all positive and mutation cases.
- [ ] Regression: `node scripts/test-verified-session-sql.mjs` proves labels at each local replay boundary.
- [ ] Inspect diff for stage derivation from real catalog facts, not filenames or a marker table.
- [ ] Stage the three exact paths; commit `test(auth): classify verified-session database stages`.

## Task 5: Worker/DB Pairing Guard

**Files:** Create `scripts/lib/verified-session-cutover-guard.mjs`, `scripts/test-verified-session-cutover-guard.mjs`.

**Interfaces:** Consumes Task 4 stage label plus locked old/new source/build identities. Produces `assertWorkerDbPairing({workerIdentity,dbStage,locks})`; returns allow only for A/B/C/D and throws `PAIRING_GUARD_DENY` for new/PRE_V1, old/ENFORCEMENT, UNKNOWN, missing digest, or identity drift.

- [ ] RED: six exact pair tests, artifact digest mismatch, unrecognized Worker, `UNKNOWN` catalog, moving-main alias, and an attempted transition that would activate a forbidden pair before external action.
- [ ] Run RED: `node scripts/test-verified-session-cutover-guard.mjs`; expect missing guard export and denial tests failing.
- [ ] Minimal implementation: pure identity/pair table; pin old commit `e6c2141be8827d961fc49462d66be8da9b4993eb`, require reviewed new commit/build digest supplied by lock evidence, and distinguish source intent from actual deployed identity. No URL-based Worker guessing and no deploy wrapper.
- [ ] Focused GREEN: `node scripts/test-verified-session-cutover-guard.mjs` passes four allowed/two denied cases and mutation controls.
- [ ] Regression: `node scripts/test-verified-session-db-stage.mjs` still returns `UNKNOWN` for partial states.
- [ ] Inspect diff for fail-closed default and no external action method.
- [ ] Stage the two exact paths; commit `test(auth): guard Worker and DB artifact pairing`.

## Task 6: Pinned Old Worker Harness And State A

**Files:** Create `scripts/test-verified-session-cutover-matrix.mjs`.

**Interfaces:** Consumes pinned old commit `e6c2141be8827d961fc49462d66be8da9b4993eb`, historical replay mirror and Tasks 4-5 labels. Produces `MATRIX_A=PASS` from a real old Worker source/build, not a mocked old endpoint.

- [ ] RED: add harness self-test that refuses a moving ref, dirty root checkout, non-loopback DB, unowned temp path or mismatched old source identity; assert baseline login, authenticated write, old anon-key resend, public product/feed/news reads and legal consent against canonical pre-v1 local DB. A fake stub cannot satisfy the route assertions.
- [ ] Run RED: `node scripts/test-verified-session-cutover-matrix.mjs --state A`; expect baseline harness/materialization missing.
- [ ] Minimal implementation: create an owned temp `git worktree add --detach` at the harness-verified temp directory using commit `e6c2141be8827d961fc49462d66be8da9b4993eb`, verify HEAD exactly, install the pinned baseline dependencies with `npm ci --offline` or stop if unavailable, and build/run its actual Worker locally against owned loopback Supabase; materialize canonical historical migrations via `build-local-supabase-replay-mirror.mjs`. In `finally`, stop local services then remove only the verified owned temp worktree; never touch `D:\OpenGlass Hub` or follow origin/main. Scrub hosted env from child processes.
- [ ] Focused GREEN: `node scripts/test-verified-session-cutover-matrix.mjs --state A` emits `MATRIX_A=PASS` with artifact digest and no hosted connection.
- [ ] Regression: `node scripts/test-verified-session-db-stage.mjs` labels the baseline `PRE_V1` and pairing guard allows old/PRE_V1.
- [ ] Inspect diff for target allowlist, ownership-checked cleanup and no network/provider fallback.
- [ ] Stage `scripts/test-verified-session-cutover-matrix.mjs`; commit `test(auth): pin old Worker baseline cutover harness`.

## Task 7: State B Backward Compatibility

**Files:** `scripts/test-verified-session-cutover-matrix.mjs`, `scripts/test-verified-session-sql.mjs`.

**Interfaces:** Consumes Task 6 real old Worker and Task 2 Foundation; produces `MATRIX_B=PASS`, `FOUNDATION_WEAKENS_BASELINE=false`, and a proven old Worker rollback target while D has not begun.

- [ ] RED: add B fixture with same old Worker + Foundation; assert password login, authenticated writes/private reads equivalent to A, public reads, legal consent, anon-key resend success and SQL-owned 5/24 even with forged caller quota/window; concurrency max five; all four tables/eight functions present, no final v1 restrictive policies, exact temporary resend ACL.
- [ ] Run RED: `node scripts/test-verified-session-cutover-matrix.mjs --state B`; expect B comparison failure before harness wiring.
- [ ] Minimal implementation: apply only Foundation to the owned local replay, reuse identical old Worker build/test actions from A, and compare results/canonical catalog. Repair only Foundation or harness defects; never make old Worker depend on new verification.
- [ ] Focused GREEN: `node scripts/test-verified-session-cutover-matrix.mjs --state B` passes and reports old Worker rollback viability.
- [ ] Regression: `node scripts/test-verified-session-cutover-matrix.mjs --state A` and `node scripts/test-verified-session-sql.mjs` pass.
- [ ] Inspect diff for baseline parity and no premature enforcement.
- [ ] Stage the two exact paths; commit `test(auth): prove old Worker survives Foundation`.

## Task 8: State C Bridge Compatibility

**Files:** `scripts/test-verified-session-cutover-matrix.mjs`, `scripts/test-verified-session-routes.mjs`, `scripts/test-verified-session-ui.mjs`.

**Interfaces:** Consumes new Worker implementation, Foundation, Tasks 4-5 stage/pair labels. Produces `MATRIX_C=PASS` with `VERIFIED_SESSION_FULLY_ACTIVE=false`; no Worker feature flag.

- [ ] RED: local C tests for anonymous public reads; existing live password session `PENDING_VERIFICATION`; protected API `403 VERIFICATION_REQUIRED` rather than missing-RPC `503`; challenge start/resend/verify and exact-session activation; signup `type:"signup"` using local provider fixture; current/stale policy bootstrap; pending denial/verified success; logout revoke-before-local-signout and old JWT denial; header state and Realtime subscription teardown on pending/logout; service-role resend and temporary legacy ACL. Assert direct PostgREST/Storage remains A/B baseline and is never labeled final.
- [ ] Run RED: `node scripts/test-verified-session-cutover-matrix.mjs --state C`; expect C route/fixture gaps before matrix wiring.
- [ ] Minimal implementation: run the unchanged reviewed new Worker build against owned Foundation DB, reuse existing auth/signup/UI fixtures, bind only loopback endpoints and mocked/local email, and record transition results. Disposable local C testing is not permission for a hosted C deployment; the future release C-entry guard remains closed until Task 10 D proof. If Worker truly needs a code change, stop for architecture review under the spec rather than silently adding a flag.
- [ ] Focused GREEN: `node scripts/test-verified-session-cutover-matrix.mjs --state C` passes with explicit `VERIFIED_SESSION_FULLY_ACTIVE=false`.
- [ ] Regression: `node scripts/test-verified-session-routes.mjs`, `node scripts/test-verified-session-ui.mjs`, `node scripts/test-verification-resend-helper.mjs` pass.
- [ ] Inspect diff for unchanged Worker logic, no paid/hosted endpoint and no final-active claim.
- [ ] Stage the three exact test paths; commit `test(auth): prove transient Worker Foundation bridge`.

## Task 9: Transient C Entry/Exit And Suspect-Row Safeguard

**Files:** `scripts/lib/verified-session-cutover-guard.mjs`, `scripts/test-verified-session-cutover-guard.mjs`; create `scripts/lib/verified-session-c-window.mjs`, `scripts/test-verified-session-c-window.mjs`, `docs/ops/verified-session-v1-cutover-rollback.md`.

**Interfaces:** Consumes Tasks 3-8 Enforcement artifact/hash, stage classifier and locked new/old Worker digests. The positive D matrix proof is supplied by Task 10; until then the C-entry guard must deny release entry. Produces `assertCanEnterStateC(evidence)`, `classifyStateCExit(evidence)`, `classifyCWindowIntegrity(evidence)`, `assertSafeToReenter(evidence)` and a reviewed non-executable rollback runbook.

- [ ] RED: deny C entry if Enforcement file/hash, local A/B/C/D result, Enforcement preflight, pairing guard, old rollback artifact, C smoke plan, prepared AUTH-D packet, or source lock is absent/stale; deny prolonged C, unrelated deployment, unknown D status and reentry with suspect unreviewed rows. Test public-read-only rollback as `PROVEN`, challenge/activation/signed-mapping/bypass failures as `SUSPECT`.
- [ ] Run RED: `node scripts/test-verified-session-cutover-guard.mjs` and `node scripts/test-verified-session-c-window.mjs`; expect missing entry/window exports.
- [ ] Minimal implementation: pure evidence validators require UTC `STATE_C_STARTED_AT_UTC`, `STATE_C_DEADLINE_AT_UTC`, and `STATE_C_ENDED_AT_UTC`, exact artifact hashes and release-window identity. AUTH-C must set a deadline no more than 60 minutes after start; exceeding it is a mandatory rollback trigger, not permission to remain in C. After bounded C smoke, D is the only forward transition. If AUTH-D is unavailable, drifted, or unknown, require immediate known-good old Worker rollback to B while Foundation stays; never mark C steady. For `SUSPECT`, require proof for every affected unrevoked row or a separately reviewed revocation receipt before C/D reentry.
- [ ] Runbook shape: inventory `private.ogh_verified_sessions` where `verified_at >= start AND verified_at < end` and `revoked_at IS NULL`, reconcile exact affected session set/count under controlled evidence, then either prove each row valid or separately authorize an `UPDATE` setting `revoked_at = greatest(clock_timestamp(), verified_at)` only for the reviewed affected window/IDs; verify postcondition and deny any out-of-window mutation. No automatic cleanup, no fifth table, no historical-session sweep, no Production SQL execution in implementation.
- [ ] Focused GREEN: both focused scripts pass suspect/proven/boundary/partial-revocation mutation tests; `SUSPECT_C_WINDOW_ROWS_REVOKED` requires postcondition evidence, not operator assertion alone.
- [ ] Regression: `node scripts/test-verified-session-db-stage.mjs` and B rollback case remain green.
- [ ] Inspect diff for no Production connector, automatic revocation, open-ended C timer, or unbounded row predicate.
- [ ] Stage the five exact paths; commit `test(auth): bind transient cutover and suspect-row rollback`.

## Task 10: State D Security And Forbidden Pairings

**Files:** `scripts/test-verified-session-cutover-matrix.mjs`, `scripts/test-verified-session-bypass.mjs`, `scripts/test-verified-session-cutover-guard.mjs`.

**Interfaces:** Consumes final Enforcement DB, new Worker, Task 9 C-entry guards. Produces `MATRIX_D=PASS`, `VERIFIED_SESSION_FULLY_ACTIVE_ELIGIBLE=true` locally only, and pre-action `PAIRING_GUARD=DENY` for both prohibited combinations.

- [ ] RED: pending Worker/API, direct PostgREST writes/private reads, mutating RPC, Storage write/private read and private Realtime all deny; service-role route call logs show zero privileged operations before verified guard; verified actor, owner/staff checks, public reads/media/counters, policy independence, no age gate, service-only resend, logout old JWT denial all pass. Reject new/PRE_V1 and old/ENFORCEMENT before a test attempts activation, including wrong build digest.
- [ ] Run RED: `node scripts/test-verified-session-cutover-matrix.mjs --state D`; expect D acceptance gap until full matrix is wired.
- [ ] Minimal implementation: reuse the full `verifyBypass`/Task 13 controls on local D and wire the pure pairing guard at the pre-action boundary; keep positive verified Realtime readiness/sentinel control. Any observed bypass blocks release and requires a reviewed owning-surface fix, never a relaxed assertion.
- [ ] Focused GREEN: `node scripts/test-verified-session-cutover-matrix.mjs --state D`, `node scripts/test-verified-session-bypass.mjs`, and `node scripts/test-verified-session-cutover-guard.mjs` pass.
- [ ] Regression: A/B/C matrix cases and `node scripts/test-verified-session-service-role-audit.cjs` remain green.
- [ ] Inspect diff for all direct paths, public branches, no default-open exception and no post-Enforcement old Worker rollback.
- [ ] Stage the three exact paths; commit `test(auth): prove final state and reject forbidden pairings`.

## Task 11: Release Catalog Packet And Readiness Documents

**Files:** Modify `docs/ops/verified-session-v1-hosted-catalog-preflight.sql`, `docs/ops/verified-session-v1-release-gates.md`, `docs/ops/verified-session-v1-hosted-readiness.md`, `scripts/test-verified-session-release.mjs`.

**Interfaces:** Consumes Tasks 1-10 final paths, SHA-256, locked local Worker/rollback identities, classifier/pairing contract, A/B/C/D proof and C-window rule. Produces non-executable AUTH-A..AUTH-F review gates and `HOSTED_READINESS_STATUS=READY_FOR_BOUNDED_HOSTED_AUTHORIZATION` only if every repository/local prerequisite is proven; `AUTH_RELEASE_STATUS=NO_GO` remains.

- [ ] RED: release test rejects old migration names/hashes, old five-stage ordering, absent Stage C transient/rollback rule, missing provenance check, missing AUTH-D packet prerequisite, `GO` status, direct executable deploy/SQL commands, missing catalog facts, or omitted per-stage single-use authorization.
- [ ] Run RED: `node scripts/test-verified-session-release.mjs`; expect stale readiness/release packet assertions.
- [ ] Minimal implementation: update read-only catalog packet with exact four-table/eight-function/resend/policy/publication/ACL facts for classifier snapshots; make private-schema privilege inspection null-safe when `private` is absent at PRE_V1 using catalog OID lookup rather than a hardcoded nonexistent schema name. Replace stale old hashes with `Get-FileHash -Algorithm SHA256` outputs for both new files; document A inventory, B Foundation, C Worker, D Enforcement, E bounded verification, F closeout. Include C start/end, same-window D or B rollback, suspect-row proof/revocation, post-D verified-capable rollback floor and hosted signing/template/quota checks. No executable release command is added.
- [ ] Focused GREEN: `node scripts/test-verified-session-release.mjs` passes and documented SHA-256 recomputes exactly.
- [ ] Regression: `node scripts/test-verified-session-db-stage.mjs`, `node scripts/test-verified-session-cutover-guard.mjs`, `git diff --check` pass.
- [ ] Inspect diff for `NO_GO`, no credential-derived data, no paid resource, no automatic external action and no stale approval template bound to old hashes.
- [ ] Stage the four exact paths; commit `docs(auth): prepare staged verified-session release gates`.

## Task 12: Whole-Branch Cutover Verification And Review

**Files:** Create `scripts/test-verified-session-cutover-final.mjs`; all artifacts under the exact file map are read for review. No new Production path.

**Interfaces:** Consumes Tasks 1-11; produces a local verification record proving A/B/C/D, two denied pairings, final-state equivalence, C transient and suspect rules, no hosted action, exact two migration files, clean branch diff.

- [ ] RED: add one aggregate verifier that fails if any required matrix result, classifier mutation test, final equivalence result, artifact SHA-256, transient C evidence, or suspect-row guard is absent; document the observed failing assertion in the local review record.
- [ ] Run RED: `node scripts/test-verified-session-cutover-final.mjs`; expect `CUTOVER_PROOF_INCOMPLETE` before wiring the focused-suite invocations.
- [ ] Minimal implementation: have the aggregate verifier spawn only the fixed local commands `node scripts/test-verified-session-sql.mjs`, `node scripts/test-verified-session-cutover-matrix.mjs --all`, `node scripts/test-verified-session-db-stage.mjs`, `node scripts/test-verified-session-cutover-guard.mjs`, `node scripts/test-verified-session-c-window.mjs`, `node scripts/test-verified-session-release.mjs`, `npm test`, and `npm run build` with sanitized environment; require current-run exit codes and exact A/B/C/D/equivalence/guard markers. Refuse any non-loopback target, hosted credential variable, or cached proof file. Do not change Worker behavior or widen access to force green.
- [ ] Focused GREEN: all preceding commands pass; migration file count is two and final state equals the pinned reviewed v1 final catalog plus resend remediation.
- [ ] Regression: auth claims/routes/signup/UI, legal consent, public reads, Storage, direct RPC, Realtime and resend suites in the File Map pass on local fixtures; `git diff --check` passes.
- [ ] Inspect full branch diff against `origin/main` for only scoped auth/cutover changes, external connection zero, and no Product Detail work; independent review all eight risk classes in Review Focus.
- [ ] Stage only `scripts/test-verified-session-cutover-final.mjs`; commit `test(auth): require complete local cutover proof`.

## Spec And Ruling Coverage

| Approved spec sections | Owning plan tasks/constraint |
| --- | --- |
| 1-3 status, blocker, constraints | Global Constraints; Tasks 1, 11-12 |
| 4 dependency graph; 5 approaches; 6 architecture | Artifact And Stage Contracts; Tasks 2-5, 11 |
| 7 compatibility matrix | Tasks 5-8, 10, 12 |
| 8 Foundation; 9 resend | Tasks 1-2, 7 |
| 10 single Worker; 11 Enforcement | Tasks 3, 8, 10 |
| 12 migration provenance | Tasks 1, 11; future AUTH-A stop gate |
| 13 existing sessions; 14 policy/legal bootstrap | Tasks 8, 10 |
| 15 rollback; 16 failure matrix | Tasks 5, 9, 11 |
| 17 local proof; 18 release-stage guards | Tasks 4-10, 12 |
| 19 authorization boundaries; 20 zero-cost | Global Constraints; Task 11 |
| 21 security invariants; 22 non-goals; 23 reviewed State C decision | Global Constraints; Tasks 3, 9-12 |

Ruling A is owned by Tasks 9, 11 and the aggregate gate in Task 12: no C entry without D artifact/hash/tests/preflight/rollback/AUTH-D packet; C exits directly toward D or back to B. Ruling B is owned by Task 9: UTC C-window evidence, cause classification, exact affected-row proof or separately authorized bounded revocation, and fail-closed reentry. A public-read/UI-only rollback is `PROVEN` only when verification integrity is positively established.

## Completion Boundary

Successful local implementation would make the repository `READY_FOR_BOUNDED_HOSTED_AUTHORIZATION`, never `AUTH_RELEASE_STATUS=GO`. Future AUTH-A must first prove actual deployed Worker, effective hosted catalog, migration provenance, free capacity, and target identity. AUTH-B/C/D/E/F remain distinct single-use authorizations with separate stop gates. No instruction in this plan runs an external stage, creates a Production wrapper, requests authorization, or starts Product Detail v2.
