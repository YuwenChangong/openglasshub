# Global Locale Ownership V2: Current-Source Design and Handoff

Status: static ownership/QA contract frozen for review; NOT a new Locale acceptance.

## Identity and Safety Boundary

- Source audit base: `1717cac230b2534a52a4dd2341f0bb56279fe241`.
- Branch: `feature/slice-c-completion-v1`.
- This change adds only the V2 manifest, static QA helper, focused self-tests and this document.
- No Product/Admin runtime changes, data changes, SQL execution, migration/RLS changes, providers, browser tests, account persistence tests, full release QA, build, push or deployment.
- The existing untracked Windows cache is left untouched. Tracked cleanliness must not be described as whole-worktree cleanliness.
- Historical acceptance receipts, forensic JSON, fingerprints and the historical QA FAIL 34/36 remain immutable. The existing V1 accepted-evidence gate in `scripts/qa/manifest.mjs` is NOT relaxed, replaced or wired to V2.
- Source-only ownership of three SQL migration files does not imply that they have been executed in this task or that RLS has been re-accepted.

## Evidence Read First

The investigation read these existing evidence sources without rewriting them:

- `artifacts/qa/slice-c-locale-ownership-design-blocker/receipt.txt`
- `artifacts/qa/slice-c-locale-ownership-forensic/receipt.txt`
- `artifacts/qa/slice-c-locale-ownership-forensic/forensic.json`
- `docs/ops/global-locale-settings-v1-acceptance.md`
- `docs/ops/slice-c-catalog-v3-local-handoff.md`

Historical 127 is comparison evidence, not an inventory generator. The current manifest is built from current behavior roots, actual imports, child presentation helpers, literal configured runtime entries, content inputs, server presentation/persistence boundaries and explicit support exclusions.

The historical acceptance at `bb6170461f9afd3dbfb9da3db023909de257df43` did not record a V2 composite fingerprint. Its later forensic-derived historical digest must not be relabeled as a contemporaneous acceptance or a current-source digest. Existing catalog/local route evidence and the prior build remain their original receipts, not fresh evidence for this contract.

## Ownership Rule

Own a file if its current content can materially change a covered Locale behavior. An import of `useLocale` is neither necessary nor sufficient. Do not own all `src/**`.

The audited set is 218 files: code, original/reviewed document inputs, integration version/configuration sources, public response-header policy and relevant schema source. 68 entries are explicitly conservative. Broadening is scoped to a named behavior/domain and a recorded reason; it is not whole-repository ownership.

Mixed modules require special care: a generic transport module that also generates user-visible fallback copy is owned for that copy. The current Admin API wrapper, upload error fallback, notification messages, profile default title and original-content image/placeholder fallbacks are included on that basis. API routes that supply human-facing copy through HTTP are explicit non-import inputs. Generic media/database helpers, machine-code-only compatibility adapters, icons, neutral facts and pure types are not automatically pulled into the transitive set.

Brand/product facts, user-authored content, original news prose, technical diagnostic details and moderator-authored reasons are not automatically translated. Their neutral transport is a reviewed support boundary. Human-facing fallback labels are different: the module supplying them is owned. These distinctions do not assert that every current fallback is already bilingual or correct.

## Fifteen Behavior Domains

