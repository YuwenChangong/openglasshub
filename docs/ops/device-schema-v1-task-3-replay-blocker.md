# Task 3 disposable Supabase replay evidence

Status: **BLOCKED**. Recorded 2026-09-10 against implementation commit
`d2a2b0cf62437e41b1b1ddb53f2fa352b8806378` in the isolated
`feature/database-schema-v1` worktree.

The plan requires `scripts/qa/local-disposable-supabase-replay.mjs` for local
schema work. The existing 89-case native PostgreSQL enforcement result is
supplementary evidence only. It does not establish enforcement against the
full migration chain, Supabase dependencies, or actual legacy triggers, and
does not complete Task 3.

## First concrete startup blocker

Command, run from `C:/Temp/openglass-database-schema-v1`:

```text
node scripts/qa/local-disposable-supabase-replay.mjs --diagnostic-start-failure
npx.cmd exited 1
exit 1
```

The failure occurs during `initializeOwnedConfig`, before the runner reaches
`supabase-start-owned-root`. It runs `npx --no-install supabase init --yes
--workdir <owned temporary root>` with that temporary root as the child working
directory. CLI resolution from that directory requests an unavailable package:

```text
# Read-only command from C:/Users/1/AppData/Local/Temp
npx --no-install supabase --version
npm error npx canceled due to missing packages and no YES option: ["supabase@2.117.0"]
exit 1

# Same command from C:/Temp/openglass-database-schema-v1
npx --no-install supabase --version
2.115.0
exit 0
```

The repository's installed `node_modules/supabase/package.json` also reports
2.115.0. Read-only attempts using `--offline`, and exposing the repository's
`node_modules/.bin` in the temporary command's PATH, returned the same missing
2.117.0 package error. No package was installed or upgraded.

The established `--diagnostic-start-failure` mode was used. Because this failure
precedes service startup, its raw-stream capture and failure-receipt stages are
not reached; there is **no** `start-diagnostic.json` or `failure-receipt.json` for
this attempt. No raw startup log was printed or retained. Inspection of recent
owned replay/evidence temporary directories found none remaining after the run.
No migration was applied and no Supabase service startup was attempted.

## Additional replay regression evidence

```text
node scripts/qa/test-local-disposable-supabase-replay.mjs
tests 30
pass 21
fail 9
Canonical migration inventory differs from the deterministic 49-file manifest
exit 1
```

The replay builder's explicit ordered manifest has 49 entries and omits
`20260909195640_device_schema_v1_foundation.sql`; this branch has 50 migration
files. Nine mocked lifecycle tests therefore fail before reaching their intended
startup/fingerprint assertions. This is a separate blocker to full replay even
after CLI resolution is repaired. The manifest and its content-hash checks were
not weakened or bypassed.

The dry-run plan still confirms the intended owned temporary project, complete
mirror/ledger validation, exact owned database container, Unix-socket SQL, and
owned-project cleanup. Its `remoteConnections: 0` is a plan property, not proof
that real replay succeeded.

Unchanged schema regressions were checked without opening a database:

```text
node scripts/test-device-schema-v1-contract.mjs --foundation-only
DEVICE_SCHEMA_V1_SYNTHETIC_RED_OK count=34
DEVICE_SCHEMA_V1_FOUNDATION_SYNTHETIC_RED_OK count=3
DEVICE_SCHEMA_V1_FOUNDATION_OK
exit 0

node scripts/test-device-persistence.mjs
DEVICE_PERSISTENCE_FOUNDATION_AUDIT_OK
exit 0
```

## Required continuation

Bind the required runner's CLI invocation to the installed, reviewed local CLI
while keeping its owned `--workdir` and target checks. Extend the explicit mirror
inventory and hash contract for the additive Schema v1 migration, preserving
historical migration checks. Then execute all existing enforcement assertions
through the owned replay after the full migration ledger has been validated,
using synthetic data with the real legacy schema instead of recreating its
tables/functions. Record the actual run and cleanup evidence before marking
Task 3 complete. No successful full-chain enforcement result is claimed here.

This fix round changes evidence documentation only. Existing SQL, fixtures, and
89 enforcement assertions remain intact. No remote or Production database,
provider API, deployment, push, `qa:prod`, or subagent was used.

## Fix A/B continuation — 2026-09-12

