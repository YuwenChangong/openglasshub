# Global Locale and Settings v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver request-wide zh-CN/en application UI and accessible Settings with manual browser/account preferences, without changing the accepted Slice A authentication or consent-removal behavior.

**Architecture:** One canonical route tree and a pure locale resolver feed `Astro.locals.localeContext`. Nonsecret cookies supply SSR preference; React islands receive the same snapshot, while the existing browser Supabase session independently loads an owner-only preference through a bearer-authenticated API. Explicit Settings changes persist locally before navigation; account adoption is bounded, generation-guarded and never an authentication prerequisite.

**Tech Stack:** Repository package/lock contract at the base below: Astro 7.2.10, @astrojs/cloudflare 14.2.6, @astrojs/react 6.0.5, @astrojs/starlight 0.41.3, React/react-dom 19.2.8 resolved, @supabase/supabase-js 2.112.4 resolved, TypeScript 5.7.3, Playwright 1.62.1, Wrangler 4.125.0. Keep dependencies/lockfile unchanged; no framework or Auth transport replacement.

**Spec:** `docs/superpowers/specs/2026-09-28-product-recovery-large-scale-readiness-v1-design.md`, exact version in main `318a252d8b8e6489044b322c3e9eefd72e9d6e08`; especially sections 7, 9, 11-13, 19-20, 22-23 and 25-27. User authorization `SLICE_B_GLOBAL_LOCALE_SETTINGS_V1_PLAN` supplies the current Slice A baseline and Slice B-only boundaries.

**Status:** Planning only; READY FOR HUMAN REVIEW, not implementation/SQL/merge/deployment authorization. Base main was freshly fetched on 2026-10-01. Slice A is CLOSED/PASS by human acceptance. CAPTCHA remains ON, app mode required; tested Gmail/QQ/163 delivery is scoped evidence, not all-provider or Mainland-China VPN acceptance.

## Global Constraints

- `LocalePreference = auto | zh-CN | en`; `ResolvedLocale = zh-CN | en`.
- Exact precedence: explicit current user choice > saved user/browser manual choice > trusted Cloudflare country > Accept-Language ONLY if trusted country is unavailable > English fallback.
- CN -> zh-CN; a known non-CN country -> en, regardless of browser language. Manual/saved choices always win. Auto is a mode, not a language lock.
- Never persist country/IP or use them for authorization/identity. Do not reuse `getRequestIp()` header logic for locale trust.
- `ogh_preferences_v1`: host-only, Path=/, Secure, SameSite=Lax, 180-day maximum age, schema version=1; preference/generation/provenance only. Not HttpOnly; untrusted input, not an Auth cookie.
- Browser localStorage is never the first SSR/hydration source. Do not add a localStorage mirror in v1; the spec permits but does not require one.
- Public SSR remains anonymous. No Auth-token cookies, SSR user lookup, new session architecture, service-role shortcut or preference-dependent authorization.
- Separate owner-only `user_preferences`; locale plus required revision/audit metadata only. No theme, arbitrary JSON bag, role/profile authority or country.
- Same canonical routes; no /en or /zh route tree, language-dependent slugs or false hreflang URLs.
- Application UI renders one selected language. User content, names, source titles and arbitrary external content are not translated. Editorial/legal bodies use reviewed authored variants or honestly labelled original-language fallback, never runtime translation.
- Dark-only presentation and existing tokens remain. No Appearance, Light/System appearance, theme state/persistence, channel toggles or instant account deletion.
- Slice C product-detail/routing/schema/search-scope/mobile-nav redesign is excluded. Existing navigation may receive localized labels and minimal spacing needed for Settings, not a new information architecture.
- Later approved Slice A changes supersede the old spec's Astro 5 and active-consent descriptions: preserve PR #7 runtime-consent removal, absent signup age/legal blocking controls, compact notice, safe legacy redirect, no consent DB prerequisite, existing identity fallback and ordinary mutation guards.
- Supabase Auth remains the sole Auth Turnstile consumer/verifier. Do not introduce Siteverify, change required mode/bindings, touch provider secrets, change 5/24h resend limits, initial 60-second UX cooldown, duplicate-email fallback or forgot-password tab rules.
- All proposed implementation tests must be credential-stripped/local-only unless a separately authorized local disposable DB run explicitly permits its owned loopback endpoints. Never inherit Production targets into a browser/API harness.
- This plan task changes only this document. Future schema/config/application changes need approved plan execution; Production migration/provider/merge/deploy/acceptance each needs separate authorization. P9/Verified Session v1 is excluded.

## Review Focus

1. SSR/island mismatch or localStorage flash: Tasks 6-7 and 19 assert first HTML lang, initial island snapshot, hostile storage and no hydration-warning trace.
2. Geo or stale account reads overwriting manual choice: Tasks 1-3 and 8 assert manual CN/non-CN overrides, choice generation, switched user and cross-tab races.
3. Auth/session/required-CAPTCHA regression: Tasks 8, 11 and 19 assert unchanged session transport, safe-next, callback/recovery secret preservation, logout and token argument/consent-removal regressions.
4. RLS/cross-user leakage or revision forgery: Tasks 4-5 use genuine local users A/B and anon; reject foreign ownership, unknown fields, stale revision, metadata and direct REST bypass.
5. Partly bilingual UI/missing dictionary keys: Tasks 1 and 10-18 enforce symmetric catalogs and a per-file coverage manifest; Task 19 exercises loading/error/empty/populated states with UGC/editorial exceptions, not a naive all-Han-character ban.

## Current Source Inventory and Plan Decisions

| Observed current main | Consequence / owning task |
| --- | --- |
| No `src/middleware.ts`, `src/env.d.ts`, `/settings/` or preference table | Create these; Tasks 4, 6, 9. Do not mistake legacy functions/Pages for the Workers request path. |
| `CommunityLayout.astro` hard-codes zh-CN/zh_CN; SiteLayout/ForumLayout wrap it | Shared context/metadata/footer conversion in Task 6/10; do not duplicate layouts. |
| `SiteHeader.astro` has Notifications then HeaderUserMenu; existing React islands use client:load/client:only | Add icon-only Settings between them, pass exact SSR locale snapshot, keep Auth hooks and layout; Tasks 7/10. |
| Auth messages already have `AuthLocale`, typed zh-CN/en entries; login/callback/reset routes pass zh-CN | Preserve `getAuthMessages()` and behavioral adapters; wire global locale, do not write another Auth stack; Task 11. |
| `useBrowserAuthState` reads browser session; APIs use bearer `getUser()` plus actor anon-key client/no-store | Preferences follow this convention, never localStorage session on SSR; Tasks 5/8. |
| `astro.config.mjs` output static with per-route SSR; Starlight root zh-CN/default prerender | Introduce an application HTML route policy and Starlight prerender=false; immutable assets remain static; Tasks 6/18. |
| LegalPage renders both document bodies; guides/[slug] imports authored MDX | Select one reviewed document variant by validated document-only `lang`; label missing variants; Tasks 17-18. |
| Runtime consent mutation helper is now identity-only | No old-spec consent gate restored in preferences or localized Auth/content; Task 11/19 regressions. |
| QA manifest misses middleware/i18n/settings-specific paths; RELEASE forbids DB replay/provider operations | Add deterministic narrow checks/path ownership; local RLS runs separately and is not hidden in release; Tasks 4/20. |
| Release has Slice A 180s, default/search 90s, project-test 180s, build 240s, browser 120s; retry0 | Preserve budgets/executor. Split new deterministic checks rather than one slow aggregate or inherited waiver; Task 20. |

### Interfaces Frozen for These Tasks

`src/lib/i18n/locale.ts` owns types:

```ts
type LocalePreference = "auto" | "zh-CN" | "en";
type ResolvedLocale = "zh-CN" | "en";
type PreferenceProvenance = "device_explicit" | "account_adopted";
type BrowserPreferenceRecord = {
  version: 1; preference: LocalePreference; generation: number;
  provenance: PreferenceProvenance;
};
type LocaleContext = {
  locale: ResolvedLocale; preference: LocalePreference;
  source: "current" | "saved" | "country" | "accept_language" | "fallback";
  autoLocale: ResolvedLocale; generation: number;
  provenance: PreferenceProvenance | null;
};
type LocaleInputs = {
  current?: LocalePreference; saved?: BrowserPreferenceRecord;
  trustedCountry?: string; acceptLanguage?: string;
};
```

