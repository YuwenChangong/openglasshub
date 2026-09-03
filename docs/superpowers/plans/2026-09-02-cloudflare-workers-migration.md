# Cloudflare Workers Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Migrate the current Astro 7 SSR application from Cloudflare Pages to a fully validated Workers-native deployment contract with a safe dual-URL transition, without database migration or legacy Pages destruction.

**Architecture:** Retire only the Pages-specific post-build mutation, preserve Astro's generated Worker deploy metadata, and make the root Wrangler configuration Workers-native. Add value-blind repository/provider inventory and deterministic local artifact/release tests; hold every Cloudflare or Supabase write in one final mutation packet.

**Tech Stack:** Astro 7.2.10, `@astrojs/cloudflare` 14.2.6, Wrangler 4, Node test scripts, Cloudflare Workers Builds, Supabase Auth.

**Spec:** `docs/superpowers/specs/2026-09-02-cloudflare-workers-migration-design.md`

## Global Constraints

- Base ancestor is `e2f45dac135edfc10d866fc83df05c0590c1adb9`; never rebase automatically.
- No remote-main write, deployment, Worker/Workers Builds/config/binding/secret write, Pages change, DNS change, Supabase Auth write, Production DB connection, SQL, migration, P10, or P11 action.
- Keep the existing Pages project and Pages URL available; do not make a new URL canonical in repository runtime behavior.
- Never print, commit, or place a credential value in evidence; all inventories are value-blind.
- Preserve `cloudflare:workers`, Astro SSR/API output, R2 `MODERATION_ASSETS`, and KV `SESSION` contracts.
- Stage explicit paths only; never use `git add .`; no main push.

---

### Task 1: Read-only provider and repository migration inventory

**Files:**
- Create: `scripts/qa/cloudflare-workers-migration-inventory.mjs`
- Create: `scripts/qa/test-cloudflare-workers-migration-inventory.mjs`
- Create: `docs/release/cloudflare-workers-migration-readonly-inventory.md`
- Modify: `package.json`

**Interfaces:**
- Produces `collectRepositoryInventory(root)` returning only config key names, binding names/types, Pages URL occurrence classifications, and route counts.
- Produces a sanitized provider receipt schema with no token or config values.
- Adds `test:workers-migration-inventory`.

- [ ] Write a failing test whose fixture includes `pages_build_output_dir`, a Worker `main`, R2/KV bindings, and Pages URL occurrences. Assert the collector preserves names/types, classifies runtime URLs separately from historical docs, and rejects a serialized secret-like value.
- [ ] Run `node scripts/qa/test-cloudflare-workers-migration-inventory.mjs`; expect failure because the collector does not exist.
- [ ] Implement the smallest collector using source text and parsed generated JSON only. It must never emit TOML values or environment values and must classify unknown URL locations as `UNKNOWN_REQUIRES_REVIEW`.
- [ ] Run the focused test and then `npm run test:workers-migration-inventory`; expect PASS.
- [ ] Use authenticated Cloudflare read-only GET calls only to capture account subdomain, existing script names, and Pages project/build metadata into the release document. Do not retrieve secret values.
- [ ] Commit explicit Task 1 paths.

### Task 2: Workers-native source configuration and canonical build

**Files:**
- Modify: `wrangler.toml`
- Modify: `package.json`
- Delete: `scripts/finalize-pages-wrangler-config.mjs`
- Delete: `scripts/test-cloudflare-pages-wrangler-config.mjs`
- Create: `scripts/qa/test-workers-native-config.mjs`

**Interfaces:**
- `npm run build` is exactly `astro build`.
- Root config is Workers-native: it has no `pages_build_output_dir`, retains declared binding names, and delegates generated `main`/assets/rules to Astro output.
- Adds `test:workers-config`.

- [ ] Write a failing config test that reads root config key names and a representative generated config. It must require no Pages field, retain `MODERATION_ASSETS` and `SESSION`, and require generated `main`, asset metadata, and module rules.
- [ ] Run `node scripts/qa/test-workers-native-config.mjs`; expect failure because the Pages field/finalizer still exists.
- [ ] Remove only the Pages finalizer path and configure the root file for Workers, preserving compatibility and all existing binding/env declarations by name without exposing values.
- [ ] Run `npm run build`, the focused test, and `npx wrangler check`; expect Worker validation to pass with redirected generated configuration.
- [ ] Commit explicit Task 2 paths.