| Domain | Covered behavior | Current roots |
| --- | --- | --- |
| 1 | Locale resolution and precedence | `src/lib/i18n/country.server.ts`; `src/lib/i18n/locale-store.ts`; `src/lib/i18n/locale.ts` |
| 2 | Locale cookie persistence | `src/lib/i18n/locale-store.ts`; `src/lib/i18n/preference-cookie.ts` |
| 3 | Authenticated locale preference persistence | `src/components/i18n/LocalePreferenceSync.tsx`; `src/lib/i18n/preference-sync.ts`; `src/lib/server/user-preferences.server.ts` |
| 4 | Route and SSR locale propagation | `astro.config.mjs`; `src/middleware.ts`; `src/plugins/locale-ssr-routes.mjs`; `src/starlightRouteData.ts` |
| 5 | Locale-aware shell and navigation | `src/components/site/SiteHeader.astro`; `src/components/starlight/Header.astro`; `src/layouts/CommunityLayout.astro` |
| 6 | Settings locale behavior | `src/components/settings/SettingsPage.tsx`; `src/pages/settings/index.astro` |
| 7 | Product and catalog bilingual presentation | `src/components/products/ProductDetail.astro`; `src/lib/public-device-data.ts`; `src/pages/products/[brand].astro`; `src/pages/products/index.astro` |
| 8 | Specification label, group and value localization | `src/lib/catalog-presentation.ts`; `src/lib/i18n/messages/catalog.ts` |
| 9 | Admin catalog bilingual UI | `src/components/admin/AdminDevicesDashboard.tsx`; `src/components/admin/CatalogMediaEditor.tsx`; `src/components/admin/CatalogSpecificationEditor.tsx`; `src/lib/server/catalog-editor.ts`; `src/lib/server/device-admin.ts` |
| 10 | Search localized groups and results | `src/components/community/GlobalSearchBox.tsx`; `src/lib/forum-search.ts`; `src/lib/quick-search.ts` |
| 11 | Legacy device and canonical product locale continuity | `src/lib/product-route.ts`; `src/pages/devices/[slug].astro`; `src/pages/devices/index.astro` |
| 12 | Safe missing-translation fallback | `src/lib/auth-messages.ts`; `src/lib/catalog-presentation.ts`; `src/lib/header-identity.ts`; `src/lib/i18n/catalog.ts` |
| 13 | Document and editorial variants | `src/content.config.ts`; `src/lib/i18n/document-locale.ts`; `src/lib/i18n/editorial-variants.ts`; `src/pages/guides/[slug].astro` |
| 14 | Locale-dependent caching and no-store | `src/lib/i18n/html-route-policy.ts`; `src/lib/response-security-headers.ts`; `src/middleware.ts`; `src/pages/api/users/me/preferences.ts` |
| 15 | Locale security and isolation | `src/lib/i18n/preference-cookie.ts`; `src/lib/i18n/preference-sync.ts`; `src/lib/server/user-preferences.server.ts`; `supabase/migrations/20261001075335_user_preferences.sql` |

The authoritative per-root `whyRoot` and `localeBehaviorControlled` records are in the manifest. Every owned file has category, domain IDs, reason, introduction attribution and `conservative` flag in `fileReviews`. Every current direct import edge of every owned file has a classification and reason in `dependencyReviews`, including explicit empty reviews for leaves.

## Current Graph Findings

- Canonical SSR request locale enters through middleware and is propagated into route/layout/island context. Cookie codec and browser store distinguish explicit device choice from account adoption.
- Authenticated preference API/server/client/sync files own actor isolation, enum/revision checks, request ownership, error handling and no-store. Browser Auth bridges are conservatively owned as actor dependencies; no service-role or remote lookup is performed.
- `AdminDevicesDashboard` passes canonical locale to both catalog editors. `CatalogSpecificationEditor` calls `catalog-presentation` for labels/groups/values. Both children and the shared helper are owned, not assumed to be covered by ownership of the parent.
- Catalog server validators and migration source define bilingual field survival, allowed presentation keys and public projection. Locale switching must not rewrite catalog facts.
- Catalog presentation owns selected-language/alternate-language/original-value fallback, missing-translation markers and disclosed/applicability/value labels. Product Detail and media mapping own localized section/metadata/alternative-text presentation.
- Search UI, result adapters and projection own localized group labels, safe result presentation and canonical product links. Generic query/media details stop at recorded boundaries.
- Legacy device redirects, product route identity and active catalog/brand routes own canonical continuity, without a second independent locale state.
- Starlight integration, route middleware, overridden header/theme components, original documents and reviewed English editions are explicit source inputs. Original documents are conservatively owned because frontmatter, source language, fallback content or embedded MDX can change observable Locale behavior. Potentially shadowed legacy documents remain included pending narrower proof.
- Document `?lang=` selection remains scoped to document editions, not global preference mutation. Original-language bodies are valid exceptions, not untranslated UI certification.
- Response header policy, HTML route classification and package/lock versions are conservative non-import boundaries for SSR/privacy and third-party behavior. No provider configuration values are copied into the manifest.

