# Task 10 report — normalized model builder

## Status

DONE

## Implementation

Created `scripts/devices/schema-v1/model.mjs` with the pure deterministic
`buildNormalizedModel(input)` contract. It consumes the normalized catalog,
reviewed definition registry, source metadata, identity mappings, and conflict
classification to return `definitions`, `devices`, `specs`, `sources`,
`sourceLinks`, `evidence`, and `blockers`. It makes no database or network
calls.

The builder preserves raw values, typed values, canonical unit, measurement
context, region, empty default variant, confidence, and verification date. A
curated true conflict becomes a `CONFLICT` spec plus exact primary/conflicting
evidence records. Device-level source links deliberately use `isPrimary=false`
because the inputs supply no reviewed device-level primary designation. Upstream
confidence/evidence blockers and unresolved identity blockers are retained;
unresolved identities create no device row.

## RED/GREEN evidence

RED (before `model.mjs` existed):

`node scripts/test-device-schema-v1-model.mjs`

Exited 1 with `MODEL_BUILDER_MISSING: buildNormalizedModel is not implemented`
and `ERR_MODULE_NOT_FOUND` for `scripts/devices/schema-v1/model.mjs`.

GREEN:

`node scripts/test-device-schema-v1-model.mjs`

Passed: `DEVICE_SCHEMA_V1_MODEL_OK definitions=2 devices=1 specs=2 sources=2 sourceLinks=2 evidence=2 blockers=2`.
The test asserts preservation of a numeric conflict value and of the raw plus
structured `2D up to 120; 3D up to 90` value, with no invented numeric winner.

Regression commands:

- `node scripts/test-device-schema-v1-normalize.mjs` — `devices=24 brands=8 specs=1488`
- `node scripts/test-device-schema-v1-definitions.mjs` — `count=7`
- `node scripts/test-device-schema-v1-sources.mjs` — `UNIQUE_SOURCE_URLS=36 SOURCE_METADATA_MAP_COUNT=36 UNMAPPED_SOURCE_URLS=0 AMBIGUOUS_SOURCE_URLS=0`
- `node scripts/test-device-schema-v1-conflicts.mjs` — `mappings=9 blockers=3`
- `node scripts/test-device-schema-v1-identity.mjs` — `mappings=23 blockers=1 releaseB=BLOCKED`
- `git diff --check` — passed with no output.

## Concerns

None. Release B remains intentionally blocked by the three unresolved
field-evidence mappings and the indeterminate Ray-Ban Gen 2 identity; Task 10
preserves those blockers rather than attempting to resolve them.

## Fix round 1

### RED/GREEN evidence

RED after adding the missing-source regression:

`node scripts/test-device-schema-v1-model.mjs`

Exited 1 with `TypeError: BLOCKED_SOURCE_METADATA: https://example.com/product`.
The prior builder threw instead of returning a blocker.

GREEN:

`node scripts/test-device-schema-v1-model.mjs`

Passed: `DEVICE_SCHEMA_V1_MODEL_OK definitions=2 devices=1 specs=2 sources=2 sourceLinks=2 evidence=2 blockers=2`.

The regression coverage now proves that an absent reviewed URL becomes a
deterministic `BLOCKED_SOURCE_METADATA` blocker while its source-link record is
omitted; valid remaining device-level source records remain. It also proves a
curated raw-only `CONFLICT` primary keeps all typed fields null while retaining
the raw primary display value and evidence. The multi-mode refresh case now
uses the actual Task 6 raw/text representation (`2D up to 120; 3D up to 90`),
with `valueNumber=null` and no invented comparison number.

The source-metadata regression additionally verifies that when a curated
field-level evidence set depends on an absent reviewed source, the complete
dependent evidence set is omitted. This prevents dangling evidence references
or an incomplete primary/conflicting claim set in a blocked model.

Regression commands rerun successfully:

- `node scripts/test-device-schema-v1-normalize.mjs` — `devices=24 brands=8 specs=1488`
- `node scripts/test-device-schema-v1-definitions.mjs` — `count=7`
- `node scripts/test-device-schema-v1-sources.mjs` — `UNIQUE_SOURCE_URLS=36 SOURCE_METADATA_MAP_COUNT=36 UNMAPPED_SOURCE_URLS=0 AMBIGUOUS_SOURCE_URLS=0`
- `node scripts/test-device-schema-v1-conflicts.mjs` — `mappings=9 blockers=3`
- `node scripts/test-device-schema-v1-identity.mjs` — `mappings=23 blockers=1 releaseB=BLOCKED`
- `git diff --check` — exit 0.
