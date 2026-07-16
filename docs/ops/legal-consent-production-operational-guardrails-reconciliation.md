# Operational Guardrails Reconciliation Preflight

Status: `INDEX_STAGES_APPLIED_POSTFLIGHT_VERIFIED_POLICY_PRIVILEGE_HOLD`. This is W6 only and remains
`LEGAL_TRUST_CONSENT_FOUNDATION_V1_PRODUCTION_RECONCILIATION_NO_GO`.

The human security/product decision approves only the architecture direction of
a server-only atomic fail-closed rate-limit RPC. It does not authorize a
function, migration, runtime change, policy removal, grant, production SQL, or
deployment. The decision record is
[operational-guardrails-rate-limit-rpc-architecture.md](reconciliation/operational-guardrails-rate-limit-rpc-architecture.md).

The completed repository-only design phase now classifies the trusted identity
as `SERVICE_ROLE_CONFIGURATION_PARTIALLY_READY`: operator-held, metadata-only
Preview evidence proves the reviewed encrypted binding record, while local
configuration is unproven and Production remains
`BINDING_ABSENT_PRODUCTION_BLOCKED`. It fixes a non-executable five-purpose
interface and advisory-lock design, and leaves the media-byte, timeout,
duplicate, owner, and external-video daily-quota decisions approval-gated. The
direct rate-limit paths remain fail-open and Stage C remains
`BLOCKED_RUNTIME_MIGRATION_REQUIRED`; no policy is removable.

R2 has authored an unexecuted static proposal for the source-backed hourly
attempt boundary. It is not a migration or execution authorization. The
generic upload byte cap and external-video daily cross-table quota remain
`HUMAN_DECISION_REQUIRED`; R3 cannot begin and Stage C remains blocked.

R1 now has a repository-only binding contract: the active server name is
`SUPABASE_SERVICE_ROLE_KEY`. The external Preview proof transition is
`BINDING_ABSENT` to `SECRET_BINDING_PRESENT`; its metadata-only JSON remains
outside Git and stores no value or hash. Local configuration remains required,
and Production remains independently blocked by `BINDING_ABSENT`. The Preview
result does not make Stage C eligible.
The dedicated current-state packet is
[operational-guardrails-current-catalog-refresh.sql](reconciliation/operational-guardrails-current-catalog-refresh.sql);
its CSV must not reuse any earlier W6 export.

The approved fresh catalog-only execution has now resolved the historical
missing-index conflict. Both index stages are closed already satisfied; the
extra-policy hold remains because the direct runtime path is non-atomic and
fail-open. See the deterministic offline review in
[operational-guardrails-current-catalog-refresh-review.md](reconciliation/operational-guardrails-current-catalog-refresh-review.md).

## Why W6 is next

W6 is dependency-complete after W0 and is the smallest unresolved bounded
security wave: four objects on one table in one domain. It contains two P0
extra policies and two P1 missing rate-limit indexes. W3B (11 objects), W4 (7
objects across posts/reports), and W5 (13 media objects) are larger or depend
on later authorization evidence. W6 therefore has the highest direct runtime
and security impact among safely preflightable candidates without reopening
Wave 1 or Wave 3A.

Exact scope:

- `public.forum_upload_attempts.forum_upload_attempts_purpose_ip_created_idx`
  (`PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED`; historical classification
  `MISSING_IN_PRODUCTION`, P1), from `20260605_forum_rate_limit_purposes.sql`.
- `public.forum_upload_attempts.forum_upload_attempts_purpose_user_created_idx`
  (`PRODUCTION_APPLIED_POSTFLIGHT_VERIFIED`; historical classification
  `MISSING_IN_PRODUCTION`, P1), from the same migration.
- `public.forum_upload_attempts.forum_upload_attempts_insert_self`
  (`EXTRA_IN_PRODUCTION`, P0), from
  `20260531_forum_phase6_upload_guardrails.sql`.
