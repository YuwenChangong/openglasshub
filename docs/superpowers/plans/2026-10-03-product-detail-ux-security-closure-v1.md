# Slice C: Product Detail + UX / Security Closure v1

Date: 2026-10-03. Status: direction accepted, priority correction proposed; implementation and revised plan pending human review. Inventory is source-derived, not a fresh runtime or Production acceptance result. Revises local plan commit `9e2afcd12aae74599ef581304c25b5d2aa35eb46` under SLICE_C_PLAN_PRIORITY_CORRECTION authorization.

**Goal (primary release blocker):** Restore REAL product/device canonical detail routing, prove the existing user-supplied parameter dataset survives source -> parser -> public reader/view -> SSR -> browser, and render those parameters truthfully. This is missing-detail restoration, not merely detail-page polish. UX/search/mobile/security closure stays in Slice C as secondary work after PRODUCT_DETAIL_CORE_ACCEPTANCE, without weakening minimum public-data/escaped-rendering safety needed by the core.

**Architecture:** Retain one Astro route tree, anonymous public SSR reads, existing Supabase Auth/RLS, values-only comparison, the shared community shell, and Slice B locale context. Add a narrow public Schema v1 invoker read boundary, not a privileged application reader. Preserve legacy routes and brand anchors.

**Tech Stack:** Current lockfile resolves Astro 7.2.10, @astrojs/cloudflare 14.2.6, React 19.2.8, @supabase/supabase-js 2.112.4. Existing Node assertion scripts, TypeScript, Playwright, Workers/Miniflare local harnesses and disposable local Supabase remain the toolchain. No dependency changes to match historical documentation.

## 1. Identity, Authority and Review Boundary

- Fetched `origin/main` and verified exact baseline `8c1e9d5beda87e633d4a67116002c48210fe4929` on 2026-10-03. Starting checkout was clean.
- Created `feature/product-detail-ux-security-closure-v1` from that exact SHA in the existing clean checkout `C:/Temp/openglass-hub-search-main-integration-v1`; no old worktree or branch was overwritten.
- Primary authority: `docs/superpowers/specs/2026-09-28-product-recovery-large-scale-readiness-v1-design.md`, sections 10, 17-23, 25-27 and 30. Its old current-state table is historical, not a description of today's A/B state.
- Read the explicitly referenced `docs/superpowers/specs/2026-09-09-database-schema-v1-design.md`, especially definitions, states, evidence and read boundaries. Its optional SECURITY DEFINER Release D choice is superseded by the later recovery design's mandatory invoker-only boundary. Do not implement that older alternative.
- Planning convention inspected: `docs/superpowers/plans/2026-09-28-product-recovery-slice-a-auth-identity-email-consent-v1.md`. Its original consent-gate architecture is not permission to restore the subsequently removed runtime gate.
- Slice A is preserved. Slice B is `CLOSED_AND_PRODUCTION_RELEASED` according to the frozen human release receipt; no reacceptance or reopening here. Production state was not queried in this planning task.
- This authorization permits this planning document and a local document-only commit. It does not authorize implementation, push, merge, deployment, Production SQL, provider access/configuration, Auth/email/content mutations or remote database reads.
- Current correction changes this document only: no product implementation, schema mutation, SQL, fixture generation/run, browser acceptance, provider query or Production action. Existing parameters may be present but disconnected; actual loss versus parser/reader/route/component omission remains UNPROVEN until Task 1 evidence. Do not manufacture a root cause or retroactively relabel historical results.
- Before implementation, human review must approve scope, gaps, task order, browser size, security assertions and expected files. `SLICE_C_SCOPE_FROZEN=PROPOSED_PENDING_HUMAN_REVIEW`; `SLICE_C_IMPLEMENTATION_STARTED=false`.

## 2. Proposed Frozen Scope

**In scope:** Published SSR `/products/{brand}/{slug}/`; honest typed groups/evidence and legacy fallback; canonical helper for cards/search/compare/sitemap/metadata; direct legacy device redirects; current comparison maximum three without scoring; explicit mobile menu; global quick/full search scope parity; catalog text/JSON/URL/media trust boundaries; dynamic security headers; existing zh-CN/en integration; focused local tests and a separately authorized release/acceptance handoff.

**Out of scope:** General redesign, forum feature overhaul, Auth/session/CAPTCHA redesign or provider toggles, new locale/preferences architecture, light/theme controls, new product research or database project, catalog bulk import/P9/Release B replay, new admin system, recommendation/ranking/social features, custom-domain/deployment migration, load certification and full restrictive script-src CSP. The final whole-product multi-agent acceptance in design section 24 is a later independently authorized task, not this slice's implementation/browser matrix.

**Explicit exclusions:** `PRODUCT_DETAIL_V2_REDESIGN=false`; `NEW_DEVICE_DATA_RESEARCH=false`. Use existing repository data only: no Internet specification collection, new device expansion, invented specs, Compare v2 scoring, Auth/locale redesign or deployment architecture change. This slice restores and hardens the truthful canonical detail experience, not the later Product Detail v2 program.

**Required user flows:** Anonymous list -> brand -> actual detail -> official/source entry -> compare -> detail; old device URL -> canonical detail in one redirect; wrong recognized brand -> database-resolved brand; unknown brand/device and unpublished -> truthful 404/noindex without private identity exposure; read failure -> 503/retry; metadata-only published item -> useful honest page; missing image -> no-image state; public quick search -> grouped results/full search -> matching entity destinations; mobile menu/search/source/compare reachable by touch and keyboard.

**Security properties:** Public readers use anonymous/actor-scoped unprivileged clients and database publication/state authorization; allowlisted columns only; internal notes/raw values/updater/auth IDs/audit data excluded; catalog values are text, not HTML; script JSON and JSON-LD are safely serialized; HTTPS external links without credentials; validated same-origin identity paths; no fetching source URLs during SSR; safe errors; preserved framing/referrer/permissions protections and locale no-store behavior.

**Responsive surfaces:** Shared header on community and Starlight shells; product index/brand/detail; compare table and quick-search popup; overview/media/specs/evidence/actions; empty/not-found/error/partial states. Desktop 1280, mobile 430 and 390, both existing locales, Dark-only.

**Required acceptance gates (verbatim identifiers):** `PRODUCT_DETAIL`, `PRODUCT_ROUTE_CANONICAL`, `PRODUCT_SCHEMA_RENDERING`, `PRODUCT_SOURCE_EVIDENCE`, `COMPARE_ENTRY`, `SEARCH_CONSISTENCY`, `MOBILE_NAV_390`, `MOBILE_NAV_430`, `XSS_CATALOG_PATH`, `SECURITY_HEADERS`. Each requires fresh evidence, not this inventory. Source evidence means correct attribution when present and honest absence when absent. Release requires zero confirmed unresolved P0/P1; P2 needs explicit disposition, owner and human acceptance. No large-scale readiness declaration from this slice alone.

**Primary task barrier:** Tasks 1-6 establish `PRODUCT_DETAIL_CORE_ACCEPTANCE=PASS` before Tasks 7-13 begin. That gate is necessary but not sufficient for whole Slice C/release PASS; every retained secondary gate still blocks release when unmet. Minimum unprivileged data authorization, native escaped text, no raw-error disclosure and truthful absence are part of the core, not deferred until security closure.

**Dependencies on A:** Preserve browser-session transport, actor-bound mutation guards, password/CAPTCHA token paths, required Production CAPTCHA mode, resend 5/24h server limit and 60-second initial/resend UX cooldown, enumeration resistance and all PR #7 runtime-consent removal. No new Auth requests/emails are necessary for detail acceptance.

**Dependencies on B:** Reuse `Astro.locals.localeContext`, typed catalogs, locale-neutral URLs, saved-preference precedence, shared header Settings order and no-store HTML. User/source titles and factual product content remain original-language content, honestly labeled where needed; do not machine-translate facts. No new persistence state.

## 3. Current Route, Component and Data Inventory

