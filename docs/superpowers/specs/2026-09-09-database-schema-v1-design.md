# OpenGlass Hub Database Schema v1 — Architecture Design

## 1. Context and current problem

Production `public.devices` is currently empty. The public product pages already
read that table through `listPublishedDevices()` and
`getPublishedDeviceBySlug()` in `src/lib/public-device-data.ts`; therefore the
brand shell can render while every brand has zero products. The prior static
catalog must not be restored directly into the legacy model. Schema v1 Release
B is the only approved path for the 24-device recovery.

The existing table deliberately combines device identity/presentation with two
legacy JSONB fields, `key_specs` and `full_specs`. That is adequate as a
compatibility surface but not as a queryable, evidence-backed specification
system. Schema v1 adds normalized definitions, values, sources, and evidence
without removing any legacy field or changing a public reader in Release A.

## 2. Goals

- Preserve the established stack: Astro SSR, React islands, TypeScript,
  Supabase PostgreSQL, and Supabase Auth plus RLS. Deployment remains the
  existing Cloudflare Workers runtime; this design makes no provider change.
- Import the user-approved 24-device YAML through a deterministic, non-
  destructive Schema v1 importer after additive schema deployment.
- Separate device identity and presentation from reusable parameter
  definitions, per-device values, sources, and field-level evidence.
- Preserve measurement context, state, provenance, conflicts, and the
  distinction between native and accessory capability.
- Make future Product Detail v2, Compare v2, and integrated administration
  data-driven without turning `devices` into a 100-column table.

## 3. Non-goals

- No migration, importer execution, database write, configuration write,
  deployment, or frontend reader cutover is authorized by this document.
- Release A does not drop, rewrite, or deprecate `key_specs` or `full_specs`.
- It does not recreate a separate admin application, introduce a second role
  model, add scoring/recommendations, add GA4, or configure Search Console.
- YAML is not a runtime database substitute after the initial import.

## 4. Authoritative inputs and source boundaries

### Product identity and presentation

`src/lib/device-catalog.ts` is the current 24-device bootstrap catalog. Its
local-only importer, `scripts/migrate-static-device-catalog-to-supabase.mjs`,
serializes identity and presentation rows, refuses non-loopback targets, and
has been used by disposable local P6B/P6C acceptance. It supplies only values
the YAML does not authoritatively specify: existing slug, brand key, images,
descriptions, route metadata, publication metadata, and legacy compatibility
payloads.

The historic 13-entry `src/data/devices.ts` MVP is provenance only. It is not
the recovery source and must not be treated as the current canonical catalog.

### Product specification values

`openglasshub_device_data_v1.yaml` is authoritative for Schema v1 values,
states, schema types, measurement meaning, confidence, conflicts, notes,
device-level source URLs, `verified_at=2026-09-05`, and its declared 24-device,
8-brand scope. It defines exactly two schema types: `display_ar` and `ai_hud`.
Older bootstrap specification text must never overwrite YAML specifications.

### Deterministic identity map

The importer creates a reviewed map of `{ yamlBrand, yamlModel, yamlGeneration
}` to exactly one existing bootstrap slug. Matching is normalized only for
specified casing/whitespace rules and must still resolve one exact approved
map entry; it must not do fuzzy matching. It blocks on zero matches, multiple
matches, changed generation, an unmapped device, or duplicate target slugs.

The initial approved map is: `XREAL One→xreal-one`, `XREAL One Pro→xreal-one-pro`,
`XREAL Air 2 Pro→xreal-air-2-pro`, `XREAL Air 2 Ultra→xreal-air-2-ultra`,
`XREAL Air→xreal-air`, `XREAL Air 2→xreal-air-2`, `RayNeo X2→rayneo-x2`,
`RayNeo Air 2→rayneo-air-2`, `RayNeo Air 2s→rayneo-air-2s`,
`RayNeo Air 3s→rayneo-air-3s`, `RayNeo Air 4 Pro→rayneo-air-4-pro`,
`RayNeo X3 Pro→rayneo-x3-pro`, `Rokid Max→rokid-max`, `Rokid Air→rokid-air`,
`Rokid AR Lite→rokid-ar-lite`, `Rokid Glasses→rokid-glasses`,
`VITURE Pro→viture-pro`, `VITURE One→viture-one`,
`VITURE One Lite→viture-one-lite`, `INMO Air 2→inmo-air-2`,
`INMO GO3→inmo-go3`, `Brilliant Labs Frame→brilliant-labs-frame`, and
`Even Realities G1→even-realities-g1`. The Ray-Ban mapping is deliberately
absent pending the generation guard below.