`resolveLocale(inputs: LocaleInputs): LocaleContext` is pure. `autoLocale` is the resolved detection language for an explicit Auto switch; it exposes no country/IP. Current Auto overrides a saved lock and goes to detection. Saved Auto also goes to detection. A valid manual language never gets overridden by detection.

`PreferenceRow = { locale_preference: LocalePreference; revision: number; updated_at: string }` is the only account API projection. `PreferenceSnapshot = { locale_preference: LocalePreference; revision: number; updated_at: string | null }` represents the response. Missing row -> `{locale_preference:"auto", revision:0, updated_at:null}`; runtime validation requires revision 0 iff updated_at is null, otherwise positive revision and a valid timestamp. No user ID/email/role/country in the response.

`GET /api/users/me/preferences` -> `{ok:true, preference:PreferenceSnapshot}`; `PATCH` accepts exactly `{locale_preference, expected_revision}` -> same projection. Actor is derived with `getUser(bearer)`. Codes: `UNAUTHORIZED`401, `PREFERENCES_INVALID_INPUT`400, `PREFERENCES_TOO_LARGE`413, `PREFERENCES_CONFLICT`409, `PREFERENCES_UNAVAILABLE`503. All responses no-store; no raw provider text.

`createLocaleStore(initial:LocaleContext, dependencies): LocaleStore` exposes `getSnapshot`, `getServerSnapshot`, `subscribe`, `select(preference)`, `adoptAccount(snapshot, expectedGeneration)` and `clearAccount()`. `useLocale(initial:LocaleContext)` uses `useSyncExternalStore`; the first server/client snapshot equals its supplied SSR context. Stores are request-local for SSR, browser-only singleton for client; never a server global mutable preference.

Manual select commits cookie and selected control immediately, publishes one preference event and navigates the current safe route for coherent SSR-only text. No optimistic English islands under Chinese shell. On cookie failure keep an in-memory control choice and show nonpersistent status; do not reload and lose it or claim persistence. Account adoption, when eligible, writes account_adopted cookie and performs at most one intentional reload. Cross-tab sync sends preference/generation only through BroadcastChannel; no tokens, user identifiers or storage-as-first-source.

**Auth URL exclusion:** Account adoption/reload is deferred on `/login/`, `/register/`, `/auth/callback/`, `/auth/reset-password/` while an Auth operation, CAPTCHA, verification/recovery exchange or form input is active. It never navigates before secret consumption or silently resubmits. Resume at the successful safe destination or a new normal request. Manual change on active credential/recovery forms requires an explicit localized confirmation of losing unsaved inputs; no password/token capture. Browser tests own this boundary.

## File Map

Exact files are enumerated in each owning task below; repeated files such as dictionaries and layout/header are intentionally evolved across reviewable commits. New runtime units (including the Task 18 Starlight translation/dark-only adapters): `src/lib/i18n/{locale,country-codes,country.server,accept-language,preference-cookie,locale-store,preference-client,preference-sync,document-locale,catalog}.ts`, `src/lib/i18n/messages/{shell,settings,community,catalog,admin,documents}.ts`, `src/lib/server/user-preferences.server.ts`, `src/middleware.ts`, `src/env.d.ts`, `src/components/i18n/LocalePreferenceSync.tsx`, `src/components/settings/SettingsPage.tsx`, `src/pages/settings/index.astro`, `src/pages/api/users/me/preferences.ts`, `src/starlightRouteData.ts`.

Only one additive migration is proposed. Its filename is generated during Task 4 using the repository Supabase CLI, not fabricated during planning; record the exact generated path as `$migrationFile`, require exactly one new `supabase/migrations/<14-digit UTC>_user_preferences.sql`, and use that one validated literal path in staging. This deliberate CLI-generated identifier is not an unresolved schema decision.

No runtime files, migration, test, dependency or provider changes are made by writing this plan.

## Execution Rules

Work in a new isolated implementation branch from fresh reviewed main after human plan review/method selection. If base moved, compare the affected source and return for review rather than silently changing this plan's contracts. Read repository instructions; use the repository lock/dependencies, not the older primary D: checkout's installation.

Each task follows its checklist: assertion-level RED (missing import/setup alone does not satisfy RED), minimal implementation, same test GREEN, listed focused regressions, `git diff --check`, inspect staged filenames, explicit `git add`, then its own commit. No `git add .`, wildcard staging, automatic retry, waiver or blanket timeout increase. New tests use node:test/assert and existing Vite/Playwright/Workers module adapters; install no testing framework. Browser fixtures forbid external HTTP/WebSocket and count blocked requests. Local DB harness startup/SQL/auth targets must pass owned-root/loopback checks first. Commands below are future execution instructions, not commands run in this planning task.

## Task 1: Locale Types, Resolver and Typed Catalog Contract

**Files:** Create `src/lib/i18n/locale.ts`, `src/lib/i18n/catalog.ts`, `src/lib/i18n/messages/shell.ts`, `scripts/test-locale-contract.mjs`.

**Interfaces:** Produce the types/`resolveLocale` above, `getUiMessages(locale)` with typed namespaces, and exact symmetric zh-CN/en key sets. Reuse `getAuthMessages()` later as the Auth namespace; don't duplicate it.

- [ ] Write assertions `resolveLocale({current:"zh-CN",trustedCountry:"US"}).locale === "zh-CN"`, `current:"en",country:"CN" -> en`, saved manual beats country, current Auto beats a saved manual lock, absent input -> en, invalid preference normalizes to Auto. Assert catalog key parity, named interpolation arguments and visible missing-key rejection in development/test rather than silently showing the other language.
- [ ] RED: `node --experimental-strip-types scripts/test-locale-contract.mjs`; establish a resolver/key-parity assertion failure with the exported surface present.
- [ ] Implement the types, pure precedence skeleton and initial shell keys; messages are reviewed authored text, not machine translation.
- [ ] GREEN: same command; all contract assertions pass.
- [ ] Regressions: `node scripts/test-auth-captcha-mode.mjs` and `git diff --check`; no Auth/config changes.
- [ ] Stage `git add src/lib/i18n/locale.ts src/lib/i18n/catalog.ts src/lib/i18n/messages/shell.ts scripts/test-locale-contract.mjs`; inspect staged names, commit `feat(locale): define resolver and message contracts`.

## Task 2: Trusted Country and Bounded Accept-Language

**Files:** Create `src/lib/i18n/country.server.ts`, `src/lib/i18n/country-codes.ts`, `src/lib/i18n/accept-language.ts`, `scripts/test-locale-detection.mjs`; modify `src/lib/i18n/locale.ts`.

**Interfaces:** `getTrustedCountry(request:Request): string|undefined` reads only the Workers Request object's runtime `cf.country`, never CF-IPCountry/X-Forwarded headers or URL; `resolveAcceptLanguage(header:string|undefined): ResolvedLocale|undefined`. Known ISO alpha-2 countries are a reviewed constant allowlist; XX/T1/unknown/invalid are unavailable. Local tests inject a runtime cf object through the owned fixture, not a public header escape hatch.

- [ ] Write `CN_AUTO_WITH_EN_HEADER -> zh-CN`, `US_AUTO_WITH_ZH_HEADER -> en`, trusted absent zh/zh-CN/zh-Hans -> zh-CN, en-* -> en, zh-Hant skipped, q=0 excluded, descending q/stable order, wildcard -> fallback. Spoofed CF-IPCountry alone must not become trusted; XX/T1/ZZ/malformed codes cannot create unsupported locales. Reject >2048 bytes/>20 tags and malformed q safely.
- [ ] RED: `node --experimental-strip-types scripts/test-locale-detection.mjs`; resolver/header assertions fail, not an import error.
- [ ] Implement adapter validation, bounded parser and resolver detection; raw country is discarded before LocaleContext serialization.
- [ ] GREEN: same command; all fixtures pass and only supported locale values leave the resolver.
- [ ] Regressions: `node --experimental-strip-types scripts/test-locale-contract.mjs`; assert manual preferences remain dominant; diff-check.
- [ ] Stage `git add src/lib/i18n/country.server.ts src/lib/i18n/country-codes.ts src/lib/i18n/accept-language.ts src/lib/i18n/locale.ts scripts/test-locale-detection.mjs`; commit `feat(locale): resolve trusted country before browser language`.

## Task 3: Cookie Persistence and Browser Choice Generation

**Files:** Create `src/lib/i18n/preference-cookie.ts`, `src/lib/i18n/locale-store.ts`, `scripts/test-locale-cookie-store.mjs`.

