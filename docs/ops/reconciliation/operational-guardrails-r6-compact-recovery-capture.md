# R6 Compact Recovery Capture Contract

Status: `R6_RECOVERY_STDIN_TRANSPORT_READY` (repository-only).

The approved R6-5 mutation was submitted exactly once and is never replayed.
The full R6-6 postflight was submitted once but exceeded the capture budget. A
later compact, read-only recovery query was also submitted once. Its ad hoc
PowerShell stdin handoff then failed before JSON parsing with `Unexpected end
of JSON input`; no canonical or failure evidence persisted.

The dynamically assembled pipe was not a checked-in transport. The parser error
does not prove truncation, premature EOF, a missed write, or a UTF-8 conversion
defect, so the transport-root-cause classification remains
`TRANSPORT_ROOT_CAUSE_INSUFFICIENT`. It does prove a separate
`RUNNER_PREPARSE_FAILURE_EVIDENCE_DEFECT`: failure-path initialization happened
after stdin parsing. This repository does not normalize any unproven connector
shape.

## Supported shape

The only accepted compact recovery result remains an exact proven connector
envelope at `$[0].text#json.result#wrapped_json`, whose fenced JSON decodes to
an array containing exactly one compact row object. The row must pass the exact
schema, canonical-size, evidence-fingerprint, and baseline checks before any
canonical evidence is written.

Direct single objects, nested arrays, metadata wrappers, scalar and null
results, multiple content blocks, multiple rows, and arbitrary wrappers are
rejected. No recursive discovery, flattening, first-object selection, or
packet-version-only acceptance is permitted.

## Stdin transport contract

`scripts/run-operational-guardrails-r6-compact-recovery-transport.mjs` is the
checked-in parent transport for a future separately approved recovery. It
accepts exactly one UTF-8 JSON payload on stdin, buffers at most 64 KiB, rejects
empty, whitespace-only, BOM-prefixed, invalid-UTF-8, oversized, incomplete, and
invalid JSON without logging the payload. It launches the capture runner with
`child_process.spawn`, `shell: false`, pipe-only stdio, Buffer writes,
drain-aware backpressure handling, exactly one `stdin.end()`, and an awaited
child close. Raw input never appears in argv, environment variables, stdout,
stderr, or persistent evidence.

The child applies the existing exact envelope, fenced JSON, one-row, schema,
canonical-size, evidence-fingerprint, and baseline checks unchanged. A timeout
or child anomaly fails closed. This repository-only harness has not contacted a
cloud service.

## Pre-parse failure record

Before reading stdin, the capture runner validates and reserves all five
approved destinations. Any later transport failure writes the exact failure JSON
and SHA pair atomically. It records only classification, `stdin-transport`, byte
and chunk counts, EOF/normal-end flags, UTF-8/empty/whitespace/JSON flags, a
parser-error category, and the byte limit. It never persists raw stdin,
connector content, excerpts, SQL values, identifiers, credentials, URLs,
function bodies, business rows, or auth-user data.

Strict-packet failures retain the existing value-blind structural record. The
failure JSON is durable before its SHA sidecar; a sidecar failure removes the
JSON. Stale or colliding destinations fail before input processing.

The prior production record is immutable. A future recovery execution requires
new explicit approval and must use this improved bridge. No catalog conclusion
has been drawn in this repository-only phase.

## Exact R6 recovery destinations

The prior R6J attempt stopped before dispatch: the old derived failure-name
contract could not create the separately approved failure filenames. No
Production SQL was submitted. The runner now accepts an explicit failure JSON
path and explicit SHA sidecar path, while keeping the old derived
`.capture-error.*` paths only for local backward compatibility.

| Evidence | Exact outside-Git path |
| --- | --- |
| Success JSON | `C:\\Users\\1\\OpenGlassHub-R6-Proof\\r6-6-compact-postflight-recovery-v2.json` |
| Success SHA | `C:\\Users\\1\\OpenGlassHub-R6-Proof\\r6-6-compact-postflight-recovery-v2.sha256` |
| Success structure | `C:\\Users\\1\\OpenGlassHub-R6-Proof\\r6-6-compact-postflight-recovery-v2-structure.json` |
| Failure JSON | `C:\\Users\\1\\OpenGlassHub-R6-Proof\\r6-6-compact-postflight-recovery-v2-failure.json` |
| Failure SHA | `C:\\Users\\1\\OpenGlassHub-R6-Proof\\r6-6-compact-postflight-recovery-v2-failure.sha256` |

The R6 operator transport must invoke the runner with `--output`, `--baseline`,
`--baseline-sha256`, `--failure-output`, and `--failure-sha-output`. It passes
the complete connector response through UTF-8 stdin, never argv. Only paths
and the reviewed baseline hash appear in argv; no raw connector response is
copied, logged, rewritten, renamed, or persisted.

All five artifact paths must be distinct, absolute, outside the Git worktree,
and use the required JSON/SHA extensions. The runner resolves existing parent
directories before writing so an observable symlink into the worktree is
rejected. It rejects an existing success or failure artifact before parsing a
response: a success cannot look current beside stale failure evidence, and a
rejection cannot coexist with partial success evidence. Every accepted write
uses the existing atomic temporary-file/rename sequence; the failure SHA is
created only after the complete value-blind failure JSON is durable. No
post-capture rename or copy is permitted.

## R6L result and stop condition

R6J2 submitted exactly one compact, read-only recovery query. R6-5 was not
replayed. R6L changes only checked-in transport and pre-parse diagnostics; it
does not issue a query, execute SQL, contact Supabase or Cloudflare, change a
secret, or alter production state. Synthetic tests cover one and many chunks,
UTF-8 split boundaries, CRLF, normal EOF, path-with-spaces, canonical evidence,
and atomic SHA output; they also cover exact failure pairs for empty,
whitespace-only, truncated, malformed, invalid-UTF-8, BOM, oversized, and
concatenated input. The historic failure is reproduced with synthetic truncated
JSON only.

A new production query remains prohibited until an explicit approval grants
exactly `APPROVE_R6M_ONE_COMPACT_READ_ONLY_RECOVERY_EXECUTION_WITH_HARDENED_TRANSPORT`.
