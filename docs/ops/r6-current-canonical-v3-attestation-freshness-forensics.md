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