The repository-local CLI binding and explicit migration-50 extension now pass
their focused checks. They remain **uncommitted**, because the required real
replay has not achieved overall GREEN and Task 3 enforcement is not yet proved
against replay-created objects.

- The runner reads the installed `node_modules/supabase/package.json`, requires
  version `2.115.0`, validates its declared Node bin entry and repository
  containment, and executes that absolute entry with `process.execPath`.
  Missing/invalid packages or bins fail closed. It clears the shim binary
  override and Node injection variables; it does not invoke npm/npx or select
  a PATH/global Supabase executable. Child cwd and `--workdir` stay owned.
- The explicit manifest now includes
  `20260909195640_device_schema_v1_foundation.sql` as migration 50, with canonical
  Git/LF SHA-256
  `7b5d4a09b76f780755e1f925b8a1517e9291e7f91409bdbcda60a6d3fa6e1849`.
  Its temporary replay version is `20260909000001`. Comparing the previous
  manifest with the working diff confirmed all 49 historical hash anchors and
  their order remain unchanged. No canonical migration was edited.
- Fix A RED was reconfirmed without changing the working implementation: the
  baseline module from Git HEAD generated `command: npx`, which failed the new
  absolute-Node spawn assertion. The actual outside-cwd installed CLI test then
  passed. Fix B RED failed with the exact historical `deterministic 49-file
  manifest` error before the manifest implementation changed.
- Lifecycle verification: `node scripts/qa/test-local-disposable-supabase-replay.mjs`
  passed **34/34**. Two stale fixtures were corrected: cleanup now expects the
  reviewed absolute CLI, and the synthetic stale fingerprint candidate has a
  count matching its own ledger. No production fingerprint validation was
  weakened.
- Mirror verification: `node scripts/test-local-supabase-replay-mirror.mjs`
  passed **8/8**, including a byte mutation for each of the 50 migrations,
  removal, unknown-file rejection, reviewed order, and dirty tracked-file
  rejection. `git diff --check` passed.

### Actual owned replay

The actual `runLocalDisposableReplay({ diagnosticStartFailure: true })` was run
with an observational execute wrapper that printed only CLI command/argument/cwd
metadata and delegated every operation unchanged to `runCommand`.

```text
LOCAL_SUPABASE_CLI_SOURCE=C:\Temp\openglass-database-schema-v1\node_modules\supabase\dist\supabase.js
LOCAL_SUPABASE_CLI_VERSION=2.115.0
CLI_EXECUTABLE=C:\Program Files\nodejs\node.exe
OWNED_PROJECT=ogl-replay-026df464
CHILD_CWD=C:\Users\1\AppData\Local\Temp\openglass-local-disposable-supabase-026df464-3TBmvk
WORKDIR=C:\Users\1\AppData\Local\Temp\openglass-local-disposable-supabase-026df464-3TBmvk
CANONICAL_MIGRATION_COUNT=50
REPLAY_MANIFEST_COUNT=50
REPLAY_SERVICE_STARTED=true
FULL_MIGRATION_CHAIN_APPLIED=true
MIGRATION_LEDGER_VALIDATION=PASS
TASK_3_DISPOSABLE_ASSERTIONS_TOTAL=0
TASK_3_DISPOSABLE_ASSERTIONS_PASS=0
TASK_3_DISPOSABLE_ASSERTIONS_FAIL=0
TASK_3_DISPOSABLE_ASSERTIONS_STATUS=NOT_RUN
REMOTE_CONNECTIONS=0
PRODUCTION_CONNECTIONS=0
OWNED_PROJECT_CLEANUP=PASS
OVERALL_REPLAY_EXIT=1
FAILING_STAGE=capture-schema-fingerprint
```

The CLI spawn sequence was Node plus the absolute bin above, followed by:
`init --yes --workdir <owned-root>`, `start --workdir <owned-root>`,
`status --output json --workdir <owned-root>`, and cleanup
`stop --no-backup --workdir <owned-root>`. The same owned root was the cwd for
all four. The database container was observed healthy. All 50 migrations were
then validated against the actual local ledger before fingerprint capture.

No startup failure is claimed: startup returned successfully. The observed
temporary vector restart did not prevent the runner reaching ledger/fingerprint
validation. No workaround or startup architecture change was attempted.

### Remaining fingerprint delta

The existing fingerprint gate correctly retained these nonsecret files:

```text
C:\Users\1\AppData\Local\Temp\openglass-local-disposable-supabase-evidence-026df464-4E45f6\fingerprint-candidate.json
C:\Users\1\AppData\Local\Temp\openglass-local-disposable-supabase-evidence-026df464-4E45f6\fingerprint-review.json
reviewId=aaedb2228ae1c5268a1044add72ecd6d13532104d4a3cdc7f34165bece29d288
```

Expected: 49 migrations / 1,247 objects. Actual: 50 migrations / 1,540 objects.
Shared ledger order matches, the sole new ledger entry is the approved Schema
v1 migration, 300 object identities were added, seven were missing, and zero
shared definitions diverged. The missing historical grants are:

- `enforce_device_slug_lock()` EXECUTE for anon, authenticated, service_role;
- `public.devices` INSERT/UPDATE/DELETE for anon, and DELETE for service_role.

These seven removals are not explained by the additive Release A SQL. The
committed fingerprint fixture was not rewritten or automatically approved.
One hypothesis for further read-only investigation is that the old fixture
captured implicit/default legacy grants that differ from the fresh local CLI
stack; this is not yet established as the cause.

After cleanup, exact project-filtered Docker container, volume, and network
inventories were empty, and the exact owned runtime directory was absent.
Only the intentional nonsecret evidence directory remains. The existing 89
native PostgreSQL assertions remain supplementary and were not rerun as an
acceptance substitute. The current replay runner still needs the Task 3
assertions connected to its validated owned database; no schema/functions were
manually recreated during this replay.

Task 3 remains incomplete. There was no commit, push, merge, deployment,
Production operation, or remote database operation in this continuation.

## Historical privilege forensic — 2026-09-12

This section supersedes the untested hypothesis above with a controlled causal
comparison. It is forensic evidence only. No fixture, migration, ACL, RLS,
approval logic, or enforcement harness was changed. The systematic-debugging
skill guided the statement/provenance trace; verification-before-completion
guided the final evidence and integrity checks.

```text
TASK_3_PRIVILEGE_FORENSIC=BLOCKED
TASK_3=BLOCKED
ROOT_CAUSE_CLASS=PREEXISTING_BASELINE_FINGERPRINT_DRIFT
AFTER_49_MIGRATION_COUNT=49
AFTER_50_MIGRATION_COUNT=50
SEVEN_PRIVILEGES_PRESENT_AFTER_49=0/7
SEVEN_PRIVILEGES_PRESENT_AFTER_50=0/7
RELEASE_A_CAUSED_PRIVILEGE_REMOVAL=false
ADDITIONS_TOTAL=300
ADDITIONS_EXPLAINED=300
UNEXPLAINED_ADDITIONS=0
FIX_PROPOSED=false
FINGERPRINT_FIXTURE_CHANGED=false
MIGRATION_CHANGED=false
GRANTS_CHANGED=false
RLS_CHANGED=false
REMOTE_CONNECTIONS=0
PRODUCTION_CONNECTIONS=0
PRODUCTION_WRITES=0
OWNED_PROJECT_CLEANUP=PASS
TASK_3_DISPOSABLE_ASSERTIONS=NOT_RUN
```

The causal experiment establishes the preexisting-baseline case, not a Release A
regression or a changed normalization rule. The forensic status remains BLOCKED
because the requested explanation of the original fixture's seven extra grants
cannot be completed from repository provenance: its original generating command,
raw ACL/default-ACL export, and bound PostgreSQL image/version are not recorded.
The missing provenance does not make the 49-to-50 causal result indeterminate.

### Baseline provenance

```text
FINGERPRINT_FIXTURE_PATH=C:\Temp\openglass-database-schema-v1\tests\fixtures\production-schema-expected-fingerprint.json
FINGERPRINT_GENERATOR_PATH=C:\Temp\openglass-database-schema-v1\scripts\generate-local-production-schema-fingerprint.mjs
FINGERPRINT_QUERY_PATH=C:\Temp\openglass-database-schema-v1\docs\ops\legal-consent-production-schema-fingerprint.sql
FINGERPRINT_NORMALIZER_PATH=C:\Temp\openglass-database-schema-v1\scripts\production-schema-fingerprint-core.mjs
BASELINE_FIXTURE_INTRODUCED_COMMIT=b55231490b1ab3478c9ccb880c92035a7a3e7669
BASELINE_FIXTURE_LAST_CHANGED_COMMIT=6ead84b3e80f6a87cd6d2f584d9e07500314cb9f
EXPECTED_MIGRATION_COUNT=49
SUPABASE_CLI_VERSION_IF_RECORDED=2.115.0 (package-lock.json; actual original invocation unknown)
POSTGRES_VERSION_IF_RECORDED=unknown (for this fixture's generation)
FINGERPRINT_BASELINE_PROVENANCE=6ead84b3e80f6a87cd6d2f584d9e07500314cb9f; declared LOCAL_DOCKER_ONLY; 49 ledger entries; 1247 objects; original generation method/runtime receipt unknown
```

