# W6 Index-Only Execution Checklist

Status: `UNEXECUTED_REVIEW_PACKET_READY`. This packet is limited to the two
missing `forum_upload_attempts` indexes. The two extra policies are not part of
this approval path because the supplemental production export reports that the
`authenticated` role lacks effective `SELECT` and `INSERT` privileges.

1. Confirm the reviewed commit and the intended production target, backup
   readiness, and incident owner.
2. Run [operational-guardrails-index-execution-preflight.sql](operational-guardrails-index-execution-preflight.sql).
   Stop unless the table exists, RLS remains enabled, the named target indexes
   remain absent, no equivalent exists, and the four reviewed policies still
   match the supplemental export.
3. Run [operational-guardrails-index-stage-a-proposal.sql](operational-guardrails-index-stage-a-proposal.sql) as a standalone statement. It must not run in a transaction.
4. Confirm Stage A reports a valid, ready, non-unique btree index with key order
   `(purpose, ip_hash, created_at DESC)`. Stop on any error or mismatch.
5. Run the fresh execution preflight again. Stop unless Stage A is present and
   Stage B remains absent with no equivalent structural index.
6. Run [operational-guardrails-index-stage-b-proposal.sql](operational-guardrails-index-stage-b-proposal.sql) as a standalone statement. It must not run in a transaction.
7. Run [operational-guardrails-index-postflight.sql](operational-guardrails-index-postflight.sql). Both exact target shapes must be valid and ready; policy definitions and the authenticated privilege finding must remain unchanged.

No policy is dropped by this checklist. Any future ACL or policy reconciliation
requires a new reviewed packet and explicit approval.