- `public.forum_upload_attempts.forum_upload_attempts_select_self`
  (`EXTRA_IN_PRODUCTION`, P0), from the same migration.

Source-backed runtime callers are `src/lib/server/rate-limit.ts` and
`src/pages/api/forum/external-video-upload.ts`. Direct dependencies are only
the table, its five rate-limit columns, the two indexes, and the two reviewed
policy names. The packet returns catalog definitions plus aggregate-only safety
counts; it returns no user identifiers, IP values, timestamps, or attempt rows.
Its ACL section reads catalog ACL entries with `aclexplode`; PUBLIC is represented
by ACL grantee OID `0`, not as a `pg_roles` name. The aggregate purpose contract
also includes `verification_email_resend`, which is added by the existing
rate-limit migration.

The supplemental production export is complete: all four existing indexes are
valid and ready but none is a structural equivalent of either expected
purpose-leading index. Both extra policies are RLS-redundant: the canonical
INSERT policy permits every reviewed `insert_self` row, and canonical SELECT
already uses `USING true` for `authenticated`. The catalog also proves a
separate availability blocker: `authenticated` has no effective `SELECT` or
`INSERT` privilege on this table, while the source-backed rate-limit callers
use bearer-bound anon-key clients. RLS policy removal is therefore held until a
separate reviewed privilege-contract reconciliation can prove runtime behavior.

The two indexes are independently eligible for review as sequential concurrent
operations. Their unexecuted packet is:

- [fresh execution preflight](reconciliation/operational-guardrails-index-execution-preflight.sql)
- [Stage A concurrent index](reconciliation/operational-guardrails-index-stage-a-proposal.sql)
- [Stage B concurrent index](reconciliation/operational-guardrails-index-stage-b-proposal.sql)
- [read-only postflight](reconciliation/operational-guardrails-index-postflight.sql)
- [staged checklist](reconciliation/operational-guardrails-index-execution-checklist.md)

Each `CREATE INDEX CONCURRENTLY` statement is intentionally a single standalone
statement outside a transaction. The index path requires fresh preflight before
each stage and explicit production approval; no policy DROP is included.

## Stage A production execution record

Stage A executed the reviewed standalone
`CREATE INDEX CONCURRENTLY forum_upload_attempts_purpose_ip_created_idx ON
public.forum_upload_attempts (purpose, ip_hash, created_at DESC)` statement
once, outside a transaction. Fresh preflight confirmed the target was missing,
no structural equivalent or invalid/unfinished candidate existed, and the
policy/privilege hold matched the reviewed state.

Redacted Stage A postflight verified one valid, ready, non-unique `btree` index
with the exact reviewed key order and descending `created_at`.

Stage B then executed its reviewed standalone
`CREATE INDEX CONCURRENTLY forum_upload_attempts_purpose_user_created_idx ON
public.forum_upload_attempts (purpose, user_id, created_at DESC)` statement
once, outside a transaction. Its fresh preflight confirmed Stage A remained
exact and valid/ready, Stage B was missing, and no structural equivalent or
invalid/unfinished candidate existed. Redacted postflight verified both exact
index shapes, with no invalid, unfinished, failed, or duplicate Stage B-shaped
index remaining.

`forum_upload_attempts_insert_self` and `forum_upload_attempts_select_self`
remain unchanged; no grant, privilege, policy, application-data, or unrelated
catalog change was made. The next safe action is a separately reviewed policy
and authenticated-privilege reconciliation; it is not authorized by this index
execution record. W6 and the overall reconciliation remain `NO_GO`.

## Authenticated privilege-contract review

This review is read-only. It does not authorize policy removal, table grants,
or runtime changes. Both production indexes are complete and outside this
scope.

### Runtime access-path inventory