The introduction commit, dated 2026-07-14, contains 43 ledger entries and 1,133
objects, with no devices/slug-lock grant identities. Commit
`4735a823a55cd80aa8a920094a93222ff4b61049` temporarily changed only the advertised
scope to 48 while retaining 43 ledger entries; commit
`cdf724889ff51a587d1210888a2ff531819e5bed` restored that advertised scope to 43.
The last fixture change, dated 2026-09-04, advances the actual ledger to 49 and
introduces all seven disputed identities. Its ledger explicitly contains
`20260904000001:forward_reconcile_security_privileges`, with 61 statements.
Therefore the recorded fixture scope is **after** the security migration. It
is not a fixture recorded as pre-security-migration data.

The repository supplies a local replay generator and an explicit reviewed
fixture-update command. The last-change commit says "refresh approved schema
fingerprint" and the artifact declares `generatedFrom=LOCAL_DOCKER_ONLY`.
Neither proves which command actually wrote that particular artifact. Manual
versus automated generation is **unknown**; a historical fixture-generation
defect or a specific old PostgreSQL/default-ACL environment is not asserted.
An unrelated PostgreSQL 17.6.1.143 reference elsewhere in operations documents
does not bind the fixture to that image and is not used as its version.

The generator, core, and SQL query are byte-identical Git blobs at that fixture
commit and current HEAD:

| File | Blob at both commits |
| --- | --- |
| `scripts/generate-local-production-schema-fingerprint.mjs` | `62dffa3b81c6f3bc4b9bf046c9c4447d9226c7af` |
| `scripts/production-schema-fingerprint-core.mjs` | `5979feef07c78374c2b2ce58d0ab8f2d63f73823` |
| `docs/ops/legal-consent-production-schema-fingerprint.sql` | `11a4e741967ea64791083d0bc4e27c981c04954c` |

The SQL has been unchanged since its introduction. At lines 138–156,
`table_grant` and `function_grant` enumerate
`aclexplode(coalesce(acl, acldefault(object_kind, owner)))`. These are distinct
grantee ACL identities. At lines 94–109, separate function rows report PUBLIC
ACL presence and each named role's `has_function_privilege` result. NULL
function ACL expands to owner and PUBLIC, not three synthetic role grants.
Whitespace normalization and the SHA-256 step cannot transform PUBLIC into a
named grantee. There is no old-versus-current ACL normalization-rule change.
The heuristic `sourceMigrations` annotations match names in source text; they
are not evidence that a matching migration actually granted a privilege.

### Complete historical SQL trace

All 49 canonical files (664 parsed statements) were scanned. The evidence file
`historical-statement-trace.json` retains the full text, position, and source
line for 52 selected statements. Two are incidental `devices` category literals
in migration 24's news table/seed, and two are the broad grants in migration 2;
the other 48 are every devices/slug-function statement in migrations 45–48.
There are zero historical `ALTER DEFAULT PRIVILEGES` statements and zero role
creation/alteration/membership statements. No historical statement drops the
target function, changes either target's owner, revokes either target, or
explicitly grants any of the seven disputed role/object privileges.

