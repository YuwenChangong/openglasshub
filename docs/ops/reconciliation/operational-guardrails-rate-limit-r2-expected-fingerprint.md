# W6 R2 Expected Static Fingerprint

Status: `STATIC_REVIEW_ONLY`. This is a fingerprint of the unexecuted proposal
file, not evidence of any local, Preview, or Production database object.

- Proposal: `operational-guardrails-rate-limit-r2-unexecuted-proposal.sql`
- SHA-256: `10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb`
- Canonical bytes: exact Git blob / raw UTF-8 file bytes, 6033 bytes, LF-only,
  no UTF-8 BOM, and one final LF. The narrow `.gitattributes` contract keeps
  this reviewed artifact LF on every supported checkout; the static test hashes
  raw bytes and rejects CRLF conversion, whitespace, BOM insertion, or a
  missing final newline.
- Identity: `public.consume_forum_rate_limit(uuid, text, text, bigint)`
- Return: `TABLE(allowed boolean, decision text)` with only `ALLOWED` and
  `RATE_LIMITED`
- Owner: `postgres`
- Security: `SECURITY DEFINER`, `VOLATILE`, `PARALLEL UNSAFE`, not leakproof
- Search path: `pg_catalog, public, pg_temp`
- Function settings: `lock_timeout = '1s'`; `statement_timeout = '3s'`
- Execute ACL: revoke `PUBLIC`, `anon`, and `authenticated`; planned grant only
  to `service_role`
- External video: 1..157286400 per attempt; accepted byte sum <= 314572800 in
  the database-clock rolling 24-hour `forum_upload_attempts` ledger

Any future R3 or R6 review must recompute this source fingerprint before using
the proposal. A catalog postflight is required to prove actual function
metadata, ACLs, and overload count after a separately approved execution.

R3 corrected the original static proposal after an isolated local execution
proved the former schema-qualified `coalesce` form invalid. This fingerprint is
the corrected source file; it is still not evidence of a Preview or Production
function.
