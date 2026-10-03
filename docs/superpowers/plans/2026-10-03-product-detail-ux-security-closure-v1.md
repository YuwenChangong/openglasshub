# Slice C: Product Detail + UX / Security Closure v1

Date: 2026-10-03. Status: proposed scope and implementation plan; pending human review. Inventory is source-derived, not a fresh runtime or Production acceptance result.

**Goal:** Ship truthful published-product detail pages, consistent product destinations and global search, reachable mobile navigation, and the catalog-rendering/header security closure expressly required by the recovery design.

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
- Before implementation, human review must approve scope, gaps, task order, browser size, security assertions and expected files. `SLICE_C_SCOPE_FROZEN=PROPOSED_PENDING_HUMAN_REVIEW`; `SLICE_C_IMPLEMENTATION_STARTED=false`.

## 2. Proposed Frozen Scope

**In scope:** Published SSR `/products/{brand}/{slug}/`; honest typed groups/evidence and legacy fallback; canonical helper for cards/search/compare/sitemap/metadata; direct legacy device redirects; current comparison maximum three without scoring; explicit mobile menu; global quick/full search scope parity; catalog text/JSON/URL/media trust boundaries; dynamic security headers; existing zh-CN/en integration; focused local tests and a separately authorized release/acceptance handoff.

**Out of scope:** General redesign, forum feature overhaul, Auth/session/CAPTCHA redesign or provider toggles, new locale/preferences architecture, light/theme controls, new product research or database project, catalog bulk import/P9/Release B replay, new admin system, recommendation/ranking/social features, custom-domain/deployment migration, load certification and full restrictive script-src CSP. The final whole-product multi-agent acceptance in design section 24 is a later independently authorized task, not this slice's implementation/browser matrix.

**Required user flows:** Anonymous list -> brand -> actual detail -> official/source entry -> compare -> detail; old device URL -> canonical detail in one redirect; wrong brand -> database-resolved brand; unknown/unpublished -> indistinguishable 404/noindex; read failure -> 503/retry; metadata-only published item -> useful honest page; missing image -> no-image state; public quick search -> grouped results/full search -> matching entity destinations; mobile menu/search/source/compare reachable by touch and keyboard.

**Security properties:** Public readers use anonymous/actor-scoped unprivileged clients and database publication/state authorization; allowlisted columns only; internal notes/raw values/updater/auth IDs/audit data excluded; catalog values are text, not HTML; script JSON and JSON-LD are safely serialized; HTTPS external links without credentials; validated same-origin identity paths; no fetching source URLs during SSR; safe errors; preserved framing/referrer/permissions protections and locale no-store behavior.

**Responsive surfaces:** Shared header on community and Starlight shells; product index/brand/detail; compare table and quick-search popup; overview/media/specs/evidence/actions; empty/not-found/error/partial states. Desktop 1280, mobile 430 and 390, both existing locales, Dark-only.

**Required acceptance gates (verbatim identifiers):** `PRODUCT_DETAIL`, `PRODUCT_ROUTE_CANONICAL`, `PRODUCT_SCHEMA_RENDERING`, `PRODUCT_SOURCE_EVIDENCE`, `COMPARE_ENTRY`, `SEARCH_CONSISTENCY`, `MOBILE_NAV_390`, `MOBILE_NAV_430`, `XSS_CATALOG_PATH`, `SECURITY_HEADERS`. Each requires fresh evidence, not this inventory. Source evidence means correct attribution when present and honest absence when absent. Release requires zero confirmed unresolved P0/P1; P2 needs explicit disposition, owner and human acceptance. No large-scale readiness declaration from this slice alone.

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
| Definition order/context | Legacy object iteration/raw group labels and fixed UI path mapping | Active applicable definitions, dictionary labels, stable ordering, correct units/measurement context/region/variant; unknown definition safely omitted with safe availability state |
| Source attribution | Mapper exposes links but no publisher/type/date/field evidence; private source ledger is not runtime | Allowlisted linked public sources/evidence; preserve null title/date; distinguish secondary from official using source_type, never hostname inference |
| External/invalid URLs | Nonempty strings copied to official/buy/image properties | Link scheme/credentials validation; omit invalid target with localized unavailable state; never display a forged official fallback |
| Media absence | Mapper knows image URL/confirmation flag; current visual cannot render image | Approved safe actual image, bounded dimensions/alt; no-image and broken-image fallback; no arbitrary SVG/data/remote unapproved fetch |
| Duplicate specs | Foundation identity/context uniqueness; legacy same key may occur across groups | Keep definition+region+variant identity, deterministic ordering; do not deduplicate different measurement contexts or choose arbitrary conflict winner |
| Long/unsupported values | Unbounded strings retained; key_specs coerces via String; legacy object values skipped | Contract bounds and safe text/structured presentation, no [object Object] or serialized research blob; do not truncate facts silently |
| Stale/unknown dates | Legacy select excludes last_verified_at; no source freshness display | Present known accessed/verified dates, unavailable when absent; no invented expiry threshold, confidence, verified date or freshness badge |
| Empty structured tables vs failure | No structured query today | Successful zero rows gives useful metadata plus labeled legacy/unverified/unknown; unavailable projection/query is 503, not false zero rows/404 |

