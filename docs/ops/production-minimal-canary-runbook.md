# Production Minimal Canary Runbook

## Scope

This is the only R6 production-write canary. It creates one temporary post and
one attached temporary comment, then soft-deletes only those exact journaled
artifacts. It never creates circles, media, external video, users, profiles,
reports, or relationships. The older broad destructive orchestrator remains
disabled for real adapters.

The V2 runner has a strict write-ahead boundary: it resolves the authenticated
actor and exact writable circle through read-only requests, writes and rereads a
sealed `PREPARED` journal, then permits the first create request. The journal
binds the actor, circle ID and slug, deployment attestation, runner commit,
markers, canonical content hashes, templates, timeout, zero-retry policy, and
the exact comment-then-post cleanup contract. A timed out or otherwise ambiguous
create is never retried automatically and never advances to a dependent comment.

## Consumed Run Registry V1

Every protected canary identity is globally single-use. The local
`CONSUMED_RUN_REGISTRY_V1` records dry-run, live, and allocated recovery run IDs
as permanently ineligible before the wrapper asks for account credentials or
allows the committed runner to inspect an attestation. It has a paired
SHA-256-only confirmation-token ledger and rejects missing, malformed,
duplicate, partially written, or inconsistent state. A dry-run identity can
never be reused as a live identity, and a failed, stale, ambiguous, successful,
or recovered run remains consumed.

The wrapper first rejects an existing identity, accepts a fresh hidden
confirmation token only for a new ID, atomically records the ID and token hash,
then creates a receipt bound to the exact ID, protected mode, runner commit,
wrapper version and hash, registry/ledger entry digests, nonce, and child-command
digest. The runner consumes that receipt once before any target, attestation,
credential, adapter, journal, or network operation. Direct runner invocation,
receipt replay, path escape/reparse, receipt mismatch, and registry/ledger
disagreement fail closed. Historical confirmation ledgers are copied only as
SHA-256 evidence into the canonical registry; the original ledger files are not
rewritten or deleted.

## Preconditions

- The reviewed application commit is deployed from `main`, production smoke
  passed, and a fresh sealed Cloudflare Pages deployment attestation proves the
  immutable deployment source commit. Public response headers are not a commit
  identity source and are never a fallback.
- The dedicated QA account has valid legal consent, a normal writable active
  circle slug, and no unfinished canary journal.
- Set these environment names locally only: `QA_SUPABASE_URL`,
  `QA_EXPECTED_SUPABASE_REF`, `QA_PRODUCTION_SUPABASE_REF`, `QA_BASE_URL`,
  `QA_CANARY_USER_ID`, `QA_CANARY_ACCESS_TOKEN`, `QA_CANARY_SUPABASE_ANON_KEY`,
  `QA_CANARY_CIRCLE_SLUG`, `QA_EXPECTED_RUNNER_COMMIT`,
  `QA_EXPECTED_DEPLOYED_COMMIT`, `QA_DEPLOYMENT_ATTESTATION_PATH`,
  `QA_DEPLOYMENT_ATTESTATION_SHA256`, `QA_ALLOW_PRODUCTION_WRITES`, and
  `QA_CANARY_APPROVAL`.
- Never put any values in Git, command output, a journal, or chat.

## Commit Identity Contract

The local runner/tooling commit and the deployed application commit are
separate identities. The runner derives its repository root from its own
`import.meta.url` and checks `git -C <runner-root> rev-parse HEAD` only against
`QA_EXPECTED_RUNNER_COMMIT`. It never uses an inherited shell working directory
for this check.

`QA_EXPECTED_DEPLOYED_COMMIT` is checked only against a sealed, externally
created attestation beneath
`C:\Users\1\OpenGlassHub-R6-Proof\deployment-attestations`. The attestation
is a short-lived, read-only Cloudflare Pages evidence record with a raw-byte
SHA-256 supplied through `QA_DEPLOYMENT_ATTESTATION_SHA256`. It must identify
the production `openglasshub` project, canonical URL, immutable Pages URL,
exact full lowercase source SHA, deployment ID, target identity, and a maximum
15-minute observation window.

