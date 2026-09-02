# P10 post-reconciliation receipt preparation

- Approved execution commit: `e48ad72bd75738e3a0d4fdc85100b8d73cf904f7`.
- Migration: `20260902042807_forward_reconcile_devices`.
- Migration SHA-256: `2F98FEA88B4B5619DCE82A0E48C0653C96F4DB3E212D6F52A85FBAB083405E65`.
- Receipt SQL: `docs/ops/p10-post-reconciliation-receipt-read-only.sql`.
- Receipt SQL SHA-256: `619EB57B1D9287BE9E28D00B34B96E11EEEF5F379307D85C5B622AA76DAD758A`.

The frozen receipt has eight deterministic SELECT-only catalog groups: table columns, constraints, required indexes, RLS state, required grants, five policies, the slug-lock function with both device triggers, and the one permitted migration-history row. It does not select application rows or migration statement/rollback bodies.

The runner reuses the P9 target validator and one-session `BEGIN READ ONLY` transport. It rejects a changed receipt hash and reports history-row absence as an observation, never as a repair request. Production capture is not executed during preparation; no Production connection, SQL, mutation, deployment, replay, or history repair is authorized by this change.

Classification is deliberately conservative: full contract plus a present history row clears the migration blocker; full contract with an absent row preserves the blocker and makes only history-registration preparation eligible; any missing contract preserves the blocker.