`Ray-Ban Meta Gen 2` has an explicit generation guard: an existing generic or
Gen 1 `ray-ban-meta` record is a `BLOCKED_IDENTITY_MISMATCH`, never an update.
It requires an administrator-approved identity resolution before any write.

## 5. Current architecture inventory

| Area | Current representation | Schema v1 consequence |
| --- | --- | --- |
| `public.devices` | Identity, presentation, publication, media, URLs, JSONB key/full specs; unique slug; `slug_locked` after first publish | Remains compatibility table and public identity record. |
| Public loader | `listPublishedDevices` / `getPublishedDeviceBySlug` select published rows from `devices` | Release A/B leave these readers unchanged. |
| `/products/` | Maps static `brandCatalog` shell to database-published product counts and previews | Importing 24 published identities restores page visibility without Detail v2. |
| Product detail | `/devices/[slug]` loads one published row then redirects to its product anchor | Detail v2 is deferred to Release D. |
| Current compare | `/products/[brand]` serializes selected legacy fields from `full_specs`/`key_specs` | Compare v2 is deferred to Release E. |
| Admin | Existing `/admin/devices` and `/api/admin/devices.ts`; server authorization uses `requireAdmin`/`requireModerator` and `profiles.role` | Add routes and server handlers inside this shell; no parallel role system. |
| RLS | Public select is only `publication_status='published'`; staff CRUD uses `public.is_moderator_or_admin()` | Reuse this predicate, grants, RLS style, and server-side authorization. |
| Audit | There is no catalog-specific immutable audit entity in current device schema | Add a narrow catalog audit trail in Release C. |
| QA Harness | Devices are MEDIUM; admin/database are HIGH and require `qa:release`; `qa:prod` is read-only smoke | Schema/admin changes are release-gated; no production smoke is part of this design. |

## 6. Proposed relational model

All new tables are in `public`, have RLS enabled, use `uuid` primary keys,
`timestamptz` timestamps, and have explicit `anon`/`authenticated` grants only
where public reading is intended. No view or `SECURITY DEFINER` function is
needed for Release A.

The exact proposed enums are: `device_schema_type = ('display_ar', 'ai_hud')`;
`device_presentation_profile = ('display', 'ai_camera', 'hud', 'developer')`;
`device_spec_value_type = ('number', 'boolean', 'text', 'json')`;
`device_spec_state = ('KNOWN', 'NOT_DISCLOSED', 'NOT_APPLICABLE', 'CONFLICT',
'UNKNOWN_UNVERIFIED')`; `device_spec_confidence = ('HIGH', 'MEDIUM', 'LOW')`;
`device_spec_comparison_mode = ('higher', 'lower', 'equal_only', 'none')`; and
`device_source_type = ('current_official_product_page', 'official_manual',
'official_spec_sheet', 'official_developer_docs', 'official_faq',
'regulatory_document', 'archived_official', 'reputable_secondary')`.

### 6.1 `devices`: identity, presentation, and publication

`devices` keeps its current columns and constraints. Schema v1 may add only
additive identity fields where current presentation is insufficient:

`generation text`, `schema_type device_schema_type`, `device_type text`,
`presentation_profile device_presentation_profile`, `status text`,
`release_date date`, and `last_verified_at date`.

Responsibilities remain: `id`, `slug`, brand identity, model/name, generation,
publication status, descriptions, media/images, official/product URLs, and
timestamps. `schema_type` expresses validity/applicability; it does not select
UI cards. `presentation_profile` (`display`, `ai_camera`, `hud`, `developer`)
selects dynamic Key Specs. They are independent values.

