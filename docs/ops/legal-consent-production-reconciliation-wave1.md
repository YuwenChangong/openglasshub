# Production Reconciliation Wave 1 Review

Status: `PARTIALLY_AUTHORED_LOCAL_VALIDATED`; production remains `NO_GO`.

Reviewed commit: `4fb0c31765684a60a4a9b8e142eb5b97504e3f03`. This is not a canonical migration. No production SQL, Supabase cloud operation, migration repair, deployment, or production data operation occurred.

## Body-integrity gate

| Exact signature | Expected body hash | Observed body hash | Body evidence | Proposal status |
| --- | --- | --- | --- | --- |
| `public.increment_post_view_count(uuid)` | `5e5d6c9682a32dbb9deb7003be854eaf06700577593c7b7ac108ddecd55fed5d` | `c29ed210f5aa903e33323aff772130d038f72c42cd6ccae593e33dda5d87b1f2` | `BODY_DIVERGENT` | Blocked; no proposal SQL authored for this function. |
| `public.insert_forum_notification(uuid, uuid, text, uuid, uuid, uuid)` | `96b887a7f28df54154c36a0e45790e61bd1cf6f10b96546ceafda8ac2c148fa2` | `96b887a7f28df54154c36a0e45790e61bd1cf6f10b96546ceafda8ac2c148fa2` | `EXACT_BODY_MATCH` | Metadata/ACL proposal authored and locally validated. |

`increment_post_view_count` is SECURITY DEFINER, owned by `postgres`, returns `void`, and has `search_path=public` in both captured definitions. Its observed body updates any published post by id; the expected body additionally requires published moderation status and `can_access_public_circle`. ACL repair cannot conceal that behavioral divergence. Fresh read-only production preflight and a separately reviewed body-level proposal are required.

`insert_forum_notification` is SECURITY DEFINER, owned by `postgres`, returns `void`, and has `search_path=public, pg_temp` in both captured definitions. Its body exactly matches. The observed production ACL has effective `PUBLIC`, `anon`, and `authenticated` execution and lacks the expected service-role-only direct grant. The server-only writer in `src/lib/server/moderation-notifications.server.ts` lazily constructs the service-role client after verified actor/target normalization and calls only this fixed RPC. No other runtime application caller exists. `src/lib/post-engagement.ts` is the public caller of the separate view-count RPC; anon/authenticated execution remains intended for that function but is blocked from this metadata-only wave due to its divergent body.

## Artifacts

- Read-only packet: [legal-consent-production-wave1-preflight.sql](reconciliation/legal-consent-production-wave1-preflight.sql). It captures existence, exact overload, return type, owner, SECURITY DEFINER, search path, full definition, effective role execution, ACL entries, overload count, and safely queryable dependent policies for both signatures.
- Non-production review proposal: [legal-consent-production-wave1-proposal.sql](reconciliation/legal-consent-production-wave1-proposal.sql). It is prominently marked unexecuted and applies only signature-qualified owner, SECURITY DEFINER, search-path, revoke, and grant operations for `insert_forum_notification`.

## Local simulation

The read-only preflight packet executed against the disposable `LOCAL_DOCKER_ONLY` normalized replay database and resolved both exact function OIDs using `to_regprocedure`; it rolled back after catalog inspection. The test then reproduced only notification ACL drift inside a transaction: service-role execution revoked and PUBLIC execution granted. It applied the proposal operations inside that same transaction and proved:

- the notification body hash was preserved;
- owner remained `postgres`;
- SECURITY DEFINER remained enabled;
- `search_path` converged to `public, pg_temp`;
- effective PUBLIC, anon, and authenticated execution became false;
- effective service-role execution became true; and
- the transaction rolled back, leaving no local residue.

The view-count function was not simulated because reproducing its captured production state would require modifying its divergent body, which is forbidden for this metadata/ACL-only proposal.

## Risk, rollback, and stop conditions

Function ACL and metadata operations take short catalog locks but can immediately affect callers. They require exact target confirmation, fresh attached preflight output, reviewed dependent callers, backup/restore readiness, and explicit non-production human approval. If verification fails after a partial application, stop and use a reviewed forward fix. Do not restore PUBLIC execution as a rollback shortcut because that would reintroduce the identified privilege boundary.

Stop immediately on an unknown overload, unexpected owner/return type/search path, non-matching notification body hash, unexpected dependent caller, failed service-role writer regression, or any evidence that the target is production. Wave 2+ legal-consent, circle, comment, post, report, media, and operational objects remain unresolved.
