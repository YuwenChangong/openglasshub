# OpenGlass QA Harness v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task with a fresh implementer and review after every task.

**Goal:** Implement four deterministic, risk-aware QA commands that orchestrate existing OpenGlass checks and produce safe compact receipts.

**Architecture:** Add a small `.mjs` orchestration layer under `scripts/qa/` with separate invocation, manifest/risk, registry/executor, safety, receipt, and profile modules. Existing tests and runners remain the source of truth and are invoked through adapters.

**Tech Stack:** Node.js ESM, existing npm scripts, Astro/Workers build, direct Playwright scripts, Node `fetch`, `node:test`/assert, and git subprocesses.

**Spec:** `docs/superpowers/specs/2026-09-05-openglass-qa-harness-v1-design.md`

## Global Constraints

- Public interface is exactly `qa:fast`, `qa:feature`, `qa:release`, and `qa:prod`.
- Risk levels are exactly `LOW`, `MEDIUM`, and `HIGH`.
- High-risk changes cannot run only under fast/feature; they fail closed naming `qa:release`.
- `qa:prod` allows only validated HTTPS origins, allowlisted read-only methods/routes, and zero DB/provider/mutation operations.
- Existing tests, security gates, cleanup logic, and proven runners are preserved; adapters may wrap them but may not weaken or delete them.
- Local deterministic checks have zero retries; production/network checks have at most one retry and retain first-attempt evidence.
- Secret values, DSNs, tokens, service-role material, and unrestricted environment output are never printed or stored.
- Receipts live under the gitignored runtime artifact directory and are not committed.
- Every implementation task follows RED test, implementation, GREEN test, relevant regression, explicit-path commit, and task review.
- No deployment, migration, provider mutation, production DB connection, `main` push, or merge is part of this branch.

---

### Task 1: Harness core contracts and invocation parser

**Files:**
- Create: `scripts/qa/runner.mjs`
- Create: `scripts/qa/contracts.mjs`
- Create: `scripts/qa/test-qa-harness-core.mjs`

**Interfaces:** Export `QA_PROFILES`, `RISK_LEVELS`, `parseInvocation(argv)`, `normalizeCheckResult(input)`, and `createRunContext(input)`. Parsing accepts the four profile names and one optional feature area; invalid flags return a typed validation error without running a command.

- [ ] Write failing tests for profile/risk enums, feature area argument parsing, duplicate/unknown flags, deterministic validation errors, and normalized result defaults.
- [ ] Run `node scripts/qa/test-qa-harness-core.mjs` and observe RED.
- [ ] Implement the smallest ESM contracts and parser without process execution.
- [ ] Run the focused test and `git diff --check`; observe GREEN.
- [ ] Commit only the task files with `feat(qa): add harness core contracts`.

### Task 2: Declarative manifest and validation

**Files:**
- Create: `scripts/qa/manifest.mjs`
- Create: `scripts/qa/test-qa-harness-manifest.mjs`

**Interfaces:** Export a frozen manifest, `validateManifest(manifest)`, `getArea(name)`, and `expandDependencies(areaNames)`. Use evidence-backed areas (`frontend`, `devices`, `products`, `forum`, `news`, `search`, `auth`, `media`, `admin`, `seo`, `cloudflare`, `supabase-config`, `database`, `security`); do not invent a compare route absent from the repository.

- [ ] Write RED tests for unknown dependencies, cycles, invalid risks, duplicate check IDs, destructive production checks, deterministic dependency closure, and actual path matcher coverage.
- [ ] Run the focused manifest test and observe RED.
- [ ] Implement data-only area/check declarations and validation.
- [ ] Run the focused test plus the existing Workers/artifact guard and observe GREEN.
- [ ] Commit only manifest/test files with `feat(qa): add declarative area manifest`.

### Task 3: Git changed-path and risk classifier

**Files:**
- Create: `scripts/qa/risk.mjs`
- Create: `scripts/qa/test-qa-harness-risk.mjs`

