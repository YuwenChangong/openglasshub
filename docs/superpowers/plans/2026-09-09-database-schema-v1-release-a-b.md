# Database Schema v1 Release A+B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build the additive Schema v1 foundation and safely restore the approved 24-device catalog and normalized specification dataset.

**Architecture:** Release A adds only schema objects, additive columns, database enforcement, and catalog authority; it does not cut readers over. Release B validates the approved YAML, produces one deterministic normalized model, derives compatibility JSONB only from it, and proves recovery only against an owned disposable Supabase instance before a separate Production authorization.

**Tech Stack:** Astro SSR, TypeScript, Node, Supabase PostgreSQL, Supabase Auth/RLS, Zod or repository-consistent validation, YAML parser, QA Harness.

**Spec:** docs/superpowers/specs/2026-09-09-database-schema-v1-design.md

## Global Constraints

- Only Release A and Release B are in scope. Release C admin UI/API, Release D detail reader, Release E compare reader, analytics, Search Console, and legacy JSONB removal are excluded.
- YAML is the sole specification-value authority. src/lib/device-catalog.ts contributes identity/presentation only; its keySpecs/fullSpecs never feed Schema v1 compatibility.
- Repository input is src/data/devices/openglasshub_device_data_v1.yaml, a byte-preserved copy of the approved 24-device YAML. Its SHA-256 is recorded in value-blind evidence.
- Use only additive schema changes. Do not edit historical migrations, delete/truncate, run P10/P11, deploy, push, or execute qa:prod.
- Local schema work must use scripts/qa/local-disposable-supabase-replay.mjs. Every Production schema/data action needs a distinct explicit authorization after its own gate passes.
- Preserve public published devices reads, public.is_moderator_or_admin(), forum policy, current legacy routes, and legacy JSONB columns. New normalized base tables have no anon direct SELECT.
- Every task: RED command, minimal implementation, GREEN command, relevant regression, git diff --check, exact git add paths, and a commit. Never use git add ..

## File Structure

| Path | Purpose |
| --- | --- |
| supabase/migrations/20260909120000_device_schema_v1_foundation.sql | Release A migration. Generate using npx supabase migration new device_schema_v1_foundation; only continue when the generated reviewed path matches this plan. |
| scripts/test-device-schema-v1-contract.mjs | Static migration, enum, RLS, grant, trigger, and SQL error contract. |
| scripts/test-device-schema-v1-enforcement.mjs | Disposable-local SQL enforcement cases. |
| scripts/devices/schema-v1/types.mjs | Frozen JSDoc types, enum literals, and blocker identifiers. |
| src/data/devices/openglasshub_device_data_v1.yaml | Approved YAML input. |
| scripts/devices/schema-v1/yaml-input.mjs | loadApprovedDeviceYaml(path). |
| scripts/devices/schema-v1/normalize.mjs | normalizeCatalogYaml(input, options). |
| scripts/devices/schema-v1/definitions.mjs | buildDefinitionRegistry(normalized). |
| scripts/devices/schema-v1/source-metadata.json and sources.mjs | Reviewed URL metadata and validation. |
| scripts/devices/schema-v1/conflict-map.json and conflicts.mjs | Curated conflict mapping and classification. |
| scripts/devices/schema-v1/identity-map.json and identity.mjs | Exact identity mapping and Ray-Ban gate. |
| scripts/devices/schema-v1/model.mjs | buildNormalizedModel(input). |
| scripts/devices/schema-v1/compatibility.mjs | buildLegacyCompatibility(device). |
| scripts/devices/schema-v1/dry-run.mjs | buildRecoveryPlan(input), fingerprintRecoveryPlan(plan). |
| scripts/devices/import-device-schema-v1.mjs | Local-only CLI: --dry-run and --apply-local. |
| scripts/qa/test-device-schema-v1-local-recovery.mjs | Owned disposable-local transaction acceptance. |
| scripts/qa/device-schema-v1-receipt.mjs | Value-blind recovery receipt writer. |
| tests/fixtures/device-schema-v1/ | Minimal test inputs and expected safe result fixtures. |
| docs/ops/device-schema-v1-release-a-production-gate.md | Release A authorization gate. |
| docs/ops/device-schema-v1-release-b-production-gate.md | Release B authorization gate. |

Shared interface names are fixed: ApprovedCatalog, NormalizedCatalog, NormalizedDevice, NormalizedSpec, SourceMetadata, ConflictMapping, IdentityMapping, RecoveryPlan, and RecoveryReceipt. A blocker is always { code, deviceKey, path, detail }; callers do not parse prose.