| Position and canonical migration | Complete relevant statement classification |
| --- | --- |
| 2 — `20260519_forum_phase2_grants.sql` | Statements 18–19, lines 26–27: broad existing-sequence USAGE/SELECT and existing-function EXECUTE grants to anon/authenticated. Both predate devices and its slug-lock function; neither is an ALTER DEFAULT PRIVILEGES operation. |
| 45 — `20260829_device_library_admin.sql` | Statement 1 / line 4 creates devices; 2–4 create three indexes; 5–6 replace its timestamp trigger; 7 / line 58 grants SELECT to anon/authenticated; 8 / line 59 grants INSERT/UPDATE/DELETE to authenticated; 9 / line 61 enables RLS; 10–19 drop/recreate five policies (public published SELECT, staff SELECT/INSERT/UPDATE/DELETE). |
| 46 — `20260829_device_slug_lock.sql` | Statement 1 / line 2 adds slug_locked; 2 / line 4 backfills published rows; 3 / line 8 first creates enforce_device_slug_lock(); 4–5 / lines 24–27 replace its trigger. No function grant. |
| 47 — `20260829054707_device_service_role_bootstrap_grants.sql` | Its sole statement / lines 3–5 grants devices SELECT/INSERT/UPDATE to service_role. No DELETE. |
| 48 — `20260902042807_forward_reconcile_devices.sql` | Statement 1 / line 3 validates prerequisites/shape; 2 / line 30 CREATE TABLE IF NOT EXISTS is a no-op for the existing table; 3–5 are existing-index no-ops; 6 enables RLS; 7–8 / lines 81–82 repeat SELECT and authenticated DML grants; 9–18 recreate the same five policies; 19 / line 110 CREATE OR REPLACE retains slug-function ownership/ACL; 20–23 replace timestamp and slug-lock triggers. |
| 49 — `20260904054013_forward_reconcile_security_privileges.sql` | 61 statements affecting other named objects. Neither devices nor enforce_device_slug_lock occurs. No defaults, target owner change, target grant, or target revoke. |

The per-identity ledger is explicit below. "No" is the result under the measured
current environment; the historical SQL alone does not revoke hypothetical
grants inherited from a different creation environment.

| PRIVILEGE_IDENTITY | FIRST_CREATED_BY | LAST_EXPLICIT_GRANT | LAST_EXPLICIT_REVOKE | EXPECTED_AFTER_MIGRATION_49 |
| --- | --- | --- | --- | --- |
| enforce_device_slug_lock() EXECUTE → anon | not found; absent on first creation at migration 46 statement 3 | none | none | no |
| enforce_device_slug_lock() EXECUTE → authenticated | not found; absent on first creation at migration 46 statement 3 | none | none | no |
| enforce_device_slug_lock() EXECUTE → service_role | not found; absent on first creation at migration 46 statement 3 | none | none | no |
| public.devices INSERT → anon | not found; absent on first creation at migration 45 statement 1 | none | none | no |
| public.devices UPDATE → anon | not found; absent on first creation at migration 45 statement 1 | none | none | no |
| public.devices DELETE → anon | not found; absent on first creation at migration 45 statement 1 | none | none | no |
| public.devices DELETE → service_role | not found; absent on first creation at migration 45 statement 1 | none | none | no |

PUBLIC function EXECUTE exists implicitly from creation at 46 and makes all
three roles' effective function privileges true. That is a separate identity
from the three missing direct grants and does not establish their existence.

### Same-stack experiment and raw ACLs

The repository-local CLI resolver, owned lifecycle/configuration, complete
50-file hash-checked mirror, actual fingerprint generator/query/normalizer,
normal ledger validator, and normal final fingerprint gate were used unchanged.
The observer withheld only owned temporary mirror files 45–50 before startup,
captured creation defaults after 44, then restored and applied each migration
45–50 sequentially with the supported `migration up --local --workdir <owned>`
command. Every intermediate ledger was checked against the corresponding prefix
of the actual mirror. Before the final application, the ledger was exactly 49;
only migration 50 was then pending. Canonical files were never moved or edited.
No alternative bootstrap, manual recreation, privilege amendment, assertion
bypass, or fixture approval was used.

```text
CLI_EXECUTABLE=C:\Program Files\nodejs\node.exe
CLI_ENTRY=C:\Temp\openglass-database-schema-v1\node_modules\supabase\dist\supabase.js
CLI_VERSION=2.115.0
OWNED_PROJECT=ogl-replay-93a74c10
OWNED_RUNTIME=C:\Users\1\AppData\Local\Temp\openglass-local-disposable-supabase-93a74c10-zTW7MH
OWNED_DB_CONTAINER=d312db7125fe
POSTGRES_VERSION=PostgreSQL 17.6 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit
POSTGRES_IMAGE=public.ecr.aws/supabase/postgres:17.6.1.159
POSTGRES_IMAGE_ID=sha256:86a2e078779e5bdccda1f6f6c5063aa9779a322d1fface5fb408d051909b230f
```