## Historical Comparison

- HISTORICAL_OWNED_FILE_COUNT=127
- CURRENT_LOCALE_OWNED_FILE_COUNT_V2=218
- COMMON_FILE_COUNT=126
- CURRENT_ONLY_FILE_COUNT=92
- HISTORICAL_ONLY_FILE_COUNT=1

Introduction labels describe why the ownership is newly explicit. `OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP` does not mean the file was created by Slice C. The accepted historical list is not changed.

### Historical Only

`src/env.d.ts`: NOT_OWNED_SUPPORT_ONLY after inspection. It declares Astro locals and imports the LocaleContext type; it emits no runtime behavior. Its existing `localeContext` marker is an explicit ambient-declaration-only exception. It was not removed merely because a set difference said so. A future runtime module is not allowed to reuse this exception.

### Current Only

| Path | Ownership introduction | Conservative | Reason |
| --- | --- | --- | --- |
| `astro.config.mjs` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | false | Registers Locale SSR integration, Starlight route middleware, locale and theme component overrides and canonical route redirects. |
| `package-lock.json` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Conservative exact resolved dependency boundary for third-party Astro, Starlight, React and Supabase behavior; no dependency changes are made by this contract. |
| `package.json` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Conservative dependency boundary: versions and integration runtime packages can change Locale rendering or Auth preference transport without editing an application file. |
| `public/_headers` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Conservative response header boundary: shared response policy must not override localized HTML privacy or no-store handling. |
| `src/components/admin/CatalogMediaEditor.tsx` | SLICE_C_ADMIN_EDITOR_WORK | false | Canonical locale prop chooses image editor controls and labels; manages both language-specific image alternative texts. |
| `src/components/admin/CatalogSpecificationEditor.tsx` | SLICE_C_ADMIN_EDITOR_WORK | false | Canonical locale prop chooses bilingual editor labels, validation guidance, specification/group defaults and presentation helper fallback. |
| `src/components/admin/useAdminSession.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | false | Produces the exact session-status messages consumed by localizeAdminSessionMessage; changing these can bypass its reviewed translation mapping. |
| `src/components/auth/useBrowserAuthState.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | false | Selects and clears the actor observed by Settings and LocalePreferenceSync during sign-in, sign-out and account switches. |
| `src/components/products/ProductDetail.astro` | SLICE_C_CATALOG_WORK | false | Chooses catalog labels, specification values, translated metadata, bilingual image alt text and explicit image/no-translation fallbacks. |
| `src/content.config.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Configures the Starlight content loader and source document collection used by Locale editorial/fallback selection. |
| `src/content/docs/about/cloudflare-web-analytics-checklist.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/about/index.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/about/search-console-launch-checklist.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/developers/index.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/apple-vision-pro.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/brilliant-labs-frame.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/even-realities-g1.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/index.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/inmo-air-2.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/inmo-go3.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/ray-ban-meta.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/rayneo-air-2.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/rayneo-air-2s.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/rayneo-air-3s.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/rayneo-air-4-pro.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/rayneo-x2.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/rayneo-x3-pro.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/rokid-air.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/rokid-ar-lite.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/rokid-glasses.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/rokid-max.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/viture-one-lite.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/viture-one.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/viture-pro.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/xreal-air-2-pro.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/xreal-air-2-ultra.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/xreal-air-2.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/xreal-air.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/xreal-one-pro.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/devices/xreal-one.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/gaze-os/index.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/guides/ar-ai-glasses-buying-guide-2026.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/guides/ar-ai-xr-glasses-difference.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/guides/best-ar-ai-glasses-for-developers.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/guides/developer-limit-checklist-before-choosing-ar-ai-glasses.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/guides/index.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/guides/why-ar-glasses-are-not-phone-systems.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/guides/why-most-ar-glasses-cannot-run-custom-os.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/reference/community/index.mdx` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/content/docs/reference/community/pinned-posts.md` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Document/editorial input to the reviewed-or-original language selection path. Conservatively binds original source bodies/frontmatter, including potentially shadowed legacy documents; no factual import or editorial rewrite is performed. |
| `src/lib/admin-api-client.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Mixed transport and user-visible Admin error fallback: current callers render its messages verbatim, so it is not a pure generic fetch boundary. |
| `src/lib/auth-messages.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | false | Owns the bilingual Auth message catalog consumed by Locale-aware login, recovery and callback UI. |
| `src/lib/auth-redirect.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Conservative redirect boundary: normalization of safe next destinations must retain the intended canonical route and scoped query continuity. |
| `src/lib/catalog-compare-dom.ts` | SLICE_C_CATALOG_WORK | true | Renders locale-provided comparison labels and has its own missing-value text fallback; conservative inclusion of this mixed DOM helper. |
| `src/lib/catalog-presentation.ts` | SLICE_C_CATALOG_WORK | false | Owns bilingual vocabulary, label/group/value precedence, safe missing-translation fallback, translation flags and locale factual formatting parity. |
| `src/lib/device-catalog.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | false | Owns legacy UI specification/group labels, route labels and external-link labels used by catalog presentation, independently of factual datasets. |
| `src/lib/format-time.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | false | Implements the Chinese time wording and formatting delegated to by the canonical community message formatter. |
| `src/lib/forum-search.ts` | SLICE_C_SEARCH_WORK | true | Builds group/result projections and canonical device links consumed by localized search; conservative mixed query/presentation boundary. |
| `src/lib/header-identity.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | false | Chooses language-specific fallback account labels in the shared header and protects owner-correct avatar/identity presentation. |
| `src/lib/legal-consent-navigation.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Controls legacy legal-consent safe redirects instead of restoring a runtime policy interstitial; continuity must remain stable for both locales. |
| `src/lib/legal-policy.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | false | Defines both language variants of policy navigation labels and document language metadata used by LegalPage. |
| `src/lib/news-content.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Original news parser also supplies default image alternative text; conservatively binds fallback presentation without translating original editorial prose. |
| `src/lib/notifications.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Notification visual labels and message bodies contain human-facing language fallbacks rendered by NotificationsPage. Not merely a type/data transport helper. |
| `src/lib/post-body.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Media-only original-body placeholder recognition controls whether fallback content is shown; conservatively owns this mixed original-content presentation boundary. |
| `src/lib/product-route.ts` | SLICE_C_ROUTE_MIGRATION | false | Defines canonical product detail paths and rejects invalid identities for legacy redirects and localized product/search navigation. |
| `src/lib/profile-data.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Profile projection supplies a default post title for comments; conservatively binds that user-visible fallback rather than treating the mixed module as pure data access. |
| `src/lib/public-device-data.ts` | SLICE_C_CATALOG_WORK | false | Maps bilingual image alternative text and its fallback; constructs legacy specification states and labels consumed by Locale presentation. |
| `src/lib/public-product-detail.ts` | SLICE_C_CATALOG_WORK | false | Assembles parameter groups from typed facts and bilingual presentation; invokes Locale label/group/value/fallback functions. |
| `src/lib/quick-search.ts` | SLICE_C_SEARCH_WORK | true | Controls which named result groups and canonical product destinations the localized search UI can present; conservative inclusion despite locale-neutral result parsing. |
| `src/lib/response-security-headers.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Conservative header-copy dependency: changing response reconstruction could discard localized no-store/private headers. |
| `src/lib/server/admin-auth.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Admin API shared error and no-store response policy is surfaced by owned Admin callers; conservatively owns the mixed policy/error boundary, without running authorization. |
| `src/lib/server/catalog-editor.ts` | SLICE_C_ADMIN_EDITOR_WORK | false | Validates, saves and reads bilingual parameter/group/value presentation; owns bilingual catalog error guidance and closed metadata fields. |
| `src/lib/server/device-admin.ts` | SLICE_C_ADMIN_EDITOR_WORK | false | Validates and round-trips bilingual media alternative text; emits messages consumed by translated Admin UI status mapping. |
| `src/lib/server/reports.server.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Report reason labels and default resource/actor titles are human-facing fallback inputs to the owned Admin reports presentation. |
| `src/lib/server/user-safety.server.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Human-facing safety status messages feed owned form/Admin fallback mappings; source ownership only, not safety writes or DB acceptance. |
| `src/lib/storage-tus.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Mixed upload transport and user-visible missing-browser-configuration error; owned form callers surface the error. Conservatively includes this fallback producer, not all upload dependencies. |
| `src/lib/supabase-browser.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Creates the shared browser session client consumed by Locale preference sync; its session/actor transport affects adoption and cross-user isolation. |
| `src/lib/supabase-server.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | Preserves anonymous SSR client creation rather than promoting public localized pages to a privileged or shared authenticated reader. |
| `src/pages/404.astro` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | false | Owns the current 404 shell and human-facing state, even without a useLocale import; current hard-coded wording is not claimed to pass bilingual acceptance. |
| `src/pages/api/admin/device-specs.ts` | SLICE_C_ADMIN_EDITOR_WORK | true | Routes bilingual specification metadata through its approved editor handlers and authorization/no-store response boundary. |
| `src/pages/api/admin/devices.ts` | SLICE_C_ADMIN_EDITOR_WORK | false | Routes bilingual media metadata into validation/persistence and emits Admin-facing fallback error messages. |
| `src/pages/api/admin/forum/posts.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | HTTP producer returns human-facing post deletion/media cleanup status shown in the owned Admin UI; no mutation is performed. |
| `src/pages/api/admin/moderation/queue.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | HTTP projection supplies the default comment title for owned Admin moderation UI; conservatively binds that presentation fallback. |
| `src/pages/api/admin/news.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | HTTP producer owns Admin news validation and success copy surfaced verbatim by the owned Admin UI; no endpoint invocation. |
| `src/pages/api/forum/search.ts` | SLICE_C_SEARCH_WORK | true | Owns search response projection, group shape and no-store response behavior used by localized quick-search consumers. |
| `src/pages/api/users/me/notifications.ts` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | true | HTTP projection builds notification messages rendered verbatim by the owned notification UI; a non-import presentation dependency. |
| `src/pages/legal-consent/index.astro` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | false | Legacy consent route redirects safely with no runtime gate; changing it can intercept locale-aware navigation. |
| `src/pages/products/[brand]/[slug].astro` | SLICE_C_ROUTE_MIGRATION | false | Connects canonical product identity and 200/301/404/503 paths to exact middleware locale and parameter presentation helpers. |
| `src/pages/register/index.astro` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | false | Redirects legacy registration to the canonical login/register mode and preserves safe next context. |
| `supabase/migrations/20261001075335_user_preferences.sql` | OTHER_CURRENT_ARCHITECTURE_NEWLY_EXPLICIT_OWNERSHIP | false | Source authority for allowed locale enum, owner-only preference grants/RLS and optimistic revision metadata; included as bytes only, never executed. |
| `supabase/migrations/20261004003349_public_device_detail_v1.sql` | SLICE_C_CATALOG_WORK | true | Conservative foundational anonymous detail projections and definition labels feeding Locale presentation; included as source only. |
| `supabase/migrations/20261004014637_catalog_editor_presentation_v1.sql` | SLICE_C_ADMIN_EDITOR_WORK | false | Defines bilingual metadata validation, save/read projections and database-side specification/group fallback; included as source only. |