### Task 1: Schema contract RED tests

**Files:** Create scripts/test-device-schema-v1-contract.mjs and tests/fixtures/device-schema-v1/schema-contract-cases.json.

**Consumes:** approved spec and existing 20260829_device_library_admin.sql. **Produces:** assertSchemaV1Contract({ migrationText }).

- [ ] Add failing assertions for every enum, MEDIUM_HIGH, additive devices fields, six tables, contexts/tracking keys, conflict evidence, catalog authority, no anonymous normalized reads, and append-only audit.
  ~~~js
  assert.match(migrationText, /device_spec_confidence.*MEDIUM_HIGH/s);
  assert.match(migrationText, /not \(is_primary and is_conflicting\)/);
  ~~~
- [ ] Run: node scripts/test-device-schema-v1-contract.mjs. Expected RED: migration file missing.
- [ ] Add only the test and fixture; do not create the migration.
- [ ] Run: node scripts/test-device-schema-v1-contract.mjs; node scripts/test-device-persistence.mjs; git diff --check. Preserve RED for the absent migration.
- [ ] Commit: git add scripts/test-device-schema-v1-contract.mjs tests/fixtures/device-schema-v1/schema-contract-cases.json; git commit -m "test(devices): define Schema v1 database contract".

### Task 2: Additive Release A foundation

**Files:** Create supabase/migrations/20260909120000_device_schema_v1_foundation.sql; modify scripts/test-device-schema-v1-contract.mjs.

**Consumes:** Task 1. **Produces:** types, additive columns, definitions/specs/sources/source-links/evidence/audit tables, restrictive foreign keys, generated region/variant keys, and indexes.

- [ ] Add RED test: assert.match(migrationText, /create table.*public\.device_specs/s). Run the Task 1 command.
- [ ] Generate the migration with npx supabase migration new device_schema_v1_foundation; implement only enums, additive devices fields, tables, keys, and indexes. Do not insert a device row or drop a legacy field.
- [ ] Run: node scripts/test-device-schema-v1-contract.mjs; node scripts/qa/validate-supabase-migration-versions.mjs; git diff --check. Expected GREEN.
- [ ] Commit exactly migration and contract test: git commit -m "feat(devices): add Schema v1 foundation".

### Task 3: Database enforcement and definition immutability

**Files:** Modify the Task 2 migration and contract test; create scripts/test-device-schema-v1-enforcement.mjs.

**Consumes:** Task 2 tables. **Produces:** enforce_device_spec_definition(), validate_device_spec_conflict_evidence(), prevent_device_spec_definition_semantic_change(), and named 23514 errors.

- [ ] Write RED local cases for typed exclusivity; KNOWN; NOT_DISCLOSED; NOT_APPLICABLE; UNKNOWN_UNVERIFIED; CONFLICT raw-primary shape; definition schema/type/unit/context mismatch; deferred evidence invariant; referenced definition delete/semantic change; audit update/delete.
  ~~~js
  await assert.rejects(insertPrimaryConflictingEvidence(), /DEVICE_SPEC_EVIDENCE_CONFLICT_INVARIANT/);
  ~~~
- [ ] Run: node scripts/test-device-schema-v1-enforcement.mjs. Expected RED: trigger/error name absent.
- [ ] Add row checks, BEFORE validation, immutable definition protection, and a DEFERRABLE trigger. CONFLICT requires exactly one is_primary=true/is_conflicting=false evidence row and at least one false/true row; non-CONFLICT rejects conflicting evidence until state transition.
- [ ] Run focused enforcement and contract tests, then git diff --check. Expected GREEN.
- [ ] Commit explicit changed paths: git commit -m "feat(devices): enforce normalized spec invariants".

### Task 4: RLS, grants, and immutable audit

**Files:** Modify Task 2 migration; create scripts/test-device-schema-v1-rls.mjs.

**Consumes:** existing profiles.role, requireAdmin, is_moderator_or_admin(). **Produces:** public.is_catalog_admin() and policies for catalog admins only.

- [ ] Write RED assertions: anon/no-user/moderator-only cannot mutate catalog; admin can; published devices remain publicly readable; anon cannot select normalized tables; audit permits only admin insert/select and rejects update/delete.
- [ ] Run: node scripts/test-device-schema-v1-rls.mjs. Expected RED: policy mismatch.
- [ ] Implement is_catalog_admin() from profiles.role='admin'. Replace only catalog CRUD policies on devices and all new catalog tables. Preserve forum moderation policies; revoke normalized base-table anon grants and enable RLS.
- [ ] Run focused RLS test, node scripts/test-device-persistence.mjs, node scripts/test-device-admin-api.mjs, git diff --check.
- [ ] Commit exact paths: git commit -m "feat(devices): restrict Schema v1 catalog authority".

