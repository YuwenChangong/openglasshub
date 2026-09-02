# P10 Forward Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore only the P9-proven missing `public.devices` schema with one new forward-only migration and a source-bound execution wrapper.

**Architecture:** A migration first rejects a malformed existing device table using catalog-only checks, then creates/reaffirms the canonical table, indexes, RLS, policies, slug-lock function and trigger. A separate Node wrapper freezes the SQL hash, verifies the approved source commit and Session Pooler target, and executes one transaction that commits only after postconditions pass.

**Tech Stack:** Supabase/PostgreSQL SQL, Node.js ESM, Node test runner, local Supabase runtime, local `psql`.

**Spec:** User-provided P10 Forward-Only Production Reconciliation Prep authorization.

## Global Constraints

- No Production connection, SQL, mutation, deployment, merge, Packet-3, or historical migration edit.
- New migration sorts after `20260829054707`; no destructive DDL, data rewrite, credential output, or migration-history repair.
- Delta is only the P9-proven absent `public.devices` contract; wrapper accepts only the approved project Session Pooler at port 5432.

---

### Task 1: Migration contract

**Files:** create `scripts/qa/p10-forward-reconciliation.test.mjs`; create `supabase/migrations/<unique>_forward_reconcile_devices.sql`.

**Produces:** a non-destructive, fail-closed device migration with table, three indexes, RLS, five policies, `slug_locked`, function, and trigger.

- [ ] Write a test that requires `create table if not exists public.devices`, all five policy identities, the slug-lock trigger, a catalog-only guard, and rejects `DROP TABLE`, `TRUNCATE`, `DELETE`, and `UPDATE public.devices`.
- [ ] Run `node --test scripts/qa/p10-forward-reconciliation.test.mjs`; observe missing-file failure.
- [ ] Create the minimal migration. Its `DO` guard permits an absent table or an already-canonical shape, rejecting any partial/unknown table before DDL.
- [ ] Re-run the test; expect PASS.

### Task 2: Transaction wrapper

**Files:** create `scripts/qa/p10-production-reconciliation.mjs`; create `scripts/qa/p10-production-reconciliation.test.mjs`.

**Interface:** `runP10Reconciliation({ mode, dsn, migrationSql, approvedCommit, actualCommit, spawnImpl })` returns sanitized counters/evidence.

- [ ] Write tests for hash/source/target rejection, no credential-bearing argv, begin/commit/rollback framing, postcondition rollback, and one successful commit.
- [ ] Run `node --test scripts/qa/p10-production-reconciliation.test.mjs`; observe missing-module failure.
- [ ] Implement the wrapper using `parseP9Connection`, SHA-256 exact match, source equality, shell-free spawn, and one transaction.
- [ ] Re-run the wrapper test; expect PASS.

### Task 3: Local proof

**Files:** create `scripts/qa/p10-forward-reconciliation-local.mjs`; create `scripts/qa/p10-forward-reconciliation-local.test.mjs`.

**Produces:** local evidence for P9-shaped absence, already-canonical safety, and forced rollback.

- [ ] Write validator tests for PASS evidence and rollback failure evidence.
- [ ] Run `node --test scripts/qa/p10-forward-reconciliation-local.test.mjs`; observe missing-module failure.
- [ ] Create only schema/catalog fixtures: P9-observed prerequisite functions/tables, no application rows. Apply via loopback mode and assert table/RLS/policies/trigger; apply on canonical shape; inject a failed postcondition and prove rollback.
- [ ] Run `node scripts/qa/p10-forward-reconciliation-local.mjs`; expect all three gates PASS and production counters zero.

### Task 4: Evidence, regression, and push

**Files:** create `docs/release/p10-forward-only-reconciliation-prep.md`; modify wrapper with final reviewed source binding.

- [ ] Record one delta row per object action with P9 source, precondition, postcondition, zero destructive actions, expected unique migration history version/name, hash, target binding and secret audit.
- [ ] Run `node --test scripts/qa/p10-*.test.mjs scripts/qa/p9-*.test.mjs scripts/qa/test-p8-migration-history-report.mjs scripts/qa/test-local-supabase-migration-mirror.mjs`, `npm test`, and `git diff --check`.
- [ ] Explicitly stage only P10 migration/scripts/tests/evidence/plan, inspect cached diff/check/stat, commit `feat(db): add forward-only production reconciliation`, push the feature branch, and verify remote/local equality and clean status.

## Self-review

- Tasks cover the only proven delta, local production-shaped/canonical/rollback paths, target/hash/source guards, and evidence.
- No task permits Production access or historical migration changes.
- The wrapper interface is consumed only in `LOCAL_TEST` during local acceptance.