| Surface | Current implementation and dependencies | Disposition |
| --- | --- | --- |
| `/products/` | `src/pages/products/index.astro`: request SSR, anonymous `createSSRClient`, `listPublishedDevices`; local `brandCatalog` supplies brand presentation; inline DOM search/compare | Brand directory, not a detail page |
| `/products/{brand}/` | `src/pages/products/[brand].astro`: same published list then brand filter; `BrandMark.astro`, `ProductVisual.astro`; inline compare/search | Brand listing remains; view-product currently self-links to `#product-{slug}` |
| `/products/{brand}/{slug}/` | No current route or detail component | Add one canonical published detail surface |
| `/devices/` | `src/pages/devices/index.astro` -> 301 `/products/`; no database read | Preserve index alias; do not rebuild a device library |
| `/devices/{slug}/` | `src/pages/devices/[slug].astro`: anonymous `getPublishedDeviceBySlug`; 301 brand anchor, absent 404/noindex with no useful body | Redirect-only alias, not a second detail implementation |
| `/reference/devices/{slug}/` | 25 checked-in MDX articles under `src/content/docs/devices/`, with explicit `slug: reference/devices/...`; Starlight content loader/layout and `src/starlightRouteData.ts` | Editorial documentation, not database-published product identity; preserve original docs, do not republish withdrawn/static entries as catalog devices |
| `/reference/devices-docs` | Explicit redirect in `astro.config.mjs` to `/devices/`, then `/products/` | Historical documentation index alias; no new product route tree |

Product components currently used: `src/components/products/BrandMark.astro`, `ProductVisual.astro`, `src/layouts/CommunityLayout.astro`, `src/components/site/SiteHeader.astro`. No product-detail renderer exists. `src/components/community/ProductCard.astro` accepts a caller-provided href; inspect call sites before any change. `src/components/devices/DeviceLibraryExplorer.tsx` remains tracked but has no active page import found; its old `/devices/{slug}/` links benefit from the redirect. Do not resurrect or refactor that unused explorer.

**Product data sources:** Runtime `public.devices` selected through `src/lib/public-device-data.ts`; checked-in `src/data/product-public-data.json` via `src/lib/device-catalog.ts` for brand/presentation helpers (24 local manifest products, not a live database count). `src/data/devices/openglasshub_device_data_v1.yaml` and schema-v1 definitions/source metadata are reviewed local fixtures/reference inputs, not runtime fallback facts.

**Device data sources:** The legacy detail alias reads the same published `devices` table, not `src/data/devices.ts`. That static file still supports `src/lib/device-discussion.ts` and the unused explorer. MDX documentation has its own historical authored content. Structured `device_spec_definitions`, `device_specs`, `device_sources`, `device_source_links`, `device_spec_evidence` exist in foundation SQL but are not read by current product runtime.

**API dependencies:** Product list/brand and device alias use Supabase Data API anonymous published-device SELECT. Global quick search calls `/api/forum/search`; full search and API share `src/lib/forum-search.ts` and `src/lib/search-types.ts`, including devices/circles/posts/users. Sitemap calls the published-device reader. There is no public product mutation endpoint or dedicated detail API now; `/api/admin/devices` is privileged and must not become the public reader. Source/image links are not fetched by the current catalog SSR mapper. Starlight documentation is content-backed, not the product Data API.

## 4. UI / UX Support Matrix

The target detail column reports current absence, not a prediction. Alias rows have no interactive body, so layout features are NOT_APPLICABLE there. Editorial pages are context only, not substitutes for canonical detail.

| Capability | Brand listing (nearest existing surface) | Canonical product detail | `/devices/{slug}/` alias | Editorial reference |
| --- | --- | --- | --- | --- |
| Loading | NOT_APPLICABLE: SSR; local search synchronous | NOT_APPLICABLE: planned SSR, no artificial spinner | NOT_APPLICABLE | NOT_APPLICABLE: content-backed |
| Empty | PARTIAL: filtered empty, no useful zero-published body | MISSING | NOT_APPLICABLE | NOT_APPLICABLE |
| Not-found | PARTIAL: unknown brand redirects to index | MISSING | PARTIAL: 404/noindex, empty body | IMPLEMENTED: framework route absence |
| Error | MISSING: public read throws, no route-owned 503/retry | MISSING | MISSING: read throws | NOT_APPLICABLE: no catalog read |
| Partial/missing data | PARTIAL: nullable legacy facts omitted/TBD | MISSING | NOT_APPLICABLE | PARTIAL: authored content, not typed public states |
| Mobile navigation | PARTIAL: inherited hidden-scroll nav | MISSING | NOT_APPLICABLE | PARTIAL: shared header |
| Long text | PARTIAL: some min-width/wrapping, fixed visual clipping | MISSING | NOT_APPLICABLE | PARTIAL: Starlight prose, not long-spec proof |
| Long specification values | PARTIAL: facts wrap; compare cells unproven | MISSING | NOT_APPLICABLE | PARTIAL: authored tables |
| External links | PARTIAL: noopener/noreferrer but no scheme/credential validation | MISSING | NOT_APPLICABLE | PARTIAL: trusted authored links, separate route |
| Images/media | MISSING: `ProductVisual` has no image prop/rendering | MISSING | NOT_APPLICABLE | PARTIAL: authored assets, not runtime media policy |
| Locale | IMPLEMENTED: B selected UI messages; facts original language | MISSING | NOT_APPLICABLE: locale-neutral redirect | IMPLEMENTED: B wrapper/original-language policy |
| Auth-independent public rendering | IMPLEMENTED: anonymous SSR/publication filter | MISSING | IMPLEMENTED: anonymous published lookup | IMPLEMENTED: public docs |
| Keyboard navigation | PARTIAL: native links/buttons and Escape; menu inaccessible | MISSING | NOT_APPLICABLE | PARTIAL: native Starlight features/shared-header gap |
| Focus state | PARTIAL: CSS focus rules; no menu focus restoration | MISSING | NOT_APPLICABLE | PARTIAL: shared-header gap |
| Responsive layout | PARTIAL: grids/breakpoints exist, detail not covered | MISSING | NOT_APPLICABLE | PARTIAL: existing docs shell, no new runtime verdict |

Global quick search has a real loading state and debounce/abort in one path, but two fetch paths have inconsistent stale-response ownership. It requests posts only, and failure becomes the same empty state as success with no results. Full search supports all four groups. Circle-scoped search intentionally remains posts-only; global scope correction must not erase that existing distinction.

## 5. Static Responsive Inventory (No Browser Run)

| Risk / existing protection | Owning evidence | 1280 / 430 / 390 implication |
| --- | --- | --- |
| Invisible horizontal primary nav | `SiteHeader.astro:179-194`: overflow-x auto, hidden scrollbar, toggle display none; mobile rules at 331-446 never enable it | Desktop can clip too if actions/search fill width; both mobile widths lack an explicit menu |
| Header overlap and drawer layering | Same header sticky z-index 100; flex-wrap below 860; Settings 44px plus notification/account slots | Need bounded vertical menu below header, separate stable search row and actual hit-box checks, not body clipping |
| Touch targets | Header links 33/34px min-height at mobile; auth/search controls 36-40px; compare removes 1.62rem and add buttons 1.92rem outside narrow overrides | 390 gets some <=420 overrides to 44px, 430 misses those; enforce >=44px for changed action hit areas at both widths |
| Long titles | `ProductVisual.astro:43,74,157-168` overflow hidden and narrow title measure; brand card fixed media height 208px, mobile 196px | Long model tokens/English titles can clip; source risk, not reproduced overflow |
| Long specs / table width | Brand facts use minmax(0,..) and overflow-wrap anywhere at 1200-1212; compare wrappers overflow-x auto, table min-width 620px/560px | Preserve scrolling inside a labeled, keyboard-reachable compare region only; new specs stack, wrap values, avoid page-wide scroll |
| Search popup | Product/brand popup max-height tied to viewport and inner scroll | Verify viewport edges, sticky header overlap, keyboard dismissal/focus; no new modal needed |
| Settings dialog | Header dialog max-width min(440px,100vw-32px), native dialog and wrapping | Preserve B unsaved-form confirmation; smoke Escape/focus coexistence, do not rewrite Settings |
| New detail overview/media/specs/evidence | No source exists | Contract coverage needed, not a proven defect in nonexistent CSS; constrained media aspect ratio, minmax(0,1fr), wrapping/source actions |

No screenshots or runtime layout PASS claimed. Source CSS has existing resilient grids; do not replace them or mask bugs with global overflow-x hidden. Preserve the existing restrained Dark-only system, stable media/control dimensions, visible first-viewport product identity and real media or honest absence. No promotional redesign.

## 6. Data Integrity Inventory and Target Contract

