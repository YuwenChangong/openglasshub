# OpenGlass QA Harness v1 Design

**Status:** Design frozen; implementation intentionally not started
**Date:** 2026-09-05
**Scope:** Local QA orchestration and read-only production smoke for OpenGlass Hub

## 1. Problem

OpenGlass currently has many valuable checks, but they are exposed as unrelated
`npm` scripts and task-specific runners. Agents must manually compose commands,
which makes selection inconsistent: a high-risk change can be under-tested while
a small change can trigger an unnecessarily expensive suite. Existing runners
also have different output shapes and different safety assumptions. QA Harness v1
adds one deterministic decision layer without replacing those proven checks.

## 2. Goals

- Provide exactly four public entrypoints: `qa:fast`, `qa:feature`, `qa:release`,
  and `qa:prod`.
- Select checks from a declarative area/risk/dependency manifest.
- Make risk escalation deterministic and impossible to bypass with an explicit
  feature area.
- Preserve existing security, moderation, device, forum, media, SEO, Workers,
  and local lifecycle tests.
- Keep successful output compact and make failed runs diagnostically useful.
- Emit one stable machine-readable receipt per run without committing receipts.
- Make production smoke HTTPS-only, allowlisted, read-only, and provider-free.
- Keep the command contract portable to future GitHub Actions.

## 3. Non-goals and v1 exclusions

V1 does not implement AI selection, self-healing, flaky-history learning,
automatic fixes, dependency upgrades, a complete browser matrix, production
write E2E, automatic production user/content creation, ordinary feature DB
replay, provider mutation from `qa:prod`, or a new CI workflow. Migration SQL,
provider configuration, deployment, and direct PostgreSQL capture remain
separately authorized operations.

## 4. Existing repository findings

The repository is an Astro 7 Workers application. Relevant package versions are
Astro `7.2.10`, `@astrojs/cloudflare` `14.2.6`, Playwright `1.62.1`, Supabase JS
`2.110.0`, and Wrangler `4.125.0` via package overrides. There is no Playwright
config file and no `.github` workflow in the current checkout; existing browser
checks launch Playwright directly.

### Proven checks and runners to wrap

| Existing component | Reuse in v1 |
| --- | --- |
| `scripts/build-workers.mjs` and `npm run build` | Fast, release, and feature build gate; it injects only `PUBLIC_*` and `SITE_ORIGIN`. |
| `scripts/smoke-production.mjs` | Adapter for the minimal read-only public/API production checks. |
| `scripts/post-launch-check.mjs` | Release and production privacy/route checks in strict mode. |
| `scripts/verify-seo.cjs`, `scripts/final-audit.cjs`, `scripts/audit-search.mjs`, `scripts/audit-media-url-privacy.mjs` | SEO, search, and media artifact checks. |
| `scripts/qa/p6b-local-e2e-runner.mjs` plus `p6b-local-e2e-runner-core.mjs` | Local Supabase mirror, Astro lifecycle, API ledger, real Playwright browser, cleanup, and zero-remote-connection evidence. |
| `scripts/qa/p6c-public-device-runner.mjs` | Local public device/product browser coverage where the device area is selected. |
| `scripts/qa/destructive-qa-orchestrator.mjs` and `run-destructive-qa.mjs` | Remain a separately guarded staging-only workflow; never selected by ordinary profiles. |
| `scripts/qa/production-minimal-canary-*` | Remain an explicitly approved write-and-cleanup canary; never selected by `qa:prod`. |
| `scripts/qa/p9-*`, `p10-*`, `p11-*` and privilege/reconciliation scripts | Remain operator-authorized database/provider workflows, not harness defaults. |
| `scripts/test-*` and existing `test:*` package scripts | Invoked as manifest commands, never deleted or weakened. |

The current public scripts include `smoke:production`, many focused tests, the
Workers config/environment/artifact guards, and `test:qa-orchestrator`; they do
not expose the four requested `qa:*` commands. `.gitignore` excludes build and
local runtime directories and `.tmp-*.log`, but has no QA receipt directory.

The actual application areas are represented by `src/pages` and `src/lib`:
`devices`, `products`, `forum`, `news`, `search`, `auth`, `media`, `admin`, SEO,
Workers/Cloudflare configuration, and Supabase/database/security. There is no
standalone compare route in the current source tree; compare may be introduced
as an area only when a manifest entry is backed by real paths and checks.

## 5. Architecture

The future implementation is a small adapter layer under `scripts/qa/`:

