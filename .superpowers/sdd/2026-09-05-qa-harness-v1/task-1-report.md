# Task 1 report — Harness core contracts and invocation parser

## Files

- `scripts/qa/contracts.mjs`
- `scripts/qa/runner.mjs`
- `scripts/qa/test-qa-harness-core.mjs`

The contracts export frozen `QA_PROFILES` and `RISK_LEVELS`, a typed stable
invocation parser, normalized check results, and a deterministic value-blind
run context. The runner is a side-effect-free CLI adapter for the parser and
context; it does not execute checks or child processes.

## TDD and tests

- `node scripts/qa/test-qa-harness-core.mjs` (RED: failed with `ERR_MODULE_NOT_FOUND` for the intentionally absent `contracts.mjs`; GREEN: 7 passed, 0 failed)
- `node scripts/qa/test-qa-harness-core.mjs` (GREEN: 7 passed, 0 failed)
- `node scripts/qa/runner.mjs feature devices` (PASS: deterministic JSON context emitted)
- `node scripts/test-qa-write-guards.mjs` (PASS: `QA_WRITE_GUARDS_OK no network requests or mutations performed`)
- `git diff --check` (PASS)

## Commit

Commit: `f6f430fcda6340ed5fd114a8cd1294ea42a87617` (`feat(qa): add harness core contracts`)

## Concerns

- `createRunContext` intentionally accepts only 40-character hexadecimal commit/base SHAs when supplied; later orchestration must provide normalized SHAs.
- Feature areas are accepted only with the FEATURE profile, matching the one optional feature-area contract.