**Interfaces:** `parsePreferenceCookie(value:string|undefined):BrowserPreferenceRecord|undefined`, `serializePreferenceCookie(record):string`, `writeBrowserPreference(record):boolean`, `createLocaleStore`. Payload keys exactly version/preference/generation/provenance; URI-encoded bounded JSON, maximum 512 bytes. Generation is a nonnegative safe integer; overflow clears/reinitializes with a new choice event rather than accepting a forged value.

- [ ] Write tests for cookie attrs including no Domain; malformed/oversized/version-mismatch/unknown keys/theme/country/token/userId rejected; manual zh outside CN and en inside CN survive parsing; SSR ignores hostile localStorage; successful write readback precedes navigation. Storage denied -> in-memory/nonpersistent state with no false save. Same/cross-tab stale generation must not overwrite newer selection; duplicate events cause no reload loop.
- [ ] RED: `node --experimental-strip-types scripts/test-locale-cookie-store.mjs`; assert initial cookie/store behavior fails.
- [ ] Implement cookie parser, browser-only subscription store and explicit choice provenance; only change cookie after validated Settings interaction/account adoption, never arbitrary URL query.
- [ ] GREEN: same command; country/user/session/appearance fields absent in serialized records/events.
- [ ] Regressions: Tasks 1-2 commands and diff-check; no session storage or Auth client modifications.
- [ ] Stage `git add src/lib/i18n/preference-cookie.ts src/lib/i18n/locale-store.ts scripts/test-locale-cookie-store.mjs`; commit `feat(locale): persist explicit device preferences in cookies`.

## Task 4: Additive Owner-Only Preference Schema and Genuine Local RLS Tests

**Files:** Create CLI-generated `$migrationFile`, `scripts/test-user-preferences-schema.mjs`, `scripts/test-user-preferences-rls-local.mjs`, `scripts/test-user-preferences-local-safety.mjs`.

**Interfaces:** `public.user_preferences(user_id uuid primary key references auth.users(id) on delete cascade, locale_preference text not null default 'auto' check (locale_preference in ('auto','zh-CN','en')), revision integer not null default 1 check (revision>0), updated_at timestamptz not null default now())`. Own SELECT/INSERT/UPDATE policies, UPDATE USING and WITH CHECK auth.uid()=user_id; anon/PUBLIC rights revoked; authenticated SELECT, INSERT(user_id,locale_preference), UPDATE(locale_preference) only. A narrow invoker trigger sets insertion metadata and increments revision/updated_at on actual updates; no browser ownership/revision/time mutation and no DELETE grant/API.

- [ ] Write schema assertions for columns/checks/grants/policy predicates and `RLS_ANON_DENIED`, `RLS_A_CANNOT_SELECT_B`, `RLS_A_CANNOT_INSERT_B`, `RLS_A_CANNOT_UPDATE_B`, owner reassignment/metadata writes denied. Define the local runner using existing `assertSafeLocalReplayEnvironment`, `sanitizedChildEnvironment`, `assertOwnedDisposableRoot`, `assertLocalReplayTarget`, `runLocalDisposableReplay` and its `afterMigrationLedgerValidated` hook. Require exact newly owned DB container and genuine local Auth users A/B created through owned local signup, then signed in normally to obtain real actor JWTs. If email confirmation is required, confirm only those disposable fixtures through the owned container SQL connection before password login; never use a privileged HTTP actor for the RLS requests. Reject remote/linked targets before any network/SQL, redact generated local tokens.
- [ ] RED: `node scripts/test-user-preferences-schema.mjs` and `node scripts/test-user-preferences-local-safety.mjs`; safety positive/negative assertions must work before DB startup. Then `node scripts/test-user-preferences-rls-local.mjs` on an owned disposable instance must fail the missing table/owner isolation expectation, not setup/auth failure. If Docker/local Auth unavailable, stop this implementation task as blocked; do not use Production.
- [ ] Run repository CLI `node node_modules/supabase/bin/supabase migration new user_preferences`; determine exactly one new matching path as `$migrationFile`, validate it stays inside migrations. Implement the additive schema there. The local hook applies only that candidate after the existing canonical replay, with an explicit ledger entry and transaction, then executes the local Auth/REST RLS matrix. Never alter the canonical fingerprint fixture or replace historical migration contents to accommodate this test.
- [ ] GREEN: schema/safety tests and `node scripts/test-user-preferences-rls-local.mjs` PASS; record owned-target/cleanup proof and A/B/anon outcomes. No secret values in stdout/artifacts, no fake-JWT or service-role HTTP actor substituted for RLS.
- [ ] Regressions: `node scripts/qa/validate-supabase-migration-versions.mjs`, `node --test scripts/qa/test-local-disposable-supabase-replay.mjs`, diff-check. Any existing replay/fingerprint mismatch is a separate reviewed additive-delta decision, not an automatic fixture refresh.
- [ ] Stage `git add -- $migrationFile scripts/test-user-preferences-schema.mjs scripts/test-user-preferences-rls-local.mjs scripts/test-user-preferences-local-safety.mjs`; inspect the exact one migration path, commit `feat(settings): add owner-only locale preferences schema`.

## Task 5: Narrow Actor Preference API and Optimistic Revision

**Files:** Create `src/lib/server/user-preferences.server.ts`, `src/pages/api/users/me/preferences.ts`, `scripts/test-user-preferences-api.mjs`.

**Interfaces:** `handlePreferenceRequest(request:Request,env:Record<string,string|undefined>,dependencies):Promise<Response>` implements frozen GET/PATCH contract; use actor-scoped `createUserClient()` convention plus `getUser(token)`, never the forum service-role rate-limit client. Body cap 1024 bytes; content-type JSON; strict exactly two fields and integer expected_revision >=0.

- [ ] Write unauthorized/malformed/unknown-key/user_id/country/theme tests, GET absent row defaults without auto-insert, own projection only, no-store, 503 DB failure/no raw text, stale409/no change. PATCH revision0 inserts owner with metadata defaults; unique collision409. Existing row uses `eq(user_id,actor).eq(revision,expected)` update + returning row; empty match409, not overwrite/upsert. Race two same revisions -> exactly one success. Verify no cookie-as-auth, country-as-auth, consent lookup or service-role use.
- [ ] RED: `node --experimental-strip-types scripts/test-user-preferences-api.mjs`; use injected route/client adapter, assert response behavior fails.
- [ ] Implement handler and cloudflare:workers route wrapper; preserve private token handling and no-store headers. Add request-origin validation for mutations without weakening bearer verification; no CORS wildcard or credential-bearing cross-origin fallback.
- [ ] GREEN: same command; all rejection cases leave row unchanged.
- [ ] Regressions: `npm run test:user-profile-api-safety`, `npm run test:user-summary-api-safety`, Task 4 local RLS runner and diff-check.
- [ ] Stage `git add src/lib/server/user-preferences.server.ts src/pages/api/users/me/preferences.ts scripts/test-user-preferences-api.mjs`; commit `feat(settings): expose revision-safe own preference API`.

## Task 6: Request Locals, HTML SSR Policy and Cache Isolation

**Files:** Create `src/middleware.ts`, `src/env.d.ts`, `src/lib/i18n/html-route-policy.ts`, `src/plugins/locale-ssr-routes.mjs`, `scripts/test-locale-middleware.mjs`; modify `astro.config.mjs`, `src/layouts/CommunityLayout.astro`.

**Interfaces:** `App.Locals.localeContext:LocaleContext`; `isLocaleHtmlRoute(pathname:string):boolean`. Middleware reads only preference cookie, trusted runtime cf and Accept-Language, sets locals before next(), then private,no-store for app HTML. Route integration `astro:route:setup` sets HTML/page prerender=false (including 404/redirect wrappers as applicable), excluding APIs/assets/sitemap; no global static-output/auth rewrite. Exact installed hook compatibility must be fixture-proven before changing rendering flags.