| Concern | Current behavior | Minimum target |
| --- | --- | --- |
| Nullable fields | `public-device-data.ts:9-10,76-89` filters text/list values, but descriptions/identity assume typed row; non-string specs vanish | Validate public row/identity; metadata-only page; nullable fields absent or honest unavailable, never invented defaults |
| Unknown specs / unsupported values | `specGroups` accepts nonempty strings only; booleans/numbers/json dropped; comparison uses TBD | Typed KNOWN including false/0; NOT_DISCLOSED, NOT_APPLICABLE, explicit CONFLICT; synthetic unknown for absent public claim; do not return internal UNKNOWN_UNVERIFIED rows |
| Definition order/context | Legacy object iteration/raw group labels and fixed UI path mapping | Active applicable definitions, dictionary labels, stable ordering, correct units/measurement context/region/variant; unsupported eligible known source field remains labeled legacy or blocks mapping, never silently omitted |
| Source attribution | Mapper exposes links but no publisher/type/date/field evidence; private source ledger is not runtime | Allowlisted linked public sources/evidence; preserve null title/date; distinguish secondary from official using source_type, never hostname inference |
| External/invalid URLs | Nonempty strings copied to official/buy/image properties | Link scheme/credentials validation; omit invalid target with localized unavailable state; never display a forged official fallback |
| Media absence | Mapper knows image URL/confirmation flag; current visual cannot render image | Approved safe actual image, bounded dimensions/alt; no-image and broken-image fallback; no arbitrary SVG/data/remote unapproved fetch |
| Duplicate specs | Foundation identity/context uniqueness; legacy same key may occur across groups | Keep definition+region+variant identity, deterministic ordering; do not deduplicate different measurement contexts or choose arbitrary conflict winner |
| Long/unsupported values | Unbounded strings retained; key_specs coerces via String; legacy object values skipped | Contract bounds and safe text/structured presentation, no [object Object] or serialized research blob; do not truncate facts silently |
| Stale/unknown dates | Legacy select excludes last_verified_at; no source freshness display | Present known accessed/verified dates, unavailable when absent; no invented expiry threshold, confidence, verified date or freshness badge |
| Empty structured tables vs failure | No structured query today | Successful zero rows gives useful metadata plus labeled legacy/unverified/unknown; unavailable projection/query is 503, not false zero rows/404 |

### 6.1. Required Data Survival Forensic and Parameter Matrix

Task 1 must inventory the COMPLETE existing expected published cohort and all eligible visible source parameters, not a sample. The canonical runtime data source remains `public.devices` and the existing Schema v1 public-safe architecture; no remote query is authorized here. Existing repository parameter authority is the approved YAML and its reviewed identity/definition/source/conflict maps; legacy manifests/fullSpecs/keySpecs/static catalog/MDX are inventory and traceability layers, not automatically equally authoritative facts. Respect `BOOTSTRAP_SPEC_VALUES_AUTHORITATIVE=false` and `LEGACY_COMPAT_SPEC_SOURCE=YAML_DERIVED`; do not resurrect old bootstrap parameters over approved input.

At execution, record:

```text
CANONICAL_DEVICE_DATA_SOURCE=<runtime reader/table and repository authority paths/hashes>
LEGACY_PARAMETER_DATA_SOURCES=<exact found paths and their authority/compatibility role>
PUBLISHED_DEVICE_COUNT=<derived count with LOCAL_REPOSITORY_COHORT evidence scope>
DEVICE_IDENTITIES=<generated sorted brand/slug/canonical identity list>
EXISTING_DEVICE_DATA_PRESENT=true|false
EXISTING_PARAMETER_DATA_PRESENT=true|false
```

Do not hardcode N or substitute today's local manifest count for the authoritative published cohort. `product-public-data.json` has no publication-status field; the bootstrap script's initial `publication_status=published` default is not proof of current runtime publication and preserves existing statuses when updating. Derive local fixtures from an explicitly reviewed repository publication snapshot/contract and record its provenance. If repository evidence cannot establish membership, emit UNKNOWN and STOP the affected core gate for human review, without querying Production, executing an importer or labeling all source/document records published. Production published count/state remains UNKNOWN until a separately authorized later release read-only check.

For every included identity enumerate brand, slug, immutable canonical identity, structured fields, legacy/full_specs/key-spec fields and existing source/evidence fields. Preserve exact source pointers, types, units, contexts, region/variant and existing state metadata. The expected-value oracle reads authoritative source leaves independently of the new reader/model/renderer; the same lossy parser/compatibility output cannot generate both expected and actual. Capture normalizer/compatibility omissions explicitly, including non-KNOWN state omissions. No hand-duplicated parameter values in tracked test fixtures. Generated fixture determinism uses pinned SHA, input hashes and stable ordering; known data cannot disappear through a shortened test list.

The generated parameter-survival ledger has these columns:

| SOURCE_FIELD | PARSER/VIEW_FIELD | UI_GROUP | RENDER_STATE | Additional proof |
| --- | --- | --- | --- | --- |
| Exact source file/hash/identity/pointer | Existing parser destination -> allowlisted detail field | Definition-derived group or explicitly labeled legacy group | KNOWN / UNKNOWN / ABSENT / LEGACY_UNVERIFIED / STRUCTURED_VERIFIED | Source value/type/unit/context, evidence pointer if present, SSR/DOM field identity, equivalence rule and exclusion rationale where legally private |

State semantics: KNOWN is a concrete source claim, including false/0; UNKNOWN is explicit lack of verified public knowledge; ABSENT means no eligible public source field/row exists. LEGACY_UNVERIFIED is an existing public legacy value without a matching verified structured claim; STRUCTURED_VERIFIED is an existing allowed structured claim supported by the approved data contract, not a new research/verification event. Source availability and output provenance are separate columns: a KNOWN source may render LEGACY_UNVERIFIED, never silently become UNKNOWN/ABSENT. Preserve Schema v1 NOT_DISCLOSED/NOT_APPLICABLE/CONFLICT semantics as separate state metadata; these five survival labels do not replace the underlying enum. Internal UNKNOWN_UNVERIFIED research rows/notes stay inaccessible.

Require `KNOWN_SOURCE_VALUE_DROPPED_COUNT=0`. Missing structured rows do not remove known published legacy values: show them with explicit legacy/unverified attribution, no fabricated confidence/source. Structured precedence is per field plus measurement context/region/variant, not whole-product suppression of legacy data. Retain otherwise distinct source/context values and public conflicts visibly, with no invented winner. Any normalization of units/format needs an explicit lossless equivalence rule; do not test with forgiving substring matches, coerce objects to strings, truncate factual values or hide unmatched known fields.

Only explicit private/internal fields may be excluded from public rendering, with reviewed classification and deny tests. A newly unsupported eligible field is a mapping blocker, not permission to retroactively shrink the oracle. If supplied dataset/identity/source layer cannot be found, STOP at Task 1 and report exact missing repository layer; no recollection, dataset fabrication or catalog expansion. If data exists but a parser/reader/UI drops it, preserve that RED and fix that layer, not the source values.

### 6.2. All-Device Primary Acceptance

Generate every expected identity and field from Task 1 current pinned repository authority, load only owned disposable local fixtures, and check actual canonical SSR plus rendered browser DOM for EVERY expected device. No sampled routes stand in for this pass.

```text
EXPECTED_PUBLISHED_DEVICE_COUNT=N
DETAIL_ROUTE_200_COUNT=N
DETAIL_ROUTE_404_FOR_EXPECTED_COUNT=0
DETAIL_ROUTE_5XX_COUNT=0
DEVICE_IDENTITY_MISMATCH_COUNT=0
KNOWN_PARAMETER_VALUE_DROPPED_COUNT=0
FABRICATED_PARAMETER_VALUE_COUNT=0
```

`PRODUCT_DETAIL_CORE_ACCEPTANCE=PASS` only if N is evidence-derived and nonzero, every expected published identity has a real canonical route/200, requested and source brand/slug match, every eligible known parameter survives source/parser/view/SSR/DOM, absent data is honest, and no private/internal data is reachable. Validate direct Data API/privacy evidence separately; UI omission alone is not authorization proof. All cohort/field/source hashes and actual observed counters must agree. Missing data/proof, unexplained filtered identity or failed route -> FAIL/BLOCKED, never vacuous PASS, count-only success or manually deleted expectation.

Task 6 uses one sequential desktop Chromium context for the full N-device sweep. Secondary 390/430/1280 locale/UX/security checks are a separate small matrix, not N multiplied by every viewport/engine. Any later reader/route/mapper/source change invalidates affected core evidence and requires focused all-device reproof before final release; source stability is not permission to copy historical PASS as fresh execution. Whole Slice C cannot close on core PASS alone.

