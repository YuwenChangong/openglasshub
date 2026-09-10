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