| Path | Intended role | Required privilege | Applicable RLS | Source-backed behavior | Current evidence / gap |
| --- | --- | --- | --- | --- | --- |
| Browser client | No direct table role | None | None | No browser source calls `forum_upload_attempts`. | Source search finds no browser-table client. |
| Authenticated forum API: post, comment, and circle creation | Caller bearer token via anon-key client | `SELECT`, then `INSERT` | Canonical `forum_upload_attempts_select_authenticated` (`USING true`) and `forum_upload_attempts_insert_authenticated` (`user_id = auth.uid() OR user_id IS NULL`) | `enforceUserRateLimit` counts then inserts a caller-derived record. | Prior catalog evidence reports effective authenticated `SELECT=false`, `INSERT=false`; helper returns `allowed: true` on either DB error. Fresh ACL/RLS evidence is required. |
| Authenticated forum API: media guard and external video upload | Caller bearer token via anon-key client | `SELECT`, then `INSERT` | Same canonical policies | `enforceUploadRateLimit` counts then inserts; external-video also directly reads `bytes` for its daily cap. | Same privilege gap; both failure paths treat unavailable attempt data as zero/allowed. |
| Unauthenticated resend-confirmation API | `anon` RPC caller | `EXECUTE` on one RPC, not table `SELECT`/`INSERT` | RLS/table grants bypassed only inside the reviewed security-definer RPC | `consumeVerificationEmailResendLimit` calls `consume_verification_email_resend_limit`; the function reads and inserts the `verification_email_resend` attempt. | Source migration grants RPC execute to `anon` and `authenticated`; fresh function ACL/metadata evidence is required. |
| Service-role server client | None for this table | None established | Not applicable | Repository service-role factories are used for legal-consent and moderation-notification work, but no `forum_upload_attempts` caller uses one. | No service-role bypass is source-backed for this table. |
| Background job / direct database function | Resend RPC only | RPC `EXECUTE` | Function is `SECURITY DEFINER` with `search_path = public, pg_temp` in source | No worker, cron, or other RPC/table reference is present in repository search. | Fresh RPC catalog evidence must confirm production still matches the reviewed contract. |

### Current grant and RLS matrix

The last redacted supplemental catalog review established RLS enabled (not
forced), all four policies present, and effective authenticated `SELECT=false`
and `INSERT=false`. It also established that the two extra policies are
RLS-redundant: permissive policies compose with `OR`, so the canonical INSERT
policy already covers the narrower `insert_self` rows and canonical SELECT is
already `USING true`.

RLS is not a grant. With the observed effective table privileges, the bearer
clients used by forum APIs cannot rely on either RLS policy to access the table.
The helper deliberately turns a table error into an available result, so this
is a rate-limit enforcement gap rather than evidence that the protected route
itself fails.

Granting `authenticated` table access is not currently an approved remedy:

- an authenticated `SELECT` grant would activate canonical `USING true` and
  expose every readable upload-attempt row to any authenticated REST/browser
  caller;
- an authenticated `INSERT` grant would activate a permissive self-or-null
  insert path for direct callers, not only the server route;
- no source-backed service-role path currently provides a separate privileged
  boundary for forum rate-limit reads or writes.

Therefore neither `forum_upload_attempts_insert_self` nor
`forum_upload_attempts_select_self` is safe to remove now. Removal is
RLS-redundant but not behavior-preserving until the table/RPC privilege
contract is freshly verified and a security reviewer selects an intended
server-side enforcement boundary.

### Required fresh evidence

The existing snapshot is insufficient to confirm the current direct ACL,
PUBLIC/inherited privilege contribution, policy definitions, and resend RPC
ACL after the index stages. Use this new catalog-only packet; it returns no
application rows and executes no write SQL:

```powershell
Get-Content -Raw "D:\OpenGlass Hub interaction-release-fresh\docs\ops\reconciliation\operational-guardrails-authenticated-privilege-preflight.sql" | Set-Clipboard
```

Run it once in the confirmed production Dashboard, export its sole result set,
and obtain explicit approval before any later review or remediation. Do not
run a policy DROP, GRANT, REVOKE, or proposal from this packet.

