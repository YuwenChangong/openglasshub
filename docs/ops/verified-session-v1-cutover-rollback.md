# Verified Session v1 cutover rollback

Status: review-only runbook. This document authorizes no hosted action, SQL execution, deployment, or revocation.

## Stage boundary

- A: old Worker with PRE_V1. Stop in place if the baseline is sound.
- B: old Worker with Foundation. Leave Foundation installed; do not down-migrate.
- C: new Worker with Foundation. This is transient, not fully active. Record UTC start, deadline no more than 60 minutes later, and UTC end. Run the bounded C smoke plan, then proceed only to reviewed D or restore the exact known-good old Worker at B. An unavailable or uncertain AUTH-D path requires immediate B rollback, not extended C operation.
- D or uncertain Enforcement commit: never deploy the old Worker. Hold the verified-capable Worker fail closed, determine the semantic catalog stage through separately authorized read-only inventory, then use a reviewed forward repair or the locked verified-capable Worker rollback floor.

## C failure classification

Record the exact old/new Worker source, build, environment, and configuration digests; Foundation and Enforcement artifact digests; C window identity and UTC times; catalog stage; affected route; and non-secret observation. A public-read or UI-only regression is `PROVEN` only when independent evidence establishes that challenge issuance, activation, signed session mapping, and bypass controls remained intact throughout the window. Challenge, activation, mapping, direct-bypass, or unknown-integrity failures are `SUSPECT`; an unclassified failure is `UNKNOWN` and blocks reentry.

## Suspect verified-session rows

For a `SUSPECT` C window, obtain separately authorized read-only inventory of `private.ogh_verified_sessions` where `verified_at >= STATE_C_STARTED_AT_UTC`, `verified_at < STATE_C_ENDED_AT_UTC`, and `revoked_at IS NULL`. Preserve the exact row IDs, timestamps, count, query identity, window ID, and a canonical inventory SHA-256. Compare every affected unrevoked row with independent provider/session and challenge evidence. Do not infer verification integrity from a Worker rollback, a count alone, or an operator assertion.

If any row cannot be positively proved valid, stop C/D reentry. A separate, reviewed, single-use authorization may permit a bounded update of only the reviewed affected IDs inside that exact UTC window, setting `revoked_at` to no earlier than both the database clock and `verified_at`. This runbook provides no executable SQL and grants no authorization. Never sweep historical sessions, mutate out-of-window rows, reset migration history, or retry an uncertain commit.

After a separately authorized revocation, obtain a new separately authorized read-only postcondition inventory of **all** rows in the same `verified_at` window, including their `revoked_at` values. Require every originally affected ID to remain present: each unrevoked row must have independent valid-session proof, and each other row must have a non-null `revoked_at` no earlier than `verified_at`. Require zero unreviewed, unrevoked affected rows; bind the query identity, window ID, observed UTC time, row-level result, and canonical digest to the original inventory and revocation receipt. Reentry remains denied when the postcondition is absent, mismatched, stale, or ambiguous. Keep the Foundation stage and old Worker as the B rollback target only while Enforcement has not begun.

## Recovery prohibitions

Do not drop RLS, restore password-only authorization after Enforcement, recreate browser resend RPC access, manufacture verified rows, perform a destructive down-migration, deploy an unreviewed Worker, or treat C as steady state. Every external stage requires its own explicit single-use authorization; this document is not one.