## 7. Security Findings and Gap Ledger

Severity refers to source-demonstrated exposure or missing required behavior, not a claimed Production exploit. P1 catalog findings require malicious content to reach the published catalog (currently privileged ingress); exploitability was not exercised here. They block release until local negative proof closes the sinks. No P0 established.

| ID | Class / severity | Evidence, effect and owner | Existing coverage | Minimum fix |
| --- | --- | --- | --- | --- |
| C01 | PRODUCT_BUG / P2 | No `/products/[brand]/[slug].astro`; view-product cannot open actual detail | Product-page tests cover lists, not detail | Published canonical SSR page and honest 404/503 |
| C02 | PRODUCT_BUG / P2 | Product index:52, brand:112, `forum-search.ts:486`, `devices/[slug].astro:15`, sitemap:99 emit anchors/brand destinations | Legacy test explicitly requires old anchor | One validated identity helper; update exact legacy assertions with RED preserved; direct 301 and metadata/sitemap agreement |
| C03 | UX_GAP / P2 | Brand:140 and legacy:10 have uncaught read errors; brand's empty element starts hidden | Mapper tests only generic exception/filter emptiness | Localized route-owned empty/unavailable/not-found states; no raw errors |
| C04 | UX_GAP / P2 | `ProductVisual.astro:2-38` has no actual-image prop/render | Asset audit checks historic manifests, not detail DOM | Detail media with approved safe image or honest absence/breakage |
| C05 | DATA_CONTRACT_GAP / P2 | `public-device-data.ts:12-20,71-89` legacy strings only; states/context not modeled | Legacy mapping/unit tests | Typed allowlisted detail model, legacy clearly unverified, conflict preserved |
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
- Target public read mechanism: narrowly projected `security_invoker=true` views (Postgres version permitting) or fixed-contract SECURITY INVOKER RPC, never definer/service-role. Exact object names/signatures and migration filename are generated/confirmed during Task 2 after CLI help/version discovery; no deployable SQL is authored by this plan.
- Important feasibility constraint: foundation grants table-level SELECT to `authenticated` for catalog-admin policies. Adding public SELECT RLS without first replacing broad client-role table grants with reviewed column grants would expose internal columns to ordinary authenticated actors. A projection alone is insufficient. Preserve catalog-admin mutation/authorization policies; test intended existing admin operations as well as public deny paths. Do not preserve a broad table SELECT merely for convenience, or silently break admin reads to make public tests pass.
- Filtering/join columns also require narrowly justified grants and RLS. Device/source/evidence linkage may be public only for published devices and allowed public states; inactive definitions, drafts, unrelated sources, internal UNKNOWN_UNVERIFIED and audit rows remain inaccessible. Test direct base-table columns and wildcard SELECT as well as the projection. No public writes.
- If invoker policies/grants cannot express that boundary while preserving existing admin contracts, STOP for a design amendment. Do not use a definer, mirror database, blanket SELECT grant, or privileged server proxy. C17 must be GREEN before runtime detail work proceeds.
- Successful empty structured results are allowed. A missing projection/grant/database connection is not empty data and must fail with a safe unavailable/503 state. A Production prerequisite discrepancy blocks later release until separately approved forward migration/read-only verification; no Production fallback here.