`key_specs` and `full_specs` remain unchanged in Release A through Release E
until a separate, proven cleanup project. The importer may populate their
existing compatibility representation only from current bootstrap presentation
data; YAML spec values are normalized into `device_specs`.

### 6.2 `device_spec_definitions`: immutable canonical registry

One row defines what a parameter means. Proposed columns:

`id`, `key text`, `group_key text`, `label text`, `help_text text`,
`value_type device_spec_value_type`, `canonical_unit text`,
`measurement_context text`, `comparison_mode device_spec_comparison_mode`,
`require_same_context boolean`, `applicable_schema_types device_schema_type[]`,
`is_core boolean`, `admin_order integer`, `is_active boolean`, `created_at`,
and `updated_at`.

`key` is globally unique, nonblank, and immutable after any `device_specs`
reference exists. Referenced definitions cannot be hard-deleted; deactivation
is the only removal action. Labels, help text, ordering, and active state may
change. A semantic change to `value_type`, `canonical_unit`,
`measurement_context`, `comparison_mode`, or applicability is rejected when
referenced unless a separate audited data migration proves every existing value
remains valid; the normal admin editor cannot make that reinterpretation.

The registry includes every YAML key and keeps brightness distinct:
`display.eye_brightness` uses context `eye_brightness`; and
`display.panel_or_projector_brightness` uses context
`panel_or_projector_brightness`. There is no generic `brightness` key.
`tracking.native_3dof`, `tracking.native_6dof`, `tracking.accessory_3dof`, and
`tracking.accessory_6dof` are distinct definitions.

### 6.3 `device_specs`: one asserted specification per identity/context

Proposed columns are `id`, `device_id`, `spec_definition_id`, `state
device_spec_state`, `value_number numeric`, `value_boolean boolean`,
`value_text text`, `value_json jsonb`, `canonical_unit text`,
`measurement_context text`, `raw_value text`, `region text`, `variant text`,
`confidence device_spec_confidence`, `verified_at date`, `note text`,
`updated_by uuid references public.profiles(id)`, `created_at`, `updated_at`.

The unique key is `(device_id, spec_definition_id, region_key, variant_key)`,
where `region_key` and `variant_key` are stored generated/coalesced values so
`NULL` never permits duplicate logical rows. The default import uses `Global`
and an empty variant. A product-specific SKU or region therefore becomes an
explicit different row rather than silently overwriting a global value.

`raw_value` preserves the publisher-facing display form. `CANONICAL_COMPARE_VALUE`
means the typed `value_number`/`value_boolean` plus canonical unit and context,
and is present only where a definition allows a sound comparison. `DISPLAY_RAW_VALUE`
is `raw_value` plus supporting structured `value_json` when needed. For example,
`"2D up to 120; 3D up to 90"` retains its full raw text and optional mode
objects, while no invented single refresh winner is exposed. Examples supported
without fake precision include `57`, `"Up to 120"`, `"3500 average / 6000
peak"`, `"76±1"`, `"0 to -6D"`, boolean values, and structured mode runtime.

### 6.4 `device_sources`: reusable source records

Proposed columns are `id`, `publisher`, `title`, `url`, `source_type
device_source_type`, `published_at`, `accessed_at`, `region`, `created_at`, and
`updated_at`. `url` is unique after normalized URL validation. Ordered source
types are `current_official_product_page`, `official_manual`,
`official_spec_sheet`, `official_developer_docs`, `official_faq`,
`regulatory_document`, `archived_official`, and `reputable_secondary`.
Secondary content is never labeled Official in public rendering.

Device-level YAML `source_urls` create device-associated source records through
`device_source_links(device_id, source_id, is_primary, note, created_at)`.
They are not automatically field-level evidence.

### 6.5 `device_spec_evidence`: field-level claims

Proposed columns are `id`, `device_spec_id`, `source_id`, `claimed_value`,
`is_primary`, `is_conflicting`, `note`, and `created_at`. It has a unique
`(device_spec_id, source_id, claimed_value)` constraint, at most one primary
row per spec, and foreign keys with restrictive deletes. A source cannot be
hard-deleted while evidence references it.

