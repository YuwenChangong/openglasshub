# Global Locale and Settings v1 Acceptance

## Status and Boundaries

Task19 is accepted at source commit `bb6170461f9afd3dbfb9da3db023909de257df43`.
Task20 repository implementation does not close Slice B. Task20 remains
`AWAITING_BOUNDED_QA_RELEASE` until separately authorized release verification
and independent whole-branch review pass. Nothing here authorizes a merge,
deployment, Production SQL, provider change, or Production Auth, email,
content or preference mutation. P9 is excluded.

## Accepted Task19 Prerequisites

| Independent gate | Historical accepted evidence |
| --- | --- |
| Workers browser locale acceptance | PASS, 102 completed / 102 required |
| Locale coverage | PASS; authoritative `tests/fixtures/locale-ui-coverage.json`, 108 files |
| Local persistence/RLS | PASS; genuine local Auth, user A/user B/anon, owner-only RLS and owned loopback target, zero remote connections |
| Required regressions | PASS; 146 Node cases and 10 script runs |

These are accepted historical results, not fresh results from Task20
validation. Keep original RED, partial GREEN, screenshots and safe receipts;
never rewrite a failure as PASS. The earlier Task20 prerequisite correction
preserves its 8/10 result: the wrong AuthPanel path and invented SettingsPage
inventory membership stopped children before execution. The correction uses
`src/components/forum/AuthPanel.tsx` and removes that SettingsPage assumption.
It does not redefine or expand the accepted 108-file inventory.

Accepted browser cases include anonymous detection and cookie reload/navigation;
account adoption and reload before explicit selection; explicit device choice
retained across reload/logout; A-to-B switching and stale actor responses;
Auto CN/non-CN and unavailable-country fallback; blocked storage, API outage
and revision conflict; first-frame SSR/hydration consistency; keyboard, dark-only,
long labels and responsive desktop/390/430 flows in the accepted engine matrix.
User content, source titles and scoped original-language documents remain
classified exceptions. Local persistence evidence separately proves genuine
Auth and user A/user B/anon RLS; browser fixtures alone cannot prove RLS.

## Validation Only

Run from the reviewed repository using a credential-stripped child environment:

```sh
node --test scripts/qa/test-qa-harness-manifest.mjs scripts/qa/test-qa-harness-profiles.mjs
node scripts/test-global-locale-settings-contract.mjs
git diff --check
```

The aggregate validates the canonical inventory's structure and referenced
files, package interfaces and QA prerequisites, then executes only deterministic
locale contract, detection, cookie/store, preference API and schema tests.
It performs no build, browser matrix, database replay or local persistence/RLS
execution. Child environments contain only OS execution variables and disabled
telemetry/update flags, not inherited provider credentials or database targets.
Each child has LOCAL retries0 and a 90000ms budget; failure is terminal.

The aggregate emits a safe receipt to stdout with actual Git HEAD, separate
gate diagnostics, `mode=VALIDATION_ONLY` and `sliceBReleaseAccepted=false`.
Its browser/persistence fields remain `SEPARATE_ACCEPTED_INPUT_REQUIRED`.
It does not persist the artifact path described by the receipt schema. Any
operator-captured validation output belongs under ignored repository-relative
`artifacts/qa/`, not in source. Validation PASS is not release PASS.

## Accepted-Input Handoff and Source Identity

The RELEASE adapter reads only
`artifacts/qa/global-locale-settings-v1/accepted-inputs.json`. This ignored
sidecar must be prepared under a separate reviewed handoff, after comparing
the original Task19 evidence and its accepted source identity. Do not fabricate
it, infer missing gates, copy credentials, or produce it to bypass a failure.
This Task20 repository-only authorization does not create the sidecar.

Its strict schema contains exactly:

| Field | Required contract |
| --- | --- |
| `schemaVersion` | 1 |
| `commitSha` | Full 40-character lowercase evidence-source Git SHA |
| `browser` | Accepted status plus `completed=102`, `required=102` |
| `coverage` | Accepted status plus `manifest=tests/fixtures/locale-ui-coverage.json` |
| `persistence` | Accepted status plus `genuineLocalAuth=true`, `realLocalRls=true`, `ownedLocalTarget=true`, `remoteConnections=0` |
| `regressions` | Accepted status plus `nodeCases=146`, `scriptRuns=10` |

All four independent statuses must be PASS supported by the reviewed evidence.
Extra fields, missing/failed/partial gates, malformed data, symlinks and oversized
inputs are rejected. This summary is a human-reviewed evidence attestation,
not cryptographic proof or a fresh browser/RLS run.

The adapter requires context SHA equal to current HEAD, evidence SHA an
ancestor of that HEAD, a clean worktree and only the seven planned Task20
files changed since the evidence SHA. Product, inventory or harness changes
invalidate reuse. Do not relabel evidence SHA to evade this check. Stop and
seek separately authorized owning-gate review if source changed.

## Bounded Release Gate

Only a separate authorization permits the established command:

```sh
npm run qa:release
```

Maximum release attempts: 1. Automatic retry: none. Preserve the first receipt;
failure requires a separately reviewed fix and new bounded authorization.
No inherited forum-search waiver, allowed-to-fail flag, gate bypass or silent
browser/RLS rerun is permitted. This document does not execute that command.

The existing RELEASE runner selects `global-locale-settings-contract` and
fails it closed before its child when accepted inputs are missing, invalid or
source-mismatched. Its safe diagnostics distinguish accepted browser/coverage/
local-RLS/regression inputs from the newly executed deterministic result.
The release receipt binds actual source SHA and keeps those outcomes separate.
Missing prerequisites or any failed check block release acceptance.

Preserve existing budgets: new deterministic/default/search 90000ms,
Slice A and project tests 180000ms, build 240000ms and the existing targeted
browser journey 120000ms. The existing release journey is not Task19's
102-case matrix or genuine-local RLS. Database replay, Production smoke,
deployment and provider operations remain excluded from RELEASE.
Safe receipts use `artifacts/qa/<runId>/receipt.json`; never commit runtime
artifacts, emails, session data, tokens, secrets or machine-specific paths.

Before any PR/release handoff, independently review the exact whole-branch SHA,
the seven Task20 paths, unchanged dependencies/lockfile, accepted prerequisites
and release receipt. No unresolved blocking issue may be hidden by the aggregate.
Task20 cannot be marked COMPLETE before the separately authorized gate passes.

## Staging, Rollout and Rollback Gates

Separate staging authorization measures the static-to-SSR change: localized
HTML private/no-store behavior, immutable asset caching, SSR latency/resource
impact, coherent locale after reload/navigation and 390/430/desktop layout.
Record measured conditions and limits; no capacity certification follows from
local fixture results. Do not substitute a Production request for staging.

Production migration, merge, deployment and locale preference writes each need
separate exact-source/target authorization. Keep CAPTCHA enabled and Auth mode
required; Supabase Auth remains the sole CAPTCHA consumer. Preserve runtime
consent removal, safe redirects, resend limits/cooldown and the human-repaired
server-only rate-limit binding. Never expose or change its value here.

On a critical locale, RLS or Auth regression, stop. An authorized app rollback
must use a recorded known-good required-mode, token-capable Worker; never an
older off/prepare artifact while enforcement is enabled. Leave the additive
preferences table/data intact; no automatic SQL, provider toggle or destructive
rollback. RLS access revocation requires separate reviewed authorization.
