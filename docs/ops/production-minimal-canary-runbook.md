# Production Minimal Canary Runbook

## Scope

This is the only R6 production-write canary. It uses the deployed bearer-bound
forum APIs to create one temporary post and one attached temporary comment, then
soft-deletes those exact recorded artifacts. It never creates circles, media,
external video, users, profiles, reports, or relationships. The older broad
destructive orchestrator remains disabled for real adapters.

## Preconditions

- The reviewed feature commit is deployed from `main`, production smoke passed,
  and the operator has verified the immutable deployment source commit.
- The dedicated QA account has valid legal consent, a normal writable active
  circle slug, and no unfinished canary journal.
- Set these environment names locally only: `QA_SUPABASE_URL`,
  `QA_EXPECTED_SUPABASE_REF`, `QA_PRODUCTION_SUPABASE_REF`, `QA_BASE_URL`,
  `QA_CANARY_USER_ID`, `QA_CANARY_ACCESS_TOKEN`, `QA_CANARY_SUPABASE_ANON_KEY`,
  `QA_CANARY_CIRCLE_SLUG`, `QA_EXPECTED_DEPLOYED_COMMIT`,
  `QA_ALLOW_PRODUCTION_WRITES`, and `QA_CANARY_APPROVAL`.
- Never put any values in Git, command output, a journal, or chat.

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