Only unambiguous input mappings create field-level links. YAML conflict prose
creates no guessed link: it requires an explicit curated mapping from conflict
to canonical spec key, otherwise the importer reports `BLOCKED_EVIDENCE_MAP`
for review while retaining the device-level source association.

## 7. State, values, evidence, and comparison invariants

The closed state enum is `KNOWN`, `NOT_DISCLOSED`, `NOT_APPLICABLE`, `CONFLICT`,
and `UNKNOWN_UNVERIFIED`.

| State | Required invariant | Public/Compare behavior |
| --- | --- | --- |
| `KNOWN` | Exactly one typed value consistent with definition type; required unit/context present where defined | Eligible only when all compare conditions hold. |
| `NOT_DISCLOSED` | No canonical typed value | Shows disclosure state; never ranks. |
| `NOT_APPLICABLE` | No canonical typed value; definition must be inapplicable for device schema type | May be hidden in normal view; never ranks. |
| `CONFLICT` | No winner; at least one primary and one conflicting evidence row | Shows warning and claims; never ranks. |
| `UNKNOWN_UNVERIFIED` | No verified canonical claim | Admin-visible research state; never promoted as public verified fact or ranked. |

YAML mapping is exact: concrete value maps to `KNOWN`; `Not disclosed` to
`NOT_DISCLOSED`; `Not applicable` to `NOT_APPLICABLE`; explicit `No` to
`KNOWN false`; official/source conflict to `CONFLICT`; and unresearched or
untrusted placeholder to `UNKNOWN_UNVERIFIED`. SQL checks and importer
validation enforce state/value compatibility; `NULL` alone never expresses a
semantic state.

A Compare v2 winner is allowed only when each candidate is `KNOWN`, has a
compatible canonical unit, has compatible measurement context, has no conflict,
and the definition mode is not `none`. Eye brightness and
panel/projector brightness are not directly comparable. Accessory 6DoF is
never represented as native 6DoF. Equal values may be hidden; differing known
values or differing states remain visible.

## 8. Administration, authorization, and auditability

Release C extends the existing admin shell with `/admin/devices`,
`/admin/devices/[id]`, and `/admin/device-specs`. The device editor has
General, Specifications, Sources & Evidence, and Publishing sections.
General controls existing presentation fields plus generation, schema type,
device type, profile, and status. The existing `slug_locked` rule remains
authoritative: a published/stable slug cannot silently change.

The specifications editor is registry-driven, never a monolithic JSON
textarea. It renders type, unit, state, applicability, and measurement context
from the definition. State-specific validation runs server-side. Editors can
manage values, notes, confidence, verification date, source links, and
conflicts. `/admin/device-specs` permits label/help/group/unit/context/mode/
applicability/core/order/activity management subject to the immutable-key and
semantic-change rules above.

Public users read only published devices and intentionally public,
eligible source/spec metadata. Non-admin authenticated users cannot mutate any
catalog table. Admin mutation is authorized in server handlers with the
existing `requireAdmin` flow and matching RLS predicate
`public.is_moderator_or_admin()`; client UI never grants authority. The
service-role importer is a separately authorized operator process only.

Release C adds `catalog_audit_events`: `id`, `actor_id`, `entity_type`,
`entity_id`, `action`, `changed_fields jsonb`, and `created_at`. It is
append-only to admins and inaccessible publicly; application mutations write
an allowlisted before/after summary, not secrets or unbounded payloads.

## 9. Importer and source-of-truth transition

The planned `scripts/devices/import-device-schema-v1.mts` pipeline is:

1. Parse YAML and validate its declared device/brand counts and allowed keys.
2. Normalize state, typed values, raw values, context, source types, and
   confidence without changing source semantics.
3. Resolve the explicit identity map against the current 24 bootstrap slugs.
4. Validate definitions, applicability, uniqueness, source/evidence mappings,
   and conflict invariants.
5. Calculate a deterministic per-device diff: `INSERT`, `UPDATE`,
   `UNCHANGED`, `CONFLICT`, or `BLOCKED`; default `DELETE=NONE`.
6. Exit successfully only for a complete dry run. A write requires separate
   explicit authorization and one transaction.

