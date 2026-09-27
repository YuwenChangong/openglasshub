# Verified Session v1 AUTH-A read-only transport review

**OFFLINE SOURCE REVIEW ONLY. NOT AUTHORIZED. NO HOSTED OBSERVATION.**

This review supersedes the execution-path readiness assessment in
`verified-session-v1-auth-a-mechanisms.md`. It does not supersede the AUTH-A
scope, budgets, artifact locks, or human authorization requirement in
`verified-session-v1-auth-a-authorization.md`. The existing Production-capable
runner was reused; no second executor was created.

## Reviewed implementation and byte identities

| Path | SHA-256 |
| --- | --- |
| `scripts/lib/verified-session-auth-a-production-gate.mjs` | `a2702247e7ff636979224af64fb4ae6f706eecc07035e4946d20cadfc435c3be` |
| `scripts/qa/verified-session-auth-a-production.mjs` | `7034900491c1ae6b9f811326374aedaedfcf51990e869f3c2e9212abb2fce4a9` |
| `scripts/qa/verified-session-auth-a-execute.mjs` | `1c3b95743a86ead884dff936170eb915cf224c3e2dc8eabd5ed5b4da6a05a36d` |
| `scripts/qa/verified-session-auth-a-read-client.mjs` | `cc5d50bb09ddfe532576f187acf86a3133296366a2daeba66f78c67262537934` |
| `scripts/qa/verified-session-auth-a-cloudflare-read.mjs` | `2bbe69358b5ca52092d478441fa8e10a4badc951ad98722e8864ef25da281198` |
| `scripts/qa/verified-session-auth-a-supabase-read.mjs` | `c219576e22954eeb7413edd75d74f1ea12fbb3ad5651c2988b51c7a811d3bda4` |
| `scripts/qa/verified-session-auth-a-brevo-read.mjs` | `739f3cee459100b66af878133156825c306ff35275323ffbfa7686e605ab160d` |
| `scripts/qa/verified-session-auth-a-db-capture.mjs` | `15ead04234c831a9d8fb1844ef864a586431ef759a9e69921373410e25677d5f` |
| `scripts/qa/p9-readonly-postgres-transport.mjs` | `9aa1805daedf9a7c6afc4a7c65e33072eaac0a6a5442501d346d96d2d8f87d72` |

The Production entrypoint is `scripts/qa/verified-session-auth-a-production.mjs`.
It uses `process.env` only in a future directly authorized operator process.
The gate requires a clean exact branch/HEAD and the current committed packet
hash, and checks Foundation, Enforcement, catalog and migration-history bytes
against the frozen SHA-256 values before any dispatch. It requires the human
authorization to bind `TARGET_CLOUDFLARE_ACCOUNT_ID` to the operator-supplied
account ID without printing that value. `SOURCE_HEAD`, `PACKET_SHA256`, a
fresh single-use authorization ID and machine-current UTC are required.

## Exact allowed observations

| Class | Credential name | Host, method and exact path | Maximum | Accepted facts |
| --- | --- | --- | --- | --- |
| PostgreSQL | `P9_PRODUCTION_DATABASE_URL` | Exact project direct DB host or reviewed Session Pooler host on port 5432; one `psql` process, `BEGIN READ ONLY`, 11 frozen catalog SELECT units plus one frozen migration-history SELECT in the same session, explicit `ROLLBACK` | One connection/session, no reconnect or retry; 8 MiB combined output and 30 s process limit | Read-only transaction and same backend proof, typed metadata catalog and migration provenance; no application rows |
| Cloudflare | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `https://api.cloudflare.com`; GET `/client/v4/accounts/{bound_account_id}/workers/scripts/openglasshub/deployments`, then GET `/client/v4/accounts/{bound_account_id}/workers/scripts/openglasshub/versions/{version_id}` where the version ID comes only from the first validated result | Two requests, no retry | Exactly one deployment with one 100% active historical version, matching second response ID, bounded non-secret runtime/binding metadata |
| Supabase | `SUPABASE_ACCESS_TOKEN` | `https://api.supabase.com`; GET `/v1/projects`, then GET `/v1/organizations/{organization_slug}` derived from the unique target project | Two requests, no retry | Exact project ref/status and matching organization Free plan; remaining capacity stays `UNKNOWN` |
| Brevo | `BREVO_API_KEY`, `BREVO_VERIFIED_SENDER_EMAIL` | `https://api.brevo.com`; GET `/v3/account`, then GET `/v3/senders` | Two requests, no retry | One Free email send-limit plan, nonnegative credit fact, relay-enabled flag and at least one exact-email active sender; no ownership or delivery claim |

The HTTP client uses only GET, fixed HTTPS origins and path allowlists, manual
redirect handling followed by exact HTTP 200 rejection, a 128 KiB response
body cap, and JSON/schema validation. It cannot follow redirects, paginate,
poll, call arbitrary URLs, or issue a write method. The database packet hashes
and SELECT-unit identities are checked before spawn. `psql` uses `-X`,
`ON_ERROR_STOP`, one process, read-only transaction proof, same-backend proof
and explicit rollback. Ambiguous, partial or malformed results stop without
retry. No transport exposes a write operation.

## Single use and output

`scripts/lib/verified-session-auth-a-production-gate.mjs` atomically creates
an exclusive consumed sentinel immediately before the first external dispatch.
The ID remains consumed after success, HTTP failure, timeout or ambiguous
response. Its fixed dispatch order is Cloudflare 2, Supabase 2, Brevo 2, then
PostgreSQL 1; a later or repeated dispatch is denied. Tests place sentinels
only in isolated temporary directories, never in real Git metadata.

Shared receipts contain only allowlisted booleans, counts, statuses, immutable
IDs, non-secret hashes and classified metadata. They omit credentials, sender
addresses, raw provider envelopes, SQL rows and raw errors. The tests use fake
secret markers and injected fetch/spawn or owned loopback fixtures. The
independent review found no exposed PostgreSQL, Cloudflare, Supabase or Brevo
write capability. Provider response fixtures prove only the offline contract;
unexpected hosted shapes must block, not be reinterpreted.

## Offline proof and future boundary

Focused tests: `scripts/qa/test-verified-session-auth-a-*.mjs` and
`scripts/qa/p9-readonly-postgres-transport.test.mjs`. The local DB test owns a
disposable loopback PostgreSQL fixture. The release regression is
`npm run qa:release`, never `qa:prod`.

No Production connection, provider request, email, deploy, Auth call or
Production write occurred during this review. A future AUTH-A attempt requires
a fresh human single-use authorization for the exact committed packet, code
fingerprints, target, budget and account binding. It must be launched by the
authorized operator from a direct credential-bearing PowerShell process;
Codex Desktop must not be assumed to inherit Production credentials. This
document is neither that authorization nor a command to execute AUTH-A.