## 10. Ordered Implementation Tasks

For future authorized execution only. Every task uses RED -> minimum implementation -> focused GREEN -> relevant regression -> explicit commit. Save real assertion/exit receipts. Do not label a missing import/module as a behavioral RED. New feature absence can be demonstrated through current real route/data behavior; scaffold-only failures are separately classified. No automatic retries, timeout inflation or rewritten historic failures. Stop at the first distinct blocker; resume only with scoped authorization. No repeated full release suite after each edit.

### Task 1: Contract Fixtures and Identity / URL / Serialization Foundations

- [ ] Goal: lock C01/C02/C05-C09 contracts before wiring UI, with pure narrow helpers.
- [ ] Files: new `src/lib/product-route.ts`, `src/lib/product-public-safety.ts`, `scripts/test-product-detail-contract.mjs`, `tests/fixtures/product-detail-v1.json`; existing `scripts/test-public-device-data.mjs` for safe mapper fixtures.
- [ ] RED: against current mapper/serialized route payload demonstrate anchor instead of detail, unsafe scheme retained, false/0 lost and closing-script bytes unescaped. Route identity cases include malformed/overlong slug, encoded slash/dot/path delimiter and wrong-brand inputs. Preserve exact observed RED; new helper absence is scaffolding, not defect proof.
- [ ] Minimum implementation: validated immutable identity -> encoded trailing-slash local path; HTTPS non-credentialed URL validation; script JSON escaping `<`, `>`, `&`, U+2028/U+2029. Use structured URL APIs. Local approved image paths may be separate from external HTTPS rules; reject traversal/protocol-relative/data/script/blob/credentialed targets, signed/private media parameters and unreviewed media origins. Finite media allowlist derived from approved existing asset metadata, not arbitrary HTTPS permission.
- [ ] GREEN: unit fixtures for source URLs, route invariants and serializer round trip; mapper baseline defects remain owned by later tasks, not marked fixed by helper tests.
- [ ] Regression: existing mapper/model/source validation pure tests; no runtime admin/importer changes. Commit boundary: contract fixtures and tested pure helpers only.

### Task 2: Genuine Local Public Schema Read Authorization (Hard Gate)

- [ ] Goal: prove C17/C15 safely with real local Data API and column/RLS boundaries before building a reader.
- [ ] Files: CLI-generated `supabase/migrations/<generated>_public_device_detail_v1.sql`; new `scripts/test-public-device-detail-local.mjs`; minimal new local runner `scripts/lib/public-device-detail-local.mjs` reusing owned replay helpers; `scripts/test-product-detail-contract.mjs` SQL contract assertions.
- [ ] RED: current closed normalized schema denies expected anon/A/B published typed read; separately prove baseline internal/draft reads and writes denied. Create actual disposable local Auth users A/B, not fake JWTs; seed via owned local setup only. No service-role HTTP actor for public assertions.
- [ ] Minimum implementation: exact allowlisted invoker surface plus active-definition, publication/state/reachable-source SELECT policies and column grants; remove conflicting broad client-role SELECT grants only with preserved admin-operation proof. No import, DML repair, role-policy weakening or audit exposure.
- [ ] GREEN: published states/spec/source/evidence visible to anon/A/B; draft/unknown/inactive/orphan/internal fields/writes denied through projection AND direct Data API. Catalog-admin mutation and approved read contracts still pass. Verify nullable title/date, conflict evidence, two device identities and variant/context separation.
- [ ] Regression: foundation enforcement/RLS/conflict/provenance suites; sanitized environment and non-loopback sentinel tests; owned cleanup confirmed. Commit boundary: additive migration plus local proof only. If feasibility fails, stop here for design review; do not proceed with partial permission proof.

### Task 3: Public Typed Detail Reader and View Model

