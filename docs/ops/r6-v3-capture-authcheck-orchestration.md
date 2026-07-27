# R6 V3 Capture And AuthCheck Orchestration

`-PrepareCurrentCanonicalProductionV3AndAuthCheckOnly` is the operator-facing
single-command mode for the R6 V3 metadata capture followed immediately by
`AuthCheckOnly`. It exists because the capture attestation has a short validity
window and manually copying the emitted downstream command can consume that
window before authenticated verification begins.

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

After the operator command returns, only hash and path summaries from the
capture parent evidence root should be reported. Do not copy an Account ID,
OAuth callback, token, password, session, raw terminal JSON, attestation body,
or transcript into chat.
