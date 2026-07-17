# R6 Sealed Recovery

Status: `R6N_REPOSITORY_READY`. Production dispatch remains limited to the one
approved sealed query and must stop after local token verification.

The sealed recovery path exists because the Production connector exposes a
result to the agent layer but has no byte-safe object-to-local-stdin bridge for
a raw connector envelope. It does not replace the reviewed compact query. It
derives the exact compact packet from the same catalog-only CTEs and serializes
that one packet as one bounded ASCII token.

## Immutable inputs

| Artifact | SHA-256 |
| --- | --- |
| Reviewed compact recovery | `a82c692a1d3569d4fe94134c613b2382d2cb11589bbc3135c4f883ca120bd3f8` |
| Reviewed full postflight | `e7082fe8e25dd13a454c3b8a41aff5ded2aba4e8f499bd2afe5999222feb857e` |
| Reviewed R2 proposal | `10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb` |

The new query is
`operational-guardrails-r6-production-postflight-recovery-sealed.sql` with
SHA-256 `1cce650d890fe481a5c9d83033ab88ea189ee28168a6ff91df24513d2d65f819`. It is
one read-only catalog statement with one `sealed_token` result column. It never
reads application rows, auth-user rows, function bodies, credentials, or IP
hashes. PostgreSQL core `sha256(bytea)` is proven by the repository-supported
local PostgreSQL 17 image; no extension is created or changed.

## Token contract

Only this exact token is transferable from a future approved connector result:

`R6SEALED1.<payload_byte_length>.<payload_sha256_hex>.<payload_base64url>`

The canonical JSON payload is the exact existing compact recovery packet. It is
limited to 4,096 UTF-8 bytes; the ASCII token is limited to 6,144 bytes. The
server supplies the byte length and SHA-256. The local verifier checks the
strict single-token format, canonical base64url encoding, decoded byte length,
SHA-256, UTF-8, exact compact-packet schema, evidence fingerprint, and the
operator-held R6-2 baseline before it writes evidence.

The agent may persist only the exact token through
`persist-operational-guardrails-r6-sealed-recovery-token.mjs`. It must never
persist, summarize, interpolate, or reconstruct the surrounding connector
response.

## Outside-Git evidence

| Evidence | Approved path |
| --- | --- |
| Sealed token | `C:\Users\1\OpenGlassHub-R6-Proof\r6-6-sealed-recovery-token.txt` |
| Token SHA | `C:\Users\1\OpenGlassHub-R6-Proof\r6-6-sealed-recovery-token.sha256` |
| Canonical packet | `C:\Users\1\OpenGlassHub-R6-Proof\r6-6-sealed-postflight-recovery.json` |
| Canonical packet SHA | `C:\Users\1\OpenGlassHub-R6-Proof\r6-6-sealed-postflight-recovery.sha256` |
| Verification metadata | `C:\Users\1\OpenGlassHub-R6-Proof\r6-6-sealed-postflight-recovery-verification.json` |

All writes are new-file-only, atomic, and SHA-bound. Verification metadata
contains only safe lengths, pass/fail state, reviewed hashes, and final
classification. It contains neither the full token nor raw payload values.

## Local proof and stop condition

The disposable Docker mirror runs full postflight, compact recovery, and sealed
recovery on one catalog state and proves their packets and classifications are
identical. The token test suite covers 26 catalog-decision states and rejects
format, length, digest, encoding, JSON, schema, baseline, and contradiction
failures.

No Production query is permitted until this repository checkpoint is committed,
pushed, and separately authorized. A sealed `NOT_COMMITTED` result never
authorizes replaying R6-5. Any token extraction or verification failure is a
mandatory stop with no supplementary query.