### Task 5: Canonical definitions

**Files:** Create scripts/devices/schema-v1/types.mjs, definitions.mjs, scripts/test-device-schema-v1-definitions.mjs.

**Consumes:** enum values and future normalized input. **Produces:** buildDefinitionRegistry(normalized): DeviceSpecDefinition[].

- [ ] Write RED tests rejecting identity/evidence entries and requiring display.eye_brightness, display.panel_or_projector_brightness, tracking.native_3dof, tracking.native_6dof, tracking.accessory_3dof, tracking.accessory_6dof; reject generic brightness.
- [ ] Run: node scripts/test-device-schema-v1-definitions.mjs. Expected RED: module missing.
- [ ] Implement deterministic ownership filtering, stable keys, stable sort, and immutable definitions input.
- [ ] Run definitions and contract tests; git diff --check. Expected GREEN.
- [ ] Commit: git add scripts/devices/schema-v1/types.mjs scripts/devices/schema-v1/definitions.mjs scripts/test-device-schema-v1-definitions.mjs; git commit -m "feat(devices): derive canonical spec definitions".

### Task 6: YAML validation and normalization

**Files:** Create src/data/devices/openglasshub_device_data_v1.yaml, yaml-input.mjs, normalize.mjs, scripts/test-device-schema-v1-normalize.mjs; modify package.json and package-lock.json only to make yaml a direct pinned dependency.

**Consumes:** approved YAML and Task 5 types. **Produces:** loadApprovedDeviceYaml(path): ApprovedCatalog and normalizeCatalogYaml(input, options): NormalizedCatalog.

- [ ] Write RED tests over all 24 devices for allowed keys/types and mappings High→HIGH, Medium-High→MEDIUM_HIGH, Medium→MEDIUM, Low→LOW, unknown→BLOCKED_CONFIDENCE_VALUE, explicit No→KNOWN false, Not disclosed→NOT_DISCLOSED, and Not applicable→NOT_APPLICABLE.
- [ ] Run: node scripts/test-device-schema-v1-normalize.mjs. Expected RED: input/module absent.
- [ ] Copy approved YAML byte-for-byte, parse it with direct yaml dependency, validate count 24/brands 8, and normalize without guessed values.
- [ ] Run normalization, public-device-data, and definition tests; git diff --check.
- [ ] Commit exact paths: git commit -m "feat(devices): validate approved Schema v1 YAML".

### Task 7: Source metadata sidecar

**Files:** Create scripts/devices/schema-v1/source-metadata.json, sources.mjs, scripts/test-device-schema-v1-sources.mjs.

**Consumes:** NormalizedCatalog. **Produces:** loadSourceMetadata(path): SourceMetadata[] and validateSourceMetadata({ sourceUrls, metadata }).

- [ ] Write RED test computing UNIQUE_SOURCE_URLS and requiring SOURCE_METADATA_MAP_COUNT equal it, UNMAPPED_SOURCE_URLS=0, AMBIGUOUS_SOURCE_URLS=0, required URL/publisher/source_type/accessed_at, nullable title/published_at, and no runtime domain/path inference.
- [ ] Run: node scripts/test-device-schema-v1-sources.mjs. Expected RED: missing map.
- [ ] Add reviewed records for every normalized URL; resolve only by normalized URL and never label reputable_secondary as Official.
- [ ] Run sources and normalization tests; git diff --check.
- [ ] Commit exact paths: git commit -m "feat(devices): add reviewed source provenance map".

### Task 8: Curated conflict classifications

**Files:** Create conflict-map.json, conflicts.mjs, scripts/test-device-schema-v1-conflicts.mjs.

**Consumes:** normalized input, source map, definitions. **Produces:** classifyConflicts({ normalized, mappings }): ConflictMapping[].

- [ ] Write RED examples: Rokid Glasses 480×400 vs 480×640 is TRUE_VALUE_CONFLICT; eye brightness vs projector brightness is NORMALIZATION_OR_CONTEXT_NOTE.
- [ ] Run: node scripts/test-device-schema-v1-conflicts.mjs. Expected RED: BLOCKED_EVIDENCE_MAP.
- [ ] Add exact canonical-key, primary-claim/source, conflicting-claim/source data only for true conflicts; reject unclassified prose.
- [ ] Run conflict, source, and enforcement tests; git diff --check.
- [ ] Commit exact paths: git commit -m "feat(devices): curate specification conflict mappings".

