# Task 7 — Source metadata sidecar report

## Scope

Implemented the reviewed source-metadata sidecar, its deterministic loader and
validator, and its standalone contract test. This work is local repository
validation only; it performs no database, provider, Cloudflare, deployment, or
production action.

## RED evidence

Command:

```powershell
node scripts/test-device-schema-v1-sources.mjs
```

Observed expected RED before implementation: `ERR_MODULE_NOT_FOUND` for
`scripts/devices/schema-v1/sources.mjs`. The reviewed source-metadata map and
its resolver did not exist.

## GREEN evidence

Commands:

```powershell
node scripts/test-device-schema-v1-sources.mjs
node scripts/test-device-schema-v1-normalize.mjs
git diff --check
```

Observed output:

```text
DEVICE_SCHEMA_V1_SOURCES_OK UNIQUE_SOURCE_URLS=36 SOURCE_METADATA_MAP_COUNT=36 UNMAPPED_SOURCE_URLS=0 AMBIGUOUS_SOURCE_URLS=0
DEVICE_SCHEMA_V1_NORMALIZE_OK devices=24 brands=8 specs=1488
```

`git diff --check` completed with no output and exit code 0.

## Release B source invariants

- `UNIQUE_SOURCE_URLS=36`
- `SOURCE_METADATA_MAP_COUNT=36`
- `UNMAPPED_SOURCE_URLS=0`
- `AMBIGUOUS_SOURCE_URLS=0`
- Every record has a normalized URL, nonempty publisher, approved explicit
  source type, and ISO `accessed_at`; `title` and `published_at` are nullable.
- Resolution is exact normalized-URL lookup only. The test proves an unknown
  domain/path remains unmapped; no domain or path classification occurs.
- `reputable_secondary` renders as `Secondary source`, never `Official`.

## Concerns

None. The existing Ray-Ban identity Release B blocker is intentionally outside
this task and remains preserved by the normalization/identity work.
