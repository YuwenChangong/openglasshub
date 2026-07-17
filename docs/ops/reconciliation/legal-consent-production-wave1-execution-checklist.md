# Production Reconciliation Wave 1 Execution Checklist

Status: `EXECUTION_PACKET_READY_PENDING_HUMAN_APPROVAL`. This checklist is not
an approval, a deployment instruction, or a migration. Wave 1 remains
`UNEXECUTED`; the only allowed scope is the two exact function signatures in
the reviewed [proposal](legal-consent-production-wave1-proposal.sql).

## Scope and order

1. Verify a fresh preflight export for both exact signatures.
2. Begin the reviewed transaction.
3. Converge `increment_post_view_count(uuid)` body and security metadata.
4. Revoke its PUBLIC, anon, authenticated, and service-role grants.
5. Grant only anon and authenticated EXECUTE for the post-view function.
6. Converge `insert_forum_notification(...)` metadata without replacing its body.
7. Revoke its PUBLIC, anon, authenticated, and service-role grants.
8. Grant only service-role EXECUTE for the notification function.
9. Run the proposal's in-transaction catalog assertions.
10. Commit only when every assertion and reviewer gate passes.

This order never grants broader access. The two function bodies and ACL changes
remain in one transaction so an assertion failure aborts all Wave 1 changes.

## Gate A: Before approval

- [ ] Wave 1A and Wave 1B forensic reports have been reviewed together.
- [ ] A database/security reviewer has approved the exact two-function scope.
- [ ] An application reviewer has confirmed the documented caller contracts.
- [ ] A fresh production preflight is attached and was run immediately before execution.
- [ ] A human operator has confirmed the production target identity.
- [ ] Both exact signatures exist with no unexpected overload.
- [ ] Both return types, owners, SECURITY DEFINER states, and search paths match the review.
- [ ] `insert_forum_notification(...)` body SHA-256 is `96b887a7f28df54154c36a0e45790e61bd1cf6f10b96546ceafda8ac2c148fa2`.
- [ ] `increment_post_view_count(uuid)` body SHA-256 is the reviewed divergent `c29ed210f5aa903e33323aff772130d038f72c42cd6ccae593e33dda5d87b1f2`, or a new forensic review has approved the changed value.
- [ ] The reviewed ACL/metadata state has not drifted since the export.
- [ ] Backup and restore readiness are confirmed.
- [ ] A maintenance and incident/forward-fix owner is named.
- [ ] The compatible application deployment state is confirmed.

Any mismatch is a STOP condition. Do not run the proposal after a mismatch.

## Gate B: Before SQL execution

- [ ] The approved proposal file checksum matches the reviewed packet.
- [ ] No edits have been made in the Dashboard.
- [ ] Only `legal-consent-production-wave1-proposal.sql` is selected.
- [ ] The selected SQL contains no migration-history command, `db push`, or migration repair.
- [ ] The transaction boundary and in-transaction assertions are present.
- [ ] No additional function, table, policy, index, constraint, or Wave 2+ object is included.

## Gate C: Immediately after execution

- [ ] The read-only [postflight](legal-consent-production-wave1-postflight.sql) succeeds.
- [ ] Notification body hash is unchanged and its owner/SECURITY DEFINER/search path is `postgres`/enabled/`public, pg_temp`.
- [ ] Notification EXECUTE is denied to PUBLIC, anon, and authenticated and allowed to service_role.
- [ ] Post-view body hash equals reviewed expected `5e5d6c9682a32dbb9deb7003be854eaf06700577593c7b7ac108ddecd55fed5d`.
- [ ] Post-view owner/SECURITY DEFINER/search path is `postgres`/enabled/`public`.
- [ ] Post-view EXECUTE is denied to PUBLIC and service_role and allowed to anon and authenticated. A superuser-only catalog result must be separately explained, never silently accepted.
- [ ] No unexpected direct grants or overloads appear.
- [ ] Application smoke checks pass: visible published post increment works; pending-review and inaccessible-circle posts do not increment; moderation notification writer works; recipient isolation holds.
- [ ] No production residue or unrelated object change appears in the review packet.

## Gate D: Stop and incident response

Stop immediately for preflight drift, a SQL error, assertion failure, unexpected
permission, application regression, body-hash mismatch, unexpected overload, or
any unrelated object mutation. Preserve the read-only evidence and use the
reviewed forward-fix/incident process. Do not restore PUBLIC EXECUTE merely to
reproduce the insecure prior state, do not blindly roll back the known-broadened
post-view body, and do not alter migration history. Where the transaction has
committed but a later issue appears, a reviewed secure forward-fix is preferred.

| Operation | Failure handling |
| --- | --- |
| Same-transaction function body, owner, search path, or ACL change before `COMMIT` | Transactionally reversible through rollback. |
| Post-view body after an approved commit | Secure forward-fix preferred; the prior body is known to broaden access. |
| Owner change | Owner-dependent; requires database-owner review. |
| Unexpected direct grantee, unavailable backup, or application regression | Manual incident decision required. |

No canonical migration is changed, no migration-history repair is allowed, and
no production SQL has been approved by this document.