### Common Files

The following 126 files remain owned. Categories/reasons and domains are current-source reviews in the manifest, not inherited solely from the historical set.

```text
src/components/CommunityCTA.astro
src/components/LatestUpdates.astro
src/components/admin/AdminCirclesDashboard.tsx
src/components/admin/AdminDevicesDashboard.tsx
src/components/admin/AdminForumDashboard.tsx
src/components/admin/AdminMediaDashboard.tsx
src/components/admin/AdminModerationQueue.tsx
src/components/admin/AdminNewsDashboard.tsx
src/components/admin/AdminReportsPanel.tsx
src/components/admin/AdminUsersDashboard.tsx
src/components/auth/AuthCTA.tsx
src/components/auth/AuthCallback.tsx
src/components/auth/FeedSidebarAuthHint.tsx
src/components/auth/ResetPasswordForm.tsx
src/components/common/GlassConfirmDialog.tsx
src/components/community/CircleCard.astro
src/components/community/CommunityHeader.astro
src/components/community/EmptyFeedState.astro
src/components/community/GlobalSearchBox.tsx
src/components/community/NewsCard.astro
src/components/community/PostCard.astro
src/components/community/PostMediaPreview.astro
src/components/community/ProductCard.astro
src/components/devices/DeviceLibraryExplorer.tsx
src/components/forum/AuthPanel.tsx
src/components/forum/CircleCoverEditor.tsx
src/components/forum/CircleManageEntry.tsx
src/components/forum/CircleOwnerDashboard.tsx
src/components/forum/CommentForm.tsx
src/components/forum/CommentsSection.tsx
src/components/forum/CreateCircleForm.tsx
src/components/forum/CreatePostForm.tsx
src/components/forum/PostMediaGallery.tsx
src/components/forum/PostModerationActions.tsx
src/components/forum/PostSocialActions.tsx
src/components/forum/SharePostButton.tsx
src/components/i18n/LocalePreferenceSync.tsx
src/components/i18n/useLocale.ts
src/components/legal/LegalPage.astro
src/components/news/NewsPagination.tsx
src/components/notifications/NotificationsPage.tsx
src/components/profile/EditProfileForm.tsx
src/components/profile/MyProfilePage.tsx
src/components/profile/ProfilePostCard.tsx
src/components/reports/ReportTrigger.tsx
src/components/settings/SettingsPage.tsx
src/components/site/HeaderNotifications.tsx
src/components/site/HeaderUserMenu.tsx
src/components/site/SiteHeader.astro
src/components/starlight/Header.astro
src/components/starlight/ThemeProvider.astro
src/components/starlight/ThemeSelect.astro
src/content/editorial-translations/en/about/index.mdx
src/content/editorial-translations/en/developers/index.mdx
src/content/editorial-translations/en/guides/index.mdx
src/layouts/CommunityLayout.astro
src/layouts/ForumLayout.astro
src/lib/i18n/accept-language.ts
src/lib/i18n/catalog.ts
src/lib/i18n/country-codes.ts
src/lib/i18n/country.server.ts
src/lib/i18n/document-locale.ts
src/lib/i18n/editorial-variants.ts
src/lib/i18n/html-route-policy.ts
src/lib/i18n/locale-store.ts
src/lib/i18n/locale.ts
src/lib/i18n/messages/account.ts
src/lib/i18n/messages/admin.ts
src/lib/i18n/messages/catalog.ts
src/lib/i18n/messages/community.ts
src/lib/i18n/messages/documents.ts
src/lib/i18n/messages/settings.ts
src/lib/i18n/messages/shell.ts
src/lib/i18n/preference-client.ts
src/lib/i18n/preference-cookie.ts
src/lib/i18n/preference-sync.ts
src/lib/i18n/starlight-ui.ts
src/lib/server/user-preferences.server.ts
src/lib/site-navigation.ts
src/middleware.ts
src/pages/account-deletion/index.astro
src/pages/admin/circles/index.astro
src/pages/admin/devices/index.astro
src/pages/admin/forum/index.astro
src/pages/admin/media/index.astro
src/pages/admin/moderation/index.astro
src/pages/admin/news/index.astro
src/pages/admin/reports/index.astro
src/pages/admin/users/index.astro
src/pages/api/users/me/preferences.ts
src/pages/auth/callback.astro
src/pages/auth/reset-password/index.astro
src/pages/circles/[slug].astro
src/pages/circles/[slug]/manage.astro
src/pages/circles/index.astro
src/pages/circles/new.astro
src/pages/community-guidelines/index.astro
src/pages/contact/index.astro
src/pages/developers/index.astro
src/pages/devices/[slug].astro
src/pages/devices/index.astro
src/pages/feed/index.astro
src/pages/forum/index.astro
src/pages/gaze-launcher/index.astro
src/pages/guides/[slug].astro
src/pages/guides/index.astro
src/pages/index.astro
src/pages/login/index.astro
src/pages/me/edit.astro
src/pages/me/index.astro
src/pages/news/[slug].astro
src/pages/news/index.astro
src/pages/notifications/index.astro
src/pages/posts/[id].astro
src/pages/posts/new.astro
src/pages/privacy/index.astro
src/pages/products/[brand].astro
src/pages/products/index.astro
src/pages/safety/index.astro
src/pages/search/index.astro
src/pages/settings/index.astro
src/pages/terms/index.astro
src/pages/u/[username].astro
src/pages/users/[id].astro
src/plugins/locale-ssr-routes.mjs
src/starlightRouteData.ts
```