- [ ] Write tests for per-request isolation, all-supported locale output, invalid cookie normalization, no country serialization, unchanged API/asset behavior and two differing cookie requests never sharing cached HTML. Assert html lang zh-CN/en and OG zh_CN/en_US match locals; no static bypass for application pages, no account/Auth call during SSR.
- [ ] RED: `node scripts/test-locale-middleware.mjs`; actual local SSR/config fixture fails fixed lang/cache/route assertions.
- [ ] Implement middleware, typing and route-policy integration; layout uses locals/context exactly. Do not overwrite existing no-store stricter response rules, auth safe-next or static asset cache headers.
- [ ] GREEN: same command; built manifest proves application HTML routes are on demand; immutable assets remain cacheable.
- [ ] Regressions: `npm run test:workers-config`, `npm run test:workers-env-contract`, `node scripts/test-auth-captcha-mode.mjs`, diff-check. Starlight's own route integration is completed in Task 18 before global coverage is called green.
- [ ] Stage `git add src/middleware.ts src/env.d.ts src/lib/i18n/html-route-policy.ts src/plugins/locale-ssr-routes.mjs scripts/test-locale-middleware.mjs astro.config.mjs src/layouts/CommunityLayout.astro`; commit `feat(locale): propagate request context with isolated HTML caching`.

## Task 7: Island Hydration Contract and Local Browser Fixture

**Files:** Modify `src/lib/i18n/locale-store.ts`; create `src/components/i18n/useLocale.ts`, `scripts/test-locale-hydration.mjs`, `tests/visual/locale-settings-harness/index.html`, `tests/visual/locale-settings-harness/main.tsx`, `tests/visual/locale-settings-harness/vite.config.ts`.

**Interfaces:** `useLocale(initial:LocaleContext):{context:LocaleContext,messages:UiMessages}`; supplied initial snapshot has exact SSR values, no global server store. Harness mounts real application units with dependency-injected Auth/API/detection only; it cannot contact canonical/preview/Supabase/Turnstile.

- [ ] Write first-frame html/island snapshot agreement tests, a throwing/opposite-language localStorage, delayed hydration, two SSR requests with opposite preferences, simultaneous islands, choice event order and storage-denied UI. Assert no hydration warnings and no bilingual initial frame; token/user data absent from preference events.
- [ ] RED: `node scripts/test-locale-hydration.mjs`; runnable loopback harness fails mismatch assertions.
- [ ] Implement hook and hydration-safe store; use exact getServerSnapshot, not reading cookie/detection/localStorage during first hydration to choose a different language.
- [ ] GREEN: same command; Chromium screenshot/frame evidence and browser HTTP/WebSocket external request count0; guaranteed browser/server cleanup.
- [ ] Regressions: Tasks 1-3/6 test commands; diff-check.
- [ ] Stage `git add src/lib/i18n/locale-store.ts src/components/i18n/useLocale.ts scripts/test-locale-hydration.mjs tests/visual/locale-settings-harness/index.html tests/visual/locale-settings-harness/main.tsx tests/visual/locale-settings-harness/vite.config.ts`; commit `feat(locale): bind island hydration to SSR locale`.

## Task 8: Account Adoption, Manual Save and Logout Synchronization

**Files:** Create `src/lib/i18n/preference-client.ts`, `src/lib/i18n/preference-sync.ts`, `src/components/i18n/LocalePreferenceSync.tsx`, `scripts/test-locale-account-sync.mjs`; modify `src/components/site/SiteHeader.astro`, `tests/visual/locale-settings-harness/main.tsx`.

**Interfaces:** `loadOwnPreference(client,signal):Promise<PreferenceSnapshot>`, `saveOwnPreference(client,preference,expectedRevision,signal):Promise<PreferenceSnapshot>`; `createPreferenceSync(store,dependencies)` cancels on actor switch/logout, uses generation/actor-in-memory guard, bounded 3-second load and one intentional adoption reload. Mount one LocalePreferenceSync in shared header; use existing createBrowserSupabaseClient/useBrowserAuthState, no awaited asynchronous Supabase call inside onAuthStateChange callback and no session gate.

- [ ] Write device_explicit anonymous choice retained on login without silent upload; no explicit choice adopts account once; stale load after select/switch/logout discarded; failed DB read leaves Auth usable/browser choice intact. Logout clears account memory and account_adopted cookie to Auto, retains device_explicit cookie. Actor B never sees A preference. Conflict keeps current browser selection and displays reconciliation, not last-write wins. Guard callback/recovery/login active forms against auto reload and token loss.
- [ ] RED: `node scripts/test-locale-account-sync.mjs`; harness race/safe-route assertions fail.
- [ ] Implement sync/client/coordinator with cancellation and explicit local-vs-account save states; no inferred preference upload, infinite poll or secret/identity broadcast. API failures are localized allowlisted codes.
- [ ] GREEN: same command; bounded reads and adoption counts verified with generation races.
- [ ] Regressions: `node scripts/test-password-recovery.mjs`, `npm run test:auth-redirect-safety`, `node scripts/test-runtime-consent-frontend.mjs`, Task 7 and diff-check. These are future local regressions, not new Production Auth/email requests.
- [ ] Stage `git add src/lib/i18n/preference-client.ts src/lib/i18n/preference-sync.ts src/components/i18n/LocalePreferenceSync.tsx scripts/test-locale-account-sync.mjs src/components/site/SiteHeader.astro tests/visual/locale-settings-harness/main.tsx`; commit `feat(settings): synchronize own preferences without gating Auth`.

## Task 9: Settings Route, Language Selector and Supported Navigation

**Files:** Create `src/pages/settings/index.astro`, `src/components/settings/SettingsPage.tsx`, `src/lib/i18n/messages/settings.ts`, `scripts/test-settings-page.mjs`; modify `src/lib/i18n/catalog.ts`, `tests/visual/locale-settings-harness/main.tsx`.

**Interfaces:** `SettingsPage({localeContext})`; SSR route uses CommunityLayout/canonical /settings/, anonymous General usable. Language option values auto/zh-CN/en; localized Auto label and self-names 简体中文/English. Use native select or accessible radio group, not arbitrary command-button state.

- [ ] Write anonymous switch/cookie/full-reload tests and account sign-in requirement, account-ready save plus expected_revision, device-only save warning on API failure and conflict reconciliation. Account links target /me/, /me/edit/, /login/?mode=forgot with safe-next, /account-deletion/; Notifications /notifications/; Privacy/Safety links use existing policy routes. Logout calls existing Supabase sign-out once; no new deletion/channel/appearance controls. Assert unsaved Auth form navigation confirmation per frozen contract.
- [ ] RED: `node scripts/test-settings-page.mjs`; assert route/options/supported states fail.
- [ ] Implement semantic full-width Settings sections, General for all, supported account/navigation entries for signed-in users; anonymous account entries show sign-in requirement. Locale save writes browser state before navigation, then confirmed account persistence only on success; one user-driven retry may be offered, never auto retry or blind conflict overwrite.
- [ ] GREEN: same command; keyboard option selection and immediate selected state/new localized request verified.
- [ ] Regressions: Tasks 3/5/7/8; `npm run test:auth-redirect-safety`; diff-check.
- [ ] Stage `git add src/pages/settings/index.astro src/components/settings/SettingsPage.tsx src/lib/i18n/messages/settings.ts scripts/test-settings-page.mjs src/lib/i18n/catalog.ts tests/visual/locale-settings-harness/main.tsx`; commit `feat(settings): add anonymous and own-account language settings`.

## Task 10: Shared Shell and Header Settings Entry

**Files:** Modify `src/layouts/CommunityLayout.astro`, `src/components/community/CommunityHeader.astro`, `src/components/site/SiteHeader.astro`, `src/components/site/HeaderUserMenu.tsx`, `src/components/site/HeaderNotifications.tsx`, `src/components/community/GlobalSearchBox.tsx`, `src/lib/site-navigation.ts`, `src/lib/i18n/messages/shell.ts`; create `scripts/test-locale-shell.mjs`.

**Interfaces:** Layout->Header->each island passes `localeContext`; retain a stable default only in standalone test fixtures, not a second production detector. Navigation keys/hrefs unchanged, labels selected via typed catalog.

