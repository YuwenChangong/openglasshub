# R6 V3 Capture And AuthCheck Orchestration

`-PrepareCurrentCanonicalProductionV3AndAuthCheckOnly` is the operator-facing
single-command mode for the R6 V3 metadata capture followed immediately by
`AuthCheckOnly`. It exists because the capture attestation has a short validity
window and manually copying the emitted downstream command can consume that
window before authenticated verification begins.

## Windows hidden-input transport

Some Windows PowerShell hosts do not expose an inherited Node.js stdin as a
TTY. The V3 wrapper first performs the existing local OAuth readiness check,
then requests the account ID once with PowerShell `Read-Host -AsSecureString`.
It starts the reviewed Node capture through a restricted `ProcessStartInfo`
transport and writes only the exact lower-case 32-character account ID plus a
newline to redirected stdin. The value is never supplied in arguments, an
environment variable, a file, evidence, or captured output.

The Node capture accepts that input only with the explicit
`--account-input-mode wrapper-stdin` contract. It rejects TTY input, malformed
input, multiple lines, and oversized input. OAuth failure occurs before any
account prompt; account-input failure occurs before a Pages request.

The mode must be started by an operator in a real interactive Windows
PowerShell host. It preserves the capture runner's real stdin, stdout, and
stderr, so the Cloudflare Account ID remains a local hidden prompt. Account IDs,
tokens, passwords, sessions, cookies, and raw provider responses are never
accepted as command arguments or written to the orchestration terminal.

The mode uses structured evidence, never console command parsing:

1. Run exactly one V3 Capture with `wrapper-buffered` final output.
2. Validate the exact capture terminal and its parent evidence binding.
3. Validate the exact attestation path and SHA-256 from that terminal.
4. Recalculate UTC freshness using `DateTimeOffset`; at least 720000 ms is
   required immediately before `AuthCheckOnly` starts.
5. Invoke the existing `AuthCheckOnly` path internally with `<parent>\auth-check`.
6. Write `capture-auth-check-orchestration-terminal-result.json`.

## Auth Password-Grant Diagnostics

AuthCheckOnly uses the Production password-grant endpoint only after the
captured attestation, endpoint binding, project reference, and hidden-input
contracts pass. The terminal is value-blind: it never records the endpoint,
email, password, anon key, account ID, request body, response body, provider
message, token, refresh token, cookie, session, or stack trace.

The v2 Auth terminal records only the request lifecycle booleans, a bounded
network/TLS enum, an optional integer HTTP status, and a provider error-code
class from a fixed allowlist. `authenticationAttempted` means the password grant
was handed to the HTTP client; `requestDispatched` means `Invoke-RestMethod` was
entered. An endpoint or project-configuration failure therefore leaves both
false. Every password-grant request has a fixed 20 second timeout and keeps
normal certificate validation. It never downgrades TLS or installs a permissive
certificate callback.

The current value-blind classifications are:

| Failure family | Inner classification |
| --- | --- |
| DNS/name resolution | `R6_AUTH_DNS_RESOLUTION_FAILED` |
| TCP connection | `R6_AUTH_CONNECTION_FAILED` |
| Timeout | `R6_AUTH_CONNECTION_TIMEOUT` |
| TLS/certificate/secure channel | `R6_AUTH_TLS_NEGOTIATION_FAILED` |
| HTTP 400, 401, 403, 404, 429, 5xx, other | `R6_AUTH_HTTP_BAD_REQUEST`, `R6_AUTH_HTTP_UNAUTHORIZED`, `R6_AUTH_HTTP_FORBIDDEN`, `R6_AUTH_HTTP_NOT_FOUND`, `R6_AUTH_HTTP_RATE_LIMITED`, `R6_AUTH_HTTP_SERVER_ERROR`, `R6_AUTH_HTTP_OTHER_REJECTION` |
| Successful HTTP response with invalid session shape | `R6_AUTH_RESPONSE_MALFORMED` |
| Local endpoint or project configuration | `R6_AUTH_ENDPOINT_BINDING_INVALID`, `R6_AUTH_PROJECT_CONFIGURATION_INVALID` |
| Any unclassified failure | `R6_AUTH_UNEXPECTED_FAILURE` |

When an HTTP error carries JSON in PowerShell's error details, the implementation
parses at most 4096 characters and retains only one allowlisted code class:
`invalid_grant`, `invalid_credentials`, `email_not_confirmed`, `user_not_found`,
`rate_limit`, `provider_rejection_other`, or `not_observed`. It does not write
the body or message to evidence. An HTTP response is always classified by its
status first; a 401 cannot be recorded as a network failure.

The historic terminal with `R6_AUTH_NETWORK_OR_REJECTED` is immutable and still
accepted by the validator as a v1 record. Its exact cause is **not recoverable
from immutable evidence**: it proves only that the password-grant stage raised a
network-or-rejection exception before authentication completed. New v2 terminals
must not emit that legacy classification.

An Auth failure is terminal for the three-stage mode. The orchestration terminal
retains successful Capture state and copies the exact `AUTH_PASSWORD_GRANT_*`
stage and inner classification. It does not create a DryRun evidence directory,
receipt, registry entry, journal, canary child, Supabase write, or Production
mutation. A later live attempt always requires a new approval, attestation, run
ID, parent evidence root, and child roots.

