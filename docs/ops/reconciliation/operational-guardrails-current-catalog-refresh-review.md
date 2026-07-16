# W6 Current Catalog Refresh Review

Status: `INDEX_STAGES_CLOSED_CURRENT_CATALOG_VERIFIED_POLICY_RUNTIME_HOLD`.
The review is fully offline and remains
`LEGAL_TRUST_CONSENT_FOUNDATION_V1_PRODUCTION_RECONCILIATION_NO_GO`.

## Evidence

The operator-held current refresh passed the strict
`operational-guardrails-current-catalog-refresh-v1` validator with 117 rows and
20 required catalog-only sections. The prior ten-section W6 supplemental and
eight-section authenticated-privilege supplemental packets also passed their
dedicated validators. No CSV is in this repository.

The older ten-section supplemental packet is now classified as historical
pre-index evidence: its `INDEX_MISSING` result predates the verified Stage A
and Stage B executions. The fresh current catalog resolves that conflict; it
matches the later verified postflight state.

## Index Closure

| Stage | Index | Fresh classification | Closure |
| --- | --- | --- | --- |
| `W6_INDEX_STAGE_A` | `forum_upload_attempts_purpose_ip_created_idx` | `EXACT_INDEX_PRESENT` | `CLOSED_ALREADY_SATISFIED` |
| `W6_INDEX_STAGE_B` | `forum_upload_attempts_purpose_user_created_idx` | `EXACT_INDEX_PRESENT` | `CLOSED_ALREADY_SATISFIED` |

Both indexes are on `public.forum_upload_attempts`, use non-unique `btree`,
have no predicate or included columns, are not constraint-backed, and are
`indisvalid=true`, `indisready=true`, and `indislive=true`.

- Stage A key order: `(purpose ASC, ip_hash ASC, created_at DESC)`.
- Stage B key order: `(purpose ASC, user_id ASC, created_at DESC)`.
- PostgreSQL's default null ordering for the explicit descending final key is
  `NULLS FIRST`; the refresh definition records `created_at DESC` and no
  explicit `NULLS` override.
- No differently named structurally equivalent target index exists. The older
  single-column/time-leading indexes are valid supporting indexes, not
  equivalents of either purpose-leading target shape.

No `CREATE INDEX`, rename, rebuild, or new index proposal is warranted.

## Policy, Privilege, and RLS Review

All four policies are present, `FOR INSERT`/`FOR SELECT` respectively, apply
to `authenticated`, and are permissive. PostgreSQL combines applicable
permissive policies with OR.

| Policy | Current effective behavior | Classification |
| --- | --- | --- |
| `forum_upload_attempts_insert_authenticated` | Canonical INSERT `WITH CHECK (user_id = auth.uid() OR user_id IS NULL)`. | `CANONICAL_INSERT_PRESENT` |
| `forum_upload_attempts_insert_self` | Narrower purpose/user subset already covered by the canonical INSERT policy. | `RLS_REDUNDANT_PRIVILEGE_HOLD` |
| `forum_upload_attempts_select_authenticated` | Canonical SELECT `USING true`; it would expose all readable attempt rows if table SELECT were granted. | `CANONICAL_SELECT_BROAD_IF_GRANTED` |
| `forum_upload_attempts_select_self` | Narrower self-or-null SELECT is ORed with canonical `USING true`. | `RLS_REDUNDANT_PRIVILEGE_HOLD` |

RLS is enabled and not forced. RLS is not a table grant. Effective table
`SELECT` and `INSERT` are false for `PUBLIC`, `anon`, `authenticated`, and
`service_role`; they are true for `postgres`. `authenticated` has no parent
membership that changes that result. All reviewed browser-facing roles have
schema `public` `USAGE=true` and `CREATE=false`. The table has no sequence or
identity dependency.

The current function catalog confirms the existing resend-only function is
owned by `postgres`, uses `SECURITY DEFINER`, and fixes
`search_path=public, pg_temp`. Its explicit `anon` and `authenticated` execute
ACL is required by the resend workflow and is incompatible with the approved
future server-only rate-limit RPC. It must not be repurposed as that new
boundary. `auth.uid()` is security invoker and is not a rate-limit RPC.

## Runtime and Stage C

`src/lib/server/rate-limit.ts` performs separate direct table count reads and
attempt inserts in `enforceUserRateLimit` and `enforceUploadRateLimit`. The
callers are the post, comment, circle, media-upload, and external-video forum
APIs. Each builds an anon-key Supabase client bound to the verified bearer, so
the production table privileges deny the direct path. The read and insert are
not atomic. On a database error the helper returns `allowed: true` with
`RATE_LIMIT_BACKEND_UNAVAILABLE`, which is fail-open.

No browser source directly calls this table. The repository has service-role
factories for legal-consent and moderation-notification operations, but no
source-proven service-role rate-limit caller or RPC contract for this table.

Stage C is `BLOCKED_RUNTIME_MIGRATION_REQUIRED`. The extra policies are
RLS-redundant but their removal is not behavior-preserving until the direct
callers are migrated, a server-only contract is deployed and verified, and no
direct table access remains. No policy-removal SQL is authored.

## Approved Architecture Readiness Sequence

1. Source-prove the trusted server execution identity for this table; do not
   reuse the browser-executable resend RPC.
2. Define and review an allowlisted RPC signature and structured narrow result.
3. Specify a single concurrency-safe check-and-record operation, its locking or
   serialization behavior, and its bounded retention/error behavior.
4. Define a fixed owner, `search_path`, ACL matrix, and revocations so no
   PUBLIC, `anon`, or `authenticated` role can execute it.
5. Change server runtime callers to use that operation and deny the request on
   RPC, validation, or result-shape failure.
6. Add deterministic concurrency, unauthorized-role, malformed-input,
   no-attempt-row-exposure, fail-closed, and rollback coverage.
7. Deploy and verify the migrated runtime before separately reviewing either
   legacy policy for removal.

The architecture direction is approved, but the trusted role, exact signature,
concurrency primitive, ownership/ACL contract, and runtime migration are not
yet source-proven. Those are the remaining prerequisites for a separate
implementation approval.
