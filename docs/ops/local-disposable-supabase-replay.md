# Local Disposable Supabase Replay

`npm run test:production-schema-fingerprint` creates a new temporary Supabase
project for each run. It never uses the repository `supabase/` directory as a
local project and never uses a linked Supabase project.

The harness performs the following local-only sequence:

1. Reject inherited `POSTGRES_URL`, `DATABASE_URL`, `PGHOST`, `PGPORT`, and
   `PGSERVICE`, plus remote DSNs and linked-project variables, then clear them
   from every child process. Error messages name only the variable, never its
   value.
2. Create an owned temporary root, generate a fresh Supabase configuration, and
   assign a run-specific project ID and local port bundle.
3. Build the reviewed 48-file deterministic replay mirror and its mapping into
   that temporary root.
4. Start local Supabase with `--workdir` set to that root; its reported API
   target must be `localhost`, `127.0.0.1`, or `::1`.
5. Bind the database operation to the newly created, exact
   `supabase_db_<run-project-id>` container, validate the complete migration
   ledger and order, then run the catalog fingerprint through
   `docker exec … psql`. No DSN is supplied to `psql`, so it uses the database
   container's Unix socket.
6. Capture the local fingerprint and structured migration/object identity review
   in a separate designated temporary evidence directory. On a verified review
   mismatch only, the nonsecret candidate and review remain there after the
   disposable runtime is removed; the failure output hands off both paths and
   the review ID. Success and malformed/secret-like evidence remove that
   directory. A mismatch cannot overwrite the committed fixture. Updating that
   fixture requires the explicit `npm run update:production-schema-fingerprint-fixture --
   --candidate <path> --review <path> --confirm-review-id <sha256>` workflow.
   If a runtime failure occurs before candidate capture (start, status,
   owned-container, or migration-ledger validation), cleanup leaves instead one
   owned temporary `failure-receipt.json`. Its strict schema contains only the
   run ID, first failure stage and class, an exit code or sanitized code, a
   closed start diagnostic enum, and cleanup status. Start failures are
   transiently classified as `UNKNOWN`, `CONFIG_INVALID`, `PORT_CONFLICT`,
   `DOCKER_UNAVAILABLE`, `SERVICE_HEALTH_FAILED`, or
   `VECTOR_HOST_NETWORK_UNREACHABLE`; all other stages are `NOT_APPLICABLE`.
   It never includes command output, DSNs, container names, usernames, or
   secret values. A cleanup failure after a matching capture also
   removes the candidate and review, retaining only that receipt; candidate and
   review retention is reserved for a verified fingerprint mismatch.
   The normal mode remains enum-only. An operator may opt into
   `--diagnostic-start-failure` for a failed local start: stdout and stderr are
   first written only to two fixed raw files inside the owned disposable runtime
   root, then deleted. A failure may retain one separate
   `start-diagnostic.json` alongside the receipt, containing only its closed
   classification (including `UNKNOWN`) and first redacted fatal context.
   URI userinfo, DSNs, passwords, tokens, JWTs, Bearer/auth headers,
   `DATABASE_URL`, Supabase secret/ref values, and Cloudflare token values are
   fail-closed redacted before that file is written. Raw streams are never
   printed, committed, or retained after the run.
7. Stop only that project with `supabase stop --no-backup` even when `start`
   fails part way through, and remove only the verified temporary root.

Use `node scripts/qa/local-disposable-supabase-replay.mjs --dry-run` to inspect
the lifecycle contract without starting Docker, creating a temp project, or
opening any database connection.

## A2 startup-only validation

`node scripts/qa/local-disposable-supabase-replay.mjs --startup-only` is the
bounded A2 check. It retains the same temporary-root ownership, inherited
connection-variable rejection, run-specific configuration, local `status` API
target check, exact newly-created database-container check, and stop/remove
cleanup. It also queries that owned database over its Unix socket to require an
empty `supabase_migrations.schema_migrations` ledger, proving this is a fresh
instance before A3 performs the full replay.

Startup-only deliberately does not build the migration mirror, apply/replay a
migration, calculate a fingerprint, or retain/read raw startup diagnostic
streams. `--startup-only --diagnostic-start-failure` is rejected. Use
`node scripts/qa/local-disposable-supabase-replay.mjs --dry-run --startup-only`
to inspect that narrower command plan without starting Docker.

The harness rejects `--linked`, `--db-url`, `--project-ref`, and all other
arguments. It does not call `supabase link`, `supabase db push`, remote SQL, or
any provider API.