- [ ] Goal: C05/C06 complete without inventing data or exposing admin fields.
- [ ] Files: new `src/lib/public-product-detail.ts`; existing `src/lib/public-device-data.ts` only for shared validated metadata; `scripts/test-product-detail-contract.mjs`, `test-public-device-data.mjs`; fixture updates.
- [ ] RED: current string mapper loses false/0/context/source metadata, presents legacy without state, and cannot distinguish structured failure from absence.
- [ ] Minimum implementation: read Task 2 unprivileged projection; discriminated result (published/not-found/unavailable); explicit field allowlist, typed states and definition order/applicability; preserve contexts/variants, conflict claims and dates; legacy values explicitly unverified, structured takes precedence. Do not invent a verified claim when structured data is absent.
- [ ] GREEN: KNOWN number/boolean/text/json, missing definitions/values, empty structured tables, legacy-only product, malformed returned shape, nullable metadata and safe errors. Unknown JSON keys are not spread into public objects. Strings are text; no raw HTML/Markdown renderer.
- [ ] Regression: Task 2 public allow/deny and existing legacy mapper/unit/source suites. Commit boundary: reader/model and focused tests, no route yet.

### Task 4: Canonical SSR Detail and Legacy Alias Correctness

- [ ] Goal: C01/C03/C04, canonical identity, overview/spec/evidence/community flow.
- [ ] Files: new `src/pages/products/[brand]/[slug].astro`, `src/components/products/ProductDetail.astro`, `ProductDetailMedia.astro`; existing `src/pages/devices/[slug].astro`; `src/lib/i18n/messages/catalog.ts` plus catalog types only as needed; `scripts/test-device-library.mjs`, detail tests.
- [ ] RED: local current canonical path 404; legacy resolves to brand fragment; reader failure lacks controlled 503/body. Historical anchor expectation is recorded, not silently rewritten as previous PASS for new semantics.
- [ ] Minimum implementation: safe published SSR reader; wrong-brand 301 using resolved row; unknown/unpublished same 404/noindex and useful return links; unavailable 503/retry without raw provider errors. First viewport shows real brand/model/category/status/summary and approved image or no-image. Group specs/evidence below; native source/compare actions; known device-circle link only when supported, otherwise full-search link. No fabricated community/thread/recommendation data.
- [ ] GREEN: actual local HTTP 200/301/404/503, one-hop device alias, metadata-only useful page, source absence/presence, unsafe media rejected, broken-image fallback, anonymous rendering and both locales/no-store. Same-origin identity validation and no query-reflected redirects.
- [ ] Regression: device-library/public mapper/locale catalog tests, existing auth callback and runtime-consent regression subset without Production Auth. Commit boundary: one canonical surface and legacy alias, no competing device UI.

### Task 5: Close Catalog JSON and DOM Injection Paths

- [ ] Goal: C07/C08 against the actual catalog SSR and comparison code.
- [ ] Files: `src/pages/products/index.astro`, `[brand].astro`, detail JSON/JSON-LD sink if present; Task 1 helper; `scripts/test-product-page.mjs`; new `scripts/test-product-detail-security.mjs` (pure and actual local DOM cases).
- [ ] RED: local hostile published fixture containing `</script>`, quotes, markup/event handlers and separators causes current unsafe node creation/script breakout. Observe safe sentinel side effect only in disposable local fixture; never persist attack strings to Production.
- [ ] Minimum implementation: use shared safe serialization; construct compare cells/headings via createElement/textContent, no dynamic data interpolation into innerHTML. Static icon markup/clearing are not confused with hostile dynamic sinks. No sanitizer/rich-text dependency.
- [ ] GREEN: literal text visible, JSON round trips, no injected DOM/scripts/event side effect; malicious query/catalog/source title remains text through detail/search/compare/metadata. No private fixture markers in HTML/data scripts.
- [ ] Regression: max-three/add/remove/clear/search positives on index and brand, both locales. Commit boundary: injection closure with security fixtures.

### Task 6: Canonical Links, Compare Entry and Metadata / Sitemap Agreement

