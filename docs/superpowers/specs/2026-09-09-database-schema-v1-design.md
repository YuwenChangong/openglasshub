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
has been used by disposable local P6B/P6C acceptance. It supplies only
non-specification identity/presentation values: existing slug, brand key,
images, descriptions, route metadata, URLs, and publication metadata. It is
not authoritative for any specification value or legacy compatibility spec
payload.

The historic 13-entry `src/data/devices.ts` MVP is provenance only. It is not
the recovery source and must not be treated as the current canonical catalog.

### Product specification values

`openglasshub_device_data_v1.yaml` is authoritative for Schema v1 values,
states, schema types, measurement meaning, confidence, conflicts, notes,
device-level source URLs, `verified_at=2026-09-05`, and its declared 24-device,
8-brand scope. It defines exactly two schema types: `display_ar` and `ai_hud`.
YAML is the sole specification-value authority. Release B derives both
normalized values and the `key_specs`/`full_specs` compatibility output from
the normalized YAML result through one deterministic compatibility adapter. If
a legacy field cannot be represented faithfully, the importer reports an
explicit compatibility gap and leaves it safely empty or omitted where the
current reader permits; it never falls back to bootstrap spec text.

`BOOTSTRAP_SPEC_VALUES_AUTHORITATIVE=false`,
`LEGACY_COMPAT_SPEC_SOURCE=YAML_DERIVED`, and
`DUAL_SPEC_SOURCE_OF_TRUTH=false` are Release B invariants.
`YAML_SPEC_VALUE_SINGLE_SOURCE=true` is the corresponding source-authority
invariant.

### YAML ownership matrix

The importer removes identity and evidence metadata before generating
definitions. The following matrix is the authoritative ownership boundary.

| YAML field set | Schema v1 owner | Rule |
| --- | --- | --- |
| `schema_type`, `basic.brand`, `basic.model`, `basic.generation`, `basic.device_type`, `basic.status` | `devices` | Identity/presentation attributes; identity changes are guarded. |
| `basic.release_date` | `devices.release_date` when YAML supplies an unambiguous ISO date; otherwise no date is invented | A year-only legacy value remains compatibility presentation, not a fabricated date. |
| `basic.weight_g`, `basic.dimensions_mm`, `basic.material`, `basic.prescription_support` | `device_specs` | Normalized specifications; never duplicate `devices` identity columns. |
| all remaining non-`evidence` parameter fields | `device_spec_definitions` plus `device_specs` | One deterministic canonical key per YAML path after the preceding removals. |
| `evidence.verified_at`, `evidence.region`, `evidence.overall_confidence` | `device_specs.verified_at`, `region`, `confidence` as scoped import metadata | They are metadata, never spec definitions. |
| `evidence.source_urls` | `device_sources` plus `device_source_links` | Device-level association only unless curated field mapping exists. |
| `evidence.conflicts` | curated conflict-classification mapping plus `device_spec_evidence` when applicable | Prose alone never creates a spec state or evidence link. |
| `evidence.notes` | non-public importer/admin curation metadata | They never become ordinary definitions or public fields by default. |

The registry includes every YAML **SPEC** key after the ownership matrix removes
identity and evidence fields. It does not create definitions for the metadata
rows in this table.

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

Current bootstrap evidence is deliberately insufficient: the only matching
record is `ray-ban-meta`; it has no generation field and only generic
presentation/spec text. Therefore
`CURRENT_RAY_BAN_BOOTSTRAP_SLUG=ray-ban-meta`,
`CURRENT_RAY_BAN_BOOTSTRAP_GENERATION=UNSPECIFIED`, and
`CURRENT_RAY_BAN_BOOTSTRAP_IDENTITY_CONFIDENCE=INSUFFICIENT_FOR_GEN_2`.
Release B is blocked until an operator records whether the slug is proven Gen 2
or preserves the existing identity and defines a separate Gen 2 identity. This
document does not choose either strategy.

## 5. Current architecture inventory

