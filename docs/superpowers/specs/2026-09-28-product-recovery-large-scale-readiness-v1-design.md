# Product Recovery and Large-Scale Readiness v1 Design

Date: 2026-09-28. Status: architecture approved with the required human amendments incorporated; Slice A planning authorized, not implementation authorization.

## 1. Context

OpenGlass Hub is in Open Beta at `https://openglasshub.ogh.workers.dev`. The approved intent is to make the promised account, community, product-research, and localized website experience coherent and genuinely verified. This is recovery of the existing product, not a framework replacement or roadmap expansion.

This specification is based on freshly fetched `origin/main` at `54ac72f8263bdefcf1b2ca247913b09b484cfbb1`. It was authored in an isolated worktree. Only this document changes. No Production request, configuration mutation, SQL, email send, deployment, P9 execution, or resumed authenticated QA is authorized by this design task. Public vendor documentation was consulted; no project/provider account was inspected.

The human approved three sequential slices: A account lifecycle; B global locale and Settings; C real product details and UX/security closure. The human review authorizes Slice A planning only after these required amendments pass self-review. Each slice needs its own approved implementation plan, isolated branch, review, merge/deployment authorization, and fresh acceptance receipt before the next slice ships. No release or readiness result is claimed here.

## 2. Confirmed Current-State Evidence

Classification describes merged source, not Production success. `MERGED_MAIN_PARTIAL` means relevant code exists but does not satisfy the requested behavior; missing operational evidence is recorded separately. Paths below are relative to this pinned repository. Remote refs were refreshed with `git fetch origin --prune` on 2026-09-28.

| Feature | Current classification | Source evidence and gap |
| --- | --- | --- |
| GLOBAL_IP_LOCALE | NOT_FOUND | No `CF-IPCountry`, `Accept-Language`, or global locale resolution in `src`; remote source-content search found no such resolver. |
| GLOBAL_I18N | MERGED_MAIN_PARTIAL | `astro.config.mjs` has Starlight root `zh-CN`; `CommunityLayout.astro:43,55` fixes HTML/OG locale to Chinese. Not a global two-locale system. |
| SETTINGS | NOT_FOUND | No Settings route, shared settings store/API, or header entry in main or refreshed remote trees searched. |
| LANGUAGE_SETTING | NOT_FOUND | No account/browser language preference control or persistence. |
| THEME_SETTING | NOT_FOUND | Fixed dark CSS and theme metadata exist, not a user preference or complete light palette. |
| DEFAULT_PROFILE_IDENTITY | MERGED_MAIN_PARTIAL | `HeaderUserMenu.tsx:283-288,318-332,389-412` computes a fallback but suppresses name/initial until summary is ready. Summary has no client deadline. |
| LEGAL_CONSENT_GATE | MERGED_MAIN_PARTIAL | `LegalConsentPage.tsx:49-51,97` loads `current` then renders a success page; gate/callback/API enforcement and versioned persistence already exist. |
| EMAIL_VERIFICATION | MERGED_MAIN_IMPLEMENTED | `AuthPanel.tsx:178-188` calls Supabase signup; `AuthCallback.tsx:40-85` exchanges code or observes session. Actual arrival/callback acceptance is not proven by source. |
| EMAIL_RESEND | MERGED_MAIN_IMPLEMENTED | `api/auth/resend-confirmation.ts` implements generic response, hashed-IP limiter (5/24h), and Supabase resend. It ignores returned provider error objects and masks thrown send errors. Delivery is unverified. |
| PASSWORD_RECOVERY | MERGED_MAIN_IMPLEMENTED | `AuthPanel.tsx:269` requests reset; `ResetPasswordForm.tsx` exchanges recovery code and updates password. Real recovery email and old/new-password behavior are unverified. |
| PRODUCT_DETAIL | MERGED_MAIN_PARTIAL | `[brand].astro:109,253` links to its own product anchor; `devices/[slug].astro:15` redirects there. No `/products/[brand]/[slug]/` route. |
| COMPARE | MERGED_MAIN_IMPLEMENTED | Product index and brand-page comparison exist. They use string values; Schema v1 typed/context-aware comparison is not implemented and is not promised by this slice. |
| SEARCH | MERGED_MAIN_PARTIAL | `GlobalSearchBox.tsx:63-66,138-142` requests posts only; full search defaults to all. `forum-search.ts:486` emits brand-anchor device URLs. |
| MOBILE_NAV | MERGED_MAIN_PARTIAL | `SiteHeader.astro` has a toggle script, but toggle CSS remains hidden and nav uses hidden-scrollbar horizontal overflow. Prior 390/430 screenshots show clipped destinations. |

Additional evidence:

- `api/users/me/summary.ts:55-61` collapses profile read errors and absence into null; `:127-142` couples profile, avatar, post counts, and comment-like counts, returning 404/500 on failure. It authenticates the bearer with `getUser`, uses actor-scoped anon-key clients/RLS, and responds `no-store`; preserve these boundaries.
- `supabase/migrations/20260518_forum_phase1_schema.sql:179-200` has a signup profile trigger using metadata or email local-part. Its existence in main does not prove the deployed trigger, grants, RLS, or timing for a new account.
- `AuthPanel.tsx:419-443` duplicates Chinese/English age/consent text. `CommunityLayout.astro:82-88` brands the footer with minimumAge and renders both legal link languages. `legal-policy.ts` defines minimumAge=16 and policy bundle `2026-07`.
- `public-device-data.ts` selects legacy published `devices` columns, including `full_specs`, and maps strings. Schema v1 foundation is present in `20260909195640_device_schema_v1_foundation.sql`; structured tables have catalog-admin policies, not a public reader.
- `products/index.astro:194,293-305` and `products/[brand].astro:279` contain raw JSON script/HTML sinks. Privileged catalog ingress limits exposure but does not make strings safe markup.
- `public/_headers` specifies nosniff/anti-framing/referrer/permissions rules. Prior beta audit observed their absence on dynamic HTML. This design verifies the source distinction, not fresh deployed headers.
- Prior audit reports, carried as historical evidence rather than new tests here: public desktop browsing and anonymous guards passed; mobile navigation and quick-search mismatch reproduced; authenticated acceptance remained partial. The human now additionally reports missed verification/recovery mail and post-login friction. Those observations require new controlled reproduction during Slice A.

### Historical and Branch Audit

`divergence` is commits only in main / only in branch, from `git rev-list --left-right --count origin/main...ref`. A branch name is not evidence that its work is missing from main.