## 7. Security Findings and Gap Ledger

Severity refers to source-demonstrated exposure or missing required behavior, not a claimed Production exploit. P1 catalog findings require malicious content to reach the published catalog (currently privileged ingress); exploitability was not exercised here. They block release until local negative proof closes the sinks. No P0 established.

| ID | Class / severity | Evidence, effect and owner | Existing coverage | Minimum fix |
| --- | --- | --- | --- | --- |
| C01 | PRODUCT_BUG / P2 | No `/products/[brand]/[slug].astro`; view-product cannot open actual detail | Product-page tests cover lists, not detail | Published canonical SSR page and honest 404/503 |
| C02 | PRODUCT_BUG / P2 | Product index:52, brand:112, `forum-search.ts:486`, `devices/[slug].astro:15`, sitemap:99 emit anchors/brand destinations | Legacy test explicitly requires old anchor | One validated identity helper; update exact legacy assertions with RED preserved; direct 301 and metadata/sitemap agreement |
| C03 | UX_GAP / P2 | Brand:140 and legacy:10 have uncaught read errors; brand's empty element starts hidden | Mapper tests only generic exception/filter emptiness | Localized route-owned empty/unavailable/not-found states; no raw errors |
| C04 | UX_GAP / P2 | `ProductVisual.astro:2-38` has no actual-image prop/render | Asset audit checks historic manifests, not detail DOM | Detail media with approved safe image or honest absence/breakage |
| C05 | DATA_CONTRACT_GAP / P2 | `public-device-data.ts:12-20,71-89` legacy strings only; states/context and complete source-to-render survival not modeled | Legacy mapping/unit tests, no complete independent oracle | Task 1 survival forensic and Task 4 zero-drop mapping; typed allowlisted model, legacy clearly unverified, conflicts preserved |
| C06 | DATA_CONTRACT_GAP / P2 | Same mapper lacks normalized sources/evidence/dates | Schema sources/provenance scripts cover importer, not public detail | Public attribution and honest absence, no source fabrication |
| C07 | SECURITY_GAP / P1 (conditional) | Product index:197 and brand:282 JSON.stringify -> set:html; closing-script catalog text exits data script | Locale test injects search query only, not catalog JSON | Shared script-safe serializer and hostile-catalog SSR/browser tests |
| C08 | SECURITY_GAP / P1 (conditional) | Product index:296-312 and brand:446-462 interpolate names/brands/specs into innerHTML | Compare positive tests only | DOM creation/textContent for dynamic content; literal markup stays literal |
| C09 | SECURITY_GAP / P2 | Brand:113-114,257 and mapper:76-89 accept arbitrary URL strings; rel attrs do not validate scheme/credentials | Importer URL validation does not protect runtime legacy rows | HTTPS credential-free public link/media policy, negative URL fixtures |
| C10 | SECURITY_GAP / P2 | `src/middleware.ts:7-19` only locale/cache; public/_headers has no framing CSP and static headers are not dynamic response proof | Security-headers tests assert generated file directives | Response-owned baseline plus static/dynamic assertions, preserve existing CSP and auth no-referrer |
| C11 | RESPONSIVE_GAP / P2 | Header toggle always hidden, mobile nav scrolls invisibly | Audit-mobile-layout source markers; B widths do not prove menu destinations | Explicit vertical menu/search row preserving action order/Gaze flag |
| C12 | RESPONSIVE_GAP / P2 | Fixed/clipped visual titles and compare minimum widths noted in section 5 | Locale test measures only product index body width | Long-title/value fixtures, local table scrolling, stacked detail, no clipped facts |
| C13 | ACCESSIBILITY_GAP / P2 | Header/mobile targets below design 44px; menu close does not restore focus; popup uses listbox containing ordinary links/buttons | Focus CSS/source assertions, not full keyboard interaction | Native navigation semantics, visible focus, Escape/focus restoration and hit-area assertions |
| C14 | PRODUCT_BUG / P2 | `GlobalSearchBox.tsx:63-109,147-199` posts-only and error-as-empty; full API all scope exists | Search unit/source and B locale tests | Global grouped all-scope preview, distinct error, bounded limits and stale cancellation |
| C15 | TEST_GAP / P2 | No public typed projection/detail negative suite; schema RLS script uses synthetic role identities, not actual Auth/Data API | `test-device-schema-v1-rls.mjs`, `test-public-device-data.mjs` | Genuine local anon/A/B/direct Data API allow/deny and detail negative contract |
| C16 | TEST_GAP / P2 | No canonical detail/browser menu/media/security matrix | B product-index widths, legacy-route and SEO list checks | Small dedicated or extended owned local browser harness, no redundant locale suite |
| C17 | DATA_CONTRACT_GAP / P2 | Foundation SQL:383-458 only catalog-admin SELECT; no normalized public reader or invoker view/RPC in src/migrations | Foundation/model tests prove existing closed state | Additive invoker projection with column grants+publication/state/source RLS; fail closed on infeasibility |
| C18 | DOC_GAP / P3 | Older schema design permits definer; docs/README and legacy tests describe anchor-only surface | Planning/spec history | Record current authority and reviewed new route/read/rollback contracts; do not rewrite history |

Counts (one primary class per ID): PRODUCT_BUG=3, UX_GAP=2, RESPONSIVE_GAP=2, ACCESSIBILITY_GAP=1, DATA_CONTRACT_GAP=3, SECURITY_GAP=4, TEST_GAP=2, DOC_GAP=1; total=18. Receipt UI_UX_GAPS_COUNT=5 combines PRODUCT_BUG and UX_GAP, not additional findings.

Priority correction: C01/C02/C05 plus C15/C17 public-read proof and C16 all-device completeness belong to the primary core gate. Existing data being truly lost is not yet proven; Task 1 distinguishes absence from parser/reader/component/routing disconnection. This priority change does not waive the later C07/C08 P1 release blockers or other required secondary gates.

**SECURITY_FINDINGS_BLOCKING:** C07/C08 source-confirmed conditional XSS sinks; C09/C10 also required security gate closure. C17/C15 form a blocking implementation feasibility/authorization-proof gate, not a claim of existing private-data leakage. All remaining required product gates must close before release; severity alone does not waive them.

**SECURITY_FINDINGS_NONBLOCKING:** No additional confirmed in-scope vulnerability. Checked current boundaries: published filters and anonymous `createSSRClient` exist; mapper hides row ID/publication metadata; search caps each result group at 20, query at 2-80 normalized characters and returns SEARCH_FAILED, not raw backend errors. No product mutation/IDOR endpoint, public service-role client, raw Markdown/HTML detail renderer or arbitrary external redirect target exists in the inspected current path. Astro/React escape ordinary interpolations. New detail still needs negative proof. These observations are not a repository-wide secret audit or a Production safety certification.

Editorial MDX is repository-trusted authored markup, not runtime untrusted rich content. Do not add raw Markdown/HTML rendering to detail. Current static discussion helper/unused explorer inconsistencies are OUT_OF_SCOPE except preserving link compatibility; no forum rewrite. Provider delivery/VPN observations remain scoped/deferred, not expanded by Slice C.

## 8. Existing Test Inventory and Reuse