- [ ] Write localized footer/nav/aria/tooltips/loading/error tests and DOM order Notifications -> Settings -> Account for anon/signed-in. Assert Settings icon links /settings/, has localized accessible name/hover tooltip and >=44px target; UGC account label remains unchanged. 390/430/desktop header spacing must not overlap, and Settings stays reachable without changing Slice C search/nav semantics.
- [ ] RED: `node scripts/test-locale-shell.mjs`; assert fixed Chinese shell/missing Settings/order fails.
- [ ] Implement shell strings and an existing icon-library Settings glyph if available; no new dependency. If no existing icon library covers it, use one shared accessible local glyph matching current icon conventions. Keep identity enrichment and notification/search behavior unchanged.
- [ ] GREEN: same command; both locale snapshots and interaction assertions pass.
- [ ] Regressions: `node scripts/test-header-identity.mjs`, `node scripts/test-user-summary-api-safety.mjs`, Task 7/9; diff-check. Keep menu identifiers/hrefs backward compatible.
- [ ] Stage `git add src/layouts/CommunityLayout.astro src/components/community/CommunityHeader.astro src/components/site/SiteHeader.astro src/components/site/HeaderUserMenu.tsx src/components/site/HeaderNotifications.tsx src/components/community/GlobalSearchBox.tsx src/lib/site-navigation.ts src/lib/i18n/messages/shell.ts scripts/test-locale-shell.mjs`; commit `feat(locale): localize shell and expose Settings in header`.

## Task 11: Auth and Own Profile Locale Wiring Only

**Files:** Modify `src/pages/login/index.astro`, `src/pages/auth/callback.astro`, `src/pages/auth/reset-password/index.astro`, `src/pages/me/index.astro`, `src/pages/me/edit.astro`, `src/pages/u/[username].astro`, `src/pages/users/[id].astro`, `src/components/forum/AuthPanel.tsx`, `src/components/auth/AuthCallback.tsx`, `src/components/auth/ResetPasswordForm.tsx`, `src/components/auth/AuthCTA.tsx`, `src/components/auth/FeedSidebarAuthHint.tsx`, `src/components/profile/MyProfilePage.tsx`, `src/components/profile/EditProfileForm.tsx`, `src/components/profile/ProfilePostCard.tsx`; create `src/lib/i18n/messages/account.ts`, `scripts/test-locale-auth-profile.mjs`; modify `src/lib/i18n/catalog.ts`.

**Interfaces:** Existing AuthLocale/getAuthMessages remain compatible and take context.locale; profile/account UI consumes messages.account. Locale props change copy, never account identity/Auth control flow.

- [ ] Write zh-CN/en login/register/forgot/callback/reset/profile states; safe-next same output, no forgot tabs, no signup blocking checkbox, conditional duplicate wording, cooldown/initial60s and resend error names preserved. Required CAPTCHA still blocks missing fresh proof, SDK captchaToken paths unchanged; no Siteverify. New-user fallback/summary failure/switch/ownership/profile links unchanged. Account reload deferred during callback/recovery tokens and active forms.
- [ ] RED: `node scripts/test-locale-auth-profile.mjs`; language/context assertions fail.
- [ ] Wire existing message boundary/context and account dictionary; do not modify AuthTurnstile, auth-captcha-mode, mutation authorization, Supabase Auth settings or policy versions.
- [ ] GREEN: same command; all UI states one-language, identity/UGC unchanged.
- [ ] Regressions: `npm run test:auth-email-abuse-ux`, `node scripts/test-auth-email-abuse-ux.mjs --final-fix`, `node scripts/test-runtime-consent-frontend.mjs`, `npm run test:auth-redirect-safety`, `node scripts/test-header-identity.mjs`; diff-check. Adapt only fixture props/locale assertions needed to observe both languages; don't remove behavioral checks.
- [ ] Stage `git add src/pages/login/index.astro src/pages/auth/callback.astro src/pages/auth/reset-password/index.astro src/pages/me/index.astro src/pages/me/edit.astro src/pages/u/[username].astro src/pages/users/[id].astro src/components/forum/AuthPanel.tsx src/components/auth/AuthCallback.tsx src/components/auth/ResetPasswordForm.tsx src/components/auth/AuthCTA.tsx src/components/auth/FeedSidebarAuthHint.tsx src/components/profile/MyProfilePage.tsx src/components/profile/EditProfileForm.tsx src/components/profile/ProfilePostCard.tsx src/lib/i18n/messages/account.ts scripts/test-locale-auth-profile.mjs src/lib/i18n/catalog.ts`; inspect staged names, commit `feat(locale): wire accepted Auth and profile UI to request language`.

## Task 12: Community Listing and Navigation Copy

**Files:** Modify `src/pages/feed/index.astro`, `src/pages/forum/index.astro`, `src/pages/circles/index.astro`, `src/pages/circles/[slug].astro`, `src/pages/posts/[id].astro`, `src/components/community/PostCard.astro`, `src/components/community/PostMediaPreview.astro`, `src/components/community/CircleCard.astro`, `src/components/community/EmptyFeedState.astro`, `src/layouts/ForumLayout.astro`; create `src/lib/i18n/messages/community.ts`, `scripts/test-locale-community.mjs`; modify `src/lib/i18n/catalog.ts`.

**Interfaces:** messages.community and localeContext on nested islands; stable URLs/filters/pagination/ACL decisions; user titles/bodies/author names not dictionary content.

- [ ] Write loading/empty/unavailable/feed/circle/post label tests in both languages; identical UGC and route params across locale switches. Preserve existing limits, ranking and data projection; format app-controlled timestamps/counts with selected locale, never infer missing facts.
- [ ] RED: `node scripts/test-locale-community.mjs` (listing cases).
- [ ] Convert only application labels/metadata/navigation/formatting; use existing data APIs unchanged.
- [ ] GREEN: same command; one-language wrappers and UGC preservation pass.
- [ ] Regressions: `npm run test:forum-permissions`, `node --experimental-strip-types scripts/test-runtime-mutation-identity.mjs`, Task 10; diff-check.
- [ ] Stage `git add src/pages/feed/index.astro src/pages/forum/index.astro src/pages/circles/index.astro src/pages/circles/[slug].astro src/pages/posts/[id].astro src/components/community/PostCard.astro src/components/community/PostMediaPreview.astro src/components/community/CircleCard.astro src/components/community/EmptyFeedState.astro src/layouts/ForumLayout.astro src/lib/i18n/messages/community.ts scripts/test-locale-community.mjs src/lib/i18n/catalog.ts`; inspect staged names, commit `feat(locale): localize community reading surfaces`.

## Task 13: Community Forms, Interactions, Notifications and Reports

**Files:** Modify `src/pages/posts/new.astro`, `src/pages/circles/new.astro`, `src/pages/circles/[slug]/manage.astro`, `src/pages/notifications/index.astro`, `src/components/forum/CreatePostForm.tsx`, `src/components/forum/CreateCircleForm.tsx`, `src/components/forum/CommentForm.tsx`, `src/components/forum/CommentsSection.tsx`, `src/components/forum/CircleOwnerDashboard.tsx`, `src/components/forum/CircleManageEntry.tsx`, `src/components/forum/CircleCoverEditor.tsx`, `src/components/forum/PostSocialActions.tsx`, `src/components/forum/SharePostButton.tsx`, `src/components/forum/PostModerationActions.tsx`, `src/components/forum/PostMediaGallery.tsx`, `src/components/notifications/NotificationsPage.tsx`, `src/components/reports/ReportTrigger.tsx`, `src/components/common/GlassConfirmDialog.tsx`, `src/lib/i18n/messages/community.ts`, `scripts/test-locale-community.mjs`.

**Interfaces:** Thread localeContext through current forms/dialogs; map known error codes to UI messages, not translate raw server text/content. Notification user-produced payload/title remains source language; application action labels/status are localized.

- [ ] Extend test with forms/sending/validation/failure/rate-limit/reports/dialogs/read-unread states; assert payloads, ownership and confirmation semantics unchanged, one simulated send per deliberate action and no consent prerequisite. Preserve external upload Turnstile integration independently from Auth.
- [ ] RED: `node scripts/test-locale-community.mjs` (interactive cases fail).
- [ ] Convert labels/known UI error mappings only; no new channel toggles, moderation/provider logic, retries, mutation capabilities or rate-limit fallback.
- [ ] GREEN: same command; both languages cover every allowlisted UI state.
- [ ] Regressions: `npm run test:forum-permissions`, `npm run test:reports`, `npm run test:user-safety`, `node --experimental-strip-types scripts/test-legal-consent-mutation-guard.mjs`, Task 12; diff-check.
- [ ] Stage `git add src/pages/posts/new.astro src/pages/circles/new.astro src/pages/circles/[slug]/manage.astro src/pages/notifications/index.astro src/components/forum/CreatePostForm.tsx src/components/forum/CreateCircleForm.tsx src/components/forum/CommentForm.tsx src/components/forum/CommentsSection.tsx src/components/forum/CircleOwnerDashboard.tsx src/components/forum/CircleManageEntry.tsx src/components/forum/CircleCoverEditor.tsx src/components/forum/PostSocialActions.tsx src/components/forum/SharePostButton.tsx src/components/forum/PostModerationActions.tsx src/components/forum/PostMediaGallery.tsx src/components/notifications/NotificationsPage.tsx src/components/reports/ReportTrigger.tsx src/components/common/GlassConfirmDialog.tsx src/lib/i18n/messages/community.ts scripts/test-locale-community.mjs`; inspect staged names, commit `feat(locale): localize community actions without changing authorization`.