```text
scripts/qa/
  runner.mjs              process orchestration and receipt lifecycle
  manifest.mjs            declarative area/check/dependency data
  risk.mjs                path and explicit-area classification
  profiles.mjs            four profile resolvers
  receipt.mjs             schema, redaction, compact rendering
  safety.mjs              production target/method/route guards
  checks/                 one-responsibility reusable checks
  profiles/               profile-specific composition adapters
  test-qa-harness-v1.mjs  offline self-tests for the harness
```

These are design boundaries, not permission to create the files in this task.
`runner.mjs` coordinates; it does not contain product assertions or a giant
profile-specific function. Existing scripts are called through adapters with
argument arrays and explicit timeouts.

## 6. Profile contracts

### `npm run qa:fast`

Fast is local-only. It runs `git diff --check`, the harness self-consistency
checks, the fastest relevant static/unit checks, and the Workers build/config
guards when source configuration or build files changed. It never opens a
production DB connection, mutates a provider, runs full browser regression, runs
full database replay, or runs unrelated subsystem suites. A high-risk changed
path causes a fail-closed result requiring `qa:release`.

### `npm run qa:feature -- <area>`

Feature resolves one explicit area or, when no area is supplied, deterministically
infers areas from the changed path set. It runs the selected area's targeted
tests, targeted local E2E project/tag, dependency-expanded regression checks, and
the build/static gates required by its risk floor. An explicit area narrows
selection but cannot downgrade a high-risk changed path. High-risk changes fail
closed with `required_profile=RELEASE`; they do not silently run only feature QA.

### `npm run qa:release`

Release runs the proven critical local gates: build, major automated tests,
auth/security/API/media/SEO checks, important device/forum surfaces, Workers
artifact/config checks, and targeted local browser journeys. It may include a
local Supabase replay or schema guard when the changed manifest area requires
it, but it never implies production migration, DB replay against production, or
provider configuration mutation.

### `npm run qa:prod`

Production is a short, read-only smoke against an explicitly configured HTTPS
origin. It uses only allowlisted GET/HEAD requests and the existing safe smoke
adapters. It covers homepage, devices/products, forum/feed, news, search, login,
auth callback/reset surfaces, public APIs, public media, canonical, sitemap,
protected-route negative auth, and systemic 5xx/runtime-error detection. It does
not create users/content, upload media, delete anything, call SQL, read secrets,
mutate Supabase/Cloudflare, or execute migrations.

## 7. Manifest model

The manifest is the single declarative source of truth. Each area entry contains:

```text
area: stable identifier
pathMatchers: ordered repository globs
risk: LOW | MEDIUM | HIGH
relatedAreas: explicit dependency edges
checks: check IDs with arguments
targetedCommands: existing npm/node commands
e2eProjectsOrTags: existing Playwright selection mechanism
releaseEscalation: required profile or fail-closed rule
```

Initial evidence-backed areas are `frontend`, `devices`, `products`, `forum`,
`news`, `search`, `auth`, `media`, `admin`, `seo`, `cloudflare`,
`supabase-config`, `database`, and `security`. `compare` is reserved for a
future real route and must not be selected by guessed filenames.

Dependency examples are encoded as data: devices expands to products, SEO, and
search where their actual checks consume device data; forum expands to auth and
media when forum paths changed; auth expands to security. The resolver records
both direct and expanded areas in the receipt.

## 8. Risk model

Exactly three levels are used:

- **LOW:** copy, isolated styling, harmless analytics, and non-behavioral docs.
- **MEDIUM:** device/product rendering, search, news, ordinary forum behavior,
  and normal API behavior.
- **HIGH:** authentication, authorization, RLS/security logic, destructive
  flows, migrations/database paths, Cloudflare configuration, Supabase provider
  configuration, and deployment architecture.

Risk ordering is `LOW < MEDIUM < HIGH`. The resolver takes the maximum risk of
all changed paths and explicit areas after dependency expansion. The selected
profile must meet the risk floor. A fast/feature request with HIGH risk returns a
stable blocked receipt naming `qa:release` as required; no flag can bypass this.

## 9. Changed-area algorithm

1. Determine the comparison base: on a feature branch use
   `git merge-base HEAD origin/main` after a read-only fetch; on `main`, use the
   previous remote baseline recorded by the caller or the parent commit only
   when no divergence exists.
2. Collect staged, unstaged, and untracked paths using `git diff`,
   `git diff --cached`, and `git ls-files --others --exclude-standard`.
3. Normalize separators and classify every path against ordered manifest
   matchers; unmatched source/config paths map to `frontend` or `security`
   according to the matcher table, never to an empty area.