### Three Proven Gaps and Eight Changed Historical Owners

All three known missing dependencies are included:

- `src/components/admin/CatalogSpecificationEditor.tsx`
- `src/components/admin/CatalogMediaEditor.tsx`
- `src/lib/catalog-presentation.ts`

All eight changed historical owners remain included:

- `src/components/admin/AdminDevicesDashboard.tsx`
- `src/components/community/GlobalSearchBox.tsx`
- `src/components/site/SiteHeader.astro`
- `src/lib/i18n/messages/catalog.ts`
- `src/middleware.ts`
- `src/pages/devices/[slug].astro`
- `src/pages/products/[brand].astro`
- `src/pages/products/index.astro`

Inclusion is source ownership, not behavioral re-acceptance of those changes.

## Manifest and Validation Contract

Manifest: `scripts/qa/contracts/global-locale-settings-v2-owned-source.json`.

- `schemaVersion=1`, `version=2`; purpose explicitly excludes acceptance/provider configuration.
- Deterministically code-unit-sorted, unique normalized repo-relative paths. No absolute paths, traversal, backslashes, generated artifacts, environment files, secret/credential files or Worker provider configuration.
- All owned files exist. Root records, per-file reviews and direct dependency reviews must be complete.
- Strict recognized fields: no free-form credentials/hash/acceptance payload slots. The static manifest contains paths and review descriptions only, not file or acceptance hashes.
- Known three dependencies, eight changed historical owners and core roots are mandatory.
- Explicit support boundaries have normalized safe paths and reasons. Existing Locale markers outside ownership are allowed only in specifically reviewed ambient declarations.
- Exact-byte source inspection only. Source modules are parsed, never imported/executed; no environment-variable reads or provider calls are needed.