The runner at application commit `b9ec4a06...` is superseded for future live
canary use: its deployed-commit guard compared an inherited local CWD Git HEAD
instead of deployment identity. This is a QA-tooling defect, not an application
deployment defect. The runner fix is not application runtime code and does not
require a Pages deployment when the application bundle remains unchanged.

Future sequence: generate a fresh read-only provider attestation, validate its
sealed hash locally, run AuthCheckOnly, run DryRunOnly, then obtain separate
approval before ExecuteApprovedPhase. Never reuse a failed run ID or prior
confirmation token.

## Wrangler Deployment List Evidence Boundary

Wrangler `4.106.0` serializes `pages deployment list --json` as a table-projection
array with `Id`, `Environment`, `Branch`, `Source`, `Deployment`, `Status`, and
`Build`. Its own command source applies `shortSha(commit_hash)`, formats a
successful stage into display text, and omits aliases. Therefore this command is
not sufficient by itself to attest the exact full deployed commit, a canonical
Production alias, or a machine-readable active status. The QA-only parser in
`scripts/qa/parse-wrangler-pages-deployments.mjs` accepts only that exact array
shape, rejects null/unknown shapes without coercion, emits value-free structural
diagnostics, and refuses attestation selection with
`WRANGLER_JSON_REQUIRED_FIELD_MISSING`. A future provider route must supply the
missing full-identity fields; a short SHA, dashboard build link, or immutable URL
is never a substitute.

## Official Deployment Get Evidence Boundary

The QA-only `scripts/qa/cloudflare-pages-deployment-get.mjs` is reserved for a
separately approved, single official Cloudflare Pages deployment `GET`. It has
one fixed method, API origin, project name, endpoint shape, timeout, response
limit, and no retry path. It reads only a currently valid existing Wrangler
OAuth profile in process memory and refuses environment credentials, login,
refresh, redirects, untrusted account identifiers, and untrusted deployment
identifiers.

### Account Routing Source Contract

`scripts/qa/cloudflare-pages-account-resolver.mjs` separates the account routing
identifier from the Wrangler OAuth credential. Wrangler 4.106.0 resolves an
explicit project `account_id` before `CLOUDFLARE_ACCOUNT_ID` and its selected
account cache; the Pages project-list command also persists its selected account
as `pages.json`. The QA resolver intentionally does not accept the ambient
environment variable: it is not a durable local ownership proof and must not
cross a child-process boundary. OAuth material is authentication secret material,
not an account-ID source.

The resolver accepts only these sources, in order: exact project-local
`wrangler.json`, `wrangler.jsonc`, or `wrangler.toml` `account_id`; an existing
regular Wrangler cache (`wrangler-account.json` or `pages.json`) bound to a
regular existing default OAuth profile; then one hidden operator input for a
future separately approved metadata operation. Multiple local values, or a
local value that disagrees with supplied hidden input, fail closed. It never
creates a cache, reads a command-line account ID, writes the account ID to
evidence, or permits the OAuth token to substitute for it. The only retained
routing metadata is an account-ID SHA-256 digest.

The future metadata-preparation library at
`scripts/qa/prepare-cloudflare-pages-deployment-get.mjs` receives the resolved
account ID only in process memory, performs one fixed GET only when separately
approved, and returns sanitized deployment evidence. It neither authenticates a
QA user nor allocates a canary run ID. A future human launcher must prompt only
when local resolution is absent, use non-echoing input, pass it by a one-shot
protected handoff rather than command line or environment, clear it immediately,
and run ValidateOnly only after the response produces a sealed attestation.