- [ ] Goal: C02 while preserving brand hashes and existing selection semantics.
- [ ] Files: product index/brand, `src/lib/forum-search.ts`, `src/pages/sitemap.xml.ts`, detail route; `src/layouts/CommunityLayout.astro` only if optional safe JSON-LD support cannot stay page-owned; `scripts/test-product-page.mjs`, `test-public-device-data.mjs`, `verify-seo.cjs`.
- [ ] RED: current card/search/compare destinations disagree with canonical detail; sitemap emits repeated brand entries for document devices and lacks all published detail entries.
- [ ] Minimum implementation: all published identity consumers use Task 1 helper; compare has links back to detail and detail enters current <=3 selection. Preserve existing selection lifecycle; first inspect page-local selection before choosing a URL handoff, do not invent cross-page persistence. Keep `#product-{slug}` card IDs; fragment bookmarks remain card navigation, never claim a server fragment redirect. Sitemap iterates published identities, excludes drafts and deduplicates entries; canonical/OG/JSON-LD URLs agree and factual metadata stays minimal/known.
- [ ] GREEN: local DOM/API/sitemap identity URL sets agree for published fixtures; correct brand repair, no draft/static-document-only catalog entry; brand hashes still locate cards; detail-to-compare navigation actually selects correct product and return link works.
- [ ] Regression: existing values-only compare, route/search/SEO and source-safe serialization. Preserve archival reference articles as editorial docs; no forced redirect of unpublished documentation to a public device identity. Commit boundary: canonical consumer integration and reviewed old-test changes.

### Task 7: Explicit Mobile Navigation and Accessible Header Order

- [ ] Goal: C11/C13, mobile destinations discoverable without hidden horizontal navigation.
- [ ] Files: `src/components/site/SiteHeader.astro`, `src/lib/site-navigation.ts`, `src/lib/i18n/messages/shell.ts`; relevant existing shell/source tests and new focused browser test file.
- [ ] RED: actual 390/430 Menu inaccessible/hidden, all required destinations not revealed; Escape/focus restoration and 44px target checks fail current contract.
- [ ] Minimum implementation: existing header menu control becomes visible on narrow widths and controls bounded vertical navigation below header; native links to Home/feed/Circles/News/Products and supported public resources; Gaze remains flag-gated. Preserve desktop navigation, brand signal, Notifications -> Settings -> Account order, anonymous Auth access and B Settings confirmation. Search separate stable row/surface, no overlapping icon controls; Escape closes/restores focus, hidden links not focusable.
- [ ] GREEN: both mobile widths and locales, open/tab/select/Escape/focus restore/outside dismiss as designed; accessible expanded/control relationships and >=44px hit boxes. No new Auth/session/notification logic.
- [ ] Regression: desktop and Starlight shared header/locale/Gaze visibility/runtime-consent checks. Commit boundary: menu/header presentation and focused tests only.

### Task 8: Global Quick / Full Search Consistency

- [ ] Goal: C14, not a new search engine.
- [ ] Files: `src/components/community/GlobalSearchBox.tsx`, `src/lib/search-types.ts` only if response typing needs reuse; `src/lib/i18n/messages/shell.ts`; existing `scripts/test-search.mjs`, `test-locale-catalog-search-news.mjs`; new focused preview state tests in security/browser harness.
- [ ] RED: device/circle/user-only query shows empty quick preview despite full search hits; failed response says no results; slower older request can settle after latest intent via the second fetch path.
- [ ] Minimum implementation: global `type=all`, bounded per-group preview limits within existing max20; grouped labels/native links; single owned fetch lifecycle/debounce/abort/stale generation; loading distinct from success-empty and unavailable with user retry/full-results. Circle-scoped quick search remains posts-only, matching its full-search destination. No news index, QA suggestions or search corpus rewrite.
- [ ] GREEN: XREAL, RayNeo, Meta, air, glasses, actual fixture circle name, nonsense, special characters and Chinese queries; scope/existence agreement not equal counts; zero-results only after success/all groups empty; failure/abort/stale cases; canonical device links.
- [ ] Regression: current filters/query normalization/2-80 limit/public entity visibility/no raw error or query HTML; update superseded posts-only source assertions transparently. Commit boundary: preview behavior and focused proofs, no search timeout/retry waiver change.