### Recommended next action

Obtain and validate the fresh read-only ACL/RLS/RPC packet, then make one
explicit product/security decision: either introduce a narrowly authorized
server-side rate-limit boundary (preferred), or explicitly accept direct
authenticated table access and replace the broad canonical policies before
granting it. Until that decision and evidence exist, retain both policies and
all grants unchanged.

### Production preflight result

The approved packet executed once as `BEGIN TRANSACTION READ ONLY` followed by
`ROLLBACK`. It returned catalog rows only; no `forum_upload_attempts` rows were
selected, no production export was committed, and no production object changed.

**Catalog-proven facts**

- `public.forum_upload_attempts` exists, is owned by `postgres`, has RLS
  enabled, and does not force RLS.
- `anon`, `authenticated`, and `service_role` each have effective table
  `SELECT=false` and `INSERT=false`. `has_table_privilege` evaluates inherited
  privileges, so no direct ACL, inherited role membership, or `PUBLIC` ACL
  currently confers either operation to `authenticated`.
- The direct ACL catalog contains no `PUBLIC` entry. `authenticated` has no
  direct `SELECT` or `INSERT` entry.
- All four permissive `authenticated` policies remain present. The canonical
  SELECT policy is `USING true`; canonical INSERT permits `user_id = auth.uid()`
  or `NULL`. The two extra policies remain unchanged and are RLS-redundant,
  not independently restrictive.
- `consume_verification_email_resend_limit(text, integer, integer)` exists,
  is owned by `postgres`, is `SECURITY DEFINER`, and has
  `search_path=public, pg_temp`. `anon` and `authenticated` have effective
  `EXECUTE`; `service_role` does not; there is no `PUBLIC` execute entry.

**Code-proven runtime intent**

- Browser code has no direct `forum_upload_attempts` call.
- Forum mutation routes create anon-key clients bound to the verified caller's
  bearer token, then make direct table reads and inserts through
  `enforceUserRateLimit` or `enforceUploadRateLimit`. The external-video route
  also directly reads `bytes` for its daily allowance.
- Those direct calls cannot receive the required table privileges under the
  catalog-proven authenticated role. The helper currently converts database
  errors into `allowed: true`; therefore the catalog proves a permission-layer
  availability failure, while an authenticated smoke still remains necessary
  to observe the exact production response path end to end.
- Resend confirmation uses the separate security-definer RPC rather than direct
  table access. Its catalog contract is present, but no runtime invocation was
  performed in this review.

**Privacy and remediation assessment**

| Strategy | Assessment |
| --- | --- |
| Grant authenticated `SELECT` and `INSERT` | Unsafe. It would activate canonical `USING true` for all authenticated callers and expose attempt rows. |
| Grant `INSERT` only and remove direct SELECT use | Not sufficient. Direct callers could still create self-or-null attempt rows under the canonical INSERT policy, and the rate-limit check remains non-atomic. |
| Narrow security-definer RPC | Viable only when executable exclusively by a server-held role, with fixed purpose/limit validation, verified server-derived actor and IP inputs, a locked search path, revoked `PUBLIC`/browser-role execution, and fail-closed callers. |
| One atomic server-only rate-limit RPC | Preferred minimum design. It should combine scoped counting, decision, and attempt insertion in one transaction with concurrency control, return a narrow decision, keep table privileges private, and cause a server error rather than `allowed: true` on database failure. |

The packet does not inventory schema `USAGE`, sequence ACLs, or the full role
membership graph. Source migrations use `gen_random_uuid()` rather than a table
sequence, but fresh catalog evidence is still required before any remediation
proposal can claim an exact schema/sequence contract. The next approval needed
is a narrowly scoped **read-only supplemental privilege packet** for those
three catalog areas, followed by separate approval for the preferred atomic,
server-only RPC design. No policy removal is currently safe.

### Authenticated privilege supplemental packet

