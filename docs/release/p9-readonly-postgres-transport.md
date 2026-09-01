# P9 dedicated PostgreSQL read-only capture transport

The consumed P9 management-API batch request returned `rows=[]` and did not preserve session proof or individual result sets. Its terminal classification is `TRANSPORT_RESULT_PRESERVATION_FAILURE`; it is not a valid capture transport and is not reused.

`scripts/qa/p9-readonly-postgres-transport.mjs` is the future capture core. It reads a future production connection string only from `P9_PRODUCTION_DATABASE_URL`, validates the exact direct hostname `db.xcbnxzjlsvtgzixurcof.supabase.co` before spawning `psql`, and derives libpq connection variables in memory. No connection URI, password, or credential-bearing argument is supplied to `psql`.

The core verifies the frozen P8 packet hash `5AC18441DBD61A36DB88300F333A40752173E224BFA9247AF28AA55E3B97E0A7`, derives four stable query IDs, starts `BEGIN READ ONLY`, observes `transaction_read_only`, database identity and a backend PID, frames each result set with a random per-run protocol nonce, and explicitly rolls back. Evidence retains zero-row queries as completed empty result sets and redacts credential-shaped values before persistence.

`scripts/qa/p9-readonly-postgres-local.mjs` creates a fresh, owned local Supabase runtime outside the repository. It uses the existing migration mirror to preserve historical migration bytes while eliminating duplicate local migration versions. Its local proof requires one psql process, read-only `on`, backend PID correlation, four captured P8 blocks, explicit rollback, connection closure, and a separately prepared local fixture whose insert is rejected inside the read-only transaction. The runner always reports production connection, SQL, mutation, DDL, DML, and deployment counters as zero.

Future P9-CAPTURE-2 work requires the credential category `PRODUCTION_POSTGRESQL_CONNECTION_CREDENTIAL`. This preparation does not acquire or use that credential.
