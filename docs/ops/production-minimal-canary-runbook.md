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

### Final Execution Lifecycle

The protected receipt is deliberately a one-shot handoff, not a durable
authorization token. `PENDING` is the state at reservation creation. The child
must consume the same sealed receipt before identity guards, credentials,
adapter creation, journal creation, or a request; its terminal may therefore
record the creation snapshot while the registry receipt is correctly
`CONSUMED` after a successful dry-run. Historical V3 dry-run terminals remain
readable with that interpretation and must never be rewritten.

R6 uses model B: a dry-run Run ID is permanently consumed plan evidence and is
not eligible for live execution. A final live Run ID is new and independently
reserved. Before its live receipt is created, it must bind the successful
dry-run terminal and orchestration SHA-256 values, exact execution/tooling
commit, canonical two-operation mutation-plan hash, and a new fresh deployment
attestation hash. The receipt stores this value-blind binding under
`finalAuthorizationBinding`; a binding mismatch, stale attestation, reused Run
ID, nonzero dry-run writes, plan mismatch, or a count other than two stops
before the live child starts.

After live execution, `validate-r6-final-canary-execution-terminal.mjs` and
`validate-r6-final-canary-postflight.mjs` are mandatory. A final success
requires a consumed live receipt, complete journal, exactly two verified
mutations, zero unexpected or duplicate mutations, zero retries, and a
strictly read-only postflight with at least one read and zero writes. Partial
execution, absent postflight, or any discrepancy is a no-go and requires a
separate incident approval; it never auto-retries, resumes, or cleans up.

### Execute Terminal And Read-Only Postflight

`ExecuteApprovedPhase` is the only live entry point. It keeps the existing
one-shot receipt, child runner, journal, mutation plan, two write operations,
and cleanup state machine. The wrapper invokes the child through the native
stdout/stderr-separated helper and gives it an exclusive child-terminal path.
It atomically seals `final-canary-execution-terminal-result.json` before any
postflight. A successful execution terminal requires the fresh live Run ID,
the consumed receipt binding, a validated child terminal, a complete journal,
exactly two mutations, no unexpected operation, and zero retry.

The next process is `run-r6-final-canary-read-only-postflight.mjs`. It first
validates the sealed execution terminal, receipt and journal locally, then uses
only its dedicated GET-only adapter to verify the cleaned post/comment and
marker residue. The adapter has no create, update, delete, SQL, RPC, or cleanup
capability. Its terminal records `supabaseWriteCount: 0` and
`productionMutationCountDuringPostflight: 0`; validators reject any other
value. A final orchestration terminal can pass only if both terminal validators
pass, the postflight has at least one read, and all counts remain exactly two,
zero unexpected, zero duplicate, zero retry, and zero postflight writes.

Any child failure, timeout, invalid/missing terminal, partial result, third
mutation, receipt/journal mismatch, or postflight discrepancy seals a failed
terminal and stops. It does not retry, resume, repair, rollback, or perform a
second write.

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
  `QA_EXPECTED_TOOLING_COMMIT`,
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

For V3 attestations, the wrapper passes its validated detached-worktree commit
as both `QA_EXPECTED_RUNNER_COMMIT` and `QA_EXPECTED_TOOLING_COMMIT`; the latter
is required by the attestation validator. The canary process reports a
value-blind, atomic child terminal record rather than relying on a merged
PowerShell stdout/stderr pipeline. The parent accepts it only when its run ID,
mode, tooling/receipt/execution commit binding, exit state, and allowlisted
classification match. Missing or inconsistent records fail before any adapter,
journal, or mutation.

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

### Metadata preparation terminal contract