The first privilege packet is complete, but it did not collect schema `USAGE`,
sequence ACL, or membership-topology evidence. The following packet fills only
those gaps. It reads PostgreSQL catalogs, returns no application-table rows,
walks only the four execution roles and their parent-role closure, uses an
explicit read-only transaction, and rolls back.

- [supplemental privilege preflight](reconciliation/operational-guardrails-authenticated-privilege-supplemental-preflight.sql)
- [static packet contract](../../scripts/test-operational-guardrails-authenticated-privilege-supplemental-preflight.mjs)

It reports direct ACL entries, role-closure membership edges labeled `DIRECT`
or `TRANSITIVE`, and final effective schema/sequence privileges separately.
It also emits `NO_REFERENCED_SEQUENCE` when the table has no sequence-backed
default. The source migration currently uses `gen_random_uuid()`, so that is
the expected outcome, but the catalog packet is the authority for production.

The first approved production execution failed safely before it returned any
catalog evidence. PostgreSQL reported `42P21` in the third output column of
the recursive `role_closure` CTE: the anchor produced default-collated text
while the recursive `pg_roles.rolname` value carried collation `"C"`. The
packet begins `BEGIN TRANSACTION READ ONLY`, reads no application rows, and has
no mutating statement, so no production mutation was possible. The client
stopped at the error before its explicit `ROLLBACK` statement; connection
cleanup ended the failed read-only transaction without committing a change.

The packet is now corrected locally by emitting `::text COLLATE "C"` from both
third-column branches. This makes the type, typmod (unconstrained `text`), and
collation identical without changing target roles, membership direction,
privilege calculations, redaction, or output columns. The traversal remains
child-to-parent (`pg_auth_members.member` to `roleid`), keeps an OID path to
terminate cycles, and labels depth one as direct and greater depths as
transitive. The rendered topology now uses `DISTINCT` only to avoid duplicate
identical report edges; distinct paths at different depths remain visible.

`scripts/test-operational-guardrails-authenticated-privilege-supplemental-local.mjs`
reproduces the original mixed-collation `42P21` in LOCAL_DOCKER_ONLY, then runs
the corrected full packet through its final `ROLLBACK`. It proves the eight
sections and ten-column contract, direct and transitive role membership output,
and absence of any attempt-row mutation. Fresh explicit operator approval is
required before one corrected production read-only execution. Before execution,
reconfirm the exact production project, clean matching branch, and the
already-verified valid/ready Stage A and Stage B index postflight state. Do not
run any policy, grant, index, function, migration, or application operation
with this packet.

### Supplemental transport correction

The later approved attempt did not run the reviewed packet. Its orchestration
called the command runner to read the SQL file, treated the runner's formatted
result output as SQL, and passed that formatted value to the database wrapper.
The command runner prepended `Exit code: 0`, so PostgreSQL stopped at line one
with `42601` before `BEGIN TRANSACTION READ ONLY` could run. This was not a
PowerShell pipeline, clipboard, temporary-file, stderr, or database-client
rewriting issue: the contamination occurred when the formatted command-result
object was selected as the SQL payload. No packet transaction body, catalog
query, or production mutation occurred.

`scripts/lib/reviewed-sql-transport.mjs` now reads only the exact reviewed file
as bytes and requires its SHA-256 to equal
`d96e76f9dd3655c03a64dc5d535087fc63f99370b13b246f6529caaf121cd074`.
It rejects a byte-count mismatch, prefix/suffix difference, invalid UTF-8,
`Exit code:`, markdown fences, tool annotations, prompts, and shell diagnostics
before a client can receive a payload. It also confirms the first meaningful
token is `BEGIN`, the explicit `READ ONLY` transaction and terminal `ROLLBACK`
remain present, and that no line-ending or encoding transformation has occurred.

