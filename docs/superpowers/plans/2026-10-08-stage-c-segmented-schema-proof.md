# Stage C Segmented Schema Proof Implementation Plan

> Execute inline under the human's integrated fast-track authorization. No
> intermediate design approval; Production requires a separate V4 approval.

**Goal:** Replace only Stage C's complete schema query with its 11 hash-pinned
projections, preserving the frozen Stage B digest and migration proof.

**Architecture:** Reconstruct PostgreSQL JSONB outer object order without
reordering projection payloads. Reuse the same schemaDigest and ledger checks
inside each caller-owned transaction. No combined-query Production fallback.

**Tech Stack:** Node.js ESM, locked pg client, existing owned Docker fixture.

**Spec:** Human Stage C Segmented Schema Proof Fast Track authorization.

## Steps

- Add RED unit checks for reconstruction, digest/ledger rejection and budgets.
- Add the reusable verifier; integrate all four import schema boundaries and
  read-only reconciliation. Keep the existing locks and commit ordering.
- Bind the segmented contract to new packet/authorization versions, including
  query dispatch, SELECT, top-level SQL and deadline ceilings.
- Add real local PostgreSQL full-value/digest equality and metadata drift tests,
  snapshot-boundary mutation, malformed response, timeout and cleanup cases.
- Run focused tests and the owned Stage-2 import/audit rehearsal; never use
  Production credentials or a non-loopback database for these checks.
- Review exact changes, commit explicit paths, regenerate the final packet,
  prepare the bounded V4 wrapper, push the feature branch and verify identity.
- Stop at AUTHORIZE_STAGE_C_SEGMENTED_READ_ONLY_RECONCILIATION_V4.

## Boundaries

Stage B code, STATE_SQL, schemaDigest, frozen proof, migrations and source YAML
stay unchanged. No Production connection, import receipt, import, activation,
hardening or deployment is permitted by this implementation authorization.
