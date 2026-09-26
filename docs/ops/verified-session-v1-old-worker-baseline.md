# Verified Session v1 old Worker baseline

HISTORICAL EVIDENCE RECOVERY
NO NEW PROVIDER OBSERVATION
NO PRODUCTION AUTHORIZATION

The project owner supplied the following prior formal Production-origin release evidence. This record preserves that historical report; this offline task did not independently observe Cloudflare or Production.

| Historical fact | Reported value |
| --- | --- |
| Worker name | `openglasshub` |
| Canonical origin | `https://openglasshub.ogh.workers.dev` |
| Worker version ID | `dba19da7-2fa8-4055-a94d-25c83ad3a02a` |
| Source commit and MAIN | `e6c2141be8827d961fc49462d66be8da9b4993eb` |
| Deployment status | `SUCCESS` |
| Deployment source matched MAIN | `true` |

WORKER_IDENTITY_PROVENANCE=HISTORICAL_VERIFIED_VERSION_BINDING
RAW_REBUILD_EQUIVALENCE_NOT_USED=true
ROOT_CAUSE=ASTRO_RANDOM_SERVER_ISLAND_KEY_WHEN_ASTRO_KEY_UNSET
RUNTIME_SEMANTIC=true
CANONICALIZATION_REJECTED=true

Astro embeds a generated server-island encryption key when `ASTRO_KEY` is absent. Rebuilding the old source now cannot be expected to reproduce the historical Worker bytes; the key must not be stripped or replaced for identity matching. This record does not claim an ETag, raw artifact digest, historical `ASTRO_KEY`, or Cloudflare-attested source commit.

A future, separately authorized AUTH-A must freshly observe the active Cloudflare deployment and require its sole 100% version to equal the historical version above. It must then fetch that exact version's metadata and require the returned ID to match. A changed, missing, split, or ambiguous deployment blocks AUTH-A. Version alone without the historical release binding is not source proof; the historical report alone is not proof that the version remains active.

For AUTH-C preparation only, the new deployable Worker needs a separately reviewed stable `ASTRO_KEY` build contract so future builds can be reproducible without accidental server-island key rotation. No AUTH-C change is made here.