The dry-run-only helper
`scripts/prepare-operational-guardrails-authenticated-privilege-supplemental-transport.mjs`
creates a non-secret execution manifest at an operator-provided local path. It
records exact source/payload SHA-256 values and byte counts, raw-stdin transport
method, timestamp, target identity fingerprint, and dry-run result. It never
executes SQL. A future approved execution must feed `payloadBytes` directly to
the selected database client's raw stdin or file-input path; it must not build
a query from a command-result, stdout, stderr, clipboard, or tool wrapper.

The LOCAL_DOCKER_ONLY regression sends the contaminated legacy prefix and proves
the expected `42601`, then sends only raw reviewed bytes and proves the packet
returns eight sections and ten columns before its explicit `ROLLBACK`.
`scripts/test-operational-guardrails-authenticated-privilege-supplemental-transport.mjs`
also validates the generated manifest. Fresh explicit production approval is
required; this correction does not authorize another production attempt.

### Dockerized `psql -f` transport

The production retry must use the pinned local image
`public.ecr.aws/supabase/postgres:17.6.1.143@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453`.
`scripts/prepare-operational-guardrails-authenticated-privilege-docker-psql-transport.mjs`
performs a dry run only: it mounts the exact reviewed source at
`/reviewed/operational-guardrails-authenticated-privilege-supplemental-preflight.sql`
with Docker `readonly`, verifies the host and in-container SHA-256 and exact
8,674-byte count, verifies `psql 17.6`, and emits a redacted manifest outside
the repository. It refuses an image-digest, source/payload, byte-count, mount,
target-fingerprint, or connection-mode mismatch. The helper requires separate
observed and reviewed target identity fingerprints and fails unless they match.

The first interactive attempt stopped before `Password:` and before any
connection or SQL because the read-only client image has no `/output` target
for the proposed directory mount. The corrected operator transport pre-creates
a unique, zero-byte host staging file adjacent to the final CSV, bind-mounts
that exact file as the only writable container path at `/tmp/...csv`, then runs
`psql -X -W -q --csv -v ON_ERROR_STOP=1 -f /reviewed/... -o /tmp/...csv`.
It validates a non-empty staging CSV offline and atomically renames it to the
approved final path only after success. A non-empty failed or invalid staging
file is moved to a unique `.failed.csv` quarantine name; an empty staging file
is removed. The approved final CSV is never overwritten.

Run the user-operated script only from an interactive terminal:

```powershell
& "D:\OpenGlass Hub interaction-release-fresh\scripts\run-operational-guardrails-authenticated-privilege-supplement.ps1" -ExpectedHead "<approved-current-HEAD>"
```

It requires the exact operator-approved current HEAD and prompts only for
non-secret Dashboard direct host, port, database, user,
and the exact project name. `psql -W` alone prompts for the hidden password;
the script rejects password environment variables, credential files, poolers,
an unclean/unmatched branch, an altered reviewed packet, a changed image
digest, and a pre-existing final CSV. SQL input remains only the read-only
reviewed mount; stdout, stderr, process status, and the output CSV never become
SQL input. The local Docker regression proves the exact writable file mount
returns the eight sections and ten columns before the reviewed packet reaches
its explicit `ROLLBACK`.

The planned production mode is `DIRECT_SSL_REQUIRED`; it must use an explicit
SSL-required direct PostgreSQL connection only after a fresh approved
connectivity preflight. If direct reachability is unavailable, execution stops.
`SUPAVISOR_SESSION_SSL_REQUIRED` is the sole fallback, but it requires a new
manifest and explicit approval rather than a silent mode switch. No credential,
production output, or production connection detail is stored in this repository.

Its result can complete the supporting privilege matrix, but it cannot change
the prior conclusion on its own: table `SELECT`/`INSERT` remains the decisive
authorization boundary, and the recommended remediation remains a fail-closed,
atomic, server-only rate-limit RPC rather than direct browser-role table grants.

### Windows-native Direct Connection transport