Validator/helper: `scripts/qa/lib/global-locale-owned-source-v2.mjs`.
Focused test: `scripts/qa/test-global-locale-owned-source-v2.mjs`.

```powershell
node --test scripts/qa/test-global-locale-owned-source-v2.mjs
```

## Dependency Closure and Limitations

The focused closure test inspects every owned source, not just the three gaps:

1. TypeScript AST inspects relative import/export, literal dynamic import and literal require edges in TS/TSX/MJS.
2. Astro compiler AST inspects frontmatter and template scripts.
3. MDX parser inspects ESM imports in owned MDX documents.
4. A narrow Astro-config assertion inspects literal Starlight `routeMiddleware` and `components` string entries.
5. Literal guide glob expansion must match the reviewed document input set.
6. Scoped discovery detects unreviewed Locale markers, HTML routes, document inputs and relevant preference/catalog migration source.
7. A support boundary acquiring new known Locale markers requires review; it cannot silently retain a support-only classification.
8. Removed/retargeted imports, missing source files, parse failures, nonliteral dependencies and unreviewed edges fail closed.

This is a reviewed explicit graph with focused parser-assisted assertions, NOT a complete semantic dependency analyzer. It does not infer arbitrary runtime fetch URLs, database view changes, generated code, aliases or custom framework registrations. Non-import HTTP/schema/content inputs are explicit source-reviewed `dataInputs`; configuration/database entries record required owned inputs, not a general query analyzer. External packages are conservatively bound through package and lock bytes, not recursively source-owned.