### Task 3: Provider-shaped Worker artifact and SSR/API regression

**Files:**
- Create: `scripts/qa/test-workers-generated-artifact.mjs`
- Modify: `package.json`

**Interfaces:**
- Adds `test:workers-artifact`.
- The validator resolves `.wrangler/deploy/config.json`, verifies the selected config is Worker-shaped, verifies `main` and assets resolve within `dist`, and reports route-source counts without server code or secret values.

- [ ] Write a failing test that expects the validator module and a missing-entrypoint failure case.
- [ ] Run the focused test; expect the missing module failure.
- [ ] Implement the validator and include representative source coverage checks for `src/pages/api`, `prerender=false` pages, devices, products, news, profiles, notifications, forum, admin, and Gaze Launcher.
- [ ] Run `npm run build`, `npm run test:workers-artifact`, `npm run test:astro-check-ratchet`, and `node scripts/test-astro7-cloudflare-runtime.mjs`; expect PASS.
- [ ] Commit explicit Task 3 paths.

### Task 4: Transitional site-origin and SEO/release checks

**Files:**
- Create: `src/lib/site-origin.ts`
- Create: `scripts/qa/test-site-origin-transition.mjs`
- Modify: `astro.config.mjs`
- Modify: `public/robots.txt`
- Modify: `scripts/smoke-production.mjs`
- Modify: `scripts/post-launch-check.mjs`
- Modify: `scripts/final-audit.cjs`
- Modify: `package.json`

**Interfaces:**
- `resolveSiteOrigin(value)` accepts only absolute HTTPS origins, removes a trailing slash, and falls back only to the legacy Pages origin.
- Adds `test:site-origin-transition`; test commands accept an explicit URL but preserve Pages as the pre-cutover default.

- [ ] Write a failing test for valid Workers/Pages origins, invalid origin rejection, and no dual canonical output.
- [ ] Run the focused test; expect failure because the helper does not exist.
- [ ] Implement the helper and update runtime/SEO consumers to use one origin source. Keep legacy Pages as default until W6; do not insert an unproven Worker URL as canonical.
- [ ] Run the focused test, `node scripts/verify-seo.cjs`, `npm run test:search-audit`, and `npm run build`; expect PASS.
- [ ] Commit explicit Task 4 paths.

### Task 5: Auth, media, and binding transition safeguards

**Files:**
- Create: `scripts/qa/test-workers-transition-contracts.mjs`
- Modify: `src/lib/auth-redirect.ts`
- Modify: `scripts/test-auth-redirect-safety.mjs`
- Modify: `scripts/test-r5l-pages-multimodule-harness.mjs`
- Modify: `package.json`

**Interfaces:**
- Adds `test:workers-transition-contracts` proving Auth continuations remain relative/safe, no source path uses `Astro.locals.runtime`, and generated config retains R2/KV binding names.

- [ ] Write a failing contract test for a second approved origin preparation mode, `cloudflare:workers` use, R2/KV name preservation, and a rejected open redirect.
- [ ] Run the focused test; expect failure because the transition contract module/check does not exist.
- [ ] Implement the minimum test-only/config validation changes. Do not add `process.env` production fallbacks, change Supabase settings, or create a second runtime path.
- [ ] Run focused tests, `npm run test:auth-redirect-safety`, media/news authorization tests, and the R5L multimodule harness; expect PASS.
- [ ] Commit explicit Task 5 paths.

### Task 6: Workers Builds source identity guard and external mutation packet

**Files:**
- Create: `scripts/qa/workers-builds-release-guard.mjs`
- Create: `scripts/qa/test-workers-builds-release-guard.mjs`
- Create: `docs/release/cloudflare-workers-provider-mutation-packet.md`
- Modify: `package.json`

**Interfaces:**
- `buildWorkersReleaseGuard({ remoteMainSha, candidateSha, providerSourceSha, activeSourceSha })` fails closed on missing/non-full/mismatched SHA values and never contacts a provider.
- Adds `test:workers-release-guard`.