4. Include explicit `--area` only as a feature selection hint. Reclassify all
   changed paths independently, then expand related-area edges to a fixed point.
5. Deduplicate and sort paths, areas, checks, and reasons lexicographically so
   equivalent inputs produce equivalent receipts.
6. If the base cannot be proven, fail closed with `BASE_UNRESOLVED`; do not
   silently use `HEAD~1`.

## 10. Check interface

Every check is a reusable unit with one responsibility and this contract:

```text
run(context) -> {
  id, status: PASS | FAIL | SKIP,
  classification, durationMs,
  summary, details: value-blind object,
  retryable: boolean,
  failureArtifactHints: string[]
}
```

`context` contains profile, area, commit/base SHA, local environment metadata,
and (for production only) the validated base URL. Checks receive no unrestricted
environment dump and never receive secret values. Examples are `checkPage`,
`checkApi`, `checkProtectedRoute`, `checkCanonical`, `checkSitemap`,
`checkMedia`, `checkBuild`, and `checkNoSystemic5xx`.

## 11. Process execution model

The executor uses `spawn`/`spawnSync` with an argv array, explicit cwd, timeout,
and bounded stdout/stderr buffers. Shell interpolation is prohibited. Exit code,
signal, timeout, and first fatal line are normalized into the result. Commands
are run in manifest order; independent checks may run concurrently only when the
manifest declares no shared server, port, DB, or artifact state. A failed check
does not trigger unrelated commands, but cleanup/final receipt writing always
runs.

## 12. E2E strategy

The repository's direct Playwright usage and local P6B lifecycle are retained.
V1 uses the project's primary Chromium-compatible browser for feature/release
coverage; it does not add Firefox/WebKit runs. Existing real browser cases remain
in their proven runner. If tags/projects are later introduced, use stable tags
such as `@devices`, `@forum`, `@auth`, `@media`, and `@security`, but do not
rewrite tests solely to add tags.

Feature E2E starts only the local runtime required by the selected area and uses
the existing lifecycle cleanup. Production E2E is HTTP smoke only; it never
uses the destructive QA orchestrator or production canary.

## 13. Production safety model

`qa:prod` fails closed unless all conditions hold:

- base URL is HTTPS and its hostname exactly matches an allowlisted production
  origin; the current entry is `openglasshub.ogh.workers.dev` and future custom
  domains are added as manifest configuration, not hard-coded into checks;
- method is GET or HEAD and route is in the production smoke allowlist;
- no request body, upload, authorization mutation, SQL, provider CLI, or secret
  read is available to the profile;
- redirect destinations are revalidated against the allowlist;
- protected endpoints must return their expected 401/403 negative result;
- repeated 5xx, Worker exception markers, missing critical assets, broken media,
  malformed canonical origin, or public success on a protected route fail the run.

The receipt records `productionDbConnections=0`, `productionMutations=0`, and
`providerMutations=0`. Any unknown route or non-read-only method produces
`PRODUCTION_ROUTE_REJECTED` before network I/O.

## 14. Retry model

Local deterministic checks have zero retries. Network/production checks may make
one retry. The receipt always records the first attempt. If attempt one fails and
attempt two passes, the result includes `FIRST_ATTEMPT=FAIL`,
`RETRY_ATTEMPT=PASS`, and `CLASSIFICATION=TRANSIENT_RECOVERED`. There is no
infinite retry and no retry for safety or validation failures.

## 15. Artifact model

Receipts are runtime artifacts, never committed. The implementation should use
`artifacts/qa/<run-id>/` with a future `.gitignore` entry (or an existing ignored
equivalent confirmed at implementation time). Success retains only the compact
receipt and summary. Failure may retain bounded command stderr, first fatal,
request URL/status, response metadata, console errors, screenshots, and a
Playwright trace when the failed check supports them. Artifact paths are
relative, run-scoped, and created with restrictive permissions where supported.

## 16. Receipt schema

The v1 JSON schema is frozen as follows; unknown fields may be added only under
`extensions`, never by changing the meaning of required fields:

```json
{
  "schemaVersion": "openglass-qa/v1",
  "runId": "qa-<uuid>",
  "qaProfile": "FAST|FEATURE|RELEASE|PRODUCTION_SMOKE",
  "areas": ["devices"],
  "expandedAreas": ["devices", "products", "search", "seo"],
  "risk": "LOW|MEDIUM|HIGH",
  "commitSha": "<40 hex>",
  "baseSha": "<40 hex>|null",
  "changedPathsCount": 0,
  "selectedChecks": [{"id": "build", "kind": "command"}],
  "skippedChecks": [{"id": "full-e2e", "reason": "profile_budget"}],
  "startedAt": "<ISO-8601>",
  "completedAt": "<ISO-8601>",
  "durationMs": 0,
  "passCount": 0,
  "failCount": 0,
  "retryCount": 0,
  "result": "PASS|FAIL|BLOCKED",
  "safety": {
    "productionReadOnly": true,
    "productionDbConnections": 0,
    "productionMutations": 0,
    "providerMutations": 0
  },
  "artifacts": {"receipt": "artifacts/qa/<run-id>/receipt.json", "failureDir": null},
  "error": null,
  "extensions": {}
}
```

The human summary prints only profile, areas, risk, selected/skipped counts,
pass/fail/retry counts, safety counters, and final result. It never prints
environment values, tokens, DSNs, secret names with values, or unrestricted
child-process output.

## 17. Security and redaction

The runner passes only an allowlisted environment subset to child processes.
Redaction covers keys and values matching token, JWT, password, anon key,
service-role, API key, R2 secret, Turnstile secret, DSN, and authorization
patterns. Secret checks are presence-only. `SUPABASE_SERVICE_ROLE_KEY`,
`OPENAI_API_KEY`, `R2_SECRET_ACCESS_KEY`, `TURNSTILE_SECRET_KEY`, and all other
private values are never printed or written to receipts. A redaction self-test
must fail if a sentinel secret reaches stdout, stderr, or an artifact.

## 18. Self-test matrix

The harness self-test command is internal and offline. It must prove:

| Scenario | Expected result |
| --- | --- |
| CSS-only path | LOW; fast checks only |
| Device detail path | MEDIUM; devices plus declared dependencies |
| Compare path when manifest-backed | MEDIUM; compare plus real related areas |
| Supabase migration path | HIGH; release required |
| Explicit low area with high-risk path | Cannot downgrade; BLOCKED/RELEASE_REQUIRED |
| Dependency expansion | Stable, deduplicated, sorted closure |
| Unrelated area | Not selected |
| Retry sequence | First failure retained; one retry counted |
| Receipt generation | Stable schema and deterministic ordering |
| Destructive production route | Rejected before network I/O |
| Invalid/non-HTTPS production host | Rejected before network I/O |
| Secret sentinel | Redacted from all output/artifacts |
| Failed check | Failure artifact collected once |
| Successful run | No heavy failure artifact and compact log |

## 19. Migration and adoption strategy

Implementation proceeds in small, reviewable stages without changing existing
checks: first freeze manifest/risk/receipt self-tests, then add command execution
adapters, then wire `qa:fast`, feature resolution, release composition, and
finally the production safety adapter. Existing scripts remain callable directly
until parity receipts show the harness invokes the same gates. CI integration is
deferred; when added, CI calls these same four commands and does not duplicate
selection logic. Each stage must retain the existing security and cleanup tests.

## 20. Acceptance criteria

An implementation is accepted only when it produces fresh receipts proving:

```text
QA_FAST=PASS
QA_FEATURE=PASS
QA_RELEASE=PASS
QA_PROD=PASS
RISK_CLASSIFICATION=PASS
CHANGED_AREA_SELECTION=PASS
DEPENDENCY_EXPANSION=PASS
UNRELATED_TEST_AVOIDANCE=PASS
FAILURE_ARTIFACT_CAPTURE=PASS
SUCCESS_LOG_COMPACT=PASS
QA_RECEIPT=PASS
PRODUCTION_SMOKE_READ_ONLY=true
PRODUCTION_MUTATIONS=0
PRODUCTION_DB_CONNECTIONS=0
EXISTING_TESTS_PRESERVED=true
EXISTING_SECURITY_GATES_PRESERVED=true
```

It must also demonstrate that high-risk paths cannot run only under fast/feature,
the production host and endpoint allowlist fail closed, and no secret value is
present in terminal output or artifacts.

## 21. Explicit v1 exclusions

The following are deliberately outside this design: AI or ML test selection,
self-healing selectors, flaky-history storage, cross-browser runs for every
feature, production write journeys, automatic production accounts/content,
ordinary-feature database replay, provider mutation from `qa:prod`, automatic
dependency upgrades, automatic code fixes, and a large GitHub Actions system.

This document freezes the architecture and contracts only. It does not add the
four commands, runner files, manifest, receipt writer, or any provider behavior.