**Interfaces:** Export `resolveComparisonBase({ branch, mainRef })`, `collectChangedPaths({ baseSha })`, and `classifyChanges({ paths, explicitArea })`. Use merge-base with the relevant main ref; include staged, unstaged, and untracked paths; return sorted paths, direct/expanded areas, maximum risk, and escalation reason.

- [ ] Write RED simulations for CSS LOW, device MEDIUM, compare-like paths only when manifest-backed, migrations HIGH, auth/security/Wrangler/provider HIGH, explicit-area downgrade prevention, dirty/staged/untracked paths, and branch divergence.
- [ ] Run the focused test and observe RED.
- [ ] Implement git subprocess adapters with argv arrays and fail-closed base resolution.
- [ ] Run focused tests and `git diff --check`; observe GREEN.
- [ ] Commit only classifier/test files with `feat(qa): classify changed areas and risk`.

### Task 4: Check registry and bounded process executor

**Files:**
- Create: `scripts/qa/check-registry.mjs`
- Create: `scripts/qa/process-executor.mjs`
- Create: `scripts/qa/test-qa-harness-executor.mjs`

**Interfaces:** Export `registerCheck`, `getCheck`, `runCheck`, and `executeCommand({ argv, cwd, env, timeoutMs, retryPolicy })`. A check declares ID, allowed profiles, timeout, retry policy, artifact policy, and classification. The executor returns bounded stdout/stderr, exit/signal/timeout, attempts, first fatal, and redacted diagnostics.

- [ ] Write RED tests for registry duplicate rejection, profile rejection, argv-only execution, timeout, bounded output, deterministic retry zero, one network retry, and secret-sentinel redaction.
- [ ] Run the focused executor test and observe RED.
- [ ] Implement the registry and executor without profile-specific orchestration.
- [ ] Run focused tests and the existing destructive orchestrator safety test; observe GREEN.
- [ ] Commit only registry/executor/test files with `feat(qa): add reusable check executor`.

### Task 5: Receipt, redaction, and failure artifacts

**Files:**
- Create: `scripts/qa/receipt.mjs`
- Create: `scripts/qa/artifacts.mjs`
- Create: `scripts/qa/test-qa-harness-receipt.mjs`
- Modify: `.gitignore` only if the chosen runtime artifact directory is not already ignored.

**Interfaces:** Export `createReceipt`, `finalizeReceipt`, `renderSummary`, `redactValue`, and `writeFailureArtifacts`. Freeze schema `openglass-qa/v1` with the required profile/areas/risk/SHA/check/timing/count/result/safety/artifact fields from the spec.

- [ ] Write RED tests for deterministic ordering, required fields, compact success output, bounded failure artifacts, secret/DSN/token redaction, and no artifact on successful runs beyond the receipt.
- [ ] Run the focused receipt test and observe RED.
- [ ] Implement value-blind receipt serialization and run-scoped artifact paths under `artifacts/qa/<run-id>/`.
- [ ] Run focused tests, `git diff --check`, and the existing service-role exposure tests; observe GREEN.
- [ ] Commit explicit receipt/artifact paths with `feat(qa): add redacted receipts and failure artifacts`.

### Task 6: FAST profile

**Files:**
- Create: `scripts/qa/profiles/fast.mjs`
- Modify: `scripts/qa/runner.mjs`
- Modify: `package.json`
- Extend: `scripts/qa/test-qa-harness-profiles.mjs`

**Interfaces:** Export `resolveFastChecks(context)`. The profile runs diff check, harness self-checks, relevant static/unit checks, and build/config guards when applicable; it must not select full E2E, replay, provider, or production checks.

- [ ] Add RED profile-selection assertions before wiring `qa:fast`.
- [ ] Run the profile test and observe RED.
- [ ] Implement FAST composition through registry IDs and add exactly `qa:fast` to package scripts.
- [ ] Run `npm run qa:fast` and focused profile tests; observe GREEN and prove excluded expensive IDs.
- [ ] Commit explicit profile/package/test files with `feat(qa): add fast profile`.