Future architecture changes, new indirect HTTP presentation producers, new aliases, new fallback producers without recognized markers or changed framework registrations require human graph review before acceptance. Static discovery is a backstop, not proof that any future unmarked module is irrelevant. No existing acceptance may be reused merely because the static closure test passes.

The current graph review closes all reviewed paths under these stated behavior boundaries; no current candidate is left unclassified. Static scope completeness and behavioral correctness are separate decisions. The independent agents were unavailable due to usage limits; this is local source review plus focused self-tests, not an independent-review PASS.

## Fingerprint Contract for the Next Acceptance

ALGORITHM_VERSION=`locale-owned-content-sha256-v1`.

For an explicitly authorized next acceptance:

1. Freeze the exact candidate commit and require tracked source cleanliness; no mid-run source edits.
2. Validate the V2 manifest and dependency closure against that immutable source snapshot.
3. Sort owned paths with JavaScript code-unit ordering. Hash each file's exact content bytes using SHA-256; record sorted `[path, contentSha256]` pairs. Do not normalize line endings, whitespace or Unicode.
4. Canonical JSON recursively sorts object keys and preserves validated array order. Use UTF-8 encoding, no pretty-print whitespace.
5. `contractSha256 = SHA256(canonicalJson(manifest))`.
6. Construct identity with exactly `algorithmVersion`, `ownershipVersion`, `contractSha256` and `fileHashes`.
7. `fingerprint = SHA256(canonicalJson(identity))`.
8. Bind candidate Git identity, schema/version, complete file-hash record and actual fresh browser/account outcomes in a NEW acceptance receipt later.