The mode never starts or creates `dry-run`, never exposes a downstream command,
and never retries either phase. Capture failure, missing or malformed evidence,
attestation mismatch, insufficient freshness, or AuthCheck failure all stop the
workflow and leave a value-blind orchestration terminal. The mode does not
authorize `DryRunOnly`, `ExecuteApprovedPhase`, Supabase writes, or production
mutations.

## Capture, AuthCheck, And DryRun

`-PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly` is the extended
single-command mode. It accepts an operator-approved `qa-canary-*` run ID and
uses the exact parent evidence root with two fixed children: `auth-check` and
`dry-run`. It never prints or parses downstream command text.

The wrapper performs Capture once, validates its structured terminal and
attestation binding, recomputes UTC freshness, runs `AuthCheckOnly`, validates
the AuthCheck terminal, recomputes UTC freshness again, and finally invokes the
existing protected `DryRunOnly` path. The DryRun terminal records a planned
scope of one post plus one comment (`plannedMutationCount = 2`) and an actual
mutation count of zero. The normal dry-run runner exits before adapter creation;
no migration, deployment, or `ExecuteApprovedPhase` path is reachable.

Both downstream gates use the existing 720000 ms minimum validity contract.
This is deliberately not weakened: the capture attestation has a 15-minute TTL,
and keeping twelve minutes at each start leaves the operator no unsafe
best-effort continuation if authentication or evidence finalization consumes the
remaining window.

The only Account ID transport remains `Read-Host -AsSecureString` followed by a
single in-memory stdin line. It is never an argument, environment variable,
terminal value, evidence value, or transcript value. Auth and DryRun prompts
also stay hidden and short-lived. Any failure writes a value-blind terminal,
does not retry, and prevents every later stage.

The successful terminal classification is
`R6_CURRENT_CANONICAL_V3_CAPTURE_AUTH_CHECK_AND_DRY_RUN_READY`. It proves
pre-execution readiness only. `ExecuteApprovedPhase` remains separately
approval-gated.

After the operator command returns, only hash and path summaries from the
capture parent evidence root should be reported. Do not copy an Account ID,
OAuth callback, token, password, session, raw terminal JSON, attestation body,
or transcript into chat.
# Receipt Commit Binding

The DryRun receipt field is `runnerCommit`. Its only canonical source is the
already validated `ExecutionWorktree` HEAD. The wrapper rereads that worktree's
HEAD immediately before reservation and fails closed if it differs from the
validated value. It then binds the same full lowercase SHA to both the receipt
and `QA_EXPECTED_RUNNER_COMMIT` passed to `run-production-minimal-canary.mjs`.

The canary runner independently reads its own execution-worktree HEAD and
continues to reject any receipt mismatch with
`QA_CANARY_CONSUMED_RUN_RECEIPT_BINDING_MISMATCH`. A historical mismatch using
`1d558a54d07a9f425b98e9bcab501b4e644b7ef6` is retained only as a negative
test example, never as an approved V3 binding.

Receipts are immutable once created. A failed `PENDING` receipt, its Run ID,
attestation, commands, and evidence root must not be repaired or reused. A new
attempt requires a new Run ID, a new attestation, a new evidence root, and a
fresh explicit approval.

## DryRun Reservation Lifecycle

A fresh, unregistered Run ID is the normal starting state. The wrapper first
performs registry lookup and journal-absence checks; the reservation helper then
atomically records the Run ID and creates the immutable `PENDING` receipt. The
minimal canary starts only after that receipt is returned and bound to the same
validated execution-worktree commit.

Any live wrapper start consumes its human approval and Run ID even when failure
occurs before a receipt exists. A missing receipt is not permission to retry,
pre-register, repair, or reuse the Run ID. A reservation failure before receipt
return leaves the canary child, adapter, journal, Supabase writes, and
production mutations at zero.

DryRun preserves the value-blind code emitted by the registry/reservation
helper. `RUN_ID_FORMAT_VALIDATION`, `RUN_ID_REGISTRY_LOOKUP`,
`RUN_ID_RESERVATION`, `RECEIPT_BINDING_VALIDATION`, and
`MINIMAL_CANARY_CHILD_LAUNCH` are distinct terminal stages. An unclassified
DryRun exception is `R6_CURRENT_CANONICAL_V3_DRY_RUN_UNEXPECTED_FAILURE`; it
must never be reported through an AuthCheck fallback classification.

The three-stage terminal retains Capture and AuthCheck success when a later
DryRun fails, including authentication completion, session validation, and the
authenticated check. It inherits the DryRun's inner classification and exact
stage without overwriting the earlier outcomes.

## Freshness Audit Semantics

The live Capture validator deliberately requires the attestation to remain
fresh at validation time. A later validation after the 15-minute window rejects
the terminal by design; that does not reinterpret a successful Capture as a
failure. Historical review reads the immutable terminal's recorded issue,
expiry, validation-time remaining validity, and freshness result without
relaxing the live gate or authorizing reuse of an expired attestation.