### Task 9: Identity mapping and Ray-Ban gate

**Files:** Create identity-map.json, identity.mjs, scripts/test-device-schema-v1-identity.mjs, docs/release/device-schema-v1-ray-ban-identity-resolution.md.

**Consumes:** YAML and buildDeviceRows() from scripts/migrate-static-device-catalog-to-supabase.mjs. **Produces:** resolveIdentityMappings({ yamlDevices, bootstrapRows, mappings }): IdentityMapping[].

- [ ] Write RED cases for zero/multiple matches, generation mismatch, duplicate slug, and Ray-Ban unresolved.
- [ ] Run: node scripts/test-device-schema-v1-identity.mjs. Expected RED: RAY_BAN_IDENTITY_INDETERMINATE.
- [ ] Perform a read-only repository/history/source investigation. Record only PROVEN_GEN_2, PROVEN_GEN_1, or INDETERMINATE. Do not create a Ray-Ban map unless evidence proves it.
- [ ] Run focused test. It must prove 23 exact mappings and preserve Release B BLOCKED if Ray-Ban is indeterminate; run git diff --check.
- [ ] Commit exact paths: git commit -m "feat(devices): gate Schema v1 identity resolution".

### Task 10: Normalized model builder

**Files:** Create scripts/devices/schema-v1/model.mjs and scripts/test-device-schema-v1-model.mjs.

**Consumes:** Tasks 5–9. **Produces:** buildNormalizedModel(input): { definitions, devices, specs, sources, sourceLinks, evidence, blockers }.

- [ ] Write RED tests preserving raw value, typed value, unit, context, region, variant, confidence, verified_at, and keeping “2D up to 120; 3D up to 90” raw/structured rather than inventing a compare number.
- [ ] Run: node scripts/test-device-schema-v1-model.mjs. Expected RED: builder missing.
- [ ] Implement pure deterministic records and blocker propagation; do not make a database call.
- [ ] Run model plus Tasks 6–9 tests; git diff --check.
- [ ] Commit exact paths: git commit -m "feat(devices): build normalized import model".

### Task 11: YAML-derived compatibility adapter

**Files:** Create compatibility.mjs and scripts/test-device-schema-v1-compatibility.mjs.

**Consumes:** NormalizedDevice. **Produces:** buildLegacyCompatibility(device): { key_specs, full_specs, compatibilityGaps }.

- [ ] Write RED representative tests that compare adapter values to normalized YAML and statically prove src/lib/device-catalog.ts keySpecs/fullSpecs are not read.
- [ ] Run: node scripts/test-device-schema-v1-compatibility.mjs. Expected RED: adapter missing.
- [ ] Implement deterministic compatibility fields and explicit safe gaps. Invariants are BOOTSTRAP_SPEC_VALUES_AUTHORITATIVE=false and LEGACY_COMPAT_SPEC_SOURCE=YAML_DERIVED.
- [ ] Run adapter and node scripts/test-device-persistence.mjs; git diff --check.
- [ ] Commit exact paths: git commit -m "feat(devices): derive legacy specs from YAML".

### Task 12: No-delete deterministic DryRun

**Files:** Create dry-run.mjs and scripts/test-device-schema-v1-dry-run.mjs.

**Consumes:** normalized model, compatibility output, existing rows. **Produces:** buildRecoveryPlan({ model, existing }): RecoveryPlan and fingerprintRecoveryPlan(plan): string.

- [ ] Write RED cases for stable sorted SHA-256, INSERT/UPDATE/UNCHANGED/CONFLICT/BLOCKED, DELETE=NONE, and admin/provenance drift becoming CONFLICT rather than overwrite.
- [ ] Run: node scripts/test-device-schema-v1-dry-run.mjs. Expected RED: planner missing.
- [ ] Implement pure diff/fingerprint logic with no credential or write path.
- [ ] Run Task 6–11 tests and git diff --check.
- [ ] Commit exact paths: git commit -m "feat(devices): add deterministic recovery dry run".

### Task 13: Local transactional importer

**Files:** Create scripts/devices/import-device-schema-v1.mjs and scripts/qa/test-device-schema-v1-local-recovery.mjs.