| Ref / inspected tip | Divergence | Disposition |
| --- | --- | --- |
| `origin/feature/account-security-email-verification-v1` / `16eb1a8bcd6da73fb76325aa545362250dc00eb5` | 214 / 2 | UNMERGED_BRANCH_ONLY: alternate verification challenge/application-session system plus age-policy changes. Reuse only test ideas and generic response principles after review; no merge/cherry-pick of its session architecture, policy removal, or migrations. |
| `origin/feature/legal-consent-forward-only-repair-v1` / `4549031f24206dc5a3c240c079576fd2433e31d6` | 227 / 2 | UNMERGED_BRANCH_ONLY: reconciliation proposals/runbooks, not a solved frontend interstitial. Use as diagnostic history only if deployed trigger evidence demands it; do not execute its SQL. |
| `origin/feature/authenticated-header-qa-polish-v1` / `21d9c529153f0b7807e2e508e7e9085b33760df9` | 416 / 0 | Already ancestor of main; UI ideas are already inherited. Does not provide a global Settings/i18n subsystem. |
| `origin/feature/search-experience-upgrade` / `00d2c64d266906f8786b327a91dc265a1ec6bfc2` | 501 / 0 | Already ancestor. Full search survived; posts-only quick preview remains. |
| `origin/feature/device-library-mvp-v1` / `b1c34468147784c19e16a4e659f1bf70c8a27fda` | 470 / 0 | Historical real `/devices/[slug]` UI exists, with local-data and old Pages-origin assumptions. Superseded by database cutover (`e6f8f762`) and redirect behavior. Reuse information hierarchy, not stale data or canonical URLs. |
| `origin/feature/product-page-refinement-comparison-v1` / `9e60a38a04067ee6005deb89c8be87bce7816331` | 463 / 2 | UNMERGED_BRANCH_ONLY divergent older catalog/SEO refinement; do not merge. Current main comparison is a separate surviving implementation. |
| `origin/feature/products-mobile-header-polish-v1b` / `89b49075818426bbdf13f39d341c09dd6f3003c0` | 419 / 0 | Already ancestor; no proof of present mobile acceptance. |
| `origin/feature/database-schema-v1` / `09b2d18a65160c8c9d1d407bd06e7f8dcb6c18f2` | 5 / 0 | Foundation is in main. Structured public-reader/detail ambitions in the 2026-09-09 design are DOCUMENTED_ONLY, not the current public runtime. |

Search covered refreshed remote `src` tree names and content for locale/preferences, relevant commit subjects, known settings/locale paths across all local history, and targeted branch diffs. No removed remote or unavailable private branch is claimed inspected. There is no evidence that global Settings/i18n was previously merged then removed. The precise historical reason an earlier request was not delivered cannot be inferred from Git; current missing behavior and superseded detail routing can be demonstrated.

## 3. User-Visible Problems

Users encounter a redundant consent success stop, blank signed-in identity, potentially undelivered account emails presented too confidently, dense bilingual registration, repeated age branding, mixed-language UI, no useful Settings entry, product links that land on the same card, hidden mobile navigation, misleading search emptiness, and conditional catalog HTML execution risk. An engineering green build is insufficient to resolve any of these human outcomes.

## 4. Root-Cause Summary

Consent rendering treats an already-current state as a terminal UI instead of navigation. Identity presentation incorrectly depends on optional enrichment completion. Summary conflates missing profile, inaccessible profile, and aggregation failure. Email request acceptance is confused with transport/delivery success, with insufficient correlated operational evidence. Localization consists of hard-coded strings and documentation locale rather than a request-wide context. Product detail identity is conflated with brand-page anchors. Mobile CSS favors hidden scrolling; quick search narrows scope without communicating it. Dynamic/static header ownership is split, and catalog strings enter raw markup sinks.

Email root cause is explicitly UNKNOWN: SMTP settings, sender DNS, Supabase logs, Brevo events, suppression, and recipient disposition have not been inspected in this task. A new user's summary root cause is also UNKNOWN until staged timings and deployed profile/RLS evidence are collected; the indefinite blank fallback is independently source-confirmed.

## 5. Goals

Deliver real recoverable account lifecycle, immediate safe identity, preserved legal enforcement, one selected UI language, functional Settings, truthful product detail pages, discoverable mobile navigation, consistent search, and closure of high-risk security checks. Keep Astro 5, React islands, Supabase Auth/Postgres/RLS, Workers/R2, the community-first shell, and restrained dark-glass visual identity. Release only with fresh evidence and zero confirmed unresolved P0/P1.

## 6. Non-Goals

No P9, Verified Session v1, alternate application-session system, operator-tool rewrite, database rearchitecture, custom domain migration, large SEO program, new catalog expansion, monetization, Compare v2 ranking, runtime machine translation, new frontend framework, or redesign. A sender-owned authenticated mail domain is an email-delivery dependency, not permission to migrate the site's canonical domain. No legal-age policy change or automatic claim of legal compliance.

## 7. Architecture

Keep one canonical route tree. Astro request middleware resolves a sanitized locale context into `Astro.locals`; layouts pass that exact context to islands. Product Recovery v1 stays Dark-only with the existing restrained dark-glass presentation. Browser Supabase sessions remain the current auth transport; the public SSR client remains anonymous. Middleware does not pretend localStorage auth is an SSR user session. Actor-private locale preferences and identity load through existing bearer-authenticated API conventions.

Boundaries: locale resolver (preference/detection only), typed message catalog (UI copy), preference service (own settings only), identity presenter (non-authoritative fallback), consent gate (versioned legal state), published product reader (public-safe projection), canonical route helper (identity-to-URL), and controlled acceptance evidence. None decides authorization from locale, metadata display names, cookies, or country.

### Alternatives and Decisions