### Task 7: FEATURE profile and dependency selection

**Files:**
- Create: `scripts/qa/profiles/feature.mjs`
- Modify: `scripts/qa/runner.mjs`
- Modify: `package.json`
- Extend: `scripts/qa/test-qa-harness-profiles.mjs`

**Interfaces:** Export `resolveFeatureChecks(context)`. Require one explicit area or deterministic inference, apply risk classification and dependency closure, and return targeted checks plus skipped reasons. HIGH risk returns `RELEASE_REQUIRED` before executing feature checks.

- [ ] Add RED tests for `devices`, forum/auth/media expansion, unrelated admin avoidance, inferred areas, and explicit-area HIGH escalation.
- [ ] Run the focused profile test and observe RED.
- [ ] Implement FEATURE composition and add exactly `qa:feature`.
- [ ] Run `npm run qa:feature -- devices` in local-safe mode and relevant focused gates; observe GREEN and selection evidence.
- [ ] Commit explicit feature/package/test paths with `feat(qa): add feature profile selection`.

### Task 8: Targeted Playwright adapter

**Files:**
- Create: `scripts/qa/checks/playwright.mjs`
- Extend: `scripts/qa/manifest.mjs`
- Extend: `scripts/qa/test-qa-harness-profiles.mjs`

**Interfaces:** Export `runTargetedBrowserCheck({ group, baseUrl, browser })`. Reuse direct Playwright and existing P6B/P6C local runners; use one Chromium-compatible browser, no production write E2E, and capture trace/screenshot only on failure or first retry.

- [ ] Add RED adapter tests with a fake browser/check group and prove success has no heavy artifacts while failure requests evidence.
- [ ] Run focused adapter tests and observe RED.
- [ ] Implement adapters for real repository groups only (`devices`, `products`, `forum`, `auth`, `media`, `admin` where manifest paths require them).
- [ ] Run the adapter test plus existing Playwright-backed local test harness; observe GREEN.
- [ ] Commit explicit adapter/manifest/test paths with `feat(qa): add targeted browser adapters`.

### Task 9: RELEASE profile

**Files:**
- Create: `scripts/qa/profiles/release.mjs`
- Modify: `scripts/qa/runner.mjs`
- Modify: `package.json`
- Extend: `scripts/qa/test-qa-harness-profiles.mjs`

**Interfaces:** Export `resolveReleaseChecks(context)`. Include build, major automated tests, auth/security/API/media/SEO/Workers guards, device/forum surfaces, and local schema guards where relevant; exclude production DB/provider/deploy operations.

- [ ] Add RED assertions for critical check inclusion and forbidden production/provider check exclusion.
- [ ] Run the focused release profile test and observe RED.
- [ ] Implement RELEASE composition and add exactly `qa:release`.
- [ ] Run `npm run qa:release` and focused profile tests; observe GREEN.
- [ ] Commit explicit release/package/test paths with `feat(qa): add release profile`.

### Task 10: Production safety guard

**Files:**
- Create: `scripts/qa/production-safety.mjs`
- Create: `scripts/qa/test-production-safety.mjs`

**Interfaces:** Export `validateProductionTarget`, `validateProductionRequest`, and `assertProductionCheck`. Configuration supplies the current Workers origin as a default plus an allowlist so a future custom domain is a data/config change. Reject HTTP, unknown hosts, unknown/destructive paths, mutation methods, request bodies, DB/provider commands, and unsafe redirects before network I/O.

- [ ] Write RED tests for HTTP, unknown host, destructive route, POST/DELETE, unknown route, secret redaction, and safe GET/HEAD acceptance.
- [ ] Run the focused safety test and observe RED.
- [ ] Implement fail-closed target/request validation and zero-mutation counters.
- [ ] Run focused tests and existing target-write/production smoke safety tests; observe GREEN.
- [ ] Commit explicit safety/test files with `feat(qa): guard production smoke targets`.