Content SHA-256 is deliberately not Git's SHA-1 object ID. A clean checkout's bytes may differ from Git blobs under line-ending conversion; never mix a Git-blob digest and checkout-content digest under one receipt. The helper implements exact content bytes. A future Git-snapshot reader must supply those precise bytes through `readFile` and retain the same algorithm. Candidate identity and tracked cleanliness are external acceptance prerequisites, not inferred by this static helper.

The static ownership manifest contains no hashes. Focused self-tests compute temporary comparison fingerprints in memory only; they do not create an acceptance receipt or publish a new accepted digest. Contract classification/reason/input changes invalidate the fingerprint even with identical owned source bytes. Changes to unrelated non-owned content do not affect the fingerprint, unless they introduce a reviewed-boundary violation.

## RED/GREEN and Mutation Evidence

Initial RED: the current-manifest test failed because the V2 ownership manifest did not exist. No historical runtime result was recast as that RED.

Additional targeted REDs proved missing handling of generated-source filenames, invalid support paths, string-configured Starlight entries and support-boundary Locale markers. Nested environment/credential filenames were also rejected only after explicit failing tests exposed the missing filename rule. All changes remained inside new QA files.

The final focused suite verifies:

- owned core bytes changed -> fingerprint changed;
- newly owned `catalog-presentation.ts` changed -> fingerprint changed;
- unrelated non-owned source changed -> fingerprint unchanged;
- missing owned source -> validation/fingerprint rejected;
- new Admin/editor/helper/static/dynamic dependencies -> closure rejected;
- Astro script and Starlight configured dependency changes -> closure rejected;
- new unreviewed Locale root, document or preference migration -> rejected;
- document glob growth and support-boundary reclassification -> rejected;
- stable JSON object-key order and independently recomputed exact-byte SHA-256 records.

All mutations are in-memory read/inventory overlays. No persistent product source mutation, disposable database or browser run is used.

## Handoff Gate

This contract is ready to underpin a separately authorized current-source Locale acceptance after human ownership review. It does NOT create that acceptance now and does not waive the historical 34/36 release failure.

The next authorization must bind the reviewed V2 contract and exact candidate source, then genuinely verify resolver/cookies, SSR/cache, Settings/device-explicit persistence, Account A/B ownership/adoption/reload/logout/conflict/outage, bilingual Product/specification/Admin/search presentation, canonical continuity, missing translations and scoped editorial variants. Preserve original-language/fact exceptions without hiding unlocalized UI fallbacks. Any observed defect is a new result; do not retroactively rewrite old receipts.

Current hardcoded fallback producers (including the existing 404 presentation) are owned, not certified as bilingual by this static audit. This task does not repair them or assert behavioral PASS.

Production SQL, provider changes, deployment, Auth/email/content mutations and feature/main pushes remain unauthorized. No cache cleanup. Stop for ownership review and a new bounded acceptance authorization.
