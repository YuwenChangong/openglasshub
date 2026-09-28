# Task 1 Report: Replace-Only Consent Navigation

Status: DONE
Date: 2026-09-28
Branch: fix/product-recovery-slice-a-v1
Workspace: C:/Users/1/.codex/worktrees/product-recovery-slice-a-v1/OpenGlass Hub
Baseline: f4580bb0495d1e35f80f994446ce973f57aa1e0b
Implementation commit: 25ecee38baa7d7fa11dd2b1a48531bc7b6eef5de
Implementation commit title: fix: replace redundant current consent interstitial
Report is staged separately and committed as `docs: record Task 1 consent navigation evidence`. Its commit is the subsequent branch HEAD; a report cannot embed its own Git hash.

## Scope and Instructions

Read task-1-brief.md first and spec section 8 only; did not read the whole plan. Read the requested test-driven-development (including writing-good-tests), systematic-debugging, verification-before-completion, and openglass-frontend-guard skills from their installed paths. The explicit Task 1 instructions govern implementation and safety. No agents or reviewers were spawned. Independent review remains for the controller after these commits. No push or PR.

Exactly seven implementation/test paths were staged explicitly:

- src/components/legal/LegalConsentPage.tsx
- src/lib/legal-consent-navigation.ts
- tests/visual/legal-consent-harness/main.tsx
- tests/visual/legal-consent-state-matrix.mjs
- scripts/test-legal-consent-visual.mjs
- scripts/test-legal-consent-auth-flow.mjs
- scripts/test-auth-redirect-safety.mjs

This report is the only additional repository path. Changes used apply_patch; no dependency/framework/config changes. Dependencies were already installed offline.

## Behavior and Root Cause

The original status lookup set a terminal `current` state, leaving an already-consented user on a success interstitial. Successful submission used `navigation.navigate`, retaining consent in history. Its busy state was set after awaiting the session, allowing simultaneous submits to start. Session lookup exceptions were outside its catch, expired API status became a generic error, and asynchronous completions had no unmount guard.

Current consent now replaces immediately, without recording or rendering the old success interstitial. Missing/outdated consent keeps the real acknowledgement form and replaces only after the existing record adapter returns current consent. A non-current record result is an actionable failure with no navigation. Sources remain legacy_account_gate, policy_update, and authenticated_callback. There is no change to minimumAge 16, bundle 2026-07, client record payload, server authorization/enforcement, persistence/idempotency, or storage.

The new `getSafeConsentNext(input: unknown): string` delegates syntax/origin validation to existing getSafeNext with /feed/ fallback. It classifies normalized/decoded auth, login, register, and legal-consent paths as loops while preserving legitimate sanitized internal destinations, query strings, and hashes. General getSafeNext and callback/recovery origin rules are unchanged.

401 during get/record and missing sessions expose a login action that returns through /legal-consent/?next=<safe destination>. Get errors have retry/logout; record errors allow resubmission/logout. Session exceptions and logout failures are caught. A synchronous lock covers the session await and record, request sequence invalidation blocks stale results, replacement is guarded once per lifecycle, and cleanup cancels timers. An 8-second deadline bounds a pending session/status/record/logout request; late results cannot record or navigate after expiry/unmount. Injected auth bypasses browser Supabase client construction on this page.

## Offline Boundary

All execution below used this process-local preload:

```powershell
$env:NODE_OPTIONS='--require=C:/Users/1/AppData/Local/Temp/task1-local-network-only.cjs'
```

The temporary CJS file was created with apply_patch outside the checkout. It denies non-loopback socket connections, DNS lookup, and fetch before transport, and removes inherited credential-related variables without printing their values. Node child processes inherit it. It is an execution guard, not a dependency or repository/config mutation. No real credentials were used.

Playwright uses injected fixture adapters and test-session tokens. Browser-context HTTP routing covers every page, allows exactly http://127.0.0.1:4387 plus data URLs, and aborts other origins. WebSocket routing permits only the matching local Vite endpoint. Service workers are blocked; Chromium background networking is disabled and non-local hostname resolution is disabled. Browser adapters record navigation rather than visiting destinations. No Production/provider requests, email sends, SQL execution, remote configuration mutation, or live Auth were performed.

The guard was verified with synchronous assert.throws calls for fetch and net.connect using example.invalid; both failed before transport:

```text
TASK1_NETWORK_GUARD_OK fetch and socket denied before transport
```

Fresh visual network evidence:

```json
{"allowedLocalOrigin":"http://127.0.0.1:4387","blockedExternal":[],"unexpectedExternalRequestCount":0}
```

This evidence covers these Node/browser processes, not an OS-wide network audit.

## Original Behavioral RED

Before changing LegalConsentPage, added the current-consent behavioral assertion and local fixture/network harness changes, then ran:

```powershell
node scripts/test-legal-consent-visual.mjs
```

Exit 1, against the original production component:

```text
LEGAL_CONSENT_VISUAL_FAIL currentConsentReplaces: already-current consent must replace immediately

false !== true
```

This was an assertion on the missing replace trace after the existing success state rendered, not a network/startup/import failure. An earlier test-development run hit a selector ambiguity because output also has a status role; that selector was corrected before the behavioral RED above and is not counted as RED evidence.

For loop rejection, first added a minimal helper delegating to existing getSafeNext without the new loop classification, plus assertions, then ran:

```powershell
node --experimental-strip-types scripts/test-auth-redirect-safety.mjs
```

Exit 1:

```text
AssertionError [ERR_ASSERTION]: consentNextRejectsLoops: /legal-consent/?next=%2Flegal-consent%2F
+ actual - expected

+ '/legal-consent/?next=%2Flegal-consent%2F'
- '/feed/'
code: 'ERR_ASSERTION'
actual: '/legal-consent/?next=%2Flegal-consent%2F'
expected: '/feed/'
operator: 'strictEqual'
```

Only after these failures were observed was the production navigation/lifecycle fix implemented.

## Fresh Focused GREEN

Final visual run after lifecycle tests were strengthened to resolve old requests after unmount:

```powershell
node scripts/test-legal-consent-visual.mjs
```

Exit 0, complete output:

```text
currentConsentReplaces: PASS
requiredConsentRecordsThenReplaces: PASS
expiredSubmissionReturnsToLogin: PASS
consentNextRejectsLoops: PASS
consentFailuresAndLifecycle: PASS
LEGAL_CONSENT_VISUAL_OK 30/30 states passed evidence=C:\Users\1\AppData\Local\Temp\openglass-legal-consent-phase3b1-matrix-2026-09-28T08-39-12-160Z
```

```powershell
node scripts/test-legal-consent-auth-flow.mjs
```

Exit 0:

```text
LEGAL_CONSENT_AUTH_FLOW_OK offline static auth/callback/page checks passed
```

```powershell
node --experimental-strip-types scripts/test-auth-redirect-safety.mjs
```

Exit 0, fresh output after correcting the diagnostic rejected-case count from 21 to 19:

```text
consentNextRejectsLoops: PASS rejected=19 preserved=7
{"validCaseCount":10,"rejectedCaseCount":27,"callbackFallback":"/","navigationCalls":2,"passwordRecoveryOriginChecked":true,"preparedOriginMode":"EXPLICIT_APPROVED_ORIGIN_ONLY"}
```

```powershell
node scripts/test-legal-consent-page-gate.mjs
```

Exit 0:

```text
LEGAL_CONSENT_PAGE_GATE_OK routes=18
```

Additional retained guard/persistence verification, both exit 0:

```powershell
node --experimental-strip-types scripts/test-legal-consent-mutation-guard.mjs
node --experimental-strip-types scripts/test-legal-consent-persistence.mjs
```

```text
LEGAL_CONSENT_MUTATION_GUARD_OK offline cases=13
LEGAL_CONSENT_PERSISTENCE_OK offline mocks and static RLS/API checks passed
```

## Revised Matrix Counts and Inspection

All 30 original state IDs remain. Per the controller ruling, consent-already-current moved from screenshot-success coverage to redirect assertion coverage. Revised counts:

| Metric | Before | After |
| --- | --- | --- |
| Matrix states | 30 | 30 |
| Screenshot-required states | 25 | 24 |
| Viewports | 3 | 3 |
| Required screenshots | 75 | 72 |
| Redirect assertion states | 5 | 6 |

Fresh matrix.json confirms executed=30, passed=30, failed=0, actualScreenshots=72, passedRedirectAssertions=6, unexpectedExternalRequests=0. Previously the executed-state diagnostic incremented once per viewport; it now counts each matrix state once. The existing auth/callback screenshot and interaction coverage remains; consent screenshot states now also drive actual checked, pending, recorded, and failed scenarios.