| Decision | Viable alternatives | Choice / reason |
| --- | --- | --- |
| Locale persistence | Browser-only localStorage; cookie-only device preference; cookie plus own account row | Cookie plus own account row. SSR sees device choice, login can synchronize account choice without auth-token cookies or slow public SSR profile calls. localStorage is only a redundant mirror, never the first hydration source. |
| Locale detection | Trusted country before Accept-Language; weighted Accept-Language before country; client navigator detection only | Explicit/current choice, saved manual choice, trusted country, Accept-Language only if country unavailable, then English. CN auto resolves zh-CN and known non-CN auto resolves en regardless of browser language; manual preference always wins. This follows the amended human decision; client-only detection causes mismatch. |
| Settings storage | Auth metadata; extra profile columns; small owner-only preference table | Separate `user_preferences` row with RLS and narrow API, avoiding profile role/identity update coupling and metadata trust. Only locale preference plus revision metadata in v1, not arbitrary settings JSON or theme state. |
| Detail routing | Restore `/devices/{slug}/`; nested `/products/{brand}/{slug}/`; brand-anchor overlay | Nested canonical route. Fits brand browsing, independent metadata and direct links; devices URLs redirect. Overlay does not repair direct-link/detail semantics. |
| Email diagnosis | Infer from app success; correlated operator log/inbox packet; new webhook/hook pipeline | Correlated operator packet first. Retains SMTP and avoids a new sensitive ingress/service until proven necessary. New mail hook is excluded from v1 absent separate justified approval. |
| Translation | Duplicate zh/en route trees; runtime translation; typed dictionaries and localized editorial fields | Shared typed dictionaries plus reviewed authored content. Same route, deterministic SSR/island copy, no translation service or duplicated route ownership. |

## 8. Slice A Detailed Design

Account correctness ships independently of the global locale rollout. A defines and uses a small typed auth/legal message interface with zh-CN/en entries; the initial locale follows the existing Chinese shell, with English previews tested locally. B supplies global resolution. A does not introduce a competing locale detector or promise global-English completion.

Consent already current: replace navigation immediately to sanitized destination, with only bounded checking status; no success interstitial. Missing/outdated consent: show the real confirmation form; record the current bundle through existing service; replace after success. Errors stay actionable and closed for protected mutations. Account enrichment starts with visible auth-derived identity, never blank labels. Summary becomes profile-first with optional stats/avatar failure isolated and safe diagnostics.

Signup/resend/recovery remain Supabase Auth email flows, with neutral public status and measured SMTP/provider/inbox evidence. Local cooldown supplements, not replaces, server/provider limits. Password reset uses the actual recovery link/session, new password validity, and one controlled old-password rejection. Recovery is exempt from consent gating so a broken/expired account can recover. Existing safe-next and origin validation stay mandatory.

Registration has one concise consent sentence, real links, one required checkbox, and a separate compact age eligibility confirmation where needed to preserve the current acknowledgement contract. Remove age advertising from ordinary branding; do not erase the age attestation from records or policies. Preserve substantive legal meaning and existing versions/enforcement. External review status is reported separately, not an unconditional engineering release prerequisite. A's auth tests include fresh/legacy profiles and both complete/current and outdated policy bundles.

## 9. Slice B Detailed Design

Introduce request-wide locale context, complete dictionaries, `/settings/`, and header Settings icon between Notifications and account identity. Anonymous users can change language; signed-in users additionally access profile/security/logout/deletion information entries. Account sections clearly ask anonymous users to sign in without hiding general Settings.

One-language rendering covers shared shell, home, auth, consent, products, community, search, notifications, loading/errors, admin UI labels, support/legal navigation, and active documentation wrappers. User-written posts/names/source titles are not translated. Legal/editorial bodies are selected from reviewed language variants, not machine-translated. A link can open the other legal language on the same route using a validated document-language query; this affects that document only, not saved UI preference.

Settings v1 has General (Auto / 简体中文 / English), Account (Profile / Edit profile / Password-security / Logout / Account deletion information), Notifications (existing supported navigation/read behavior only), and Privacy & Safety (Privacy / Terms / Guidelines / Safety-reporting / Deletion information). There is no Appearance section, System preference, Light mode, light-compatible token conversion, or appearance persistence/release gate. Theme customization is a future independent project; retain Dark-only presentation without fake controls.

Notifications exposes only notification-center access and supported read/unread operations. No channel/email/push preference toggles until backend behavior exists. Privacy & Safety supplies localized legal/reporting/deletion links. Account deletion remains the existing information/support workflow; do not invent instant irreversible deletion.

## 10. Slice C Detailed Design

Add published-device SSR detail at `/products/{brand}/{slug}/`, update cards/search/compare links and legacy redirects, and render Schema v1 groups and honest absent-data states. Keep brand listing and existing compare selection; no numerical winner ranking. Mobile navigation becomes explicit rather than horizontally clipped. Global quick search uses the same scope as full search. Worker dynamic headers and safe text/JSON rendering close the known security issues.

Structured read authorization is an explicit additive change within this slice, not a bulk import or P9 dependency. No direct raw-table/service-role exposure. Definition completeness or structured-row absence does not block a real page: published legacy values may appear as labeled legacy, unverified facts; no source/confidence is invented. Schema-shaped unknown fields render honestly. Structured verified data takes precedence; conflicts remain visible, not silently overridden by strings.

## 11. Data/State Model

`LocalePreference = auto | zh-CN | en`; `ResolvedLocale = zh-CN | en`. Browser record schema version=1 stores locale preference, a choice generation, and provenance (`device_explicit` or `account_adopted`); not theme state, user identifiers, emails, bearer tokens, country, or inferred demographics. Provenance only controls synchronization/cleanup and is untrusted, never an authorization claim. A host-only secure preference cookie is a preference, not trusted identity.

`user_preferences`: user_id primary key referencing the account, locale_preference default auto, revision integer, updated_at. Own-row SELECT/INSERT/UPDATE only (`auth.uid() = user_id` in both update predicates); no anon read, appearance state or role/public-profile fields. Deletion follows authorized account lifecycle; no new destructive account endpoint. Updates derive user ID server-side, accept only locale preference and expected revision, reject unknown properties and invalid revision, respond no-store. No service-role shortcut.

`IdentityView`: display label, initial, avatar resolved URL or null, enrichment status. `ConsentView`: checking/current/required/expired/error/redirecting; current is not a display-success terminal state. `EmailAttemptEvidence`: QA case label, flow, UTC request/response times, normalized status, operator correlation IDs, recipient-provider label, transport events, inbox receipt and callback result; never link/code/password or raw email body.

`ProductDetailView`: published identity, schema type/presentation profile, status/category, safe media, localized field labels, typed spec states/value/unit/context, optional evidence and official links, canonical route. It is independent of internal audit events, updater identity, notes, credentials, and raw admin curation.

## 12. Locale Resolution Algorithm

Resolution is deterministic on each SSR request:

1. A validated current explicit Settings change overrides other sources. It is written to the device cookie before full-page navigation. `auto` is a mode, not a Chinese/English lock.
2. Use the saved browser preference. Once the authenticated client loads its own account preference, use the account value only if no device-explicit choice exists for this login lifecycle. A new explicit choice on this device wins; a stale account fetch may not overwrite it. Signed-in changes persist to both device and account. Anonymous explicit choice is retained on login and not silently uploaded to the account until the user saves Settings.
3. If the chosen mode is explicit zh-CN/en, return it without checking country. If auto (or no saved preference), use trusted Cloudflare Worker request country metadata: CN -> zh-CN; known non-CN -> en. Validate a known country code; unavailable/unknown sentinel values are not known non-CN. Never trust a client-supplied country header in local/direct-origin tests.
4. Only when trusted country is missing/unavailable, parse Accept-Language by descending q weight, skip q=0, support zh/zh-CN/zh-Hans as zh-CN and en variants as en. Unsupported tags including zh-Hant continue to the next supported candidate. Malformed or oversized headers are ignored; cap parsing at 20 tags/2048 bytes.
5. If country is unavailable and no supported Accept-Language candidate exists, return en safe default.

Final precedence is current explicit choice > saved manual user/browser choice > trusted country > supported Accept-Language only when country unavailable > en. An English-language browser in CN using Auto resolves zh-CN; a Chinese-language browser in a known non-CN country using Auto resolves en. Explicit or saved English in CN remains English, and explicit or saved Chinese outside CN remains Chinese. IP never overrides manual selection. Wildcard Accept-Language does not force Chinese. Selecting Auto removes a language lock but retains the auto mode. Inferred country is never persisted or exposed to UI islands.

Cookie: `ogh_preferences_v1`, Path=/, Secure, SameSite=Lax, host-only, 180-day maximum age, small bounded locale-preference record with provenance/generation only. No theme or inferred country is stored. It is not HttpOnly because it contains nonsensitive preference values and supports immediate same-tab UI setting; treat it as untrusted input. localStorage may mirror only after cookie success; SSR never reads it. Storage-denied clients keep in-memory choice and show an honest nonpersistent status. No arbitrary query parameter can change preference; only explicit Settings interaction persists it.

Middleware passes resolved locale and reason, not raw country/IP, to layout/islands. First hydration uses the server value exactly. Account adoption triggers one intentional localized reload, not divergent island rerender or locale oscillation. HTML lang and dictionary locale match; OG is zh_CN/en_US. Same canonical URL regardless of preference; no false hreflang alternates for identical URLs. Personalized/locale-varying HTML uses private/no-store in v1 to prevent CDN bleed. Immutable JS/media caching remains unchanged. Prerendered normal UI requiring detection becomes SSR; documentation serving must also select reviewed locale rather than leave a hard-coded alternate shell.

## 13. Settings Persistence Model

Use `/settings/` for a semantic, keyboard-accessible page in the shared shell, not a fake popover. General language is available without login. The general Settings route is consent-exempt so language, legal links and recovery are reachable; account/profile/content actions retain their existing authentication and consent guards. Saving nonsensitive own locale preference is permitted while consent is pending, without granting community-write access. Preserve Notifications -> Settings -> Account ordering; icon-only Settings has a localized accessible name and tooltip. Account identity can compact to avatar on mobile without losing accessible label.

SSR and islands retain the existing Dark-only styling on every OS appearance setting. No appearance control, theme cookie, account appearance field, or light-token work is part of v1. The same server locale context keeps language controls consistent; no preference-dependent public cache entry is introduced.

On a signed-in save, update device state immediately, then own-row API with expected revision. Confirm account persistence only after success; on failure retain local choice and show 'saved on this device; account sync failed' with retry. Conflict reloads the latest row for explicit user reconciliation, not silent last-write wins. A generation counter prevents a prior read from overwriting a newer local selection. Logout clears in-memory account state and adopted account cookie (reset auto); device-explicit nonsensitive choices may remain. Never leak previous user's profile or account preferences into the next login.

No preference read is required for the auth session to become usable. Missing row means defaults, not profile failure. Database outage leaves browser choice functional. Cookie payload tampering is normalized to defaults and never affects permissions. Same-tab and cross-tab changes use one shared preference event; each island receives the same selected locale.

## 14. Auth/Consent Behavior

| State | Required behavior |
| --- | --- |
| Current policy with valid session | Replace to safe destination; do not render success/Continue page. |
| Required/outdated policy | One localized confirmation form, unchecked by default; record actual bundle/source only after acceptance. |
| Explicit policy-update request but already current | Redirect; reason/query alone cannot force another consent record. |
| Consent service failure | Show retry/logout; block protected actions, no fabricated current state. |
| Expired auth | Localized login entry preserving safe destination; no recursion through consent. |
| Recovery / callback processing | Recovery stays reachable; callback waits for real Supabase session, validates next, then gate. |

Prevent loops by rejecting consent/login/callback self-destinations where they recur; fall back to `/feed/`. Navigation uses replace to avoid back-button success loops. On current state there is no write. On required state the API retains existing bundle-version, actor, age-confirmation, rate-limit, and idempotency rules. Recheck on a changed user/session or policy bundle, not every redundant rerender. UI gating is never the only authorization boundary.

Chinese sentence: '我已阅读并同意《服务条款》和《社区准则》，并知悉《隐私政策》。' English: 'I have read and agree to the Terms of Service and Community Guidelines, and acknowledge the Privacy Policy.' Each link opens the actual policy. A separate concise eligibility checkbox ('I meet the minimum-age requirement stated in the Terms') preserves age attestation without repeating 16+ branding. Policy pages retain the exact minimum age and legal meaning; record ageConfirmed only from actual eligibility acceptance. Bundle versions/semantics, rights/obligations, data-use purposes and legal enforcement are unchanged by presentation/localization.

`LEGAL_EXTERNAL_REVIEW_STATUS = CONFIRMED | NOT_CONFIRMED | REQUIRED_FOR_POLICY_CHANGE`. Current external review is NOT_CONFIRMED because this task has no reviewer attestation; this is not an engineering failure. Report it separately from A/B/C completion and authenticated functional acceptance. Never claim legal compliance or lawyer approval. If a proposed implementation changes substantive policy or legal meaning, stop that specific change and report REQUIRED_FOR_POLICY_CHANGE; do not silently change minimumAge, consent semantics or policy versions. Continue unaffected engineering work preserving existing policy.

Never store passwords/callback links in logs, artifacts, source, or chat. Callback URL secrets are removed from history after successful exchange; error copy uses mapped codes, not provider raw text. Invalid/expired/reused link tests are bounded to owned QA users. Password changes and binding Terms acceptance use required human handoff where browser policy demands it; gate waits for completion evidence.

## 15. Email Deliverability Observability