| Test / entrypoint | Current proof and limitation | Planned reuse |
| --- | --- | --- |
| `scripts/test-product-page.mjs` (`npm run test:products`) | List/brand search, compare<=3, source/CSS/catalog assertions; no actual detail | Extend canonical entry/security DOM expectations, preserve existing positives |
| `scripts/test-device-library.mjs` (`npm run test:device-library`) | Static legacy alias contract, currently requires brand-anchor 301 | Update only superseded destination expectation; real route proof added separately |
| `scripts/test-public-device-data.mjs` | Mocked published-column mapping, string specs/units, no raw mapper exception | Extend public model and negative fields; not RLS acceptance |
| `scripts/test-device-schema-v1-{definitions,model,sources,provenance,conflicts,enforcement,rls}.mjs` | Definition/import/state/conflict invariants; existing role-based Postgres tests | Preserve foundation suite; add public direct-API/genuine-Auth test rather than change importer authority |
| `scripts/test-search.mjs`, `scripts/audit-search.mjs` | Search normalization/result contracts and local Worker wiring; test-search reads production config and rebuilds | Source-inspect outbound paths first; loopback-only new scope/preview fixture, preserve previous failure receipts/waivers as historical only |
| `scripts/test-locale-catalog-search-news.mjs` | Local owned SSR zh-CN/en, positive compare, index widths 390/430/1280, literal query probe | Extend for new page/catalog payload; never rerun B's 102-case acceptance just to claim C |
| `scripts/audit-mobile-layout.mjs` | Static CSS/presentation markers, not menu interaction | Update required menu targets; supplement actual browser measurements |
| `scripts/test-security-headers.mjs`, `test-security-headers-artifact.mjs` | Static generated _headers shape only | Keep and extend response/header policy proof |
| `scripts/verify-seo.cjs` | Owned Worker SSR metadata, legacy devices-index redirect, loopback route-scoped fixture | Extend exact detail and sitemap/canonical cases; do not loosen fixture wildcard allowlist |
| `scripts/audit-product-data.mjs`, `audit-product-assets.mjs` | Historical public manifest/internal source ledger/assets | Inventory only now; asset audit can fetch remote links and must not run implicitly |
| `scripts/audit-media-url-privacy.mjs` | Relevant privacy patterns; has optional fetch behavior | Source-only/local mode if proven available; otherwise bounded dedicated local negative test, no remote scan |
| `scripts/qa/manifest.mjs`, `profiles/release.mjs` and profile tests | Existing ownership/escalation/release flow, previous B evidence | Integrate C focused checks without mutating B historical evidence, bypassing checks or adding automatic retries |

No tests/build/browser/DB replay ran during this planning task. Only source/metadata inspection and final document hygiene are required now. Missing proof is detailed in C15/C16, with security negatives below. Existing scripts must be inspected for remote capabilities before later execution; a name containing test/local does not establish isolation.

## 9. Implementation Preconditions and Data Permission Gate

- New execution authorization must pin HEAD/base/worktree and approved plan commit. Fetch main and stop on identity drift; no automatic rebase/merge. Discover installed tool commands from their current help; no global installs or inherited provider authorization.
- Before SQL/browser data work, verify reachable Linux Docker and repository-pinned local Supabase tooling, owned disposable root, genuine local Auth A/B and anon. Reuse `scripts/qa/local-disposable-supabase-replay.mjs`, its canonical baseline plus additive migrations mechanism and `sanitizedChildEnvironment`; inspect current exports before use.
- Construct child environments by positive allowlist, omit Production/provider variables rather than forward or blank them. Deny non-loopback execution targets and all unapproved outbound requests at browser, Worker and fixture-service boundaries. Local test bootstrap keys/passwords stay local and value-blind. Never load root .env as a shortcut or borrow Production bindings.
- Target public read mechanism: narrowly projected `security_invoker=true` views (Postgres version permitting) or fixed-contract SECURITY INVOKER RPC, never definer/service-role. Exact object names/signatures and migration filename are generated/confirmed during Task 3 after CLI help/version discovery; no deployable SQL is authored by this plan.
- Important feasibility constraint: foundation grants table-level SELECT to `authenticated` for catalog-admin policies. Adding public SELECT RLS without first replacing broad client-role table grants with reviewed column grants would expose internal columns to ordinary authenticated actors. A projection alone is insufficient. Preserve catalog-admin mutation/authorization policies; test intended existing admin operations as well as public deny paths. Do not preserve a broad table SELECT merely for convenience, or silently break admin reads to make public tests pass.
- Filtering/join columns also require narrowly justified grants and RLS. Device/source/evidence linkage may be public only for published devices and allowed public states; inactive definitions, drafts, unrelated sources, internal UNKNOWN_UNVERIFIED and audit rows remain inaccessible. Test direct base-table columns and wildcard SELECT as well as the projection. No public writes.
- If invoker policies/grants cannot express that boundary while preserving existing admin contracts, STOP for a design amendment. Do not use a definer, mirror database, blanket SELECT grant, or privileged server proxy. C17 must be GREEN before Task 2's runtime detail integration can be accepted; route RED/contract comes first, not an unsafe success placeholder.
- Successful empty structured results are allowed. A missing projection/grant/database connection is not empty data and must fail with a safe unavailable/503 state. A Production prerequisite discrepancy blocks later release until separately approved forward migration/read-only verification; no Production fallback here.

## 10. Ordered Implementation Tasks

For future authorized execution only. PRIMARY BLOCKING SEQUENCE: data survival RED -> canonical route RED -> public reader -> parameter mapping -> link migration -> all-device detail acceptance. Only then begin secondary UX/mobile/search/security closure and final release. Every task records RED -> minimum implementation -> focused GREEN -> relevant regression -> explicit commit. Save actual assertion/exit receipts, not missing-import failures labeled behavioral RED. No automatic retries, timeout inflation, repeated broad gates after tiny changes or rewritten historical results.

Task 2 opens canonical-route RED before its reader exists. Its integration GREEN and product-route commit are deferred until Tasks 3/4 provide the real reader and full parameter mapping. This is a dependency barrier, not permission for a fake known-product 200, client-only modal or broken product commit. Task 3 may commit independently passing read-boundary changes; Task 4 closes Tasks 2/4 together before Task 5. No secondary task starts while Tasks 1-6 or PRODUCT_DETAIL_CORE_ACCEPTANCE are incomplete.

### Task 1: Existing Data Survival Forensic and Generated Inventory (First Hard Gate)

- [ ] Goal: establish whether the user's supplied device identities and parameters exist and where they are disconnected, before treating the problem as detail-page polish.
- [ ] Files: new scripts/lib/product-detail-repository-inventory.mjs and scripts/test-product-detail-data-survival.mjs; existing mapper/model tests only as necessary. Generated deterministic inventory/fixture goes under an ignored owned artifact directory, with a tracked schema/assertion contract, not hand-copied values. Inspect existing YAML, identity/definition/source/conflict maps, bootstrap manifest, static catalogs and migrations without changing them.
- [ ] RED: independently enumerate expected source fields and observe current mapper/route omissions. Detect missing dataset/identity layer, unresolved generation, parser omission, compatibilityGaps and lost known fields. Missing repository layer blocks, not permission to invent replacements.
- [ ] Minimum implementation: use approved repository parsers and reviewed identity mapping; independently enumerate source leaves BEFORE lossy normalization/compatibility. Record each device brand/slug/canonical identity, structured/legacy/full_specs/key-spec fields, existing source/evidence, publication evidence and file/hash/pointer. Derive local published fixture membership only from a reviewed repository publication contract/snapshot, not names/counts or all static documentation. Do not execute the bootstrap importer or infer current Production publication from its initial published default.
- [ ] GREEN: deterministic regeneration agrees for pinned source hashes. Emit CANONICAL_DEVICE_DATA_SOURCE, LEGACY_PARAMETER_DATA_SOURCES, PUBLISHED_DEVICE_COUNT with evidence scope, DEVICE_IDENTITIES, EXISTING_DEVICE_DATA_PRESENT and EXISTING_PARAMETER_DATA_PRESENT. Both presence fields must be true. Local repository cohort count is not a Production count; unavailable publication evidence remains UNKNOWN and blocks the affected gate.
- [ ] Regression: approved source-authority/identity/model/provenance plus omission/tamper negatives; no remote reads or fixture DML yet. Commit boundary: generator/schema/tests only. Missing previously supplied parameters -> STOP, report exact source/identity/parser/compatibility/repository-publication layer and safe file/pointer/count evidence; do not recollect specs or continue route implementation.

### Task 2: Real Canonical SSR Route Contract (Next Blocking RED)

- [ ] Goal: C01 is a missing route, not polish: /products/{brand}/{slug}/ must become actual canonical SSR detail.
- [ ] Files: new src/lib/product-route.ts, src/pages/products/[brand]/[slug].astro, src/components/products/ProductDetail.astro and scripts/test-product-detail-contract.mjs. Tests use Task 1 generated identities/expectations, not one manually curated representative.
- [ ] RED: current known repository-published nested route is 404; brand anchor is not acceptable. Require known published -> 200, unknown brand/device -> truthful 404/noindex, private/unpublished never exposed, unavailable read -> safe 503. Wrong recognized brand for a published slug retains design's resolved-brand 301; unknown brand is 404, not list fallback.
- [ ] Minimum implementation: immutable identity validation/encoded trailing-slash local path and anonymous request SSR route; integrate Task 3 real reader then Task 4 parameter renderer. No fake success placeholder/modal or unapproved static runtime database fallback. Native escaped text/basic private-public checks apply immediately; any new embedded JSON/JSON-LD needs script-safe serialization from introduction. Broad existing catalog-sink closure remains Task 10, not permission for new unsafe detail markup.
- [ ] GREEN: integration checkpoint deferred to after Tasks 3/4: actual owned local Worker statuses, correct brand/slug, complete visible parameters and honest absence/outage. No route completion claim before this.
- [ ] Regression: malformed/overlong/encoded delimiter identity controls, public/locale/consent boundaries. Commit boundary: test scaffolding only if it leaves no knowingly broken product tree; route implementation commits atomically with Task 4 after GREEN. Task 2 is incomplete until real integration passes.