**Consumes:** Tasks 5–12 and assertLocalTarget/owned cleanup from scripts/qa/local-disposable-supabase-replay.mjs. **Produces:** runLocalSchemaV1Import({ target, plan }): RecoveryReceipt.

- [ ] Write RED fake-client cases proving a non-local target rejects before client creation and a transaction error rolls back definitions/devices/sources/links/specs/evidence.
- [ ] Run: node scripts/qa/test-device-schema-v1-local-recovery.mjs. Expected RED: importer missing.
- [ ] Implement local-only --dry-run and --apply-local, one transaction, no delete/truncate, and blocker refusal before write.
- [ ] Run local-recovery test and node scripts/qa/local-disposable-supabase-replay.mjs --dry-run; git diff --check.
- [ ] Commit exact paths: git commit -m "feat(devices): import Schema v1 catalog locally".

### Task 14: Local 24-device and legacy-reader acceptance

**Files:** Modify scripts/qa/test-device-schema-v1-local-recovery.mjs, scripts/test-public-device-data.mjs, scripts/test-product-page.mjs; create tests/fixtures/device-schema-v1/local-recovery-expected.json.

**Consumes:** local importer receipt. **Produces:** assertLocalRecoveryReceipt(receipt).

- [ ] Add RED assertions for 24 devices/unique slugs, exact derived published/spec counts, sources/evidence, no duplicate contexts, no-overwrite rerun, /products/, brand counts, and representative legacy routes.
- [ ] Run local recovery test. Expected RED: acceptance values absent.
- [ ] Wire disposable-only acceptance and existing readers; do not implement public normalized RPC/Release D.
- [ ] Run focused acceptance, node scripts/test-device-library.mjs, node scripts/test-products.mjs, git diff --check.
- [ ] Commit exact paths: git commit -m "test(devices): prove local Schema v1 recovery".

### Task 15: Local gates and recovery evidence

**Files:** Create scripts/qa/device-schema-v1-receipt.mjs and scripts/test-device-schema-v1-receipt.mjs; modify .gitignore only if artifacts/device-schema-v1/ is not already ignored.

**Consumes:** migration/model/plan/local receipt. **Produces:** writeSchemaV1Receipt(input): { path, sha256 }.

- [ ] Write RED tests for stable fingerprints, required exact counts, secret/DSN rejection, and a Production-write receipt rejection without later authorization evidence.
- [ ] Run: node scripts/test-device-schema-v1-receipt.mjs. Expected RED: writer missing.
- [ ] Implement canonical value-blind JSON receipt under ignored artifacts/device-schema-v1/.
- [ ] Run every focused Schema v1 test, npm test, npm run build, npm run qa:release, git diff --check. Record the accepted dependency baseline: 5 HIGH, runtime reachable 0, upstream-blocked; do not remediate it.
- [ ] Commit exact paths: git commit -m "test(devices): record Schema v1 recovery evidence".

### Task 16: Release A Production authorization gate

**Files:** Create docs/ops/device-schema-v1-release-a-production-gate.md and scripts/qa/test-device-schema-v1-release-a-gate.mjs.

**Consumes:** local evidence and migration SHA-256. **Produces:** assertReleaseAProductionGate(input): { allowed: false, missing: string[] } until explicit authorization.

- [ ] Write RED cases for absent local migration tests, clean candidate, migration fingerprint, exact Production schema precheck, or authorization.
- [ ] Run: node scripts/qa/test-device-schema-v1-release-a-gate.mjs. Expected RED: RELEASE_A_PRODUCTION_AUTHORIZATION_REQUIRED.
- [ ] Implement only evidence evaluation/documentation. It must not connect to Supabase, spawn psql, or apply a migration.
- [ ] Run focused gate/receipt tests and git diff --check.
- [ ] Commit exact paths: git commit -m "docs(devices): gate Release A production apply".

### Task 17: Release B Production authorization gate

**Files:** Create docs/ops/device-schema-v1-release-b-production-gate.md and scripts/qa/test-device-schema-v1-release-b-gate.mjs.

**Consumes:** Release A receipt, RecoveryPlan, local receipt, and Ray-Ban evidence. **Produces:** assertReleaseBProductionGate(input): { allowed: false, missing: string[] }.

