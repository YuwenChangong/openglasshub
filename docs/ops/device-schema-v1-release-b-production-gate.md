# Device Schema v1 Release B Production authorization gate

This is an offline, value-blind authorization-packet validator. It does not
open a database connection, invoke a provider CLI, import data, apply a
migration, or make a Cloudflare change. Passing the gate is evidence for one
separately human-controlled future recovery operation; it is not that
operation and is not a retry permission.

`assertReleaseBProductionGate(input)` is exported by
`scripts/qa/device-schema-v1-release-b-gate.mjs`. It requires exactly the
documented JSON-like input shape and returns an immutable
`{ allowed: boolean, missing: string[] }`. Unknown fields, symbols,
non-enumerable/accessor properties, proxies, cycles, secret-bearing keys,
DSNs, credentialed URLs, private-key material, and token-shaped values are
rejected before evidence evaluation. Supplied values are never echoed.

## Frozen candidate and value-blind packet

The candidate source is exactly commit
`4787375a84cb55b3fb3fc86bdab66ae6dc565fbc`, not the caller's working tree.
The operator must prove a clean, isolated worktree and calculate every input
artifact from `git show 4787375a84cb55b3fb3fc86bdab66ae6dc565fbc:<path>`;
uncommitted files are not packet inputs. A new payload, importer, or source
commit requires a newly reviewed packet and distinct authorization.

| Binding | SHA-256 / exact value |
| --- | --- |
| Production project | `xcbnxzjlsvtgzixurcof` |
| approved YAML bytes | `a4da41f5011911ddbc9f602a7bd3322148a71314955303f67d08ef2d95bddc9b` |
| source metadata sidecar bytes | `1a46f7676847d9064e53c5031af065f5d0e306bd2c3e002bcbdf3e8ecd3dc1f2` |
| conflict-map sidecar bytes | `056d89a95abce13b898913bed7ce2712bd738cd5dec5560a4143cfc48bba4a28` |
| identity-map sidecar bytes | `82801dc594469010c70dcf086396824f86ae22e55e35896015045a9af1b0a2b2` |
| canonical definition registry | `be0ce61f4a15f2d39c3c16e14b9ad978ed358f64150ed4fd81235315601c691f` |
| normalized model | `b9cf3dc49010200f5b5d3b2fa4e2edae1a4e9d89c02e47e7327680febbf27451` |
| normalized payload (canonical normalized YAML) | `c4b2bbaca63376402fcd4ca00af108a953a0b94d0975db2c579698e8a08aa333` |
| no-delete recovery plan | `c1583080fdffa004861c70ab9c2987a19839b87b30846cbf9983994e6b64e5e7` |
| local importer source bytes | `ee78b01ecdeb63161978bf91791e05c9ea56cef1fbba4d8761d6fd332f7c32c9` |

The registry, normalized-model, and normalized-payload hashes are SHA-256 of
canonical JSON (recursive code-point key sort, no whitespace). The plan hash
is `fingerprintRecoveryPlan(plan)`. Two independently run normalized payload
rebuilds must both equal the frozen normalized-payload hash.

## Required evidence

The gate requires Release A status `PASS`, one Release A migration-history
record, schema postconditions `PASS`, and migration SHA-256
`a117631dd7a1ffa848b1df8dfbc8286bc7f901a1375961b3d4fe9ad5b2a2d215`.

Catalog identity and mapping evidence is exact: 24 YAML devices, 8 brands, 24
identity-map entries, 24 unique target slugs, zero unresolved identities,
`OPERATOR_APPROVED_GEN2` for Ray-Ban, canonical slug `ray-ban-meta`, zero
unmapped/ambiguous source URLs, zero unresolved evidence maps, and seven true
value conflicts. The conflict validator must attest that every such conflict
has exactly one primary claim and at least one conflicting claim. The payload
has 24 devices, 1,488 specs, and zero duplicate device/spec/source/evidence
identities.

The dry run and in-memory importer-contract rehearsal each require these operation counts: 92
definitions, 24 devices, 39 sources, 46 source links, 1,488 specs, 15 evidence
rows, and 24 compatibility rows. Both require `DELETE=NONE`; the first dry run
also requires zero blockers/conflicts. The in-memory rehearsal requires
successful adapter constraints with no repair, and its second dry run requires
zero blockers and `DELETE=NONE`; it is not SQL constraint evidence.

A separate `localSqlRehearsal` record is mandatory. It must identify
`LOCAL_DISPOSABLE_SQL`, have `status=PASS` and `constraints=PASS`, carry the
same exact operation counts, state `repaired=false`, and prove an idempotent
second dry run with zero blockers and `DELETE=NONE`. `NOT_RUN`, in-memory-only,
or non-disposable evidence is blocked by
`LOCAL_SQL_TRANSACTIONAL_REHEARSAL_REQUIRED`. Compatibility evidence must pass locally for `/products/`,
brand grouping, the `ray-ban-meta` route, and YAML-derived `key_specs` and
`full_specs` (`YAML_SPEC_VALUE_SINGLE_SOURCE=true`,
`BOOTSTRAP_SPEC_VALUES_AUTHORITATIVE=false`,
`LEGACY_COMPAT_SPEC_SOURCE=YAML_DERIVED`). `qa:release` must be a pass and
record zero Production connections and provider writes.

Controller-supplied, value-blind Production precheck evidence must bind the
target project and show: Release A history 1; six target tables; seven enums;
six RLS-enabled target tables; seven Schema v1 device columns; 22 target
policies; required functions and triggers present; and zero rows in devices,
definitions, specs, sources, source links, evidence, and audit events. Any
unknown count or drift blocks the gate.

Expected post-commit counts are separately exact: 24 devices, 24 unique slugs,
24 published devices, 92 definitions, 1,488 specs, 39 sources, 46 source
links, 15 evidence rows, and zero audit events. The importer has no audit-event
write entity, so `auditEvents=0` is a required exact count. A mismatch blocks
with `EXACT_PRODUCTION_AFTER_COUNTS_REQUIRED`.

Future execution evidence is constrained to `transaction=ONE`, `attempts=1`,
`retry=FORBIDDEN`, and `failureDisposition=STOP_UNKNOWN_STATE`. A failure,
timeout, ambiguity, or unknown state ends the procedure without an automatic
or manual retry under this packet. A distinct bounded authorization object is
also mandatory: `release-b-approval-<at least three digits>` plus a strict UTC
millisecond timestamp. Release A authorization does not satisfy this field.

## Current authorization state

This document and evaluator prepare the gate only. They do not manufacture a
successful local SQL rehearsal or `qa:release` result. Current readiness is
blocked: no real local/disposable SQL rehearsal has been supplied, and the
latest `qa:release` result is not a pass. Until every supplied record passes
and a separate Release B authorization exists, the evaluator returns
`allowed: false`; a synthetic all-pass evaluator fixture is a contract test,
not operational readiness evidence.

Run the offline evaluator with:

```powershell
node scripts/qa/test-device-schema-v1-release-b-gate.mjs
```