### Task 9: Dynamic Security Headers Without Locale / Auth Regression

- [ ] Goal: C10; preserve static assets and response-specific policy.
- [ ] Files: `src/middleware.ts`, optional narrow `src/lib/security-headers.ts`; `public/_headers`; existing security-header artifact tests; new `scripts/test-product-security-headers.mjs` local middleware/Worker response tests.
- [ ] RED: current local dynamic 200/404/503/redirect responses lack required framing/referrer/permissions baseline despite _headers file PASS.
- [ ] Minimum implementation: response-owned nosniff, frame-ancestors 'none', legacy DENY, strict-origin-when-cross-origin, unused camera/microphone/geolocation denied; no-referrer for callback/recovery routes. Preserve unrelated existing CSP directives without creating duplicate/weaker framing directives. Maintain cache/no-store/body/status/location and B locale context; static headers retain relevant baseline. No HSTS/account-wide TLS or full script-src policy.
- [ ] GREEN: exact local response headers for dynamic detail/list/error/alias and static asset fixture; callback/recovery redaction rule through synthetic local route request only; preserve stronger existing directives and API no-store/errors where applicable. Deny-framing browser assertion if local harness can express it safely.
- [ ] Regression: locale middleware/HTML route policy, security artifact tests, callback-safe-next and required-CAPTCHA source/test contracts. Commit boundary: narrowly owned response policy and tests.

### Task 10: Detail / Compare Responsive and Accessibility Closure

- [ ] Goal: C12/C13 and unresolved presentation from Tasks 4/7, no redesign.
- [ ] Files: new detail/media components, existing product index/brand CSS, `src/components/products/ProductVisual.astro` only for a demonstrated inherited clipping issue; popup component/header only for proven interaction defect; `scripts/audit-mobile-layout.mjs`, focused browser test.
- [ ] RED: oversized unbroken model/source titles, long specs, contexts and three-item compare fixture clip/overflow or have unreachable keyboard actions. Measure owning element, not just document width.
- [ ] Minimum implementation: min-width:0/stacked grid and wrapping; stable media aspect ratio/fallback; bounded keyboard-focusable labeled table scroll only; readable complete facts/source labels; >=44px changed actions; native navigation popup semantics rather than unsupported listbox-option claim. Visible focus, logical headings, image alt and source link names; reduced-motion behavior preserved.
- [ ] GREEN: 1280/430/390 measurements plus screenshots, full-title/value visibility, no viewport-wide horizontal overflow, menu/popup/Settings dialog layering and touch/keyboard control interactions. Both locales, honest error/empty/partial states; no invented data to fill layout.
- [ ] Regression: index/brand compare and shared header/locale positives. Commit boundary: measured layout/accessibility fixes only; unexplained engine issue stops for diagnosis.

### Task 11: Focused Browser Acceptance and Locale Integration

- [ ] Goal: C16, actual small local SSR/hydration acceptance, not another broad locale program.
- [ ] Files: new `scripts/test-product-detail-browser.mjs`, minimal `scripts/lib/product-detail-browser-harness.mjs`, Task 1 fixture; extend existing catalog locale/SEO scripts where reuse avoids duplicate suites; locale catalog keys only if required messages missing.
- [ ] RED: negative controls prove missing detail/canonical/menu/header/unsafe-payload/overflow detection; harness boot failure is not a product RED. Require actual built Worker route execution and terminal network accounting, not a component mock labeled SSR.
- [ ] Minimum implementation: owned same-origin loopback front door and Worker + local data fixture, reusable repository transport/cleanup utilities, explicit fixture routes/methods, no wildcard outbound provider permission. No TLS trust-store changes/global certificate bypasses. Public product browser contexts anonymous; actual Auth A/B RLS is Task 2, not this fake fixture.
- [ ] GREEN: execute section 11 matrix once, record distinct checkpoints, actual URLs/status/screenshot ownership and all external request counters zero. Locale SSR/hydration and selected UI messages consistent; original facts not translated or manufactured.
- [ ] Regression: existing B focused locale catalog/shell/hydration tests only; no 102-case rerun or copied B receipt. Commit boundary: focused browser acceptance harness/tests and only evidenced catalog message additions.

