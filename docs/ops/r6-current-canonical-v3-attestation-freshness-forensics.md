# R6 Current Canonical V3 Attestation Freshness Forensics

## Downstream Wrapper Contract

The repository source of truth for the external secure wrapper is
`scripts/qa/r6-detached-secure-wrapper.ps1`. The external copy is rebound only
after this source and its offline PowerShell fixtures pass.

V3 capture uses the V3 detached-worktree contract. V3-generated
`AuthCheckOnly` and `DryRunOnly` invocations use that same contract only when
their evidence roots are the fresh `auth-check` or `dry-run` child of a V3
capture parent. They must also match the capture terminal's attestation path
and SHA-256. Legacy modes continue to use the legacy detached-worktree
contract.

`AuthCheckOnly` now seals `r6-auth-check-only-terminal-result-v1` for every
safe downstream start after a fresh child evidence root is accepted. The
terminal is value-blind: it contains state, classifications, counters, and
timestamps but never credentials, tokens, cookies, account IDs, or raw
responses. A successful result requires zero production mutations and zero
Supabase writes.

This offline review examined two sealed V3 attestations and their terminal
results without issuing a provider request, OAuth operation, AuthCheckOnly,
DryRunOnly, or Production request.

| Record | Issued (`observedAt`) | Expiry | TTL | Attestation SHA-256 | Terminal SHA-256 |
| --- | --- | --- | --- | --- | --- |
| First | `2026-07-24T09:17:50.205Z` | `2026-07-24T09:32:50.205Z` | `900000ms` | `48c1ec666cef2b0eb59200cf4c56ad42d4a4a2a33e0ce214bc0d8969581ecf01` | `68c09df8b6e268b803dba7dc11305f8afb42f1f75519abc9eb96d5b0aaabccad` |
| Second | `2026-07-24T09:32:02.266Z` | `2026-07-24T09:47:02.266Z` | `900000ms` | `b6cc03ba2e3878360fd1a456dc9cdd9f655177f95378e7a2f434f87a624f3e6b` | `17877fd7fc25a10a0fdf935bd26f2d98420c14e0543c685c3cd715640826f59a` |

Both attestations use the local UTC sealing instant plus exactly fifteen
minutes. Their provider-evidence digest is
`de4431793c895ed6cd43540af1b1ff2de704b837481e231948d722c5cda3cf29`.
The source does not read deployment `created_on`, `modified_on`, a cached
attestation, or a fixture timestamp to calculate V3 expiry. PowerShell local
and UTC time and Node UTC time agreed during the review; `w32tm` could not
report synchronization because the Windows Time service was not running.

The historical terminal schema recorded only successful sealing and
ValidateOnly completion, not the exact freshness calculation at command
emission. This repair makes the terminal result integrity-bind issuance,
expiry, emission validation instant, remaining validity, minimum validity, and
the pass result. Command emission now occurs only after its final 13-minute
check. The independent downstream AuthCheckOnly 12-minute guard remains in
place, so a delayed human handoff fails before authentication.

The companion local-only evidence manifest is outside the repository at
`C:\Users\1\OpenGlassHub-R6-Proof\r6-current-canonical-production-identity\offline-evidence\attestation-freshness-20260724\forensic-summary.json`.

## V3 Capture And AuthCheck Reconciliation

The 2026-07-27 operator evidence established a terminal contradiction: the
capture runner wrote a valid V3 success terminal and emitted two downstream
commands, then the PowerShell wrapper threw
`R6_CURRENT_CANONICAL_V3_TERMINAL_FRESHNESS_INVALID`. The capture JSON used
UTC `Z` timestamps and numeric freshness values. Windows PowerShell 5.1
parsed those timestamps with the local `+12:00` offset when using the default
`DateTimeOffset.Parse`, while the wrapper separately required a zero offset.
The wrapper now parses every terminal and attestation timestamp with invariant
UTC `AssumeUniversal | AdjustToUniversal` semantics before applying its TTL
and remaining-validity checks. A valid capture can therefore produce its
success classification and two commands only when the wrapper also returns
success.

The same evidence found that a V3 AuthCheck failure occurred after worktree
validation but before any credential prompt. The capture provenance reader now
uses the exact parent of the `auth-check` child, reads only the expected V3
capture terminal filename, normalizes PowerShell 5.1 JSON arrays, and records
each capture/attestation provenance step as a Boolean. Known provenance,
schema, freshness, parent-root, path, and SHA mismatches are now value-blind
inner classifications rather than `R6_CURRENT_CANONICAL_V3_AUTH_CHECK_UNEXPECTED_FAILURE`.
Optional V3 `canonicalAlias` metadata is read safely when the valid
`aliasesObservedType = null` contract omits that property.

`r6-auth-check-only-terminal-result-v1` now requires provenance booleans, a
non-empty failure stage, and a sanitized exception type. It accepts standard
UTC timestamps with three through seven fractional-second digits, matching
PowerShell's round-trip format. A terminal cannot represent an authentication-
precondition failure with an ambiguous null provenance state.

Operator launch handling must distinguish phases before writing failure
evidence: when the capture parent or capture terminal exists, record a
post-terminal wrapper failure rather than a
`r6-operator-launch-preterminal-result-v1` record. The launch transcript is
hashed and scanned locally only; it is never committed or copied into this
repository.

### Windows PowerShell 5.1 Serialization And Output Ordering

The subsequent consumed capture confirmed that `JavaScriptSerializer` returns
the terminal root as a .NET dictionary under Windows PowerShell 5.1. Casting
that dictionary directly to `[pscustomobject]` preserves dictionary members
(`Keys`, `Values`, and `Count`) rather than exposing the JSON keys. The
freshness reader consequently treated every required terminal field as absent.
The reader now copies the parsed dictionary keys into an ordered object before
any terminal or attestation contract access.

The same capture also showed that the Node preparation child wrote its success
classification and downstream commands directly to stdout before the wrapper's
post-child validation ran. The wrapper now captures child stdout and emits only
the terminal-derived success classification and exactly two commands after all
terminal, integrity, and freshness guards pass. A failure emits no downstream
command. This is verified by the PowerShell wrapper regression suite without
making a provider request.