Retain browser/application -> Supabase Auth -> configured SMTP -> Brevo -> recipient provider. Do not replace email verification with a custom challenge to evade a delivery failure. Before remediation, the operator gathers an approved, redacted settings inventory: custom SMTP enabled, SMTP credential type validity (not secret values), sender/domain ownership, From alignment, reply/contact, Supabase Site URL and redirect allowlist, email templates, confirmation mode, rate limits, and Brevo sender/suppression status.

For signup, resend, and reset separately, create one controlled QA case per recipient provider with exact UTC request/response and mailbox-check windows. Match Supabase Auth request/log to Brevo message ID where available. SMTP may not propagate a browser request ID: join by owned recipient, flow/template, and narrow time interval; ambiguous matches remain UNKNOWN. Never infer event time from a probe ID or manual-action recollection.

Normalized evidence states: REQUEST_ACCEPTED, AUTH_REJECTED, SMTP_ACCEPTED, SENT, DELIVERED, DEFERRED, SOFT_BOUNCED, HARD_BOUNCED, BLOCKED, SUPPRESSED, UNKNOWN. Preserve raw event category and UTC time privately without payload/body/link. DELIVERED means provider transport evidence, not inbox visibility; add independent INBOX_RECEIVED and SPAM_RECEIVED. Opening/click telemetry does not prove a human completed verification. A final callback/session check proves functional receipt.

Operator validates SPF, DKIM, DMARC and identifier alignment for the actual sender domain using public DNS and received Authentication-Results. A public-mailbox From identity without controlled domain authentication is a remediation dependency, not a reason to spoof Gmail. Use one approved sender-domain configuration change with before/after evidence and rollback details if needed. No site custom-domain migration is required.

Primary owned Gmail is mandatory for all three flows. Include a second major provider, preferably Outlook, when an owned inbox can be supplied. QQ/163 are additional checks where owned access exists; unavailable inboxes are a separately reported provider-coverage limitation, not an automatic Slice A engineering failure. EMAIL_DELIVERY must state the tested provider scope, never imply universal delivery; missing primary Gmail receipt still blocks Slice A functional PASS. Request budget: one send per flow/provider, at most one deliberate resend/retry after cooldown/operator diagnosis; never loop on absence. Stop on throttling, suppression, or bounce, and do not raise limits as a diagnostic shortcut. Observe for 15 minutes, recording late arrivals independently; absence is NOT_RECEIVED_WITHIN_WINDOW, not an invented bounce.

Public reset/resend responses remain enumeration-resistant: same generic success for known/unknown/suppressed accounts; validation, infrastructure failure, and rate-limit errors may be generic, never reveal existence. UI says 'If the address can receive this message, check your inbox' rather than 'delivered'. Record returned Supabase errors server-side as allowlisted category, not expose them or swallow all operational evidence. Signup/recovery browser calls use local QA evidence plus provider logs; no new public delivery-status endpoint or full email tracking database is needed.

Application-controlled copy becomes localized. Supabase-hosted SMTP templates have their own configuration: no assumption of per-request locale selection. Use reviewed minimal templates and operator-confirmed supported locale inputs; if current SMTP cannot select per-user language safely, retain one neutral concise template and document the exception. A localized app landing page supplies instructions. No new Send Email Hook merely to add translation; a requirement for fully per-user localized provider mail would need separate approval.

## 16. Default Identity Behavior

Preferred label: loaded profile.display_name -> loaded profile.username -> auth metadata display_name -> safe email local-part -> shortened auth user ID -> localized generic label. Trim whitespace, bound display length, render text only; empty strings are absent. Metadata is presentation-only and cannot establish role/trust. Email-derived labels are shown only in the user's private header/menu, never written to public profile or logs; discard control characters, unsafe display text, and sensitive-looking local parts. Use ID/generic fallback when unsafe.

Avatar: verified owner-resolved profile URL -> deterministic initial/fallback. Image failure immediately restores fallback. No arbitrary metadata avatar URL, third-party avatar service, or avatar dependency that blocks the label. Use stable dimensions and one initial; color selection may be deterministic from the user ID without displaying it. On signed-in status, visible fallback is immediate (same render); no summary skeleton hides it.

Enrichment deadline is 3 seconds with abort/stale-user cancellation; one user-triggered retry, not endless polling. Profile identity is independent from optional counts. Summary returns own minimal profile when available and separate optional stats/avatar availability; stats can be null ('unavailable'), not fabricated zero. Profile missing and profile query unavailable have distinct internal stages and generic safe error codes. Preserve no-store and no raw avatar path, email, role, auth metadata, or another actor's profile in the response.

Diagnosis records durations/status for auth validation, profile lookup, avatar, post counts, comment counts. Test delayed response, abort, 401/404/500, RLS rejection, missing trigger row, malformed avatar, new-user refresh, and switched account. Inspect deployed trigger/grants only through separately authorized operator read-only evidence; do not infer that a trigger migration is applied. Any required profile repair is actor-bound and separately reviewed, not a service-role upsert in the header.

## 17. Product Canonical-Routing Model

Canonical published device URL is `/products/{brandKey}/{slug}/` with trailing slash and encoded, validated database identity. One helper supplies cards, search, compare, sitemap and metadata. Slug is immutable under existing slug-lock rules; brand comes from the resolved row, not unchecked request input. A valid slug at an incorrect brand returns 301 to its database brand; unknown/unpublished slug returns 404/noindex. Database read failure returns 503/retry, not a false missing-product 404.

`/devices/{slug}/` returns 301 directly to the canonical route when published identity resolves; no redirect chain via brand anchors. `/products/{brand}/` remains a brand listing. Existing `#product-{slug}` bookmarks still locate cards; fragments cannot be read server-side, so do not promise an HTTP fragment redirect. Card actions now open detail. Preview or unpublished admin IDs never become public aliases. Canonical, OG URL, JSON-LD URL, internal links, and dynamic sitemap all agree; no new duplicate route tree or large SEO expansion.

## 18. Product-Detail Information Architecture

First viewport: brand/model and actual approved product image (or honest no-image state), lifecycle/status, category, concise reviewed summary, official source entry, compare action. No decorative boxed hero or invented product data. Follow with key facts and Schema v1 grouped specifications, each with label, typed value, unit and measurement context where required. Distinguish eye/panel brightness, per-eye resolution, regional/variant values and date; never rank incomparable contexts.