## Task 14: Home, Catalog, Search and News Application UI

**Files:** Modify `src/pages/index.astro`, `src/pages/products/index.astro`, `src/pages/products/[brand].astro`, `src/pages/devices/index.astro`, `src/pages/devices/[slug].astro`, `src/pages/search/index.astro`, `src/pages/news/index.astro`, `src/pages/news/[slug].astro`, `src/components/community/ProductCard.astro`, `src/components/community/NewsCard.astro`, `src/components/devices/DeviceLibraryExplorer.tsx`, `src/components/news/NewsPagination.tsx`, `src/components/CommunityCTA.astro`, `src/components/LatestUpdates.astro`; create `src/lib/i18n/messages/catalog.ts`, `scripts/test-locale-catalog-search-news.mjs`; modify `src/lib/i18n/catalog.ts`.

**Interfaces:** messages.catalog/search/news typed keys; keep current catalog routing/compare/search scope/API/data unchanged. Existing source/product names, titles and external news bodies remain source language; authored home descriptions select reviewed copy, not fabricated data.

- [ ] Write locale-only assertions for page headings, compare controls, query/empty/error/loading/filter states and data-preserving cards; inspect built client scripts' visible strings too. Same query/results/canonical hrefs in both languages, special query strings remain escaped text. No new /products/brand/slug routes or quick-search scope repair in B.
- [ ] RED: `node scripts/test-locale-catalog-search-news.mjs`.
- [ ] Convert UI strings and deterministic selected-locale number/date formatting, passing context to islands; no product fact edits.
- [ ] GREEN: same command; one-language application copy and original data pass.
- [ ] Regressions: `npm run test:products`, `node scripts/test-public-device-data.mjs`, `node scripts/test-public-news-api-safety.mjs`, `npm run test:search`; diff-check. Search failure stops with original receipt, no inherited waiver/retry/timeout inflation.
- [ ] Stage `git add src/pages/index.astro src/pages/products/index.astro src/pages/products/[brand].astro src/pages/devices/index.astro src/pages/devices/[slug].astro src/pages/search/index.astro src/pages/news/index.astro src/pages/news/[slug].astro src/components/community/ProductCard.astro src/components/community/NewsCard.astro src/components/devices/DeviceLibraryExplorer.tsx src/components/news/NewsPagination.tsx src/components/CommunityCTA.astro src/components/LatestUpdates.astro src/lib/i18n/messages/catalog.ts scripts/test-locale-catalog-search-news.mjs src/lib/i18n/catalog.ts`; inspect staged names, commit `feat(locale): localize home catalog search and news wrappers`.

## Task 15: Admin Dashboard Shell Labels

**Files:** Modify `src/components/admin/AdminUsersDashboard.tsx`, `src/components/admin/AdminReportsPanel.tsx`, `src/components/admin/AdminNewsDashboard.tsx`, `src/components/admin/AdminModerationQueue.tsx`, `src/components/admin/AdminMediaDashboard.tsx`, `src/components/admin/AdminForumDashboard.tsx`, `src/components/admin/AdminDevicesDashboard.tsx`, `src/components/admin/AdminCirclesDashboard.tsx`, `src/pages/admin/users/index.astro`, `src/pages/admin/reports/index.astro`, `src/pages/admin/news/index.astro`, `src/pages/admin/moderation/index.astro`, `src/pages/admin/media/index.astro`, `src/pages/admin/forum/index.astro`, `src/pages/admin/devices/index.astro`, `src/pages/admin/circles/index.astro`; create `src/lib/i18n/messages/admin.ts`, `scripts/test-locale-admin.mjs`; modify `src/lib/i18n/catalog.ts`.

**Interfaces:** localeContext/messages.admin props only; useAdminSession and all privileged API/role checks unchanged. Local fixture may simulate admin UI but never performs real admin requests.

- [ ] Write both-language labels/filters/status/errors/actions, unprivileged denial and original moderation/catalog user text preservation. Action confirmation remains explicit; selected locale cannot grant privilege or alter payload.
- [ ] RED: `node scripts/test-locale-admin.mjs`.
- [ ] Convert shell labels and known error mappings only; no moderation policy/data/privilege changes.
- [ ] GREEN: same command; local fixtures cover anon/denied/loading/ready/error.
- [ ] Regressions: `node scripts/test-device-admin-api.mjs`, `npm run test:profile-role-security`, `npm test`; diff-check.
- [ ] Stage `git add src/components/admin/AdminUsersDashboard.tsx src/components/admin/AdminReportsPanel.tsx src/components/admin/AdminNewsDashboard.tsx src/components/admin/AdminModerationQueue.tsx src/components/admin/AdminMediaDashboard.tsx src/components/admin/AdminForumDashboard.tsx src/components/admin/AdminDevicesDashboard.tsx src/components/admin/AdminCirclesDashboard.tsx src/pages/admin/users/index.astro src/pages/admin/reports/index.astro src/pages/admin/news/index.astro src/pages/admin/moderation/index.astro src/pages/admin/media/index.astro src/pages/admin/forum/index.astro src/pages/admin/devices/index.astro src/pages/admin/circles/index.astro src/lib/i18n/messages/admin.ts scripts/test-locale-admin.mjs src/lib/i18n/catalog.ts`; inspect staged names, commit `feat(locale): localize current admin shell without privilege changes`.

## Task 16: Support and Public Documentation Entry Wrappers

**Files:** Modify `src/pages/guides/index.astro`, `src/pages/guides/[slug].astro`, `src/pages/developers/index.astro`, `src/pages/gaze-launcher/index.astro`; create `src/lib/i18n/messages/documents.ts`, `scripts/test-locale-document-wrappers.mjs`; modify `src/lib/i18n/catalog.ts`.

**Interfaces:** messages.documents contains app-controlled headings/navigation/actions; source frontmatter titles and MDX bodies are separate editorial documents, not translated inside UI dictionaries. Keep launcher visibility flag and redirects unchanged.

- [ ] Write UI wrapper, continuation/back navigation, missing/loading/error language cases and original authored-content fallback label. Assert locale doesn't expose hidden launcher routes or move documents into locale-prefixed trees.
- [ ] RED: `node scripts/test-locale-document-wrappers.mjs`.
- [ ] Convert wrapper UI and preserve authored body identity; Task 18 selects reviewed editorial variants. Do not expand launcher/product scope.
- [ ] GREEN: same command; both-language wrapper contracts pass.
- [ ] Regressions: `node scripts/test-gaze-launcher-visibility.mjs`, `npm run test:products`; diff-check.
- [ ] Stage `git add src/pages/guides/index.astro src/pages/guides/[slug].astro src/pages/developers/index.astro src/pages/gaze-launcher/index.astro src/lib/i18n/messages/documents.ts scripts/test-locale-document-wrappers.mjs src/lib/i18n/catalog.ts`; commit `feat(locale): localize supported documentation entry UI`.

## Task 17: Reviewed Legal Document Selection, Separate from UI Preference

**Files:** Create `src/lib/i18n/document-locale.ts`, `scripts/test-locale-legal-documents.mjs`; modify `src/components/legal/LegalPage.astro`, `src/pages/terms/index.astro`, `src/pages/privacy/index.astro`, `src/pages/community-guidelines/index.astro`, `src/pages/safety/index.astro`, `src/pages/account-deletion/index.astro`, `src/pages/contact/index.astro`, `src/lib/i18n/messages/documents.ts`.

**Interfaces:** `resolveDocumentLocale(value:string|null,uiLocale:ResolvedLocale):ResolvedLocale`; validated `?lang=zh-CN|en` selects document body only. Unsupported input -> global UI locale. No cookie/account write on document navigation. Existing zh/en authored legal strings are the reviewed variants; preserve policy versions/minimumAge/substantive meaning and public contact routes.