### Task 3: Public-Safe Reader and Genuine Local Authorization

- [ ] Goal: C17/C15/C05 public ProductDetailView reads only published detail data without private/privileged shortcuts.
- [ ] Files: new src/lib/public-product-detail.ts, scripts/test-public-device-detail-local.mjs and scripts/lib/public-device-detail-local.mjs; narrow src/lib/public-device-data.ts metadata validation; CLI-generated supabase/migrations/<generated>_public_device_detail_v1.sql if additive invoker read authorization is needed. This plan executes no SQL.
- [ ] RED: closed normalized schema rejects expected typed public read; legacy reader lacks public typed fields. Independently prove unpublished/internal/writes denied, not hidden merely by UI.
- [ ] Minimum implementation: owned disposable local Supabase, genuine local Auth A/B and anon, positive-allowlisted child env and Task 1 source-derived fixtures. Allowlisted SECURITY INVOKER projection, publication/active-definition/public-state/reachable-source RLS and justified column grants; no definer/service-role reader. Broad authenticated table SELECT must not expose internals when public policies are added; preserve admin authorization/read/mutation contracts or STOP for design amendment.
- [ ] GREEN: public projection AND direct Data API allow published metadata/spec/source/evidence; deny drafts, internal UNKNOWN_UNVERIFIED/raw_value/notes/updater/auth IDs/audit/credentials/unrelated sources and public writes. Reader discriminates published/not-found/unavailable; zero structured rows are not failure and unavailable projection is not empty. No privileged HTTP actor substitutes for public proof.
- [ ] Regression: foundation RLS/enforcement/conflicts/sources, target/env isolation, false/0/context representability and owned cleanup. Commit boundary: independently GREEN reader/read-boundary/local proof. Docker loss, non-loopback target, missing dataset or infeasible grants -> STOP; no Production fallback/import.

### Task 4: Parameter Survival Matrix and Truthful Rendering

- [ ] Goal: SOURCE_FIELD -> PARSER/VIEW_FIELD -> UI_GROUP -> RENDER_STATE covers every eligible existing visible value; lack of a structured row must not discard known legacy parameters.
- [ ] Files: inventory generator/tests; src/lib/public-product-detail.ts, src/components/products/ProductDetail.astro, src/pages/products/[brand]/[slug].astro; src/lib/i18n/messages/catalog.ts only necessary detail labels; scripts/test-public-device-data.mjs. Mapping matrix is generated, not a manually copied catalog.
- [ ] RED: compare independent source leaves against current parser/model/UI; detect lost non-string/legacy values/structured absence without deleting them from expected inventory. Normalizer output alone cannot be the oracle because it can itself omit values.
- [ ] Minimum implementation: explicit ledger with pointer/type/unit/context/identity and rendered destination; KNOWN, UNKNOWN, ABSENT, LEGACY_UNVERIFIED, STRUCTURED_VERIFIED per section 6.1. Structured public verified data takes precedence but legacy source values remain visible and labeled when not structurally represented. Preserve conflicts/variants, no fabricated source/confidence/winner/default or private JSON spread. Unmapped eligible known field fails rather than quietly becoming excluded.
- [ ] GREEN: KNOWN_SOURCE_VALUE_DROPPED_COUNT=0 across generated cohort; values/false/0/units/contexts survive actual model/SSR/browser. Use exact field/value sets and source-defined equivalence, not loose substring checks. No fabricated value or silent truncation. Close Task 2 route GREEN here.
- [ ] Regression: Task 3 direct API/public/privacy and legacy unit/context/source/identity tests. Commit boundary: real route + parameter renderer + mapping proof atomically GREEN before links or broad UX/mobile.

### Task 5: Repair Product Identity Links After Real Detail Exists

- [ ] Goal: C02 canonical card/brand/search/compare/legacy identity actions only after Tasks 2-4 pass.
- [ ] Files: src/pages/products/index.astro, [brand].astro, src/lib/forum-search.ts, src/pages/devices/[slug].astro, src/pages/sitemap.xml.ts; existing product/device/data/SEO tests. ProductCard.astro only if an active caller needs repair.
- [ ] RED: existing consumers and legacy assertion still require brand anchors; preserve historical evidence then assert canonical /products/{brand}/{slug}/ for every published identity action.
- [ ] Minimum implementation: Task 2 helper everywhere, direct legacy 301, existing compare<=3 selection handoff/backlinks, canonical/OG/JSON-LD/sitemap agreement. Keep old brand hash IDs/bookmarks but no identity action self-targets its brand anchor. No server fragment-redirect promise, selection persistence redesign or Compare v2 ranking.
- [ ] GREEN: generated published identities have correct card/search/compare/alias destinations, no remaining anchor identity action, no drafts/static-only catalog aliases; actual detail-to-compare and back works.
- [ ] Regression: current compare add/remove/clear/limit, search filters/SEO and editorial-doc preservation; transparent old destination assertion revision. Commit boundary: canonical links only, no quick-search scope overhaul yet.

### Task 6: All-Device Core Detail Acceptance (Secondary Work Barrier)

- [ ] Goal: every expected repository-published device passes PRODUCT_DETAIL_CORE_ACCEPTANCE, not only a representative sample.
- [ ] Files: new scripts/test-product-detail-all-devices.mjs and minimal scripts/lib/product-detail-browser-harness.mjs reused later; generated inventory/mapping schema; narrow scripts/lib/slice-c-acceptance.mjs and scripts/test-slice-c-acceptance.mjs if existing receipt machinery cannot express core gates.
- [ ] RED: current missing nested routes and synthetic omitted-field/swapped-identity/fabricated-value controls are detected. Missing publication/dataset layer remains Task 1 blocker, not an empty PASS. Synthetic detector controls never hand-copy actual parameter values.
- [ ] Minimum implementation: Task 1 independently derived cohort/field oracle with pinned hashes; source-derived owned local seed, no remote import. Sequentially visit EVERY canonical detail through actual built local Worker and one anonymous Chromium desktop context; inspect actual SSR and DOM fields, including legacy-only/empty structured. N is derived at execution from reviewed repository publication evidence, never hardcoded/sample-count inferred. Core minimum escaping/public privacy/error truth applies now; broad security/mobile closure comes later.
- [ ] GREEN: EXPECTED_PUBLISHED_DEVICE_COUNT=N, DETAIL_ROUTE_200_COUNT=N, DETAIL_ROUTE_404_FOR_EXPECTED_COUNT=0, DETAIL_ROUTE_5XX_COUNT=0, DEVICE_IDENTITY_MISMATCH_COUNT=0, KNOWN_PARAMETER_VALUE_DROPPED_COUNT=0, FABRICATED_PARAMETER_VALUE_COUNT=0. Honest missing data/internal-field absence and Task 3 genuine privacy proof match the same fixture/source contract. N=0 fails. PRODUCT_DETAIL_CORE_ACCEPTANCE=PASS only with all evidence complete.
- [ ] Regression: omitted-device/source/mapping tamper negatives, aliases/canonical link sets, private/unpublished controls, no-store/locale baseline and owned process/port/container cleanup. Commit boundary: all-device tests/core evidence gate. STOP on first distinct failed device/layer, no broad secondary work or copied PASS. Later route/reader/mapping/source changes invalidate affected core evidence and require focused core reproof.

### Task 7: Source / Evidence and Detail-State UX Closure (After Core PASS)