The Docker direct transport is not reusable for IPv6-only Direct Connection
hosts: Windows resolved the exact `db.<project>.supabase.co` hostname to an
AAAA record, while Docker Desktop's resolver returned no address and `psql`
stopped before a database connection or SQL. The separate
`run-operational-guardrails-authenticated-privilege-supplement-native.ps1`
runner preserves Direct Connection only and never falls back to Session or
Transaction Pooler. It requires a native PostgreSQL 17 `psql.exe`, exact AAAA
DNS evidence, a successful native TCP reachability probe, the reviewed packet
hash and byte count, and a clean exact HEAD/origin match before its hidden
`psql.exe -W` prompt. It writes first to a unique Downloads temporary file,
validates it offline, atomically moves it only to the approved final CSV, and
quarantines non-empty failures.

If the client is absent, stop for **A. install/configure a native PostgreSQL
17 client**. If AAAA DNS or the native IPv6 TCP probe fails, stop for **B.
restore native IPv6 connectivity**. Selecting or purchasing the Supabase IPv4
Add-on is **C. explicitly approve the Supabase IPv4 Add-on** and requires a
separate human decision; this runner never enables it.

The eight-section packet has a dedicated operator export path:
`C:\Users\1\Downloads\operational-guardrails-authenticated-privilege-supplement.csv`.
It must never reuse the distinct ten-section W6 supplemental export. Validate
the direct `psql --csv` result fully offline with:

```powershell
node scripts/validate-operational-guardrails-authenticated-privilege-supplement.mjs "C:\Users\1\Downloads\operational-guardrails-authenticated-privilege-supplement.csv"
```

The validator requires the exact
`operational-guardrails-authenticated-privilege-supplemental-preflight-v1`
packet version, all eight expected sections, the ten-column schema, target-role
sentinels, and the packet manifest. It fails closed for malformed or duplicate
rows, truncation, the unrelated ten-section packet, non-allowlisted business
rows, `auth.users`, secret-like evidence, and email-like evidence. The CSV is
operator-held evidence and must remain untracked.

## Supplemental catalog review

The primary packet proves only that the two named indexes are missing and that
the two extra policies exist. Before any W6 remediation, run the supplemental
catalog packet. It records every table index, all overlapping policies, direct
ACL entries, effective privileges for real roles, RLS state, and safe catalog
dependencies. It returns no table rows and creates no proposal.

1. Copy the supplemental packet:

   ```powershell
   Get-Content -Raw "D:\OpenGlass Hub interaction-release-fresh\docs\ops\reconciliation\operational-guardrails-production-preflight-supplemental-one-shot.sql" | Set-Clipboard
   ```

2. Run it once in the confirmed production Dashboard and export its only result
   set to `C:\Users\1\Downloads\operational-guardrails-production-preflight-supplemental.csv`.
3. Validate fully offline:

   ```powershell
   node scripts/validate-operational-guardrails-production-preflight-supplemental.mjs "C:\Users\1\Downloads\operational-guardrails-production-preflight-supplemental.csv"
   ```

4. Resume W6 proposal review only with that validator result. A later missing
   index must use sequential `CREATE INDEX CONCURRENTLY` outside a transaction;
   the supplemental packet itself contains no executable remediation SQL.

## One-run operator workflow

1. Copy the one-shot SQL:

   ```powershell
   Get-Content -Raw "docs/ops/reconciliation/operational-guardrails-production-preflight-one-shot.sql" | Set-Clipboard
   ```

2. Run it once in the confirmed production Supabase Dashboard SQL Editor.
3. Export the only result set.
4. Save it exactly as `C:\Users\1\Downloads\operational-guardrails-production-preflight.csv`.
5. Run fully offline:

   ```powershell
   node scripts/validate-operational-guardrails-production-preflight.mjs "C:\Users\1\Downloads\operational-guardrails-production-preflight.csv"
   ```

6. Resume proposal review only with the CSV and validator result. The packet is
   read-only and creates no fixture, migration, proposal, or postflight.