The metadata wrapper preserves the Node child's inherited console so its
non-echoing account prompt remains a TTY. It does not redirect stdout or stderr
into a capture pipe. Instead, every child invocation writes exactly one atomic,
restricted, contained `metadata-preparation-terminal-result.json` record. The
record is value-blind: schema and tooling binding, outer/inner classification,
exit code, prompt/request/transport/attestation/ValidateOnly booleans, command
count, safe follow-up commands, and path/digest only. It never contains OAuth
material, account IDs, provider values, or QA credentials. The wrapper captures
`$LASTEXITCODE` immediately, waits for the result record, and rejects missing,
partial, malformed, path-escaping, digest-invalid, conflicting, or nonzero
results with a stable blocker. This avoids the Windows `new URL(path, "file:")`
entrypoint mismatch and prevents the wrapper from swallowing an interactive
prompt.

The only successful terminal output is ordered as: the stable
`R6_HARDENED_AUTH_AND_DRY_RUN_ATTESTATION_READY_FOR_HUMAN_EXECUTION`
classification, then exactly one `AuthCheckOnly` command and one `DryRunOnly`
command. No failure emits later executable commands. The wrapper maps OAuth,
account-input, transport, target, attestation, and ValidateOnly failures to
their corresponding `R6_HARDENED_OFFICIAL_GET_*` classification and does not
retry automatically. Required result-channel blockers include
`R6_HARDENED_OFFICIAL_GET_RESULT_MISSING`,
`R6_HARDENED_OFFICIAL_GET_RESULT_INVALID`, and
`R6_HARDENED_OFFICIAL_GET_CHILD_PROCESS_FAILED`.

## Pages Project Human Query Mode

`scripts/qa/run-cloudflare-pages-project-metadata-preparation.mjs` is a second,
mutually exclusive QA-only metadata entrypoint. Its only operation is
`PREPARE_PROJECT_AUTH_DRY_RUN_ATTESTATION`; it cannot receive an account ID,
credential, provider path, method, query, dry-run ID, or live ID as a command
line argument. After offline OAuth readiness succeeds, it uses the existing
trusted account resolver and, only if every trusted local source is absent,
requests one non-echoing inherited-TTY account value. No account value reaches
the command line, environment, result channel, or attestation.

The only future request it can represent is the fixed official Project request
`GET /accounts/{resolved-account-id}/pages/projects/openglasshub`. It never
invokes deployment GET, follows redirects, refreshes OAuth, retries, or accepts
an arbitrary project/host/path. Its one-request sentinel is process-local and
rejects a second invocation before network access.

After the committed Model A selector proves the canonical deployment contract,
the mode seals `CLOUDFLARE_PAGES_PROJECT_GET_V1` evidence using the existing
`r6-production-deployment-attestation-v1` container. Project evidence adds the
fixed transport, parser/selector, public-source-contract, endpoint, account
digest, canonical branch/stage, and raw/sanitized response bindings. Shared
ValidateOnly accepts this explicit type without weakening legacy
`CLOUDFLARE_PAGES_DEPLOYMENT_GET_V1` validation. A future sealed attestation is
valid for at most 15 minutes and must retain at least 13 minutes after
ValidateOnly; only then can a fresh, unreserved dry-run ID and exactly two
commands (`AuthCheckOnly`, `DryRunOnly`) be emitted. For Current Canonical V3,
`observedAt` is also the attestation issuance time: it is sampled from the
local UTC clock at sealing, and `expiresAt` is exactly fifteen minutes later.
Provider deployment timestamps are evidence only and cannot determine this
short-lived window. Immediately before command emission, V3 records the UTC
validation instant, remaining milliseconds, its thirteen-minute minimum, and a
freshness-pass boolean in the integrity-hashed terminal result. It emits zero
commands if the remaining window is below that boundary. The downstream
AuthCheckOnly guard independently requires a twelve-minute window before any
authentication, preserving defense in depth after a human handoff delay. No
live, recovery, or execution command is emitted by this mode.

The source-proven minimum sufficient attestation set is deployment ID, project
name, production environment, immutable Pages URL, canonical alias, `main`
branch, full lowercase source commit, `is_skipped: false`, and the exact
`latest_stage` pair `deploy` / `success`. Required fields must exist, be
non-null, have the exact JSON type, and meet the exact value contract.