Existing schema groups/definitions determine order and applicability; labels use dictionary keys, not raw English database keys as UI headings. KNOWN shows the typed value; false is 'No', not empty. NOT_DISCLOSED says manufacturer has not disclosed. NOT_APPLICABLE says not applicable. Missing public verified claim says Unknown/unverified; do not reveal internal UNKNOWN_UNVERIFIED rows or notes. CONFLICT, already in Schema v1, shows an explicit differing-source state and public evidence, never a single unqualified value. No placeholder string disguised as fact.

Public-safe Schema v1 projection: grant only selected read columns with publication/state RLS and an invoker read surface. Definitions must be active; specs belong to published devices and expose only allowed public states; evidence/sources must be reachable from those public specs or published device links. Exclude raw_value, internal notes, updated_by, catalog_audit_events, auth/user IDs and private research fields. Existing admin policies remain. Do not simply grant SELECT on every table. Columns needed by invoker filtering receive narrowly reviewed grants; tests exercise both endpoint and direct Data API access to prove excluded columns remain inaccessible. If invoker policies cannot safely express the projection, stop for design amendment instead of silently adding a definer/service-role reader.

Public view model includes official URL, source publisher/title/URL/type, accessed/verified date and field attribution where present. HTTPS links are allowlisted by scheme and escaped; no automatic source fetch during rendering. No source means 'source not available', not a fabricated citation. Legacy full_specs can fill visible legacy/unverified sections but cannot masquerade as KNOWN canonical typed claims. Empty structured tables yield an honest useful page from published metadata and clearly labeled unknown fields. No bulk import, replay, or P9 is required.

Compare entry uses current selection model (maximum three) and links back to detail; existing comparison stays values-only with no winner scoring. Related community uses known device-circle association or a full-search link, not an invented thread. Mobile stacks overview/specs, uses bounded horizontal scrolling only inside genuinely wide comparison tables, and keeps source and compare actions reachable.

## 19. Security Design

Dynamic HTML headers belong in request/response middleware; static assets keep applicable `_headers` rules. Baseline: X-Content-Type-Options nosniff; CSP frame-ancestors 'none'; X-Frame-Options DENY for compatible legacy protection; Referrer-Policy strict-origin-when-cross-origin, with no-referrer on auth callback/recovery; Permissions-Policy camera=(), microphone=(), geolocation=() while those capabilities are unused. Do not alter HSTS/account-wide TLS from this slice. Preserve existing header directives rather than overwrite another CSP blindly. The initial CSP intentionally limits framing only; a full script-src policy requires a separate asset/connect inventory and report-only rollout, not an unsafe blanket restriction.

Catalog values render through Astro escaping/React text or DOM textContent; replace dynamic innerHTML, not merely strip a few characters. JSON embedded in script elements uses one safe serializer escaping '<', '>', '&' and script-breaking separators before set:html; JSON-LD follows the same rule. No catalog rich HTML is required, so no sanitizer dependency is introduced. Tests include closing-script strings, event-handler markup, quotes, Unicode separators and malicious URL schemes; verify literal text and no side effect in a local browser fixture, not public persistent exploits.

Preferences are untrusted enums; metadata label is not authority; private preference/summary APIs validate actor via existing auth and own-row RLS. No token in cookies for locale, no private profile data in SSR caches. State-changing preference calls require bearer auth and accepted same-origin request context; no wildcard credentialed CORS. Protect real-user actions with server ownership checks plus RLS. Recovery, notification/media IDs, circle ownership, and report boundaries remain in final high-risk audit scope. Do not claim JWT logout immediately revokes every access token: define and test the existing Supabase sign-out semantics separately.

## 20. Mobile Behavior

At 390 and 430px, shared header uses brand/logo, explicit Menu control, then Notifications -> Settings -> compact Account. Search occupies a stable separate row or opens an accessible search surface; no invisible horizontal primary-nav strip. Menu reveals a vertical list of Home, Community/feed, Circles, News, Products and supported public documentation/resources; Gaze appears only when its existing public flag permits. At narrow widths brand may compact, but a primary first-viewport product/site identity remains elsewhere. Anonymous login/register remain reachable from menu/account entry without forcing header overflow.

Use existing glass tokens, icon library where available, localized labels/tooltips, focus restoration, Escape dismissal, aria-expanded and keyboard order. Touch targets at least 44px, safe viewport margins, scrollable overlays below the header, no text/control overlap or page-wide overflow. Account names truncate visually but accessible names remain complete. Form errors and consent links wrap; software keyboard never hides the only submit action. Screenshots plus actual interactions cover both locales with unchanged Dark-only styling. Testing includes populated/empty/loading/error views and sticky-header/modal layering, not only homepage pixel widths.

## 21. Search Behavior

Global header/home search and full search share all-supported scope: devices, circles, posts and people, using current endpoint contracts. News is not added until a real indexed result implementation exists. Quick preview uses bounded per-type limits and grouped labels, shows a loading state distinct from empty, cancels stale responses, and always offers full results. 'No results' is allowed only when every supported group is empty after successful response; failure says unavailable/retry, never no content.

Full search retains type filters and same query normalization, length validation and escaping. Device results link to canonical detail; circles/posts/profiles retain valid URLs. Case-insensitive XREAL, RayNeo, Meta, air, glasses, existing circle names, nonsense, special characters and Chinese queries are acceptance cases. Preview and full results need not contain identical counts because preview is bounded, but they must agree on scope and existence. User-entered query is text, never HTML. No QA suggestions or generated test strings are baked into dictionaries.

## 22. Migration / Backward Compatibility

Preserve existing auth storage, legal-policy versions, public devices and comparison state. A's summary envelope keeps core profile fields and adds optional status/null stats with all current consumers updated together; failure behavior must not silently show zero reputation. Browser preferences default cleanly when absent; versioned invalid cookie values are dropped. Own preference table is additive and has no role/profile authority. Schema projection is additive and read-only for public actors; no data import or removal.

Legacy device redirects and brand hashes remain valid. Unknown/withdrawn products do not leak unpublished identities. Search URL/query semantics and route slugs do not become locale-dependent. Existing policy links continue to work; selecting legal translation does not rewrite recorded bundle acceptance. Starlight/documentation strings need reviewed integration with the same locale context; their existing fixed root configuration is not global support.

Migration approval and execution are separate from spec approval. All proposed table/policy changes require disposable-database replay, grants/RLS tests, and an operator-authorized forward migration under existing release controls. This specification does not authorize Production SQL or reopen schema-import tooling. If deployed prerequisites differ from source, halt that slice and document discrepancy before approving any repair.

## 23. Testing Strategy

Design-level requirements, not an implementation task list:

