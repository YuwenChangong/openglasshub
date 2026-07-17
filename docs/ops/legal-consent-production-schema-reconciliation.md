# Legal Consent Production Schema Reconciliation

Status: `BLOCKED_PENDING_FINGERPRINT`.

This is an evidence collection procedure only. It does not authorize migration execution, migration history repair, `db push`, deployment, or a production write.

## What This Resolves

The known production ledger contains only:

- `20260518 | forum_phase1_schema | 103`
- `20260703 | moderation_action_notifications | 3`

That incomplete ledger does not prove the other canonical SQL was never applied manually. The expected fingerprint in `tests/fixtures/production-schema-expected-fingerprint.json` was generated from the verified local Docker replay. It covers 1,133 normalized application-catalog/configuration entries without business or user data. The active legal-policy bundle is application-owned source configuration rather than a migration-managed database row, so the packet proves the acceptance persistence schema/RPC but deliberately does not export an invented policy-value row.

## Operator Steps

1. Open the sole production Supabase project in the Dashboard.
2. Open SQL Editor and create a new query.
3. Paste the complete contents of `docs/ops/legal-consent-production-schema-fingerprint.sql`.
4. Confirm the packet contains only `BEGIN TRANSACTION READ ONLY`, catalog/configuration `SELECT` statements, and `ROLLBACK`.
5. Run the packet.
6. Export the single result set as CSV without editing its column headers.
7. Do not edit migration history. Do not run `db push`, migration repair, or any migration command.
8. Provide only the exported CSV file to Codex for offline comparison.

Do not provide keys, passwords, access tokens, project references, connection strings, Auth-user data, user-generated content, report data, or screenshots containing those values.

Codex compares an export locally with:

```powershell
node scripts/compare-production-schema-fingerprint.mjs path\to\dashboard-export.csv
```

The comparator performs no network operation. It emits object evidence as `MATCH`, `MISSING_IN_PRODUCTION`, `DIVERGENT_IN_PRODUCTION`, `EXTRA_IN_PRODUCTION`, or `INSUFFICIENT_EVIDENCE`, plus a separate effective-state classification for every canonical migration. A ledger record alone never proves a migration was applied; matching structural evidence can establish effective presence even when a ledger version is absent.

## Decision Rules

### Complete expected match

Historical SQL is effectively present. Do not replay the 41 unrecorded historical files. Prepare a separate reviewed migration-baseline/history reconciliation plan; do not automatically repair history.

### Missing all or most historical objects

Do not replay the historical directory. Prepare an isolated forward baseline plan after assessing current production data and dependencies.

### Partial or divergent result

Hard stop. Create an object-by-object forward reconciliation plan. No blind replay, `db push`, or migration repair is approved.

### Security-broadening result

Urgent `NO_GO`. This includes unexpected `PUBLIC` or authenticated execution on `insert_forum_notification`, missing service-role execution on that function, incorrect post-view/report-target ACLs, Security Definer search-path/body divergence, disabled protected-table RLS, missing required policies/constraints, missing consent persistence, or broad mutation grants. Prepare only a minimal reviewed forward hardening fix.

## Current Boundaries

Local replay, upgrade simulation, ACL, search-path, RLS, RPC, consent, and residue verification remain successful. Production fingerprint collection is `NOT RUN`; comparison is `NOT RUN`; production history reconciliation remains `BLOCKED_PENDING_FINGERPRINT`.

All cloud migrations remain unexecuted by this branch workflow. Production remains `NO_GO` until the exported fingerprint is reviewed, history is reconciled through a separately approved plan, cloud runtime configuration is verified, operator/legal blockers are resolved, and explicit production approval exists.
