# R6 Compact Recovery Capture Contract

Status: `R6_BLOCKED_RECOVERY_DIAGNOSTICS_INSUFFICIENT`.

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