`scripts/qa/run-cloudflare-pages-metadata-preparation.mjs` is the sole
executable metadata-preparation surface. It accepts only the fixed
`PREPARE_AUTH_DRY_RUN_ATTESTATION` operation and reviewed non-secret paths and
hashes. Before an account source is resolved, it validates the regular local
Wrangler default OAuth profile with a five-minute remaining-validity minimum.
Wrangler 4.106.0 binds `expiration_time` to `oauth_token`; its persisted
`refresh_token` is optional capability metadata. A refresh field therefore does
not block a currently valid access credential. At exactly five minutes of UTC
validity the profile is ready; below that threshold it stops before account
input or the provider request. An expired or below-threshold profile with a
non-empty refresh capability is classified as refresh-required, but this tool
never refreshes automatically. It rechecks the same UTC validity immediately
before its future fixed GET.
The CLI itself, not the PowerShell wrapper, requests the hidden account ID once
only when no trusted source exists. It rejects redirected stdin, never accepts
the account ID as an argument or environment value, and restores TTY state on
all input outcomes. A one-request sentinel rejects a second GET.
The wrapper resolves the CLI to the exact absolute path below its already
validated detached worktree and invokes Node through an argument array while
that worktree is the explicit working directory. A Node loader failure is
reported as `R6_HARDENED_OFFICIAL_GET_NODE_ENTRYPOINT_LOAD_FAILED`; it cannot
fall through to account input, a request, an attestation, or a later command.
Only a successful fixed GET, exact selector, sealed fifteen-minute attestation,
and shared attestation validation may produce a fresh but unreserved dry-run ID
and exactly two later commands: `AuthCheckOnly` and `DryRunOnly`.

The source-proven minimum sufficient attestation set is deployment ID, project
name, production environment, immutable Pages URL, canonical alias, `main`
branch, full lowercase source commit, `is_skipped: false`, and the exact
`latest_stage` pair `deploy` / `success`. Required fields must exist, be
non-null, have the exact JSON type, and meet the exact value contract.
`commit_dirty`, unproven response-wide nullability, and a complete provider
state taxonomy are deliberately excluded. Unknown optional fields are ignored
and never become attestation evidence. Raw bytes are parsed before cleanup and
are removed after either sanitized metadata or a value-free structural
diagnostic exists.

## Commands

Generate a fresh `qa-canary-<uuid>` run ID. The redacted plan must pass first:

```powershell
node scripts/qa/run-production-minimal-canary.mjs --dry-run --run-id <run-id> --confirm-run <run-id>
```

Only after a separate explicit approval, set `QA_ALLOW_PRODUCTION_WRITES=1` and
`QA_CANARY_APPROVAL=APPROVE_R6_HARDENED_WRITE_AHEAD_FRESH_ATTESTATION_AUTH_DRY_RUN_AND_CANARY_EXECUTION`, then run:

```powershell
node scripts/qa/run-production-minimal-canary.mjs --execute --run-id <run-id> --confirm-run <run-id>
```

The journal is written and reread after read-only authentication/circle
resolution and before a create request at
`C:\Users\1\OpenGlassHub-R6-Proof\production-canary\<run-id>\journal.json`.
It contains no credentials and is sealed with a SHA-256 integrity value.

For an interrupted run, do not repeat creation. Recovery requires a separately
approved recovery-only adapter with no create capability and complete,
deterministic enumeration of exact candidates. The shipped production adapter
intentionally fails closed because it cannot prove complete enumeration; it does
not fall back to search, pagination guesses, broad deletion, or automatic
cleanup. Generate a new `qa-recover-<uuid>` confirmation only after a new
recovery approval:

```powershell
node scripts/qa/run-production-minimal-canary.mjs --recover-run <run-id> --confirm-run <run-id> --confirm-recovery <fresh-recovery-token>
```

## Stop Conditions

Stop for a target, QA-account, circle resolution, marker, journal-integrity,
ambiguous transport, incomplete enumeration, cleanup, or residue error. Never
retry a create. Recovery may adopt only one fully exact candidate after a
complete result proves that all candidate pages were inspected; zero, multiple,
partial, malformed, or ambiguous results block. It performs no broad query,
no broad deletion, and no automatic cleanup. A complete journal is already
clean and performs no data mutation on repeat recovery.

The normal post/comment delete APIs are soft deletes. The cleanup contract
requires their success, no public marker search result, no readable comment
under the deleted post, no media or circle operation in the fixed adapter, and
zero reported residue. The comment notification trigger ignores self-notices,
so the single QA owner acting as both post and comment author creates no normal
notification record.