Additional injected cases assert no record for current consent; exactly one ordered record then replace for missing/outdated/callback consent; 401 during record; missing submission session; generic get/session/record failures; non-current record result; retry success; delayed status; concurrent submit before session resolution; stale GET and POST completion after unmount; status timeout with late resolution; logout success/failure; external, encoded external, and encoded consent-loop destinations. Destination and source expectations are literal assertions on the real component's adapter calls.

Evidence directory: C:/Users/1/AppData/Local/Temp/openglass-legal-consent-phase3b1-matrix-2026-09-28T08-39-12-160Z

Visually inspected these generated images, with no visible overlap or clipping:

- screenshots/390x844-consent-missing-checked.png
- screenshots/430x932-consent-session-expired-401.png
- screenshots/1440x900-consent-submit-success.png (transient redirect status, not a success interstitial)

The automatic overflow check passes for all 72 screenshots at 1440x900, 430x932, and 390x844.

## Full Project Test and Local Compilation

Ran `npm test` exactly once after focused GREEN and before implementation commit. Exit 0; all three existing commands passed:

```text
> openglass-hub@0.1.0 test
> node --experimental-strip-types scripts/test-moderation.mjs && node --experimental-strip-types scripts/test-trusted-server-admin-runtime.mjs && node --experimental-strip-types scripts/test-admin-circle-lifecycle.mjs
```

All emitted PASS cases completed, including default-off provider/classifier behavior, authorization-before-elevation, legal-consent mutation gates, circle lifecycle, and failed storage preventing purge. Expected fixture lexicon fallback warnings were emitted for temporary R2 failure and the emergency fallback path. The incidental `WebSocket server error: Port 24678 is already in use` warning appeared; as ruled by the brief, it was not a test failure. No tests failed or were omitted from that command.

For frontend compilation, ran the existing fixture Vite config from tests/visual/legal-consent-harness, producing only a temporary artifact:

```powershell
node ../../../node_modules/vite/bin/vite.js build --config vite.config.ts --outDir C:/Users/1/AppData/Local/Temp/task1-consent-harness-build --emptyOutDir
```

Exit 0: Vite 8.0.16, 72 modules transformed, built in 110ms. Existing shared CSS emitted two lightningcss warnings about `.detail-main :global(p)` and `:global(li)`; those unrelated styles were not changed. The full project `npm run build` was not run: its wrapper reads Production configuration, injects configured public variables, and writes generated Wrangler configuration, outside the explicit no-credentials/no-config-mutation boundary. Local TSX compilation and browser fixture execution passed; no Production build or deployment readiness claim is made.

## Self-Review and VCS Proof

Reviewed the complete component/helper, harness, and script diffs. Checked that getSafeNext remains the first validator; the consent helper does not relax approved-origin rules; session resolution happens once per operation; record cannot happen while unchecked or after session/unmount expiry; submit acquires its lock before awaiting; non-current/failed records cannot replace; 401 gets a safe nested return; logout consumes its adapter error; and timer/request cleanup prevents stale updates/navigation. Record idempotency remains server-owned; no local storage consent flag was introduced.

`git diff --check` and `git diff --cached --check` passed before commit. Explicit staging listed only the seven mapped implementation/test paths. Commit output:

```text
[fix/product-recovery-slice-a-v1 25ecee38] fix: replace redundant current consent interstitial
7 files changed, 341 insertions(+), 65 deletions(-)
create mode 100644 src/lib/legal-consent-navigation.ts
```

The report is committed separately with explicit path staging. The SDD directory is ignored, so ordinary git add refused it; only this requested report path was force-staged with `git add -f -- .superpowers/sdd/2026-09-28-product-recovery-slice-a-auth-identity-email-consent-v1/task-1-report.md`. No ignore rules were changed. No Settings/global i18n/theme/detail/P9/VerifiedSession files were changed. Test-owned browser/Vite processes closed at the end of each run; final successful harness teardown awaited Vite exit.

## Concerns and Review Handoff

No unresolved Task 1 behavioral failures found in self-review. Full project Production build and live-provider/browser-history traversal are intentionally outside this fixture-only task. Existing auth/callback matrix labels remain baseline smoke coverage, not proof of real provider integration. The process/browser network controls are not an OS firewall. An in-flight request can already have reached its adapter before timeout/unmount; the component suppresses stale completion rather than cancelling server work, and existing server idempotency remains authoritative.

Nonblocking warnings: fixture lexicon fallback, occupied Vite HMR 24678, and existing shared CSS :global minifier warnings. Independent review has not been performed here and is to be dispatched by the controller. Task 2 and later Slice A tasks were not started.