### Required-field diagnostics

The parser keeps the minimum deployment identity contract unchanged. For every
required provider field, missing, null, and wrong-type cases now carry a
value-blind diagnostic reference in the form
`PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_<KIND>:result.<path>`. The diagnostic
contains only JSON path, observed type, expected type, parser version, and raw
response digest; it never contains a field value, account identifier, token,
header, or raw response. The terminal-result `innerClassification` preserves
that safe reference for a future local forensic review.

Three digests intentionally differ: the terminal-result file SHA-256 hashes
its raw bytes, `resultSha256` hashes the canonical result object with its own
digest field set to `null`, and `sanitizedEvidenceDigest` hashes the absolute
contained result path. Equality between those three values is neither expected
nor accepted as a validation rule.
`commit_dirty`, unproven response-wide nullability, and a complete provider
state taxonomy are deliberately excluded. Unknown optional fields are ignored
and never become attestation evidence. Raw bytes are parsed before cleanup and
are removed after either sanitized metadata or a value-free structural
diagnostic exists.

### Aliases-null and terminal-process boundary

The second reviewed official Pages deployment GET reached the provider and
returned the value-blind failure
`PAGES_DEPLOYMENT_GET_REQUIRED_FIELD_NULL:result.aliases`. The installed
Wrangler `4.106.0` deployment type models `aliases` as `string[]`, not a
nullable canonical-target substitute, and its locally installed model provides
no other response field that proves the canonical Production URL. The response
is therefore insufficient for target attestation. `result.aliases` remains a
required non-null string array and the selector still requires the exact
canonical alias; an immutable deployment URL, matching commit, or production
environment is not equivalent proof.

The metadata child now pauses hidden TTY stdin after success, cancellation, or
end-of-input, after restoring raw mode. This closes the source-proven event-loop
liveness path in which `stdin.resume()` remained active after the atomic
value-blind terminal result was written and `process.exitCode` was set. A local
bounded child-process test proves the aliases-null terminal result is persisted
before Node exits with status `1`; it performs no provider request or mutation.
The stable local liveness failure classification is
`R6_METADATA_POST_RESULT_PROCESS_EXIT_FAILED`; it is reserved for a bounded
controller or regression assertion that observes a child remain live after its
terminal result has been safely written.
No additional Pages GET is authorized by this remediation.

## Pages Project Get Source Contract

The public Cloudflare TypeScript SDK Project GET source contract is bound outside
Git by SHA-256 `7d3a3650c5c6c47296164335aa41f4020ca5d34e148f9045fe62ef86d6ba81a0`.
It documents `GET /accounts/{account_id}/pages/projects/{project_name}` as an
envelope containing `result: Project`. `Project.canonical_deployment` is
documented as the most recent production deployment and is typed
`Deployment | null`; `latest_deployment` is also nullable. The QA-only
`scripts/qa/cloudflare-pages-project-get.mjs` deliberately fails closed when
either target field is missing or null, then requires the canonical deployment
to prove the existing minimum deployment identity contract.

The fixed future request is GET-only at
`/client/v4/accounts/{resolved-account-id}/pages/projects/openglasshub`, carries
no query string, rejects redirects, uses a 15-second timeout and a 1 MiB body
limit, and has no retry path. `selectExactCanonicalProjectTarget` requires the
project name, `main` production branch, expected canonical deployment ID,
production environment, exact immutable URL, canonical Pages alias, `main`
trigger branch, full expected commit, `is_skipped: false`, and `deploy` /
`success`. A distinct `latest_deployment.id` is a conflict only when it also
claims to be production; a preview latest deployment is not substituted for the
canonical target.

This module is inert. No Project GET, account prompt, OAuth load, attestation,
or canary action is authorized until a separately approved execution phase.

### R2 value-minimized Project capture