- [ ] Write only one selected body visible, document section lang vs shell html lang, locale-specific navigation/version metadata, override doesn't change global cookie/account/generation, malformed query safe. Golden/structural body comparison proves no substantive policy rewrite; existing contact addresses must not be copied to new test artifacts/logs unnecessarily. Legacy consent safe redirect remains covered by existing tests, no new Production exercise.
- [ ] RED: `node --experimental-strip-types scripts/test-locale-legal-documents.mjs`.
- [ ] Select reviewed body, localize app-controlled document controls/metadata and provide document-only language links. A Chinese document inside English global shell is an intentional scoped document override, not partial UI translation.
- [ ] GREEN: same command; no preference mutation or legal rewording.
- [ ] Regressions: `npm run test:legal-content`, `npm run test:legal-public-rendering`, `node --experimental-strip-types scripts/test-legal-consent-page-gate.mjs`; diff-check. Tests previously expecting two simultaneously rendered bodies must retain content-integrity checks and move render assertions to two separate locale requests.
- [ ] Stage `git add src/lib/i18n/document-locale.ts scripts/test-locale-legal-documents.mjs src/components/legal/LegalPage.astro src/pages/terms/index.astro src/pages/privacy/index.astro src/pages/community-guidelines/index.astro src/pages/safety/index.astro src/pages/account-deletion/index.astro src/pages/contact/index.astro src/lib/i18n/messages/documents.ts`; inspect staged names, commit `feat(locale): select reviewed legal language without changing global preference`.

## Task 18: Same-Route Starlight and Reviewed Editorial Variants

**Files:** Create `src/starlightRouteData.ts`, `src/lib/i18n/starlight-ui.ts`, `src/components/starlight/ThemeProvider.astro`, `src/components/starlight/ThemeSelect.astro`, `src/lib/i18n/editorial-variants.ts`, `src/content/editorial-translations/en/guides/index.mdx`, `src/content/editorial-translations/en/developers/index.mdx`, `src/content/editorial-translations/en/about/index.mdx`, `scripts/test-locale-starlight-editorial.mjs`; modify `astro.config.mjs`, `src/components/starlight/Header.astro`, `src/pages/guides/[slug].astro`, `src/lib/i18n/messages/documents.ts`.

**Interfaces:** `selectEditorialVariant(documentKey:string,documentLocale:ResolvedLocale):{kind:"reviewed"|"original",locale:ResolvedLocale,moduleKey:string}` uses an explicit compile-time registry, never path interpolation from unchecked input. English authored variants are manually reviewed during this task; no machine translation. Missing reviewed variant renders original with localized language notice. Other existing docs remain allowed original-language content, while all application/Starlight chrome follows global locale.

- [ ] Write Starlight root /about/ and nested live doc fixtures for html lang, shared header, sidebar/TOC/pagination/footer/search chrome, dark-only and doc metadata. No generated /en or /zh routes, no default locale switcher. Request cookie changes affect HTML after build. `?lang` affects body only and missing variant is honestly labelled; raw authored/source titles preserved. Verify registered authored English files are selected and never overwrite original MDX.
- [ ] RED: `node scripts/test-locale-starlight-editorial.mjs` against actual installed Starlight route data/SSR fixture.
- [ ] Set Starlight prerender=false and pagefind=false (installed schema forbids Pagefind with SSR); use existing GlobalSearchBox rather than invent docs-search backend. Register supported routeMiddleware at `src/starlightRouteData.ts`, setting `starlightRoute.lang`/dir and app chrome labels from request context, but preserving `starlightRoute.locale=undefined` as the root URL prefix; keep entryMeta body language honest. Install a repository-owned typed translation adapter from `src/lib/i18n/starlight-ui.ts` on public `Astro.locals.t`, implementing the installed callable/`all()`/`exists()`/`dir()` contract, reviewed symmetric UI keys and named interpolation. The root-only configured translation resources cannot be assumed to supply English; test adapter key coverage against actual rendered chrome. Do not add a fictitious route-data translator field or import private package internals. Override supported ThemeProvider/ThemeSelect component slots: force dark on initial load/navigation without reading/writing theme storage or system preference, render no picker, and preserve any required provider callable contract. Keep expressiveCode github-dark and no Appearance control. If installed integration cannot satisfy same-route locale with these supported interfaces, stop for architecture review rather than adding duplicate routes or private API monkey patches.
- [ ] GREEN: same command; real SSR docs and registry mapping assertions pass. Human reviews new authored editorial variants before task is accepted.
- [ ] Regressions: Task 6/10/16/17 tests, `node scripts/verify-seo.cjs`; diff-check. Canonical/sitemap routes stay unchanged.
- [ ] Stage `git add src/starlightRouteData.ts src/lib/i18n/starlight-ui.ts src/components/starlight/ThemeProvider.astro src/components/starlight/ThemeSelect.astro src/lib/i18n/editorial-variants.ts src/content/editorial-translations/en/guides/index.mdx src/content/editorial-translations/en/developers/index.mdx src/content/editorial-translations/en/about/index.mdx scripts/test-locale-starlight-editorial.mjs astro.config.mjs src/components/starlight/Header.astro src/pages/guides/[slug].astro src/lib/i18n/messages/documents.ts`; inspect staged names, commit `feat(locale): serve same-route localized documentation chrome and reviewed variants`.

## Task 19: End-to-End Persistence, Coverage and Responsive Acceptance

**Files:** Create `scripts/test-global-locale-browser.mjs`, `scripts/test-global-locale-persistence-local.mjs`, `scripts/test-global-locale-coverage.mjs`, `tests/fixtures/locale-ui-coverage.json`; modify `tests/visual/locale-settings-harness/main.tsx`, `tests/visual/locale-settings-harness/vite.config.ts`.

**Interfaces:** Coverage manifest lists every source file enumerated in Tasks 10-18, owned namespace, visible state cases and classified UGC/editorial/source-title exceptions. Browser test loads actual SSR/islands in local Workers-compatible fixture, screenshots named by case/locale/viewport; persistence integration uses Task 4's disposable local Supabase, never Production. Do not make regex string scans the sole language test.

- [ ] Write assertions for anonymous cookie full reload/navigation, signed-in cookie+row reload, account adoption across login, retained explicit browser choice on logout, A->B switch, stale response/cross-tab events, Auto on CN/non-CN and unavailable-country language fallback. Cover blocked storage/API outage/conflict, explicit selection immediately updates control then coherent full-page locale. Screenshot first hydrated frame with hostile localStorage, HTML lang/islands/catalog parity and console warnings. Cover desktop Chromium/Firefox and 390/430 Chromium (second-engine key mobile flows where supported), populated/empty/loading/error/long English labels, keyboard/safe-next and dark-only with both OS color preferences.
- [ ] RED: `node scripts/test-global-locale-coverage.mjs`, `node scripts/test-global-locale-browser.mjs`, `node scripts/test-global-locale-persistence-local.mjs`; distinguish real behavior failures from missing local engine/runtime. Missing browser/local Auth blocks corresponding acceptance, not PASS.
- [ ] Complete coverage fixtures, minimum focused corrections in their owning runtime files only if a demonstrated test fails; such corrections require the owning task's regression suite and a separate scoped commit before this test-only commit. Never alter accepted Auth/CAPTCHA/provider semantics to satisfy locale tests.
- [ ] GREEN: same commands; inspect screenshots, actual control interactions, no overflow/text overlap at 390/430/desktop, all UI-owned strings in selected language and external browser request count0. Cookie HTTPS attributes tested directly; local HTTPS fixture uses an owned test certificate/loopback origin, never disables cookie security in product code.
- [ ] Regressions: all deterministic locale tests, `npm run test:auth-email-abuse-ux`, `node scripts/test-auth-email-abuse-ux.mjs --final-fix`, `node scripts/test-runtime-consent-frontend.mjs`, `npm run test:auth-redirect-safety`; diff-check. No fresh Production signup/resend/recovery/content requested.
- [ ] Stage `git add scripts/test-global-locale-browser.mjs scripts/test-global-locale-persistence-local.mjs scripts/test-global-locale-coverage.mjs tests/fixtures/locale-ui-coverage.json tests/visual/locale-settings-harness/main.tsx tests/visual/locale-settings-harness/vite.config.ts`; commit `test(locale): prove persistence hydration and responsive coverage`.

## Task 20: QA Registration, Release Gates and Handoff

**Files:** Modify `package.json`, `scripts/qa/manifest.mjs`, `scripts/qa/profiles/release.mjs`, `scripts/qa/test-qa-harness-manifest.mjs`, `scripts/qa/test-qa-harness-profiles.mjs`; create `scripts/test-global-locale-settings-contract.mjs`, `docs/ops/global-locale-settings-v1-acceptance.md`.