- Unit/property tests cover current/saved manual locale override, Auto CN with English Accept-Language -> zh-CN, Auto known non-CN with Chinese Accept-Language -> en, unavailable country with weighted supported Accept-Language, English default, untrusted-header rejection and no country persistence; also preference synchronization race, label fallback, safe-next recursion, consent state navigation, URL identity, typed spec state/units and safe serialization.
- API tests cover unauthorized preferences/summary, own-row updates, malformed input, stale revision, missing profile vs unavailable enrichment, no-store, no raw avatar/internal product fields, static versus dynamic header coverage. Disposable RLS tests use anon and two genuine local Auth users, not fake JWTs or service-role HTTP actors.
- Browser tests prove hydration matches SSR, manual preference beats country, country precedes browser language in Auto, both languages with Dark-only styling, public/private settings without appearance controls, profile failures, actual detail links and legacy redirect, source states and local XSS fixtures. Desktop Chromium and Firefox plus 390/430 Chromium are minimum; second-engine key mobile flows where supported.
- Engineering checks for each implementation slice: focused regressions, `npm test`, `npm run build`, `npm run qa:release`, `git diff --check`, independent review. Inspect command scripts for external activity before execution; no `qa:prod`, P9, destructive canary, or deferred integration runner is implied.
- Real Production acceptance uses dedicated owned QA inboxes/users, normal UI, exact UTC evidence and operator-approved mail evidence. A mocked mail transport or unit PASS never substitutes for real inbox/link/callback behavior.

Every receipt records SHA/artifact/deployed version, tested origin, date, exact cases, observer, PASS/FAIL/PARTIAL/NOT_APPLICABLE and reason. No inferred or copied prior PASS. Large-scale functional readiness does not represent a load/capacity certification; no Production load test is authorized.

## 24. Multi-Agent Acceptance Strategy

After all three slices individually ship/pass, independent agents receive isolated initial briefs. A gets only product purpose/canonical origin and owned QA access, no source/known-bug list before discovery. It naturally navigates home/signup/real verification/login/settings/locale/products/detail/compare/search/feed/post/comment/reply/like/notifications/circle/report/tiny media/profile/logout/relogin/recovery at desktop and 390/430. Required handoffs remain pending until the human acts; observation or safe redacted evidence must confirm outcome.

B owns QA user B and an anonymous context. A alone writes its content during discovery; B performs bounded rejected cross-user edit/delete/manage requests against A-owned disposable fixtures after coordination, never legitimate user records. Verify unchanged content after rejection; 403 alone is insufficient if mutation happened. Two QA identities are a prerequisite, not simulated claims. Notification tests require a real B-to-A action and correct recipient/link/read state; self-like is not substituted for notification creation.

C explores UX/discoverability independently without mutating content. D reviews source/security after A/B/C begin, including auth/callback/session/RLS/IDOR/preferences/locale/media/catalog/headers. Initial results return to coordinator separately, then deduplicate/reproduce/classify. Coordinator independently reproduces P0/P1 with minimal safe evidence. Stop exploitation on private/secret/cross-user destructive risk. Agent reports alone cannot establish acceptance PASS.

Track all QA-owned artifacts by explicit label/owner. Clean through supported normal deletion only, confirm ownership and outcome, request human confirmation for irreversible actions. Unsupported cleanup is a reported leftover, not direct SQL. No concurrent manipulation of the same account/password. Four agents also need a preflight origin check: retired Pages findings are excluded unless an actual current UI link leads there.

## 25. Deployment Strategy

Ship A, then B, then C as separate reviewed branches/releases. Each has its own written plan approved after this spec, engineering verification, independent review, explicit merge and deploy authorization, artifact/version receipt and controlled post-deploy acceptance. An unmet A real-email gate blocks B release even if B code tests pass. An unmet B gate blocks C release. No giant branch or automated chaining across human gates.

Provider SMTP/DNS/template or database grants/preferences changes require explicit operator scope, exact expected redacted state and rollback before execution. Preview/staging must not accidentally use Production credentials or send mail to real users. Acceptance uses canonical Worker origin, not preview/Pages URLs. No silent merge/deploy is authorized by 'continue' during design.

## 26. Rollback Strategy

Keep the preceding known-good Worker artifact/version and per-slice config manifest. Revert deploy on confirmed critical regression; record what was actually rolled back. Additive preferences/schema read changes stay installed but access can be revoked via separately approved minimal policy rollback if exposed; do not drop data. Reverting app code leaves preference rows harmless and old device URLs usable. Avoid restoring an artifact with a known exploited XSS path; use the smallest reviewed hotfix instead.

Consent records are never deleted to roll back UI. Password resets and sent emails cannot be undone; record them, revoke QA sessions if appropriate, and do not claim rollback. SMTP changes revert to the operator-recorded previous safe configuration without exposing credentials; DNS changes respect propagation and may require a paused signup/recovery notice. Localization cookie schema is backward-compatible and ignored by old code; canonical detail-route rollback must preserve redirect safety and avoid broken indexed links. Operator must approve actual rollback actions; this is design only.

## 27. Release Gates

PASS means a fresh tested behavior, not source presence. Any required human action/inbox access missing -> PARTIAL and blocks advancing; a missing optional capability -> NOT_APPLICABLE only with source/UI proof. All slices require CONFIRMED_P0_COUNT=0 and CONFIRMED_P1_COUNT=0, successful engineering verification and reviewed critical findings.

| Slice | Required gate fields |
| --- | --- |
| A | AUTH_SIGNUP, AUTH_EMAIL_VERIFICATION, AUTH_LOGIN, AUTH_SESSION_PERSISTENCE, DEFAULT_IDENTITY, CONSENT_FLOW, AUTH_LOGOUT, AUTH_RELOGIN, AUTH_PASSWORD_RECOVERY, EMAIL_DELIVERY all PASS. Resend arrival separately PASS; safe-next/invalid callback PASS. |
| B | LOCALE_AUTO_CN (even with English Accept-Language), LOCALE_AUTO_NON_CN (even with Chinese Accept-Language), LOCALE_MANUAL_ZH, LOCALE_MANUAL_EN, LOCALE_PERSISTENCE, NO_NORMAL_UI_DOUBLE_LANGUAGE, SETTINGS, HEADER_SETTINGS, MOBILE_390, MOBILE_430 all PASS. Unavailable-country Accept-Language fallback and safe default must pass; no appearance gate. |
| C | PRODUCT_DETAIL, PRODUCT_ROUTE_CANONICAL, PRODUCT_SCHEMA_RENDERING, PRODUCT_SOURCE_EVIDENCE, COMPARE_ENTRY, SEARCH_CONSISTENCY, MOBILE_NAV_390, MOBILE_NAV_430, XSS_CATALOG_PATH, SECURITY_HEADERS all PASS. |