- [ ] Goal: C03/C04/C06 presentation after data survival, not a substitute for restored detail.
- [ ] Files: detail/reader components, new src/components/products/ProductDetailMedia.astro, catalog messages and focused source/media/state tests. Task 1 existing sources remain authoritative, no Internet spec research.
- [ ] RED: present source metadata lacks correct attribution/dates/field relationship; no-source/media/fault presentation deficient even though core statuses and values are truthful.
- [ ] Minimum implementation: existing public evidence/source_type/dates/claims with honest absence; useful retry/back states; approved real media or no-image/breakage, bounded dimensions/alt; known circle link or full search, no invented thread. Native escaped text and no unvalidated active link/media from day one; adversarial closure is Task 10.
- [ ] GREEN: null title/date, secondary/official source distinction, conflicts, metadata-only/empty/unavailable/no-image/broken-image and both locales; no fabricated confidence/freshness/citations or translated factual data.
- [ ] Regression: affected all-device survival/mapping/privacy; no core regression. Commit boundary: source/state/media presentation only.

### Task 8: Mobile Navigation, Responsive Layout and Accessibility (After Core PASS)

- [ ] Goal: C11/C12/C13, no general redesign or Auth/locale changes.
- [ ] Files: SiteHeader.astro, src/lib/site-navigation.ts, shell messages; detail/media and product index/brand CSS; ProductVisual.astro only demonstrated clipping; audit-mobile-layout and focused browser tests.
- [ ] RED: 390/430 hidden Menu/unreachable destinations, small hit areas/focus loss, long-title/spec clipping/overflow. No broad mobile work before core PASS.
- [ ] Minimum implementation: bounded vertical native menu/Home/feed/Circles/News/Products/resources/Gaze flag; stable search row; Notifications -> Settings -> Account and anonymous Auth access; preserve B confirmation. >=44px changed targets, focus/Escape/restoration, stacked/wrapping detail/full facts, bounded keyboard-reachable compare-only scrolling; no global overflow masking.
- [ ] GREEN: 1280/430/390 both locales, screenshots and element/hitbox measurements, no menu/search/dialog overlap, known fields accessible, native popup semantics/headings/alt/reduced-motion.
- [ ] Regression: affected all-device visibility, desktop/Starlight header/locale/Gaze/Settings/Auth-consent subset. Commit boundary: measured presentation/accessibility only.

### Task 9: Global Quick / Full Search Consistency (After Core PASS)

- [ ] Goal: C14 using existing search API/corpus.
- [ ] Files: GlobalSearchBox.tsx, src/lib/search-types.ts only response type reuse, shell messages; existing search/locale tests and focused preview assertions.
- [ ] RED: quick preview omits device/circle/user matches, failure looks empty and stale fetch settles after latest intent.
- [ ] Minimum implementation: global type=all, bounded per-group limits/grouped native links; one owned debounce/abort/stale lifecycle, distinct loading/error/success-empty/full-results/retry. Preserve circle-scoped posts-only, Task 5 canonical hrefs; no new corpus/news index/QA strings.
- [ ] GREEN: XREAL/RayNeo/Meta/air/glasses, actual source-derived circle name, nonsense/special/Chinese; scope/existence not count equality, canonical details, stale/failure cases.
- [ ] Regression: normalized 2-80 query/result<=20/public visibility/generic errors, all-device identity hrefs. Commit boundary: preview only, no timeout/retry waiver or harness workaround.

### Task 10: External URL, Catalog XSS / JSON-LD and Rendering Security (After Core PASS)

- [ ] Goal: C07/C08/C09 comprehensive adversarial closure; core unprivileged/escaped rendering is not delayed.
- [ ] Files: new src/lib/product-public-safety.ts and scripts/test-product-detail-security.mjs; index/brand dynamic DOM/JSON, detail/media/optional page-owned JSON-LD and product tests. Importer source authority unchanged.
- [ ] RED: local hostile catalog closing-script/quotes/markup/events/separators breaks JSON/innerHTML; invalid script/data/credentialed/media URLs retained. Never persist attack fixture to Production.
- [ ] Minimum implementation: serializer escaping <,>,&,U+2028/U+2029; DOM createElement/textContent for dynamic compare, structured URL checks/HTTPS without credentials; approved existing media origins/local paths, no unreviewed/private/signed/SVG-data URL or remote SSR source fetch. JSON-LD known facts only, no rich HTML/sanitizer dependency.
- [ ] GREEN: literal text/no injected nodes or side effects/JSON roundtrip, unsafe active href/src rejected, private sentinel absence/privileged-client denial; genuine direct API proof stays Task 3, not UI filtering.
- [ ] Regression: all-device core exact identity/field equivalence, positive compare/search/source both locales; don't truncate/reclassify public text to dodge negative test. Commit boundary: security closure after restoration.

### Task 11: Dynamic Worker Security Headers (After Core PASS)

- [ ] Goal: C10 without locale/Auth/static regressions.
- [ ] Files: src/middleware.ts, public/_headers, optional src/lib/security-headers.ts; existing artifact tests/new scripts/test-product-security-headers.mjs.
- [ ] RED: actual local dynamic 200/301/404/503 missing baseline despite generated static _headers PASS.
- [ ] Minimum implementation: nosniff/frame-ancestors none/DENY/referrer/unused-capability policy, callback/recovery no-referrer; preserve unrelated CSP/status/body/location/no-store/locale. No HSTS/account TLS/script-src/CAPTCHA change.
- [ ] GREEN: actual local dynamic/static header proof and synthetic callback/recovery request only; no token-bearing Auth flow, preserve stronger policy.
- [ ] Regression: core statuses/no-store, locale/HTML route policy, artifact/callback/runtime-consent/required-CAPTCHA subset. Commit boundary: response policy/tests.

### Task 12: Focused Secondary Browser / Security Acceptance and Release Integration

- [ ] Goal: C15/C16 and release gates; sampled responsive tests never substitute for Task 6 all-device proof.
- [ ] Files: new scripts/test-product-detail-browser.mjs, reuse Task 6 harness/generated inventory; locale catalog/SEO/security/core tests; minimal package.json/scripts/qa/manifest.mjs/profiles/release.mjs/test-qa-harness-profiles.mjs wiring.
- [ ] RED: seeded missing-device/value/unsafe URL/HTML/private/privileged/raw-error/overflow controls detected; validator rejects missing/stale/wrong-SHA/origin/cleanup/core evidence. Boot failure is not product RED or printed PASS.
- [ ] Minimum implementation: section 11 seven-context SECONDARY matrix reuses actual local Worker/loopback transport; scoped fixture methods/paths, deny outbound, no TLS trust changes. Distinguish source/mock/genuine RLS/deployed evidence; C checks preserve B history/schema/ancestry/budgets/retries.
- [ ] GREEN: core valid, all secondary checkpoints/negatives complete; actual route/status/observer/screenshots, terminal network and owned cleanup counters; no unauthorized external requests/provider Auth or broad B matrix.
- [ ] Regression: inspected product/device/search/SEO/header/A/B subset, then one npm test/build/qa:release at integrated candidate with bounded authorization where needed. First failure STOP, preserve FAIL, no automatic rerun. Commit boundary: final focused proof + release wiring, no deployment config.

### Task 13: Review and Deployment-Aware Release Handoff

- [ ] Goal: C18, core/rest-of-C/release statuses separate; restored routes alone are not whole-Slice-C PASS.
- [ ] Files: docs/README.md, new docs/ops/product-detail-ux-security-closure-v1-acceptance.md and plan ledger; no credential/provider edits.
- [ ] RED: refuse missing inventory/mapping/all-device core PASS, source-only/stale core proof, unresolved P0/P1, absent genuine RLS or unapproved migration/merge/main push.
- [ ] Minimum implementation: source/file/fixture/mapping hashes, exact N/counters, core and secondary immutable receipts, independent review/remaining P2 owners/human disposition; separate operator migration/version/rollback gates. PRODUCT_DETAIL_V2_REDESIGN=false; NEW_DEVICE_DATA_RESEARCH=false.
- [ ] GREEN: actual receipts/docs agree, full required gates/hygiene/ancestry/scope reviewed; READY_FOR_PR_REVIEW only. Main push -> Cloudflare build -> automatic Production deployment remains explicit, never neutral handoff.
- [ ] Regression: final clean-tree/document/commit proof, no whole-A/B acceptance rerun. Commit boundary: handoff docs only; STOP for explicit push/PR/merge/deploy authorization.

## 11. Proposed Small Browser Acceptance

This SECONDARY matrix starts only after Task 6 PRODUCT_DETAIL_CORE_ACCEPTANCE=PASS. The primary all-N-device SSR/browser sweep is mandatory and separate; these sampled presentation contexts cannot establish all-device coverage.