### Task 11: PROD profile

**Files:**
- Create: `scripts/qa/profiles/prod.mjs`
- Modify: `scripts/qa/runner.mjs`
- Modify: `package.json`
- Extend: `scripts/qa/test-qa-harness-profiles.mjs`

**Interfaces:** Export `resolveProductionChecks(context)`. Use the safety guard and existing route knowledge to check `/`, devices/products, forum/feed, news, search, login, auth callback/reset, public APIs, media, canonical, sitemap, and protected negative auth. Compare is selected only if a real route/check exists.

- [ ] Add RED fake-fetch tests for route allowlisting, systemic 5xx, malformed canonical, missing public asset/media, protected-route public success, and first-fail/one-retry recovery accounting.
- [ ] Run the focused PROD test and observe RED.
- [ ] Implement read-only PROD composition and add exactly `qa:prod`.
- [ ] Run `npm run qa:prod` against the approved current URL only; observe GREEN with zero DB/provider/mutation counters.
- [ ] Commit explicit prod/package/test paths with `feat(qa): add read-only production profile`.

### Task 12: Harness self-test matrix

**Files:**
- Create: `scripts/qa/test-qa-harness-v1.mjs`
- Modify: `package.json` only if an internal `test:qa-harness-v1` script is needed.

**Interfaces:** Exercise all fourteen required scenarios from the design: LOW CSS, MEDIUM device, MEDIUM compare when backed by manifest, HIGH migration, explicit downgrade prevention, dependency expansion, unrelated avoidance, retry accounting, receipt determinism, destructive-route rejection, host validation, redaction, failure artifacts, and compact success logging.

- [ ] Write RED matrix assertions against the completed modules.
- [ ] Run the matrix and observe RED for missing behavior.
- [ ] Implement only missing test fixtures/adapters; do not add production writes.
- [ ] Run the matrix and all focused harness tests; observe GREEN.
- [ ] Commit explicit self-test/package paths with `test(qa): cover harness v1 contracts`.

### Task 13: Package contract and adoption documentation

**Files:**
- Modify: `package.json`
- Modify: `docs/README.md` only if the existing docs convention supports a short QA command section.
- Extend: `scripts/qa/test-qa-harness-v1.mjs`

**Interfaces:** Package scripts expose exactly four public `qa:*` names; lower-level existing scripts remain available and are not renamed or deleted. Documentation states profile intent and safety boundaries without adding deployment behavior.

- [ ] Add RED package contract assertions for exactly four public QA commands and preserved existing scripts.
- [ ] Run the package contract test and observe RED.
- [ ] Implement the final script wiring/docs only where required.
- [ ] Run package contract, harness matrix, and `git diff --check`; observe GREEN.
- [ ] Commit explicit package/docs/test paths with `docs(qa): document harness command contract`.

### Task 14: Full regression, evidence, and branch review preparation

**Files:**
- No new production source files; only test/receipt fixtures if a prior task proves one is necessary.

- [ ] Run `npm ci`, `npm audit --omit=dev`, `npm test`, and `npm run build` freshly.
- [ ] Run all four profiles in their authorized modes, including read-only `qa:prod`; retain receipts outside git.
- [ ] Verify selection evidence: FAST excludes full E2E/replay/provider; FEATURE runs area/dependencies only; RELEASE includes critical gates; PROD runs minimal safe smoke.
- [ ] Run `git diff --check`, verify existing tests/security gates are preserved, and inspect worktree/commit paths.
- [ ] Create the SDD whole-branch review package and dispatch the broad reviewer. Address only review findings through a fresh fix subagent and one scoped re-review; do not push or merge.

## Plan self-review record

The plan follows the frozen spec, uses existing runners instead of duplicating
product assertions, keeps production safety before network I/O, and assigns
each shared interface to a single task. Task order is dependency-safe: core →
manifest/risk → registry/receipts → profiles → safety/prod → self-tests and
adoption. No task authorizes a provider mutation or production database access.
