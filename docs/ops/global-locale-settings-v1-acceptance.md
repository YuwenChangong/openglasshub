# Global Locale and Settings v1 Acceptance

## Status and Boundaries

Task19 is accepted at source commit `bb6170461f9afd3dbfb9da3db023909de257df43`.
Task20 repository implementation does not close Slice B. Task20 remains
`BLOCKED_AWAITING_NEW_BOUNDED_RELEASE_AUTHORIZATION` until separately authorized
release verification and independent whole-branch review pass. Nothing here authorizes a merge,
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
files, package interfaces, QA prerequisites and the manifest's accepted evidence
with its source binding, then executes only deterministic locale contract,
detection, cookie/store, preference API and schema tests.
It performs no build, browser matrix, database replay or local persistence/RLS
execution. Child environments contain only OS execution variables and disabled
telemetry/update flags, not inherited provider credentials or database targets.
Each child has LOCAL retries0 and a 90000ms budget; failure is terminal.

The aggregate emits a safe receipt to stdout with actual Git HEAD, separate
gate diagnostics, `mode=VALIDATION_ONLY` and `sliceBReleaseAccepted=false`.
After acceptance validation, its independent gate diagnostics identify historical
inputs: `browser=PASS_102_OF_102`, `coverage=PASS_ACCEPTED`,
`persistence=PASS_GENUINE_LOCAL_ACCEPTED` and
`regressions=PASS_ACCEPTED_146_NODE_10_SCRIPTS`. They carry
`evidenceOrigin=ACCEPTED_TASK19`, the evidence-source SHA,
`freshBrowserEvidence=false` and `freshLocalRlsEvidence=false`.
Missing or invalid accepted inputs fail validation before deterministic children;
requirements alone cannot supply PASS. The aggregate does not persist its stdout
receipt. Operator-captured output remains ignored runtime evidence, not source.
Validation PASS is not release PASS.

## Accepted-Input Handoff and Source Identity

The canonical channel is `locale-settings.checks[].acceptedEvidence` in
`scripts/qa/manifest.mjs`, on the `global-locale-settings-contract` check.
The immutable record transcribes explicit human-reviewed Task19 acceptance bound
to `bb6170461f9afd3dbfb9da3db023909de257df43`. It is separate from the manifest's
prerequisite requirements; those requirements are not evidence of execution.
Both validation-only and RELEASE consume this record through
`loadLocaleAcceptance`. RELEASE defaults to the manifest record; an explicit
test-context `localeAcceptance` override goes through the same strict validator
and source gates, not a bypass. No external evidence file or machine-local
receipt discovery is required. Do not fabricate accepted inputs, infer missing
gates, copy credentials or change the record to bypass a failure.

Its strict schema contains exactly:

| Field | Required contract |
| --- | --- |
| `schemaVersion` | 1 |
| `commitSha` | Full 40-character lowercase evidence-source Git SHA |
| `browser` | `status=PASS`, `completed=102`, `required=102` |
| `coverage` | `status=PASS`, `manifest=tests/fixtures/locale-ui-coverage.json` |
| `persistence` | `status=PASS`, `genuineLocalAuth=true`, `realLocalRls=true`, `ownedLocalTarget=true`, `remoteConnections=0` |
| `regressions` | `status=PASS`, `nodeCases=146`, `scriptRuns=10` |

All four independent statuses must be PASS supported by the reviewed evidence.
Exact root and gate keys and matching prerequisite values are required.
Extra fields, missing/failed/partial gates and malformed data are rejected.
This summary is a human-reviewed evidence attestation,
not cryptographic proof or a fresh browser/RLS run.

The loader requires context SHA equal to current HEAD and evidence SHA an
ancestor of that HEAD. Committed changes since the evidence SHA and pending
tracked/untracked source paths must stay within this exact Task20 QA allowlist:

- `package.json`
- `scripts/qa/manifest.mjs`
- `scripts/qa/profiles/release.mjs`
- `scripts/qa/test-qa-harness-manifest.mjs`
- `scripts/qa/test-qa-harness-profiles.mjs`
- `scripts/test-global-locale-settings-contract.mjs`
- `docs/ops/global-locale-settings-v1-acceptance.md`
- `scripts/test-auth-legal-acknowledgement.mjs`
- `scripts/qa/checks/playwright.mjs`

RELEASE additionally requires a clean worktree. Validation-only permits pending
edits limited to the same allowlist; it does not relax evidence or ancestry
requirements. Product, inventory, schema or Task19 harness changes outside this
allowlist invalidate reuse. Missing, malformed, failed, stale or source-mismatched
inputs fail closed; no evidence-SHA relabeling or gate bypass is permitted.
Stop and seek separately authorized owning-gate review if source changed.

## Bounded Release Gate

Only a separate authorization permits the established command:

```sh
npm run qa:release
```

One invocation per bounded release authorization:
`TASK20_RELEASE_MAX_ATTEMPTS=1`, `TASK20_AUTO_RETRY=false`.
The per-run maximum is not the total historical release-run count. There is no
automatic retry of the release invocation; deterministic failure is terminal
for that invocation and blocks acceptance. Preserve the original failed receipt
and all historical evidence unchanged; never reinterpret a failed run as PASS.
After failure the sequence is repository repair -> review -> NEW explicit
bounded authorization -> new release invocation on the corrected reviewed SHA.
A separately authorized new run is not an automatic retry of the old process,
and does not erase or overwrite it. This document authorizes no new run.
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
102-case matrix or genuine-local RLS. Its auth fixture establishes a zh-CN
device preference before navigation and uses local-only Worker overrides with
Auth CAPTCHA off and no Auth sitekey. This does not change Production's required
mode or prove bot-protection acceptance. Existing targeted-browser adapter retry
classification is unchanged; it does not authorize a second release invocation.
Database replay, Production smoke, deployment and provider operations remain
excluded from RELEASE.
Expected Production mutations are zero: no SQL, provider mutation, deployment,
Auth request, email or content/preference mutation. Release verification is not
deployment. Safe runtime receipts remain ignored evidence; never commit runtime
artifacts, emails, session data, tokens, secrets or machine-specific paths.

Before any PR/release handoff, independently review the exact whole-branch SHA,
the Task20 QA allowlist, unchanged dependencies/lockfile, accepted prerequisites
and release receipt. Confirm the human-accepted Task19 binding and keep each
accepted gate status separate from the fresh deterministic outcome and current
source identity. No unresolved blocking issue may be hidden by the aggregate.
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
