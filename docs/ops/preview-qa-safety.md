# Preview QA Safety

## Default posture

- Preview and production verification is read-only by default.
- A Cloudflare preview is production-backed when its actual Supabase project ref equals production, regardless of its Pages hostname.
- Routine write QA requires a separate preview or staging Supabase project. Do not use production-backed previews for routine writes.
- Never run migrations, destructive moderation, account changes, role changes, or public-content creation against production as ordinary QA.

## Required target contract

All privileged QA writers require these non-secret operator or CI values:

- `QA_SUPABASE_URL`: exact target project URL.
- `QA_EXPECTED_SUPABASE_REF`: ref expected for that target.
- `QA_PRODUCTION_SUPABASE_REF`: known production ref.

The target URL must be a well-formed HTTPS Supabase project URL. The guard rejects missing, malformed, localhost, unidentifiable, or expected-ref-mismatched targets. It never treats an unfamiliar target as safe.

## Production-backed exception

Production-backed writes are disabled unless both controls are present:

```powershell
$env:QA_ALLOW_PRODUCTION_WRITES = "1"
node scripts/qa/create-preview-test-accounts.mjs --confirm-run "qa-run-<unique-id>"
```

`--confirm-run` must be a unique, non-generic run ID. Either control alone fails closed. The confirmation does not bypass target-ref validation.

## Safe dry runs

Dry runs validate the target and print only operation categories, refs, and the safe run label. They perform no network mutation and never print credentials, passwords, tokens, or private emails.

```powershell
node scripts/qa/create-preview-test-accounts.mjs --dry-run
node scripts/qa/cleanup-preview-test-accounts.mjs --dry-run --marker "qa-run-<unique-id>"
```

## Cleanup and emergency stop

- Stop immediately for an ambiguous target, ref mismatch, missing confirmation, unexpected artifact discovery, or cleanup error.
- Cleanup verification must show zero targeted public artifacts. Any incomplete cleanup is a failed release gate and returns nonzero.
- Legacy owner/marker cleanup exists only for compatibility and is high risk. Future workflows must track exact artifact IDs and clean only those IDs.
- Do not use broad prefix, title, marker, or owner deletion for future destructive QA.
- Do not create or modify real users, real content, roles, reports, or media to rehearse QA.

## Exact-ID Destructive QA v2

- V2 is staging-first and is not part of routine release validation or production smoke.
- The v1 target guard and dual-confirmation contract remain mandatory. A production target additionally needs the explicit `--execute-destructive-qa` action flag and separate approval.
- Every created artifact must be registered immediately by exact immutable ID in one run manifest. New workflows must never discover cleanup targets by owner, marker, title, or prefix.
- The orchestrator always enters cleanup in `finally`, attempts each exact-ID cleanup independently, and verifies exact absence for every registered artifact.
- A partial cleanup, failed cleanup call, missing exact ID, or any residue is a failed release gate. The current CLI supports validation plans only; a real staging adapter has not been configured.

## Staging requirement

Create and maintain a dedicated staging or preview Supabase project, configure preview-only runtime values there, and verify the target-ref guard before any write QA. Leave production values and secrets untouched.
