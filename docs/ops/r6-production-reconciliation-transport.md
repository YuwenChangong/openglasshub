# R6 Dedicated Production Reconciliation Transport

`scripts/qa/r6-production-reconciliation-transport.mjs` is the only execution core for the forward-only reconciliation package. It is intentionally separate from the Cloudflare and QA canary transport.

The transport accepts only a v2 authorization, a package containing the three named materialized artifacts, and an exact confirmation phrase supplied through the dedicated PowerShell launcher. It does not accept a SQL path, a migration name, a connection string argument, or a general command.

The state machine is `PRECHECK_READY -> TARGET_VERIFIED -> ATTEMPT_RESERVED -> SQL_SUBMITTED -> COMMITTED -> POSTFLIGHT_COMPLETE`. Before `SQL_SUBMITTED`, the authorization has not been consumed. At `SQL_SUBMITTED`, an exclusive durable receipt is already present and the attempt is permanently consumed. A failed client result after submission is `COMMIT_STATE_UNKNOWN` unless rollback has been independently confirmed.

The native client is `psql` with `-X` and `-v ON_ERROR_STOP=1`. Credentials are taken only from the `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` environment variables. Connection strings are rejected. The migration is sent from the retained canonical byte buffer inside one explicit transaction; the postflight packet is sent once only after a committed migration and is written as CSV beside the receipt.

`ValidateOnly` validates the authorization, phrase, package hashes, postflight read-only form, and receipt eligibility without opening a SQL client connection or consuming an attempt. Existing v1 authorization artifacts fail with `R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_TRANSPORT_VERSION_MISMATCH`.
