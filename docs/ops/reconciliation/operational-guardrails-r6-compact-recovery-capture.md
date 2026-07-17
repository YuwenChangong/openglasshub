# R6 Compact Recovery Capture Contract

Status: `R6_RECOVERY_FAILURE_PATH_CONTRACT_READY` (repository-only).

The approved R6-5 mutation was submitted exactly once and is never replayed.
The full R6-6 postflight was submitted once but exceeded the capture budget. A
later compact, read-only recovery query was also submitted once. Its response
was rejected before canonical evidence persisted with
`RECOVERY_CAPTURE_ROW_COUNT_INVALID`.

The historical failure record has only that classification. It contains no
candidate count, JSON type, wrapper-layer state, or row shape. It therefore
does not prove that the connector returned a direct single row object, and this
repository does not normalize that unproven form.

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

## Future failure record

The capture runner now writes a separate atomic, SHA-bound diagnostic outside
Git on a rejection. It records only classification, validation stage, approved
envelope path, JSON types, parseability flags, array lengths, candidate count,
candidate type, exact-schema boolean, and normalized row count. It never
persists a raw connector envelope, scalar packet values, function body,
credential, URL, auth-user field, IP hash, or production row.

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
