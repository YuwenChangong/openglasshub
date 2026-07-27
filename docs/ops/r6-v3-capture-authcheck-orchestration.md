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
