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
6. Capture the local fingerprint as an owned temporary candidate and write a
   structured migration/object identity review beside it. A mismatch cannot
   overwrite the committed fixture. Updating that fixture requires the
   explicit `npm run update:production-schema-fingerprint-fixture --
   --candidate <path> --review <path> --confirm-review-id <sha256>` workflow.
7. Stop only that project with `supabase stop --no-backup` even when `start`
   fails part way through, and remove only the verified temporary root.

Use `node scripts/qa/local-disposable-supabase-replay.mjs --dry-run` to inspect
the lifecycle contract without starting Docker, creating a temp project, or
opening any database connection.

The harness rejects `--linked`, `--db-url`, `--project-ref`, and all other
arguments. It does not call `supabase link`, `supabase db push`, remote SQL, or
any provider API.