**Interfaces:** `test:global-locale-contract`, `test:global-locale-browser`, `test:global-locale-persistence-local` scripts. Deterministic release check `global-locale-settings-contract` runs strict contract/coverage/schema/API/cookie/resolver checks without DB/browser build side effects. Browser locale acceptance and genuine RLS/persistence acceptance remain independently recorded gates, not silently omitted or simulated by the contract aggregate.

- [ ] Write QA manifest mapping tests for middleware/env/i18n/Settings/preference API/Starlight paths, deterministic selection, exact command argv, LOCAL retries0, no DB replay/provider/deploy in RELEASE, no allowed-to-fail. Preserve all existing timeouts including Slice A180000/search90000; measure the new deterministic check under existing90000, split named checks if legitimately needed before freeze rather than inflate global budgets. Receipt must link actual SHA and distinct deterministic/browser/RLS outcomes.
- [ ] RED: `node --test scripts/qa/test-qa-harness-manifest.mjs scripts/qa/test-qa-harness-profiles.mjs`; expected missing selection/registration assertions fail.
- [ ] Register narrow checks and add package scripts without dependency/lock churn. Operations doc lists exact acceptance cases/rollback/gates, not executable Production SQL. Include cache/static-to-SSR resource impact measurement in staging; no capacity certification.
- [ ] GREEN: same QA tests plus `node scripts/test-global-locale-settings-contract.mjs`; no missing owning path/check.
- [ ] Regressions: inspect every command for external activity, then credential-stripped local `npm test`, `npm run build`, `npm run test:workers-config`, `npm run test:workers-env-contract`, `npm run test:workers-artifact`, `npm run test:product-recovery-slice-a`, and one bounded `npm run qa:release`. Save truthful receipts; zero retries, no inherited search waiver. Run Task 19 browser and local RLS/persistence separately with owned target proofs. Independent whole-branch review must find no unresolved blocking issue. Any failure blocks release and requires a separately reviewed fix; do not silently rerun to replace FAIL.
- [ ] Stage `git add package.json scripts/qa/manifest.mjs scripts/qa/profiles/release.mjs scripts/qa/test-qa-harness-manifest.mjs scripts/qa/test-qa-harness-profiles.mjs scripts/test-global-locale-settings-contract.mjs docs/ops/global-locale-settings-v1-acceptance.md`; commit `test(qa): gate Global Locale and Settings v1 release`.

## Migration, Rollout and Rollback: Human Gates, Not Automatic Tasks

1. Human reviews this plan and selects execution method. Implementation creates the additive schema/tests locally first. No Production SQL/provider operation is implied by this document or `continue` during planning.
2. Implementation PR review includes genuine local A/B/anon RLS, browser persistence, first-frame/UI coverage, unchanged Slice A regressions, release receipt and no unresolved P0/P1. Report P2 with explicit owner/acceptance, not a generic waiver.
3. Separate operator authorization applies only the exact reviewed additive user_preferences migration to the intended target after local replay/grants/RLS verification. No service-role browser access, no remote test-runner, no `db push` shortcut, no schema fixture/history rewrite. Record installed table/policies/grants/revision behavior without credential values. A missing/deviating prerequisite blocks account-persistence release even though browser fallback works.
4. Separate merge/deploy authorization pins reviewed head/main, current known-good Worker/config and rollback owner. Supabase CAPTCHA remains ON and AUTH_CAPTCHA_MODE=required throughout Slice B; previous known-good Worker must be a required/token-capable artifact. Do not revert to older off/prepare code to fix locale. Do not modify the server-only rate-limit secret that human repaired after Slice A.
5. Preview must remain Auth off/no Auth sitekey per existing non-main contract and use local/test preferences data only; no Production Auth/email/content acceptance by implication. Staging verifies private/no-store localized HTML, unchanged immutable assets and resource/caching impact of SSR.
6. After separately authorized deployment, bounded human locale acceptance checks Auto CN with English browser, known non-CN with Chinese browser, unavailable country fallback using controlled staging evidence, manual zh/en, anonymous/signed-in reload and account sync, Settings/header/no Appearance, one-language app states, docs-only override, 390/430 and dark-only. Use existing owned users and narrow approved preference writes; no repeat real-email flows merely for locale smoke.
7. Critical locale/RLS/Auth regression stops rollout. App rollback uses separately approved preceding required-mode Worker; additive table remains, no data drop/consent record removal. RLS exposure requires a separately approved narrow access revocation after impact evidence; no invented Production SQL. Country/cookie preference is never an identity or security fallback.

## Requirement-to-Task Self-Review

| Requirement / edge case | Owning tasks and proof |
| --- | --- |
| Exact precedence, manual zh non-CN/manual en CN, saved wins, Auto CN/non-CN | 1-3 resolver/cookie fixtures; 19 browser/persistence |
| Country unavailable zh/en header, malformed/unsupported/q/oversize, spoof headers | 2 detection matrix; 6 request fixtures |
| Country not persisted/exposed; identity separate | 2-5 schemas/serialized keys/API/RLS assertions |
| Anonymous cookie, account row/revision, login sync/logout/switched-account races | 3-5, 8-9, 19; no SSR Auth lookup |
| SSR HTML/island language, hostile localStorage, no hydration flash, immediate choice | 6-10, 19 snapshots/screenshots/events |
| /settings/ anonymous General/account sign-in; all supported account/privacy/notification links | 9-10 supported-route/DOM assertions |
| Settings between Notifications/account, localized icons/tooltip, no overflow | 10, 19 keyboard/390/430/desktop |
| Shell/home/Auth/catalog/community/search/news/notifications/errors/admin UI coverage | 10-16, 19 per-file coverage and state fixtures |
| Reviewed legal/editorial variants, no machine translation, document-only override | 16-18; cookie/account unchanged and original-body integrity |
| Same route tree, active docs SSR, no false hreflang, immutable assets preserved | 6, 18 manifest/route-data fixtures and 19 |
| No Appearance/light/system/theme/channel/deletion implementation, dark tokens intact | 9, 18-19 absence and OS-color-scheme fixtures |
| Slice A safe-next/required Turnstile/cooldown/identity/no runtime consent remain | 8, 11, 19-20 local regressions, no new provider/Production Auth tests |
| Slice C/P9/session redesign/policy rewrite excluded | Global constraints, Tasks 14/16-18 scoped projections, release/human gates |
| Local/test-first schema, owner RLS, no Production application by plan approval | 4-5, rollout gates, separate local receipts |

Twenty tasks are deliberately reviewer-meaningful rather than mechanically following A-O: schema and API split for RLS review; community reading/actions split to keep behavior reviewable; admin, legal and Starlight/editorial each own distinct trust/coverage contracts. Task 19 is acceptance coverage, not a new feature. Task 20 owns release selection rather than hiding a DB/browser run inside an aggregate.

Self-review requires all tasks to preserve these interface names/types, explicit staged paths, actual RED assertion failures, focused GREEN and truthful local vs Production evidence. No task grants implementation/merge/Production access merely by being written here.

## References and Evidence Limits

- Current repository source and lockfile at base main are the planning authority. The old September spec's source inventory is historical, not a claim of current deployed behavior.
- [Astro middleware](https://docs.astro.build/en/guides/middleware/): request locals and build-time versus on-demand execution; installed Astro integration APIs must be fixture-tested in Tasks 6/18.
- [Cloudflare Request](https://developers.cloudflare.com/workers/runtime-apis/request/): runtime cf metadata, not untrusted country headers; Task 2 adapter tests define unavailable handling.
- [Starlight route data](https://starlight.astro.build/guides/route-data/): supported route-data customization. Installed 0.41.3 source confirms routeMiddleware/prerender options and Pagefind incompatibility with prerender=false.
- Supabase changelog markdown fetch did not return usable content during planning. No claim that a failed fetch proves API compatibility. Existing actor bearer/RLS conventions are retained; before implementing Task 4/5, verify current official RLS/Data API/CLI behavior and the installed CLI's migration command help without contacting a project/provider account.

## Human Review Boundary

Review this implementation plan before any runtime/schema/config execution. Recommended execution: subagent-driven, because resolver/hydration/session/RLS boundaries span many consumer surfaces and deserve fresh task reviews. Native execution is also possible if explicitly selected, with a fresh whole-branch reviewer before merge. Neither method is selected or started by this planning task.