Secondary matrix: Chromium 1280x900, 430x900, 390x900, each zh-CN/en = **six contexts**, plus **one Firefox desktop 1280x900/en context** = **seven contexts total**, sequential, not 102 cases. Representatives are deterministically selected from Task 1 generated source-derived inventory; metadata-only/hostile/fault detector controls are local synthetic scenarios, not manually copied real parameter facts. This is not N devices multiplied by seven contexts.

1. In every context: list/brand -> detail first viewport, canonical metadata, real safe local image plus fallback, long title/value/source wrapping, public/no Auth requirement, correct single selected UI language and no runtime-consent gate; screenshot and element-level overflow/hit-box measurements.
2. In every context: menu where mobile, source/compare action reachability, add/remove/limit-three and links back to detail; keyboard focus/tab/Escape and visible focus; table-only horizontal scrolling. Desktop keeps normal navigation. Source navigation is intercepted with expected safe URL rather than contacting manufacturers.
3. Each locale at desktop: actual 301 wrong-brand/legacy alias and 404/noindex unpublished/unknown vs 503 unavailable; metadata-only/empty structured groups/source absence, false/zero/CONFLICT evidence; sitemap URL-set consistency; malicious catalog/closing-script/no side effects.
4. Each locale at desktop plus a mobile popup geometry check per width: grouped quick/full search existence and canonical destinations, loading/error/empty/stale responses, circle-scoped behavior; query corpus from Task 9. Request cancellation is recorded, not ignored as success.
5. Shared-header Starlight smoke in one context per locale plus both mobile widths across those contexts: menu destinations and Settings confirmation compatibility; no full documentation translation matrix.

Firefox desktop preserves the recovery design section 23 minimum without duplicating the locale matrix. Its bounded distinct-risk scope is new dynamic DOM/text construction and hostile catalog script parsing, keyboard focus/popup dismissal, and comparison scroll-region containment in Gecko. These are browser-engine-owned behaviors, not an assertion of a confirmed Firefox defect. Reuse the desktop English detail/compare/security checkpoints only, with zero external requests. No Firefox mobile or other engine is scheduled unless an actual distinct risk justifies a separately reviewed expansion.

Tests deny unapproved network, capture no secret-bearing URLs/screens, and clean owned processes/ports/containers. Local browser fixture HTTP is not proof of Production publication, provider delivery or real Auth; each receipt labels its evidence class.

## 12. Explicit Security Acceptance

- URLs: reject javascript/data/blob/file/vbscript, mixed-case/control/encoded bypasses, protocol-relative URLs, username/password authority, internal traversal/encoded separators and malformed/overlong identities; safe HTTPS sources retain href and noopener/noreferrer. Unsafe URLs are not merely hidden with an active click target retained.
- Media: approved local/HTTPS asset origin policy, no arbitrary SVG/data/credentialed/signed/private URL, no remote SSR source fetch. Honest no-image/broken-image fallback, real product image not decorative stock substitute.
- HTML/script: catalog names/specs/source titles/queries containing markup, closing scripts, event handlers, quotes and Unicode separators appear literally; no injected nodes/execution side effects, safe JSON/JSON-LD parse and identical data values. Test both initial SSR and subsequent comparison/quick-search DOM updates.
- Private data: sentinel notes/raw_value/updated_by/auth IDs/catalog audit/internal research and UNKNOWN_UNVERIFIED excluded from endpoint/model/HTML/scripts; draft and unrelated evidence sources inaccessible for anon and actual A/B. Direct Data API denied columns, wildcard SELECT and writes are independently checked; don't accept UI filtering as authorization.
- Privileged client: dependency/import graph and built browser/public SSR projection check forbids service-role paths and sensitive field/config names where inappropriate; use synthetic safe sentinels, never read/print/scan actual secret values. Public code continues using anon; existing server-only forum binding untouched.
- Raw errors: simulated backend/permission/network errors disclose only bounded generic public categories and 503 where applicable, never SQL/stack/database host/credentials/raw payload; distinguish absence from outage. API search errors remain generic.
- Headers: actual dynamic 200/301/404/503 and static asset response coverage; framing denied; callback/recovery no-referrer; CSP merge preserves unrelated directives; locale no-store preserved. No auth action or token-bearing callback navigation required.
- Public params/redirects: validation before lookup, finite query/group limits preserved; wrong-brand redirect can only use published identity helper, no next/query-generated external redirect. No new product write/IDOR endpoint. Negative tests use owned local identities only.

## 13. Eventual Release, Migration and Rollback Contract

This section describes future gates, not authority to execute them.

1. Human reviews this revised plan, then separately authorizes implementation. Tasks 1-6 must establish PRODUCT_DETAIL_CORE_ACCEPTANCE before Tasks 7-12 secondary closure; full slice needs both plus independent review and human disposition of remaining P2/P3. Missing supplied dataset/publication authority, dropped/fabricated known fields, Docker/RLS failure, non-loopback target, Production secrets/config entering local execution, A/B/CAPTCHA/consent regression or architecture infeasibility -> STOP.
2. Proposed migration is reviewed with additive replay, real public/admin permission tests and exact previous grants/policies. A separate operator authorization supplies target identity, forward migration and rollback scope. This task performs no Production SQL. Verify deployed prerequisites read-only under that future authorization before application release; do not deploy a detail reader against nonexistent projection and pretend empty data.
3. After explicit branch push/PR authorization, verify exact source/review/checks, main identity and known-good Worker version/config rollback reference. Feature push can trigger preview Builds too; no push in this planning task. No main change or automatic rebase when drift occurs.
4. **Main push -> Cloudflare build -> automatic Production deployment.** Treat a main fast-forward/merge push as a Production deployment action requiring explicit authorization; it is not a source-only neutral handoff. Use established source-controlled release path, no manual unreviewed Worker/config shortcut. Record exact merge/new-main/build/deployment version and traffic from authorized read-only metadata/human evidence.
5. Separately authorized bounded public smoke verifies required C routes/schema/source/compare/search/menu/XSS/header gates and representative real published products. It does not replace the all-device local source-to-SSR/DOM core pass. Future read-only deployed publication/schema evidence must reconcile with the repository cohort; a mismatch blocks release/acceptance for review, never triggers an automatic import or Production repair. Controlled local typed fixtures remain required; absent source is honest, not license to fabricate. No Production injection, Auth/email or content mutation implied. Record scope/origin/SHA/version/observer/results with reasons.
6. Failure -> stop; no CAPTCHA toggle, service-role read or Production import workaround. Restore preceding reviewed safe Worker artifact through separately authorized established deployment mechanism, preserving required CAPTCHA state/sitekey and A/B bindings. Do not restore an artifact with known exploited XSS; request narrow reviewed hotfix authorization instead. Newly indexed canonical links need a reviewed compatibility/redirect rollback if reverting route support; do not silently break them.
7. Additive schema is not dropped automatically. If public grants/policies leak data, stop exposure and request exact narrowly scoped operator-approved permission rollback; do not drop data or undo admin privileges blindly. Preserve existing legacy public devices/read and brand/device URL compatibility. Worker rollback does not revoke database grants: both channels need separate recorded outcomes.

Slice C PASS does not establish LARGE_SCALE_READY, all-provider mail delivery, Mainland-China VPN compatibility, load capacity or the final whole-community two-user acceptance. A/B historical evidence stays intact and scoped.

## 14. Planning Verification and Remaining Unknowns

Current evidence is read-only source and Git/package metadata. No provider account, Production page, SQL, Auth, email or content request was made. Public official documentation only was consulted: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [API security](https://supabase.com/docs/guides/api/securing-your-api), checked 2026-10-03; grants and RLS must both be tested. Changelog markdown fetch was unsupported by the web tool, so no current changelog compatibility PASS is claimed. Recheck version-specific invoker/Data API/CLI behavior before implementation.

Remaining unknowns: complete existing parameter survival and repository published-cohort provenance (Task 1), deployed normalized contents/schema/grants, approved image-origin set, source/evidence availability, invoker/admin preservation feasibility, actual detail/menu layout (new route absent) and release version metadata. No data-loss/published-count claim is made from a static manifest or provider guess. Task 3 resolves local database feasibility; later separately authorized operator gates resolve deployed facts. Task 10 freezes media allowlist from existing approved evidence only; earlier core/media rendering must not activate an unvalidated URL. No permissive all-HTTPS fallback or new research.

Planning completion checks: new document only; `git diff --check`; task/receipt/route/gap-count consistency; document-only commit; clean worktree; no push. Human review remains pending. Stop here; implementation task checkboxes remain unchecked.