Catalog captures used a read-only transaction over that exact container's Unix
socket (`docker exec ... psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
-At`). The observer called the actual `generateLocalFingerprint` after 49 and
50. The unmodified generator advertises the **source manifest** count of 50 in
both files; its measured `localMigrationLedger.length` is respectively 49 and
50. No metadata was rewritten to disguise that distinction.

| Snapshot | Ledger validation | Target privilege observation |
| --- | --- | --- |
| 44 | PASS / 44 | Neither target exists; creation defaults captured before devices creation. |
| 45 | PASS / 45 | devices created without anon INSERT/UPDATE/DELETE or service_role DELETE. |
| 46 | PASS / 46 | Slug-lock function created with proacl NULL; no direct anon/authenticated/service_role grant. |
| 47 | PASS / 47 | service_role SELECT/INSERT/UPDATE added; its DELETE remains absent. |
| 48 | PASS / 48 | Target ACLs unchanged by forward reconciliation. |
| 49 | PASS / 49 | Target ACLs unchanged; fingerprint 1,240 objects. |
| 50 | PASS / 50 | Target ACLs unchanged; fingerprint 1,540 objects; 47 Release A statements recorded. |

```text
FUNCTION_ACL_AFTER_49=owner postgres; oid 19637; proacl NULL; acldefault yields postgres EXECUTE and PUBLIC EXECUTE; direct anon/authenticated/service_role EXECUTE absent; effective EXECUTE true for all three
FUNCTION_ACL_AFTER_50=identical to after49, including oid, owner, proacl, definition, expanded ACL, and effective privileges
DEVICES_ACL_AFTER_49=owner postgres; oid 19596; relacl {postgres=arwdDxtm/postgres,anon=rDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwDxtm/postgres}; RLS enabled, not forced
DEVICES_ACL_AFTER_50=identical to after49, including oid, owner, relacl, RLS state, raw expanded ACL, information_schema privileges, and effective privileges
```

For devices, `a/r/w/d/D/x/t/m` mean INSERT/SELECT/UPDATE/DELETE/TRUNCATE/
REFERENCES/TRIGGER/MAINTAIN. The four disputed DML privileges are false in
`has_table_privilege` as well as absent from ACL expansion. The corresponding
`information_schema.table_privileges` capture agrees. Authenticated has all
eight table privileges; anon has SELECT plus D/x/t/m; service_role has
SELECT/INSERT/UPDATE plus D/x/t/m. All expanded rows are non-grantable.

The pre-creation and after-49 snapshots contain these postgres-owned public
creation defaults:

```text
tables:    {postgres=arwdDxtm/postgres,anon=Dxtm/postgres,authenticated=Dxtm/postgres,service_role=Dxtm/postgres}
functions: {postgres=X/postgres} (schema-specific; no global default ACL override)
sequences: {postgres=rwU/postgres,anon=w/postgres,authenticated=w/postgres,service_role=w/postgres}
```

There is no default direct role EXECUTE or DML grant to generate any of the
seven identities. The schema-specific function default does not remove
PostgreSQL's global PUBLIC EXECUTE default. Merging it with the built-in default
produces the built-in function ACL, which PostgreSQL stores as NULL. The table
default generates only four non-DML privileges per application role; historical
explicit SELECT/authenticated DML/service-role bootstrap grants then yield the
observed devices ACL.

Role snapshots show anon/authenticated/service_role are not superusers and have
no membership in a role supplying these missing DML rights. service_role's RLS
bypass does not supply table DELETE. Their function EXECUTE is supplied by
PUBLIC. All memberships were captured, rather than assuming inheritance.

The exact comparison is:

| Comparison | Added identities | Missing identities | Shared-definition changes |
| --- | ---: | ---: | ---: |
| committed baseline → after 49 | 0 | 7 | 0 |
| after 49 → after 50 | 300 | 0 | 0 |
| committed baseline → after 50 | 300 | 7 | 0 |

### Release A statement and dependency proof

`release-a-statement-trace.json` contains all 47 statements with their source
lines, full SQL, and effect on each target ACL. Their complete grouping is:

| Statements | Operation | Effect on target ACLs |
| --- | --- | --- |
| 1–7 | Seven new enums | No target mutation. |
| 8–14 | Seven ADD COLUMN operations on existing devices | Same table OID/owner/ACL; nullable columns have no function-executing defaults. |
| 15–20 | Six new tables, checks, primary/unique keys, foreign keys | New objects; REFERENCES does not alter a referenced table's ACL. |
| 21–28 | Eight explicit indexes on new tables | No target ACL operation. |
| 29–34 | Enable RLS on those six new tables | No existing devices RLS/ACL mutation. |
| 35, 37, 39, 41, 43, 46 | Six CREATE OR REPLACE FUNCTION statements | Each is a new, differently named function absent after49; none replaces enforce_device_slug_lock. Function bodies are installed, not invoked. |
| 36, 38, 40, 42, 44, 45, 47 | Seven new triggers, including two constraint triggers | No old trigger/function replacement; creation does not execute their DML bodies. |

There is no DROP, target function recreation, ALTER OWNER, schema recreation,
GRANT, REVOKE, default-privilege change, SECURITY DEFINER replacement, or extension
DDL in migration 50. The current event-trigger definitions were also captured:
the pg_cron/pg_graphql/pg_net hooks require CREATE EXTENSION; the placeholder
requires DROP EXTENSION; the general PostgREST DDL/drop hooks only send schema
reload notifications. None can reset these ACLs for this migration. The same
target OIDs and equal raw ACLs before/after support the statement trace directly.