| Area | Current representation | Schema v1 consequence |
| --- | --- | --- |
| `public.devices` | Identity, presentation, publication, media, URLs, JSONB key/full specs; unique slug; `slug_locked` after first publish | Remains compatibility table and public identity record. |
| Brand/device IDs | No `brands` table exists; `brandCatalog` and the 24 bootstrap slugs are repository data. Production has no current device IDs because its table is empty | Schema v1 does not introduce a brands table; `devices.brand_key` remains the relationship key. |
| Public loader | `listPublishedDevices` / `getPublishedDeviceBySlug` select published rows from `devices` | Release A/B leave these readers unchanged. |
| `/products/` | Maps static `brandCatalog` shell to database-published product counts and previews | Importing 24 published identities restores page visibility without Detail v2. |
| Product detail | `/devices/[slug]` loads one published row then redirects to its product anchor | Detail v2 is deferred to Release D. |
| Current compare | `/products/[brand]` serializes selected legacy fields from `full_specs`/`key_specs` | Compare v2 is deferred to Release E. |
| Admin | Existing `/admin/devices` and `/api/admin/devices.ts`; server authorization uses `requireAdmin`/`requireModerator` and `profiles.role` | Add routes and server handlers inside this shell; no parallel role system. |
| RLS | Current legacy `devices` public select is `publication_status='published'`; staff CRUD uses `public.is_moderator_or_admin()` | This is current state only. Schema v1 target catalog mutation uses the separate `public.is_catalog_admin()` predicate; forum/moderation policy remains untouched. |
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
'UNKNOWN_UNVERIFIED')`; `device_spec_confidence = ('HIGH', 'MEDIUM_HIGH',
'MEDIUM', 'LOW')`;
`device_spec_comparison_mode = ('higher', 'lower', 'equal_only', 'none')`; and
`device_source_type = ('current_official_product_page', 'official_manual',
'official_spec_sheet', 'official_developer_docs', 'official_faq',
'regulatory_document', 'archived_official', 'reputable_secondary')`.

Confidence mapping is deterministic: YAML `High` maps to `HIGH`, `Medium-High`
to `MEDIUM_HIGH`, `Medium` to `MEDIUM`, and `Low` to `LOW`. Any other source
text is `BLOCKED_CONFIDENCE_VALUE`; there is no heuristic coercion. YAML
`evidence.overall_confidence` is device/dataset-scope baseline confidence, not
proof that every field has equal quality. It initializes imported field
confidence only as a baseline. A curated field-level override may lower or
replace it with auditable provenance; secondary-source prose cannot silently
gain a higher confidence without an explicit curated mapping.
`CONFIDENCE_MEDIUM_HIGH_SUPPORTED=true` and `CONFIDENCE_COERCION=false` are
Release A/B invariants.

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
until a separate, proven cleanup project. Their compatibility representation is
derived deterministically from the normalized YAML result by one compatibility
adapter. Bootstrap catalog data supplies only non-specification identity and
presentation fields; it is never a fallback source for a legacy specification
value. If a normalized YAML value cannot be represented faithfully in a legacy
field, the adapter reports an explicit compatibility gap and safely omits or
empties that legacy field where the current reader permits.

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

The registry includes every YAML SPEC key after identity/evidence removal by
the ownership matrix and keeps brightness distinct:
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

### 6.3.1 Database enforcement of definition/value invariants

Row-local `CHECK` constraints enforce state shape and mutually exclusive typed
columns: `KNOWN` has exactly one compatible typed column; `NOT_DISCLOSED`,
`NOT_APPLICABLE`, and `UNKNOWN_UNVERIFIED` have zero typed columns; and
`CONFLICT` always has a nonempty primary `raw_value` plus zero or one safely
representable compatible typed primary value. JSON is valid only for
`value_type='json'`; the typed columns are otherwise mutually exclusive.

Because ordinary checks cannot inspect a definition row, a `BEFORE INSERT OR
UPDATE` trigger on `device_specs` loads the referenced definition and rejects
`DEVICE_SPEC_UNKNOWN_DEFINITION`, `DEVICE_SPEC_SCHEMA_TYPE_DISALLOWED`,
`DEVICE_SPEC_VALUE_TYPE_MISMATCH`, `DEVICE_SPEC_UNIT_MISMATCH`,
`DEVICE_SPEC_CONTEXT_MISMATCH`, and `DEVICE_SPEC_STATE_VALUE_MISMATCH`.
It requires row unit/context to equal the definition unless that definition has
an explicit, documented override policy; Release A defines no overrides. A
`DEFERRABLE INITIALLY DEFERRED` constraint trigger, fired for relevant
`device_specs` and `device_spec_evidence` changes, validates at transaction
end that every `CONFLICT` has exactly one `is_primary = true, is_conflicting =
false` claim and at least one `is_primary = false, is_conflicting = true`
claim. This avoids rejecting a valid transaction merely because it inserts the
spec before its evidence. Importer and server validation provide user-friendly
diagnostics but are never the sole enforcement layer.

### 6.4 `device_sources`: reusable source records

Proposed columns are `id`, `publisher`, `title`, `url`, `source_type
device_source_type`, `published_at`, `accessed_at`, `region`, `created_at`, and
`updated_at`. `url` is unique after normalized URL validation. Ordered source
types are `current_official_product_page`, `official_manual`,
`official_spec_sheet`, `official_developer_docs`, `official_faq`,
`regulatory_document`, `archived_official`, and `reputable_secondary`.
Secondary content is never labeled Official in public rendering.

YAML URLs are paired with a deterministic, reviewed source-metadata registry
sidecar keyed by normalized URL. Each record supplies `publisher`, `title`,
`source_type`, `published_at`, `accessed_at`, and `region`; `title` and
`published_at` may be null, but `publisher`, `url`, and `source_type` are
required. Source type is never inferred from a domain or path. Before Release
B, `UNIQUE_SOURCE_URLS` must equal `SOURCE_METADATA_MAP_COUNT`, with
`UNMAPPED_SOURCE_URLS=0` and `AMBIGUOUS_SOURCE_URLS=0`; otherwise import blocks.
`reputable_secondary` can never render as Official.
`SOURCE_TYPE_AUTOMATIC_INFERENCE=false` and
`UNMAPPED_SOURCE_URL_BLOCKS_RELEASE_B=true` are Release B invariants.

### 6.4.1 `device_source_links`: device-level provenance

This table has `id uuid primary key`, `device_id uuid not null references
public.devices(id) on delete restrict`, `source_id uuid not null references
public.device_sources(id) on delete restrict`, `is_primary boolean not null
default false`, `note text`, and `created_at timestamptz not null default now()`.
It has `unique(device_id, source_id)` and a partial unique index allowing at
most one `is_primary=true` source per device. `note` is internal and is never
in the public read contract. RLS permits only catalog-admin mutation.
Device-level links are not automatically field-level evidence.
`DEVICE_SOURCE_LINK_SCHEMA_COMPLETE=true` is a Release A invariant.

### 6.5 `device_spec_evidence`: field-level claims

Proposed columns are `id`, `device_spec_id`, `source_id`, `claimed_value`,
`is_primary`, `is_conflicting`, `note`, and `created_at`. It has a unique
`(device_spec_id, source_id, claimed_value)` constraint, at most one primary
row per spec, and foreign keys with restrictive deletes. A source cannot be
hard-deleted while evidence references it.

The local row check is `not (is_primary and is_conflicting)`. The deferred
constraint trigger requires every `CONFLICT` spec to have exactly one
`is_primary=true, is_conflicting=false` evidence row and at least one
`is_primary=false, is_conflicting=true` evidence row. For a non-`CONFLICT`
spec, a conflicting evidence row is rejected until an explicit state transition
to `CONFLICT`; it cannot silently alter state semantics.
`CONFLICT_PRIMARY_AND_CONFLICTING_MUTUALLY_EXCLUSIVE=true` is a Release A
invariant.

Only unambiguous input mappings create field-level links. YAML conflict prose
creates no guessed link or conflict state: it requires an explicit curated
classification and canonical-spec mapping. The classification is either
`TRUE_VALUE_CONFLICT` (competing claims about one canonical key) or
`NORMALIZATION_OR_CONTEXT_NOTE` (explanatory material such as 600 eye nits
versus 4000 projector nits, which are different keys). The latter remains
device-level/admin curation metadata. An unmapped prose item reports
`BLOCKED_EVIDENCE_MAP` while retaining its device-level source association.

## 7. State, values, evidence, and comparison invariants

The closed state enum is `KNOWN`, `NOT_DISCLOSED`, `NOT_APPLICABLE`, `CONFLICT`,
and `UNKNOWN_UNVERIFIED`.

| State | Required invariant | Public/Compare behavior |
| --- | --- | --- |
| `KNOWN` | Exactly one typed value consistent with definition type; required unit/context present where defined | Eligible only when all compare conditions hold. |
| `NOT_DISCLOSED` | No canonical typed value | Shows disclosure state; never ranks. |
| `NOT_APPLICABLE` | No canonical typed value; definition is allowed for the schema type, but this specific device is asserted not to implement/possess it | May be hidden in normal view; never ranks. |
| `CONFLICT` | No winner; exactly one `is_primary=true,is_conflicting=false` claim and at least one `is_primary=false,is_conflicting=true` claim. Primary typed value is retained if safely representable, and explicit raw primary display value is always retained | Shows primary value with warning and claims; never ranks. |
| `UNKNOWN_UNVERIFIED` | No verified canonical claim | Admin-visible research state; never promoted as public verified fact or ranked. |

YAML mapping is exact: concrete value maps to `KNOWN`; `Not disclosed` to
`NOT_DISCLOSED`; `Not applicable` to `NOT_APPLICABLE`; explicit `No` to
`KNOWN false`; explicitly curated `TRUE_VALUE_CONFLICT` to `CONFLICT`; and
unresearched or untrusted internal candidate to `UNKNOWN_UNVERIFIED`. A definition's
`applicable_schema_types` means the parameter is allowed/meaningful in that
family; it does not require every device in the family to implement it. A row
outside that allowed set is invalid, while `NOT_APPLICABLE` is a per-device
assertion. SQL checks, database triggers, and importer validation enforce
state/value compatibility; `NULL` alone never expresses a semantic state.

For `CONFLICT`, the `device_specs` row retains a safe primary canonical typed
value, canonical unit/context, and a required primary `raw_value`. If the
primary value cannot be safely normalized, typed compare fields are null while
the explicit raw primary value remains displayable. `device_spec_evidence` records exactly
one primary claim and one or more conflicting claims. For example, a public
Rokid value can render `480×400 Official ⚠` with its current-official primary
source and a `480×640` official-FAQ alternative, but is never compare-eligible.

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

Catalog mutations are admin-only. Release A adds the narrowly scoped reusable
predicate `public.is_catalog_admin()`, implemented from the existing protected
`profiles.role` source as `current_user_role() = 'admin'`; it does not change
`public.is_moderator_or_admin()` or forum moderation policy. All catalog-table
insert/update/delete policies—including `devices`, `device_specs`,
`device_spec_definitions`, `device_sources`, `device_source_links`, and
`device_spec_evidence`—use `(select public.is_catalog_admin())` in both
`USING` and `WITH CHECK` as applicable. The server uses existing
`requireAdmin`; RLS and the server consequently enforce the same authority.
Non-admin authenticated users cannot mutate catalog tables. The service-role
importer is a separately authorized operator exception.

Release A/B/C grant no anon direct `SELECT` on `device_specs`,
`device_spec_definitions`, `device_sources`, `device_source_links`,
`device_spec_evidence`, or `catalog_audit_events`.
`NORMALIZED_BASE_TABLE_ANON_SELECT=false`. The existing legacy public
`devices` read remains unchanged so `/products/` works after Release B.

Release D introduces the sole normalized public read boundary: a narrowly
scoped fixed-contract RPC, `public.get_public_device_detail_v1(request_slug
text)`, or a repository-consistent equivalent with the same constraints. It
returns allowlisted typed columns only for `publication_status='published'` and
only `KNOWN`, `NOT_DISCLOSED`, `NOT_APPLICABLE`, and `CONFLICT` states. It
returns allowlisted source/evidence metadata only (`publisher`, nullable title,
URL, source type, dates, region, claimed value, and primary/conflict flags).
It never returns `UNKNOWN_UNVERIFIED`, `device_specs.note`, YAML/admin curation
notes, importer diagnostics, audit records, or arbitrary table data.

The RPC uses no dynamic SQL, fully qualified objects, and a fixed locked
`search_path`. It is callable only by `anon` and `authenticated` for public
read. If implementation chooses `SECURITY DEFINER` to bypass base-table RLS,
it must retain the fixed return contract, locked search path, fully qualified
references, explicit execute grants, no public base-table grants, and tests
proving unpublished identities/internal columns cannot escape. Application
projection may format this RPC result but is not the authorization boundary.
`PUBLIC_NORMALIZED_READ_BOUNDARY=EXPLICIT_RPC_OR_EQUIVALENT` and
`INTERNAL_SPEC_COLUMNS_PUBLICLY_REACHABLE=false` are Release D invariants.

Release C adds `catalog_audit_events`: `id`, `actor_id`, `entity_type`,
`entity_id`, `action`, `changed_fields jsonb`, and `created_at`. It is
append-only by database policy: catalog admins may `INSERT` and `SELECT`; all
`UPDATE` and `DELETE` policies/grants are absent. It is inaccessible publicly.
Application mutations write an allowlisted before/after summary, not secrets or
unbounded payloads.
`AUDIT_DB_APPEND_ONLY=true` is a Release C invariant.

## 9. Importer and source-of-truth transition

The planned `scripts/devices/import-device-schema-v1.mts` pipeline is:

1. Parse YAML and validate its declared device/brand counts and allowed keys.
2. Normalize state, typed values, raw values, context, and confidence without
   changing source semantics; resolve every source URL only through the
   reviewed source-metadata sidecar, never domain/path inference.
3. Resolve the explicit identity map against the current 24 bootstrap slugs.
4. Validate definitions, applicability, uniqueness, the exact source-sidecar
   count/mapping contract, source/evidence mappings, and conflict invariants;
   derive legacy `key_specs`/`full_specs` only from normalized YAML output.
5. Calculate a deterministic per-device diff: `INSERT`, `UPDATE`,
   `UNCHANGED`, `CONFLICT`, or `BLOCKED`; default `DELETE=NONE`.
6. Exit successfully only for a complete dry run. A write requires separate
   explicit authorization and one transaction.

The importer never fuzzy-matches, never deletes, never silently overwrites
post-import admin edits, and never turns an unresolved field-level mapping into evidence.
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
   importer. Preconditions: production device count is zero,
   `IDENTITY_MAP_COUNT=24`, `UNIQUE_TARGET_SLUGS=24`,
   `UNRESOLVED_IDENTITIES=0`, `UNIQUE_SOURCE_URLS=SOURCE_METADATA_MAP_COUNT`,
   `UNMAPPED_SOURCE_URLS=0`, `AMBIGUOUS_SOURCE_URLS=0`, and every required
   identity is exact. The current unresolved Ray-Ban Meta Gen 2 identity blocks
   this release (`RAY_BAN_RELEASE_B_BLOCKER_PRESERVED=true`).
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

Research Completion is `investigated core fields / all expected core fields for
that device`, target at least 95%. Investigated means `KNOWN`,
`NOT_DISCLOSED`, `NOT_APPLICABLE`, or `CONFLICT`; `UNKNOWN_UNVERIFIED` does not
count. `NOT_APPLICABLE` counts because it proves investigation. Verified Data
Coverage is `reliable KNOWN values plus appropriately primary CONFLICT values /
applicable expected fields`; `NOT_APPLICABLE` is excluded from that denominator
and `NOT_DISCLOSED` has no verified-value credit. Its initial target is 70–85%
depending on source availability. Neither metric may be increased by fabricated
values or unqualified secondary claims.

## 12. Testing and QA strategy

- Database: enum/check/FK/unique constraints; forbidden state/value pairs;
  definition key immutability; referenced definition deactivation versus
  deletion; source/evidence conflict invariants.
- Importer: 24-device YAML validation, exact identity map, duplicate keys,
  Generation guard, state normalization, context mismatch, unresolved-mapping blocking,
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