The importer never fuzzy-matches, never deletes, never silently overwrites
post-import admin edits, and never turns a field-level ambiguity into evidence.
Reruns default to drift-detecting dry runs. A separately authorized write may
insert missing rows and update only explicitly owned initial-import fields;
any divergence from catalog-audit provenance is a conflict for operator
resolution, not an overwrite.

Before Release B the YAML is canonical migration/import input. After its
verified import, PostgreSQL is the runtime and admin source of truth. YAML is
retained as provenance, reproducible import input, and regression fixture; it
is not rewritten when administrators edit the database.

## 10. Releases and failure handling

1. **Release A — additive schema:** enums, new tables, constraints, indexes,
   RLS, grants, and no reader cutover or legacy JSONB removal.
2. **Release B — controlled 24-device recovery:** approved transactional
   importer. Preconditions: production device count is zero, 24 YAML records
   resolve to 24 unique bootstrap slugs, and every required identity is exact.
   Postconditions: 24 devices, expected published count, exact expected spec
   rows, no duplicate device/spec context keys, and no unexpected identities.
3. **Release C — administration:** device, definitions, source/evidence UI and
   server APIs with audit events and authorization tests.
4. **Release D — Product Detail v2:** SSR reader uses normalized specs only
   after preview evidence; legacy rendering remains fallback until accepted.
5. **Release E — Compare v2:** context-aware comparison and no-winner safety.

Any schema validation, identity, source mapping, count, transaction, or
postcondition failure rolls back Release B and leaves public runtime unchanged.
No compensating delete or legacy replay is permitted. A zero-row table is not
treated as evidence of a successful prior import.

## 11. Research metrics

Research Completion is `(KNOWN + NOT_DISCLOSED + NOT_APPLICABLE + CONFLICT) /
applicable investigated core fields`, target at least 95%. Verified Data
Coverage is `(reliable KNOWN + appropriate primary official conflict value) /
applicable fields`, initially 70–85% depending on available sources. Neither
metric may be increased by fabricated values or unqualified secondary claims.

## 12. Testing and QA strategy

- Database: enum/check/FK/unique constraints; forbidden state/value pairs;
  definition key immutability; referenced definition deactivation versus
  deletion; source/evidence conflict invariants.
- Importer: 24-device YAML validation, exact identity map, duplicate keys,
  Generation guard, state normalization, context mismatch, ambiguity blocking,
  deterministic dry-run output, zero deletes, and rerun drift behavior.
- Security: public RLS visibility; non-admin mutation denial; admin server
  authorization; service-role importer invocation boundary; audit redaction.
- Product recovery: empty-table precondition, atomic success path, 24 unique
  identities, expected published count, and old `/products/` visibility without
  Detail v2.
- Detail/Compare: dynamic Key Specs, group applicability, evidence display,
  conflict warnings, 4000 projector versus 700 eye nits rejection, 87g versus
  77g lower-is-better, `Not disclosed` no winner, and native versus accessory
  tracking separation.
- QA Harness: database/admin paths classify HIGH and require `qa:release`;
  device/product changes receive the existing device/product checks. `qa:prod`
  remains a separately authorized read-only smoke and is never run for design.

## 13. Production safety and acceptance criteria

Schema work is additive and release-gated. It preserves existing RLS, uses
least privilege, does not expose service-role credentials, and retains current
Workers configuration. Production data import occurs only in Release B after
a separate operator authorization; no current approval exists.

Acceptance of this design requires agreement that: Schema v1 tables satisfy
the responsibilities and invariants above; 24 YAML records are the only
specification-value source; no old 13-record dataset is canonical; identity
mismatches block; field-level evidence is never fabricated; JSONB legacy
fields survive Release A; current product pages recover after Release B; and
Compare v2 cannot conflate measurement contexts or native/accessory tracking.

## 14. Deferred work

Implementation plan, migration SQL, importer code, admin UI/API code, Detail
v2, Compare v2, GA4/Cloudflare Web Analytics/Search Console, consent handling,
and legacy JSONB cleanup are deferred. They require their own approved plans,
reviews, and production authorizations.