PostgreSQL documents that CREATE OR REPLACE FUNCTION retains existing ownership
and permissions, and that default privileges act at creation, with per-schema
defaults added to global defaults. These semantics support the historical
replacement/default analysis, not an assumption that the word "additive"
precludes effects: [CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html),
[ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html),
[privilege inquiry functions](https://www.postgresql.org/docs/17/functions-info.html).

### All 300 additions accounted for

`additions-300-accounting.json` assigns every exact added identity its category,
source migration, statement number, source line, normalized definition/hash,
and explicit creation/dependency mechanism. Counts are mutually exclusive:

| Category | Count | Complete explanation |
| --- | ---: | --- |
| New enum/type | 7 | Seven declared enums. |
| New table / RLS state | 6 | Six new relations; the fingerprint represents a table by its RLS-state row. Their six RLS states are counted here, not again. |
| New column | 75 | Seven added devices columns plus 68 columns on six new tables. Default/generated expressions are included in these rows. |
| New function/trigger | 37 | Six function-definition rows, 24 effective function-ACL rows (four roles each), seven trigger rows. |
| New index | 19 | Eight explicit indexes plus 11 automatic primary/unique backing indexes. |
| New sequence / standalone default | 0 | UUID defaults use existing gen_random_uuid; no sequence is created. |
| New policy / additional RLS identity | 0 | No policies; six RLS rows are included with tables above. |
| New privilege/grant | 132 | 12 function rows (owner/PUBLIC for each new function) plus 120 table rows (20 creation-default grants for each new table). |
| Other: constraints | 24 | Six primary keys, five unique constraints, eight foreign keys, three checks, and two automatic pg_constraint companions of constraint triggers. |
| **Total** | **300** | **300 explained, zero unexplained.** |

The 20 table-grant rows per table are eight owner privileges plus four privileges
(TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) for each of anon/authenticated/service_role.
These are measured current default dependencies of table creation, not explicit
GRANT statements in Release A. The 12 new function-grant rows are PostgreSQL's
owner/PUBLIC default, not direct application-role grants. Explanation of these
additions is not an ACL/RLS approval or completion of Task 4.

### Root cause and remaining provenance limit

ROOT_CAUSE: The committed post-49 fixture contains seven direct ACL identities
which the current controlled replay never creates: four devices DML grants are
already absent at migration 45 creation, and three direct slug-lock EXECUTE
grants are already absent at migration 46 creation. The captured creation
defaults explain their absence, and the actual historical SQL never grants
them. All seven remain absent after 49 and after 50; the function's separate
PUBLIC/effective execution contract remains true. Migration 50 causes no
historical privilege removal and the unchanged fingerprint query represents
the current ACLs correctly. Thus the fixture is stale relative to this measured
replay. Repository history proves where the seven expectations entered the
fixture (6ead84b3) but does not prove the original runtime/default-ACL state or
whether its refresh was assembled manually; assigning a particular old image,
environment change, or generation defect would exceed the evidence.

This selects PREEXISTING_BASELINE_FINGERPRINT_DRIFT only. It does not select
FINGERPRINT_NORMALIZATION_DRIFT merely because PUBLIC still gives effective
function access: the missing objects are distinct direct grants under the
unchanged query. The historical provenance gap is retained as a blocker; no fix
is proposed and no fixture update is authorized by this report.

### Evidence paths, gate result, and cleanup

All forensic evidence below is under this exact nonsecret evidence directory:

```text
C:\Users\1\AppData\Local\Temp\openglass-task3-privilege-forensic-93a74c10-7aynWJ
  baseline-provenance.json
  historical-statement-trace.json
  release-a-statement-trace.json
  raw-acl-query.sql
  raw-acl-after-44.json
  raw-acl-after-45.json
  raw-acl-after-46.json
  raw-acl-after-47.json
  raw-acl-after-48.json
  raw-acl-after-49.json
  raw-acl-after-50.json
  fingerprint-after-49.json
  fingerprint-after-50.json
  three-way-fingerprint-review.json
  additions-300-accounting.json
  migration-mapping.json
  runtime-identity.json
  protected-files-before.json
  cleanup-and-integrity.json
```

The normal final fingerprint gate was allowed to fail and retain its ordinary
candidate/review; it was neither skipped nor approved:

```text
C:\Users\1\AppData\Local\Temp\openglass-local-disposable-supabase-evidence-93a74c10-Ajwgzb\fingerprint-candidate.json
C:\Users\1\AppData\Local\Temp\openglass-local-disposable-supabase-evidence-93a74c10-Ajwgzb\fingerprint-review.json
reviewId=aaedb2228ae1c5268a1044add72ecd6d13532104d4a3cdc7f34165bece29d288
```

The observer's process exited 0 after collecting the expected gate failure and
verifying its cleanup; this is not a passing enforcement or fingerprint gate.
Owned `stop --no-backup` completed. The exact runtime path was absent, and Docker
container/volume/network inventories contained zero matches for
`ogl-replay-93a74c10`. SHA-256 before/after comparisons confirmed the four existing
uncommitted replay A/B files, the baseline fixture, and Release A migration were
unchanged. The historical migration hashes remain unchanged. No new repository
code file, commit, push, merge, deployment, remote connection, or Production
operation was performed.

Run summary: one owned CLI 2.115.0 / PostgreSQL 17.6 Supabase stack; seven ledger
snapshots 44–50 PASS; 49→50 +300/-0/0 divergent; normal fingerprint gate BLOCKED;
Task 3 enforcement NOT RUN; owned cleanup PASS.

## Canonical 49-migration rebaseline — 2026-09-12

The baseline contract was confirmed from repository code: the committed
fingerprint fixture is the reviewed expected output of a local disposable
Supabase replay and fingerprint generator. It is not recorded as an immutable
Production snapshot, provider export, or hand-curated security-policy document.

The historical baseline was regenerated from exactly the canonical first 49
migrations using the repository-owned Supabase CLI 2.115.0 path and the existing
fingerprint generator/normalizer. Migration 50 was not applied to the baseline
candidate and was not absorbed into the fixture.

```text
FINGERPRINT_BASELINE_SOURCE=CANONICAL_MIGRATIONS_1_TO_49
BASELINE_MIGRATION_COUNT=49
BASELINE_OBJECT_COUNT=1240
BASELINE_REVIEW_ID=f50caf4dea9308792b1b546aa040ef036bb546936e85ee5c04d0bc7d35bb3d27
BASELINE_PROVENANCE_REVIEW_ID=9e9e4a8d76ef76531fd69760f4155ddddf2425a434006764793db5009e9c2dc6
BASELINE_OUTSIDE_LEDGER_PROVENANCE=0
STALE_BASELINE_IDENTITIES_REMOVED=7
BASELINE_ADDITIONS=0
BASELINE_DEFINITION_CHANGES=0
GRANTS_ADDED_TO_DATABASE=0
RELEASE_A_MIGRATION_CHANGED_FOR_PRIVILEGES=false
REMOTE_CONNECTIONS=0
PRODUCTION_CONNECTIONS=0
```

The removed stale identities are the seven direct grants proven absent before
and after Release A:

- `enforce_device_slug_lock()` EXECUTE for anon, authenticated, and service_role.
- `public.devices` INSERT, UPDATE, and DELETE for anon.
- `public.devices` DELETE for service_role.

No historical migration, Release A migration, grant, revoke, RLS policy, or
normalization rule was changed to manufacture those privileges. Future
maintainers should treat this fixture as the reproducible canonical 49-migration
baseline for Release A delta review.
