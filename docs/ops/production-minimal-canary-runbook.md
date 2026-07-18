# Production Minimal Canary Runbook

## Scope

This is the only R6 production-write canary. It uses the deployed bearer-bound
forum APIs to create one temporary post and one attached temporary comment, then
soft-deletes those exact recorded artifacts. It never creates circles, media,
external video, users, profiles, reports, or relationships. The older broad
destructive orchestrator remains disabled for real adapters.

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

## Commands

Generate a fresh `qa-canary-<uuid>` run ID. The redacted plan must pass first:

```powershell
node scripts/qa/run-production-minimal-canary.mjs --dry-run --run-id <run-id> --confirm-run <run-id>
```

Only after the approved plan, set `QA_ALLOW_PRODUCTION_WRITES=1` and
`QA_CANARY_APPROVAL=APPROVE_R6Y_BUILD_CRASH_SAFE_MINIMAL_PRODUCTION_CANARY_AND_COMPLETE_R6`, then run:

```powershell
node scripts/qa/run-production-minimal-canary.mjs --execute --run-id <run-id> --confirm-run <run-id>
```

The journal is written before authentication or a create request at
`C:\Users\1\OpenGlassHub-R6-Proof\production-canary\<run-id>\journal.json`.
It contains no credentials and is sealed with a SHA-256 integrity value.

For an interrupted run, do not repeat creation. Generate a new
`qa-recover-<uuid>` confirmation and use exact recovery only:

```powershell
node scripts/qa/run-production-minimal-canary.mjs --recover-run <run-id> --confirm-run <run-id> --confirm-recovery <fresh-recovery-token>
```

## Stop Conditions

Stop for a target, QA-account, marker, journal-integrity, ambiguous-multiple
match, cleanup, or residue error. Never retry a create. Recovery may look up
only the exact high-entropy marker, verified QA owner, and known parent post;
it performs no broad query or delete. A complete journal is already-clean and
performs no data mutation on repeat recovery.

The normal post/comment delete APIs are soft deletes. The cleanup contract
requires their success, no public marker search result, no readable comment
under the deleted post, no media or circle operation in the fixed adapter, and
zero reported residue. The comment notification trigger ignores self-notices,
so the single QA owner acting as both post and comment author creates no normal
notification record.