Source evidence gate verifies correct presentation when evidence is present AND honest absence when absent, not fabricated completeness. Tests require representative real published products plus controlled local typed-state fixtures; no missing factual data is filled just to turn a gate green. A delivered-email event without receipt/callback does not satisfy EMAIL_DELIVERY. Recovery needs real new-password login and old-password rejection; session persistence needs refresh/navigation/context reopen, not one header screenshot. LEGAL_EXTERNAL_REVIEW_STATUS=NOT_CONFIRMED alone does not block engineering slice completion or authenticated functional acceptance; a substantive policy change is stopped separately as REQUIRED_FOR_POLICY_CHANGE.

## 28. Large-Scale Readiness Gate

The final receipt may emit `LARGE_SCALE_READY=true` only after AUTHENTICATED_REAL_USER_ACCEPTANCE, EMAIL_DELIVERY, DEFAULT_IDENTITY, SETTINGS, GLOBAL_LOCALE, PRODUCT_DETAIL, CORE_COMMUNITY, MOBILE_390, MOBILE_430, SECURITY_HIGH_RISK are PASS, with CONFIRMED_P0_COUNT=0 and CONFIRMED_P1_COUNT=0. P2 requires named nonblocking findings, owners and explicit acceptance. Report external legal-review status and tested provider-coverage limitations separately; NOT_CONFIRMED alone is not an engineering/functional blocker or an assertion of legal compliance. Readiness must name its actual tested email-provider scope.

CORE_COMMUNITY requires real post/view/comment/reply/like/unlike/recipient notification/profile/circle/report and small media paths where implemented, with owner rejection and cleanup evidence. SECURITY_HIGH_RISK requires two-user/anonymous boundaries, catalog XSS closure, header coverage, callback/redirect safety, private-data/secret checks and media access. Missing second user, email receipt, mobile interaction, or coordinator verification makes the final result PARTIAL, not PASS. Until then readiness is NOT_ESTABLISHED; this document does not assert a current boolean success.

## 29. Risks

| Risk / explicit uncertainty | Required disposition |
| --- | --- |
| Email sender/config/events and mailbox outcome unknown | Operator read-only evidence and owned inbox tests before root-cause remediation; no guessed SMTP fix. |
| Deployed new-user profile trigger/RLS state unknown | Stage-specific summary diagnostics and separately authorized operator inspection; maintain immediate UI fallback. |
| Age wording/legal translation changes | Preserve substantive meaning, minimumAge, versions and enforcement. Report external review separately; stop only a substantive change with REQUIRED_FOR_POLICY_CHANGE. Reviewer availability is not an unconditional engineering prerequisite. |
| Browser-only auth prevents SSR account preference lookup | Use safe device cookie for SSR and bounded authenticated adoption; do not introduce a session migration. |
| Country unavailable or spoofed / manual preference overridden | Country-first Auto only from trusted runtime metadata; Accept-Language only when unavailable; manual selection always wins, with no raw country persisted/exposed. |
| Structured tables closed to public and deployed data unverified | Reviewed allowlisted invoker projection/grants/RLS tests; no raw exposure/import or fabricated data. |
| Localization of editorial/legal/device content | Reviewed variants or honest original-source language labels; no untranslated app-controlled mixed UI or runtime translation. |
| SMTP lacks per-request template locale support | Document narrow email exception; app UI remains fully localized; separate approval if a hook is required. |
| Unavailable additional provider inboxes or exact operator evidence | Separate provider-coverage limitation; require primary Gmail receipt and report ambiguity without inventing transport success. |
| Locale cookies and SSR cache bleed | No-store personalized HTML, sanitized locale preference, exact hydration context; measure caching changes in staging. |
| Historical branches combine unrelated policy/session changes | Reuse ideas selectively; no merge-by-name or inferred applied migrations. |
| 'Large scale' mistaken for capacity assurance | Gate is bounded functional/security acceptance, not concurrency/cost/load certification. |

## 30. Explicit Deferred Work

P9, Verified Session v1, Release B bulk catalog imports, Compare v2 winner/ranking, Product Detail v2 redesign, new device-data research, new notification delivery channels, instant self-service account deletion, alternate auth challenge/session system, runtime translation, site custom-domain migration, full restrictive CSP expansion, provider webhooks/mail hook pipeline, monetization and high-volume/load testing remain excluded. Appearance customization, System/Light preferences and light-compatible token conversion are deferred to a future independent project; v1 has no appearance state or controls. No vague dependency on those programs is allowed for this recovery.

### Self-Review and Review Boundary

The specification defines current states, branch ancestry/divergence, six alternative comparisons, component/data/trust boundaries, slice ownership, backward compatibility, failure handling, and measurable gates. It distinguishes presentation from legal policy, external legal review from engineering readiness, request acceptance from inbox delivery, source presence from fresh acceptance, and operational uncertainty from architectural choice. It contains no placeholder sections or implementation task sequence. The human amendments preserve A/B/C, correct country-first Auto, and defer appearance. After this amended spec passes self-review, Slice A planning is authorized; executing that plan still requires human review and an execution-method choice.

Amendment self-review: LOCALE_RULES_CONSISTENT=true; APPEARANCE_SCOPE_REMOVED=true; LEGAL_REVIEW_SEPARATED_FROM_ENGINEERING_GATE=true; THREE_SLICE_ARCHITECTURE_UNCHANGED=true; P9_NOT_REOPENED=true; VERIFIED_SESSION_V1_NOT_REOPENED=true; NO_NEW_SCOPE_EXPANSION=true.

### Reference Basis

Source citations above are pinned to the base SHA. Public documentation consulted 2026-09-28:

- [Astro middleware](https://docs.astro.build/en/guides/middleware/) for request context and response middleware.
- [Cloudflare static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/) for static versus Worker response header ownership.
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) for SMTP delivery configuration and non-Production default-mail constraints.
- [Brevo transactional events](https://developers.brevo.com/docs/transactional-webhooks) for sent/delivered/deferred/bounce/blocked event distinctions and UTC evidence normalization.

The Supabase changelog markdown endpoint did not return usable content in this session. Implementation must recheck version-specific SDK/provider behavior against current official docs before selecting any new API/config mechanism; this spec preserves existing APIs and does not claim that failed lookup proved compatibility.
