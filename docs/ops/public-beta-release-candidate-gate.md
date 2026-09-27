# Public Beta Release Candidate Gate

Status: `RELEASE_CANDIDATE_OFFLINE_FREEZE_NO_GO_FOR_PRODUCTION`.
This is a repository-only release decision. It records no hosted state and
authorizes no Production, provider, deployment, migration, email, canary, or
R7 operation.

## Candidate

- RC source commit: `754024827bdd6455f9319d4429bfdf2934bb0abb`.
- Offline P0 blockers: `0`.
- Offline P1 blockers: `0`.
- Controlled Production-release P1 items: `2`.
- Current Production DB stage: `UNKNOWN`.
- Current Production Worker identity: `UNKNOWN`.
- Auth release status: `NO_GO`.

The two controlled Production P1 items are the verified-session cutover and
the R6 fail-closed rate-limit runtime deployment/verification. They are not
treated as completed by local tests or repository source. Auth requires the
ordered single-use sequence `AUTH-A -> capacity clearance -> AUTH-B -> AUTH-C
-> AUTH-D -> AUTH-E -> AUTH-F`. The approved Worker/database pairings are
old/PRE_V1, old/FOUNDATION, new/FOUNDATION, and new/ENFORCEMENT; NEW/PRE_V1
and OLD/ENFORCEMENT are forbidden. State C is transient and must complete D in
the same bounded window or roll back to B.

The R6 runtime sequence is a separately authorized deployment of the reviewed
fail-closed runtime, exact target/commit and server-only binding verification,
bounded low-volume smoke/canary, and read-only residue/direct-access
postflight. No Production action occurred during this audit.

## Offline evidence

- The exact seven direct service-role consumers pass the exact-path allowlist;
  all privileged-surface findings are zero.
- The R4 rate-limit runtime is fail-closed, has zero retries, zero direct-table
  fallback, and no browser table/RPC callers.
- Focused Auth, signup, fresh-login challenge, logout, resend, verified-session,
  forum authorization, media ordering, and service-role tests pass locally.
- `npm run qa:release` passes 34/34 checks. Its release profile skips
  Production smoke, deployment, provider operations, and database replay.
- R6P SQL catalog recovery is `COMMITTED_EXACTLY`; both W6 extra policies are
  safe to retain through Beta. W6 has two technical cleanup objects, but zero
  policy objects blocking Beta. R7 Stage C remains unauthorized.

## Post-Beta backlog

The historical reconciliation inventory has 67 unresolved logical objects in
W2, W3B, W4, W5, and W6. Current hosted state is not established by the old
export, so these are not promoted to current Beta blockers without fresh,
separately authorized evidence. W6's two redundant policies and R7 Stage C
cleanup remain post-Beta reconciliation work. Any object later shown to have a
current concrete security or availability failure must be reclassified through
a fresh evidence review.

## Decision

Offline P0/P1 count is zero, so the repository can be frozen as a candidate.
Public Beta is not globally released: the controlled Production P1 window must
positively establish Auth provenance and the required runtime deployment before
launch. Every hosted stage requires its own authorization, reviewed artifact
binding, rollback owner, bounded evidence, and cleanup receipt. Zero-paid-infra
policy remains fail-closed with no automatic paid upgrade or overage path.