### Task 12: Security Negatives and Release Check Integration

- [ ] Goal: C15 plus all section 12 assertions, release cannot mask missing negative proof.
- [ ] Files: detail security/local tests; `package.json` minimal test aliases; `scripts/qa/manifest.mjs`, `profiles/release.mjs`, `scripts/qa/test-qa-harness-profiles.mjs`; new strict `scripts/lib/slice-c-acceptance.mjs` and `scripts/test-slice-c-acceptance.mjs` only if existing receipt infrastructure cannot express gates without complexity.
- [ ] RED: unsafe URLs/injection/private-marker/privileged-client/raw-error fixtures fail; receipt validator rejects missing/unreached/stale/wrong-origin/wrong-SHA gates and cleanup failures. No script merely printing PASS.
- [ ] Minimum implementation: register small C deterministic contract/response/security checks and explicit browser/local-RLS prerequisite evidence with immutable SHA-bound receipts. Distinguish source/static, mocked/local, genuine Data API and separately deployed evidence. No relaxation of B acceptedEvidence schema/ancestry or prior release failure history; no retries/budget inflation bundled with features.
- [ ] GREEN: all negative assertions detect seeded unsafe behavior and pass fixed current code; own cleanup and zero unauthorized network; release profile focused integration tests and required gate completeness.
- [ ] Regression: source-derived relevant product/device/search/SEO/headers/A/B boundary checks; inspect every command before running. One `npm test`, full `npm run build` and `npm run qa:release` at integrated candidate only after separate bounded execution approval if aggregate external/budget behavior requires it. Stop first distinct failure, preserve FAIL, no automatic rerun. Commit boundary: release integration + security proof, no deployment config.

### Task 13: Review and Deployment-Aware Handoff (No Implicit Release)

- [ ] Goal: document C18, engineering and operational gates without conflating completion/Production release.
- [ ] Files: `docs/README.md`, new `docs/ops/product-detail-ux-security-closure-v1-acceptance.md`, this plan task ledger; no provider/config secrets.
- [ ] RED: handoff validation refuses source-only Product/Schema/headers PASS, unresolved P0/P1, absent local direct-API evidence, unapproved migration/merge/push or missing previous Worker artifact.
- [ ] Minimum implementation: ordered engineering receipts, exact reviewed SHA/files, independent source review, genuine local RLS/browser evidence, required operator SQL/config/version prerequisites and rollback contract. Human review of every security/data migration before execution. No provider configuration edits anticipated.
- [ ] GREEN: documented gate IDs and safe counters agree with actual immutable receipts; tests complete, diff hygiene clean, only reviewed files committed; human may then authorize push/PR separately. READY_FOR_PR_REVIEW is not shipped.
- [ ] Regression: final clean-tree/commit ancestry/files and scope review, not another acceptance matrix. Commit boundary: docs/handoff only; stop before push/merge/Production until explicit release authorization.

## 11. Proposed Small Browser Acceptance

Minimum matrix: Chromium 1280x900, 430x900, 390x900, each zh-CN/en = **six contexts**, plus **one Firefox desktop 1280x900/en context** = **seven contexts total**, sequential, not 102 cases. Cases share an owned published representative plus metadata-only/hostile/local fault fixtures; they are checkpoints, not seven copies of the whole repository acceptance.

1. In every context: list/brand -> detail first viewport, canonical metadata, real safe local image plus fallback, long title/value/source wrapping, public/no Auth requirement, correct single selected UI language and no runtime-consent gate; screenshot and element-level overflow/hit-box measurements.
2. In every context: menu where mobile, source/compare action reachability, add/remove/limit-three and links back to detail; keyboard focus/tab/Escape and visible focus; table-only horizontal scrolling. Desktop keeps normal navigation. Source navigation is intercepted with expected safe URL rather than contacting manufacturers.
3. Each locale at desktop: actual 301 wrong-brand/legacy alias and 404/noindex unpublished/unknown vs 503 unavailable; metadata-only/empty structured groups/source absence, false/zero/CONFLICT evidence; sitemap URL-set consistency; malicious catalog/closing-script/no side effects.
4. Each locale at desktop plus a mobile popup geometry check per width: grouped quick/full search existence and canonical destinations, loading/error/empty/stale responses, circle-scoped behavior; query corpus from Task 8. Request cancellation is recorded, not ignored as success.
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

