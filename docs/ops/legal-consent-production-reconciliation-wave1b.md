# Production Reconciliation Wave 1B Forensic Review

Status: `PROPOSAL_AUTHORED_LOCAL_VALIDATED`; production remains `NO_GO`.

This review used the manually exported read-only schema packet at `C:\Users\1\Downloads\increment-post-view-count-body.csv` offline only. The packet has 1,011 catalog rows, all required packet sections, exactly one target function-definition row, and no secret-like or email-like content. It was not committed.

## Exact evidence

| Property | Expected verified source | Observed production export | Classification |
| --- | --- | --- | --- |
| Definition hash | `5e5d6c9682a32dbb9deb7003be854eaf06700577593c7b7ac108ddecd55fed5d` | `c29ed210f5aa903e33323aff772130d038f72c42cd6ccae593e33dda5d87b1f2` | `SECURITY_BROADENING` |
| Target table and column | `public.posts.view_count` | `public.posts.view_count` | `NON_SEMANTIC` |
| Identifier/status predicate | Exact `id = p_post_id` and `status = 'published'` | Same | `NON_SEMANTIC` |
| Moderation predicate | Requires `moderation_status = 'published'` | Absent | `SECURITY_BROADENING` |
| Circle predicate | Requires `public.can_access_public_circle(post_ref.circle_id)` | Absent | `SECURITY_BROADENING` |
| Return behavior | SQL `void`; nonexistent or null UUID yields zero updated rows | Same | `NON_SEMANTIC` |
| Invalid UUID | The typed `uuid` signature rejects an invalid value before the function body | Same signature | `NON_SEMANTIC` |
| SECURITY DEFINER | true | true | `NON_SEMANTIC` |
| Search path | `public` | `public` | `NON_SEMANTIC` |
| Owner | `postgres` | `postgres` | `NON_SEMANTIC` |
| Effective ACL | PUBLIC false; anon/authenticated true; service_role false | PUBLIC/anon/authenticated/service_role true | `SECURITY_BROADENING` |
| Dynamic SQL/arbitrary object | None; fixed qualified `public.posts` and fixed helper | None; fixed qualified `public.posts` | `NON_SEMANTIC` |
| Unrelated side effects | One fixed view-count update only | One fixed view-count update only | `NON_SEMANTIC` |

The local enum uses `pending`, not a separate `draft` value. Hidden, deleted, and pending posts all fail the shared `status = 'published'` predicate in both bodies. The meaningful behavior difference is that the observed body still increments a published post that is pending moderation or belongs to an inactive/test/inaccessible circle; the expected body denies both cases. Missing UUID-shaped IDs and null reach no matching row; malformed UUID text is rejected at the typed invocation boundary before either body runs.

## Source-proven caller contract

The runtime search found only two application references: `src/lib/post-engagement.ts` defines the fixed RPC wrapper, and `src/pages/posts/[id].astro` invokes it only after its server-side post detail query has already required `status = 'published'` and `moderation_status = 'published'`. The wrapper can call only `increment_post_view_count` with the selected post id and has no table, column, SQL, or function-name input. The `anon` and `authenticated` grants remain required for public post-detail rendering; `PUBLIC` and `service_role` execution do not.

The expected source body is therefore unambiguous and not a new product policy: it closes a database-level authorization gap for direct RPC callers and preserves the route's existing public-post contract. No product-semantic human decision is required before authoring the proposal.

## Proposal and local validation

[legal-consent-production-wave1b-preflight.sql](reconciliation/legal-consent-production-wave1b-preflight.sql) is read-only and resolves the exact overload, body, owner, SECURITY DEFINER state, search path, ACLs, and overload count. [legal-consent-production-wave1b-proposal.sql](reconciliation/legal-consent-production-wave1b-proposal.sql) is explicitly unexecuted and non-production only. It restores the exact expected function body, keeps the owner and security metadata, revokes broad execution, and grants only `anon` and `authenticated`.

The deterministic `LOCAL_DOCKER_ONLY` test reproduced the observed production body and broad PUBLIC ACL inside one disposable database transaction. It then applied the Wave 1B proposal and verified the expected function hash, owner, SECURITY DEFINER state, search path, and ACL matrix. Behavior converged as follows: an accessible published/moderation-published post incremented in both bodies; hidden, deleted, pending, missing, and null targets did not increment; the observed body incorrectly incremented published pending-review and inaccessible-circle posts, while the proposal correctly left both unchanged. The transaction rolled back, leaving no local residue.

## Stop conditions

Do not execute this proposal on production. Stop on an unknown overload, body/owner/search-path mismatch, unexpected runtime caller, failed non-production behavior matrix, or any target that is not positively verified as non-production. A fresh attached preflight, backup/restore readiness, and explicit human non-production approval remain required. Wave 2 has not started.