- [ ] Write RED cases for unknown/nonzero device count, unresolved Ray-Ban, incomplete source/conflict mapping, non-24 YAML, unlocked payload fingerprint, or missing separate authorization.
- [ ] Run: node scripts/qa/test-device-schema-v1-release-b-gate.mjs. Expected RED: RELEASE_B_PRODUCTION_AUTHORIZATION_REQUIRED.
- [ ] Implement fail-closed evidence checks for Release A verified, map counts 24, UNRESOLVED_IDENTITIES=0, complete sources/conflicts, locked normalized fingerprint, local pass, compatibility pass, and qa:release pass.
- [ ] Run gate/receipt tests and git diff --check.
- [ ] Commit exact paths: git commit -m "docs(devices): gate Release B production recovery".

### Task 18: Authorization-gated Production transaction contract

**Files:** Create docs/ops/device-schema-v1-release-b-transaction-runbook.md and scripts/qa/test-device-schema-v1-transaction-contract.mjs.

**Consumes:** future successful Task 17 gate only. **Produces:** a one-transaction, value-blind procedure contract; it executes nothing.

- [ ] Write RED assertions rejecting delete, truncate, no authorization, and an automatic second attempt.
- [ ] Run: node scripts/qa/test-device-schema-v1-transaction-contract.mjs. Expected RED: runbook absent.
- [ ] Specify precheck locked fingerprints; begin; apply plan; validate plan-derived counts; commit; close; record receipt. Published/spec totals come from the locked RecoveryPlan, never a fabricated constant.
- [ ] Run focused test and git diff --check.
- [ ] Commit exact paths: git commit -m "docs(devices): define guarded recovery transaction".

### Task 19: Post-recovery read-only verification

**Files:** Create scripts/qa/device-schema-v1-post-recovery.mjs and scripts/qa/test-device-schema-v1-post-recovery.mjs.

**Consumes:** future RecoveryReceipt. **Produces:** verifySchemaV1PostRecovery({ receipt, fetch }): Promise<RecoveryReceipt>.

- [ ] Write RED fake-fetch cases for /products/, brand counts, representative /devices/[slug] redirects, YAML-derived compatibility output, and unexpected 500 classification.
- [ ] Run: node scripts/qa/test-device-schema-v1-post-recovery.mjs. Expected RED: module absent.
- [ ] Implement bounded read-only verification; reject non-HTTPS/non-approved hosts and never invoke qa:prod.
- [ ] Run focused test plus Task 14 reader regressions; git diff --check.
- [ ] Commit exact paths: git commit -m "test(devices): verify recovered public catalog".

### Task 20: Recovery provenance closeout

**Files:** Create docs/release/device-schema-v1-recovery-receipt-template.json and scripts/test-device-schema-v1-provenance.mjs.

**Consumes:** all fingerprints and receipts. **Produces:** a validated closeout template containing spec/plan commits, migration/YAML/source/conflict/identity/model fingerprints, pre/post counts, transaction count, and route result.

- [ ] Write RED validation for missing provenance, credential-shaped text, absent authorization ID, or transaction count other than one.
- [ ] Run: node scripts/test-device-schema-v1-provenance.mjs. Expected RED: template missing.
- [ ] Implement JSON template/validator. Production fields are evidence slots only, never executable commands.
- [ ] Run all focused Schema v1 tests, npm test, npm run build, npm run qa:release, git diff --check, and inspect the worktree. Do not run qa:prod.
- [ ] Commit exact paths: git commit -m "docs(devices): define recovery provenance receipt".

## Plan self-review record

- Spec coverage: Tasks 1–4 cover schema, MEDIUM_HIGH, states, contexts, tracking, triggers, RLS, no anon normalized reads, source links, and audit. Tasks 5–12 cover YAML authority, sources, conflicts, identity/Ray-Ban, normalized values, compatibility, and DryRun. Tasks 13–15 prove local recovery. Tasks 16–20 separate Release A and B authorization, transaction, verification, and provenance.
- Placeholder scan: this plan contains no TODO/TBD, generic test instruction, or unnamed interface. Dynamic Production counts are explicitly derived from a locked RecoveryPlan.
- Type consistency: NormalizedCatalog is produced in Task 6 and consumed through Task 12. RecoveryPlan is produced in Task 12 and consumed by Tasks 13, 15, 17, and 18. RecoveryReceipt is produced in Task 13 and consumed by Tasks 14, 15, 17, 19, and 20.
- Boundary check: no task adds Release C/D/E functionality. Release A and Release B Production mutations remain independently blocked pending future authorization.

## Execution handoff

Plan complete and saved to docs/superpowers/plans/2026-09-09-database-schema-v1-release-a-b.md. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh implementer per task and review every task independently.
2. **Inline Execution** — use superpowers:executing-plans in batches with review checkpoints.