1. Human reviews this plan, then separately authorizes implementation. Engineering closes Tasks 1-12 and the invoker feasibility gate; independent review and human acceptance of remaining P2/P3 required. Docker/RLS failure, non-loopback execution target, secrets/Production configuration entering local execution, A/B/CAPTCHA/consent regression or architecture infeasibility -> STOP.
2. Proposed migration is reviewed with additive replay, real public/admin permission tests and exact previous grants/policies. A separate operator authorization supplies target identity, forward migration and rollback scope. This task performs no Production SQL. Verify deployed prerequisites read-only under that future authorization before application release; do not deploy a detail reader against nonexistent projection and pretend empty data.
3. After explicit branch push/PR authorization, verify exact source/review/checks, main identity and known-good Worker version/config rollback reference. Feature push can trigger preview Builds too; no push in this planning task. No main change or automatic rebase when drift occurs.
4. **Main push -> Cloudflare build -> automatic Production deployment.** Treat a main fast-forward/merge push as a Production deployment action requiring explicit authorization; it is not a source-only neutral handoff. Use established source-controlled release path, no manual unreviewed Worker/config shortcut. Record exact merge/new-main/build/deployment version and traffic from authorized read-only metadata/human evidence.
5. Separately authorized bounded public smoke verifies required C routes/schema/source/compare/search/menu/XSS/header gates and representative real published products. Controlled local typed fixtures are also required; source-not-available is a valid honest result, not license to invent claims. No Production injection payloads, signup/recovery/resend/Auth mutations or content writes implied. Record tested scope/origin/SHA/version/observer/PASS/FAIL/PARTIAL/NOT_APPLICABLE with reasons.
6. Failure -> stop; no CAPTCHA toggle, service-role read or Production import workaround. Restore preceding reviewed safe Worker artifact through separately authorized established deployment mechanism, preserving required CAPTCHA state/sitekey and A/B bindings. Do not restore an artifact with known exploited XSS; request narrow reviewed hotfix authorization instead. Newly indexed canonical links need a reviewed compatibility/redirect rollback if reverting route support; do not silently break them.
7. Additive schema is not dropped automatically. If public grants/policies leak data, stop exposure and request exact narrowly scoped operator-approved permission rollback; do not drop data or undo admin privileges blindly. Preserve existing legacy public devices/read and brand/device URL compatibility. Worker rollback does not revoke database grants: both channels need separate recorded outcomes.

Slice C PASS does not establish LARGE_SCALE_READY, all-provider mail delivery, Mainland-China VPN compatibility, load capacity or the final whole-community two-user acceptance. A/B historical evidence stays intact and scoped.

## 14. Planning Verification and Remaining Unknowns

Current evidence is read-only source and Git/package metadata. No provider account, Production page, SQL, Auth, email or content request was made. Public official documentation only was consulted: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [API security](https://supabase.com/docs/guides/api/securing-your-api), checked 2026-10-03; grants and RLS must both be tested. Changelog markdown fetch was unsupported by the web tool, so no current changelog compatibility PASS is claimed. Recheck version-specific invoker/Data API/CLI behavior before implementation.

Remaining unknowns: deployed normalized table contents/schema/grants, current public image-origin set, exact source/evidence availability, invoker admin-read preservation feasibility, actual detail/menu runtime layout (new route absent), and final release migration/version metadata. None is filled from historical static manifests or guessed provider state. Task 2 resolves database feasibility locally; later operator gates resolve deployed facts. Narrow media allowlist is frozen from approved source evidence during Task 1, not by permissive all-HTTPS fallback.

Planning completion checks: new document only; `git diff --check`; task/receipt/route/gap-count consistency; document-only commit; clean worktree; no push. Human review remains pending. Stop here; implementation task checkboxes remain unchecked.
