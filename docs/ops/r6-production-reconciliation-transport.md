# R6 Dedicated Production Reconciliation Transport

`scripts/qa/r6-production-reconciliation-transport.mjs` is the only execution core for the forward-only reconciliation package. It is intentionally separate from the Cloudflare and QA canary transport.

The transport accepts an immutable v2 candidate authorization and a package containing the three named materialized artifacts. A candidate is always `AWAITING_FINAL_HUMAN_CONFIRMATION` with `executionEligible: false`; it is never executable by itself. The exact confirmation phrase is accepted only by `FinalizeHumanConfirmation`, which creates one immutable `qa-production-reconciliation-final-human-confirmation-v1` artifact bound to that candidate's raw SHA-256 and every execution-relevant package and transport hash.

The state machine is `PRECHECK_READY -> TARGET_VERIFIED -> ATTEMPT_RESERVED -> SQL_SUBMITTED -> COMMITTED -> POSTFLIGHT_COMPLETE`. Before `SQL_SUBMITTED`, the authorization has not been consumed. At `SQL_SUBMITTED`, an exclusive durable receipt is already present and the attempt is permanently consumed. A failed client result after submission is `COMMIT_STATE_UNKNOWN` unless rollback has been independently confirmed.

The native client is `psql` with `-X` and `-v ON_ERROR_STOP=1`. Credentials are taken only from the `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` environment variables. Connection strings are rejected. The migration is sent from the retained canonical byte buffer inside one explicit transaction; the postflight packet is sent once only after a committed migration and is written as CSV beside the receipt.

`ValidateOnly` validates a candidate and package without opening a SQL client connection or consuming an attempt. `FinalizeHumanConfirmation` validates the candidate and package, verifies the byte-exact phrase without trimming or normalization, and creates no receipt. `Execute` requires the immutable candidate plus its separately materialized final-confirmation artifact. The `NO_SQL_CLIENT_BEFORE_FINAL_EXECUTION_BINDING_READY` invariant requires candidate/final/package validation and receipt replay eligibility to finish before the SQL client factory is invoked; only then can the transport read secure connection variables or probe a target. Existing v1 authorization artifacts fail with `R6_PRODUCTION_RECONCILIATION_AUTHORIZATION_TRANSPORT_VERSION_MISMATCH`.

The dedicated launcher defaults to `ValidateOnly`. `Execute` is an explicit mode and never prompts for, accepts, or forwards a raw confirmation phrase.
