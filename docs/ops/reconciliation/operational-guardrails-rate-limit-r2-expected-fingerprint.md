# W6 R2 Expected Static Fingerprint

Status: `STATIC_REVIEW_ONLY`. This is a fingerprint of the unexecuted proposal
file, not evidence of any local, Preview, or Production database object.

- Proposal: `operational-guardrails-rate-limit-r2-unexecuted-proposal.sql`
- SHA-256: `59a11a196cdeaad7a04c13a0ee00aa49037d49232a158c205fdb57ec8cb3d93e`
- Identity: `public.consume_forum_rate_limit(uuid, text, text, bigint)`
- Return: `TABLE(allowed boolean, decision text)`
- Owner: `postgres`
- Security: `SECURITY DEFINER`, `VOLATILE`, `PARALLEL UNSAFE`, not leakproof
- Search path: `pg_catalog, public, pg_temp`
- Execute ACL: revoke `PUBLIC`, `anon`, and `authenticated`; planned grant only
  to `service_role`

Any future R3 or R6 review must recompute this source fingerprint before using
the proposal. A catalog postflight is required to prove actual function
metadata, ACLs, and overload count after a separately approved execution.