- [ ] Write a failing test for short SHA, mismatched provider source SHA, and a fully matching SHA receipt.
- [ ] Run the focused test; expect failure because the guard does not exist.
- [ ] Implement the pure guard and the value-blind W2-W8 mutation packet: Worker setup, additive Auth redirects, first deploy, acceptance, primary cutover, and retained Pages fallback. Include required name/identity fields but no values/secrets.
- [ ] Run focused tests and verify packet content has no placeholder markers or secret values.
- [ ] Commit explicit Task 6 paths.

### Task 7: Complete local migration acceptance and candidate closeout

**Files:**
- Modify: `docs/release/cloudflare-workers-migration-readonly-inventory.md` only if refreshed local evidence changes its value-blind status.
- Modify: `docs/release/cloudflare-workers-provider-mutation-packet.md` only if the final candidate SHA requires replacement.

**Interfaces:**
- Produces a local candidate receipt with the exact candidate SHA, baseline-ancestor proof, and zero external-write counters.

- [ ] Run `npm ci`, `npm audit --omit=dev`, `npm test`, canonical Workers build, all Workers migration focused tests, Astro runtime gate, media/news/auth/device/product/search/SEO/security/P10/P11/release gates, and `git diff --check`.
- [ ] Record only command/status/commit/binding-name evidence; do not add a post-candidate documentation commit merely to restate results.
- [ ] Run a whole-branch review, fix its findings through the SDD review loop, rerun affected gates, and create one final local candidate commit if changes remain.

## Self-review

- Spec coverage: Tasks 1-7 cover provider inventory, native config/build, artifact/SSR/API validation, URL/Auth/SEO transition preparation, R2/KV preservation, release identity, complete gates, and the external packet. Provider writes remain excluded.
- Exact paths: each task names concrete repository paths; Task 7 modifies only existing evidence documents when needed.
- Interfaces: Tasks 1/2 supply config and inventory inputs; Task 3 consumes generated config; Tasks 4/5 consume the origin and binding contracts; Task 6 consumes final source identity; Task 7 consumes all focused gates.
- Placeholder scan: this plan intentionally contains no unresolved implementation markers.
- External writes: no task contains a Cloudflare, Supabase, Git main, deployment, or database mutation.

## Task 3 Astro ratchet forensic report

- Classification: `STALE_VERSION_RATCHET`.
- Origin: `1493090da96b38c9515051aa46004ada8dd23166` introduced an immutable Astro-check debt baseline for Astro `5.18.2`. P8 commit `e9ab7b72bfcfe3a2e6d04f1b9abf2c2e865b911d` independently approved and pinned Astro `7.2.10`. Merge `4e61134e7ba1f3b1308e46b21caaa76e1b313594` combined the Astro 5 ratchet parent with the Astro 7 runtime parent without reconciling the ratchet.
- Contract: the gate enforces exact package versions for Astro, `@astrojs/check`, and TypeScript, then prevents new diagnostics, diagnostics in changed paths, increased error/path totals, or changes to files containing baseline debt. It is an exact reviewed-toolchain contract, not a semantic minimum-version check.
- RED evidence: the local gate rejected approved Astro `7.2.10` against stale `5.18.2`; the focused regression failed with the same mismatch before implementation.
- Fix: advance the frozen toolchain and diagnostic manifest to migration ancestor `e2f45dac135edfc10d866fc83df05c0590c1adb9`, whose Astro 7 check has 177 errors across 90 paths, and resolve Astro's executable from its package-declared bin instead of the removed Astro 5 `astro.js` path. Current Task 1-3 diagnostics are identity-equal to that approved base: 0 added and 0 removed.
- Safety: focused unit coverage accepts `7.2.10` and rejects downgrade `7.2.9`, missing Astro version state, and malformed Astro version state. Manifest integrity, changed-path, baseline-blob, error-count, and affected-path guards remain enabled.
- Verification: `npm run test:astro-check-ratchet-unit`, `npm run test:astro-check-ratchet`, `node scripts/test-astro7-cloudflare-runtime.mjs`, `npm run build`, `npm run test:workers-artifact`, and `npm test` all exited 0. Cloudflare writes: 0. Supabase writes: 0. Remote-main writes: 0. Production database connections: 0.