`scripts/qa/run-cloudflare-pages-project-r2-metadata-preparation.mjs` is a
separate, QA-only preparation entrypoint. Its only supported operation is
`PREPARE_PROJECT_R2_AUTH_DRY_RUN_ATTESTATION`; it accepts no account ID,
credential, arbitrary endpoint, deployment ID, or positional arguments.

The future, separately approved request is fixed to one `GET` at the official
Cloudflare API Project endpoint for `openglasshub`, with no query, redirect, or
retry. Raw response bytes are held only in memory, hashed, parsed, and cleared.
Only the exact Project/deployment facts needed to prove one of these modes are
sealed:

- `CANONICAL_DEPLOYMENT_ALIASES_V1`: a non-null aliases array contains the
  canonical Production URL.
- `PROJECT_SUBDOMAIN_PRODUCTION_BINDING_V1`: aliases is exactly null and the
  Project subdomain, production branch, canonical deployment, project binding,
  immutable URL, branch, commit, skip, and stage all exactly match the reviewed
  Production identity.

The V2 attestation never stores raw JSON, account ID plaintext, headers,
credentials, custom domains, build configuration, environment variables, or
unrelated deployments. It is accepted by shared `ValidateOnly` only when every
observed field, source-contract hash, proof-mode discriminator, account digest,
and fifteen-minute validity window is exact. The preparation flow emits only
`AuthCheckOnly` and `DryRunOnly` commands; it never emits a live or recovery
command.

Canonical deployment URLs use `canonical-deployment-url-v1`. It accepts only
the fixed HTTPS deployment hostname with an empty/root path (both serialize to
the same root URL), and rejects credentials, non-default ports, another host,
non-root paths, queries, and fragments. A rejected URL is represented only by
the normalization version, a structural reason, and expected/observed normalized
URL digests. The original provider URL is neither persisted nor emitted.

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

## Final Same-Commit Entry Point

The final Production entry point is
`-PrepareCurrentCanonicalProductionV3FinalExecuteAndPostflight`. It is a
single wrapper mode: local binding preflight, fresh V3 capture, fresh
AuthCheckOnly, the existing write-ahead ExecuteApprovedPhase path, and its
GET-only postflight remain in one process. It never chains operator commands
or silently adopts the legacy worktree profile.

Before a separately approved final run, create a new same-commit DryRun and
then create a fresh `final-execution-binding.json` with
`scripts/qa/prepare-r6-final-execution-binding.mjs`. The binding records the
canonical detached worktree, one equal execution/runner/tooling commit, the
external wrapper hash, required Git blobs, and the new DryRun authorization
and consumed receipt hashes. The final mode rejects a missing or altered
binding, a dirty or non-detached worktree, `node_modules`, a stale parent
authorization, a non-CONSUMED parent receipt, a nonzero parent mutation count,
or any commit/plan/operation mismatch before credential prompts or provider
requests.

An authorization from an earlier commit remains historical evidence only. It
must not be copied, resigned, or used to authorize a later commit.
# Canonical Target Binding

Every fresh R6 DryRun resolves the operator-provided slug exactly once through the
authenticated read-only circle catalog. The result is sealed as
`qa-canary-target-binding-v1`: its immutable `canonicalCircleId`, confirmed slug,
operation mapping, base-plan hash, and target-bound-plan hash are persisted in
the DryRun receipt, terminal, orchestration terminal, and final authorization.
If resolution fails before a receipt is reserved, the failed DryRun terminal
records no receipt runner commit, no expected tooling commit, and no target
binding. Those fields begin together only after the reservation is bound.

Final execution accepts only a validated final authorization. It never prompts
for a circle slug and never reads `QA_CANARY_CIRCLE_SLUG`; `CREATE_POST` uses the
sealed canonical UUID and `CREATE_COMMENT` uses only the post created in that
same execution. Historical v1 artifacts remain readable for forensics but are
not eligible to generate a new final authorization.
