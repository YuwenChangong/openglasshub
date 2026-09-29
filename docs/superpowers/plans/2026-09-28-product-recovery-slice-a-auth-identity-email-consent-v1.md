# Product Recovery Slice A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the owned-user signup, actual email verification, consent, immediately usable identity, persistent login, logout/relogin, resend and real password-recovery lifecycle without changing the existing authentication architecture.

**Architecture:** Retain Supabase browser Auth, versioned server consent and actor-scoped summary reads. Make consent navigation replace-only, identity synchronous with bounded optional enrichment, and email failures observable through allowlisted categories. Separate deterministic local engineering tests from separately authorized deployed acceptance with operator/inbox evidence.

**Tech Stack:** Astro, React 19, TypeScript, Supabase Auth, existing Cloudflare Worker API routes, Node assertion scripts, Vite test modules and Playwright local harnesses.

**Spec:** `docs/superpowers/specs/2026-09-28-product-recovery-large-scale-readiness-v1-design.md`, amended at `7b0f7093a7634c7f1905166d7aceb5c20a6c48ae`.

## Global Constraints

- This document is a plan, not execution authorization. This task changes documentation only; implementation waits for human review and execution-method selection.
- Preserve `LEGAL_POLICY.minimumAge=16`, bundle/version `2026-07`, legal rights/obligations, data-use purposes, consent semantics and server enforcement.
- Report `LEGAL_EXTERNAL_REVIEW_STATUS=CONFIRMED|NOT_CONFIRMED|REQUIRED_FOR_POLICY_CHANGE` independently. Current status is NOT_CONFIRMED; that alone does not block engineering or functional acceptance. Stop a substantive policy change, not the whole engineering slice. Do not claim legal compliance or lawyer approval.
- Dark-only, restrained dark-glass presentation; no Appearance, System/Light, theme tokens, account theme preference or appearance cookie/gate.
- Slice A uses typed zh-CN/en auth/legal messages, defaults to the existing zh-CN shell and previews en locally. No locale detector, global Settings or preference persistence. Slice B owns explicit > saved > trusted country > unavailable-country Accept-Language > en resolution.
- No direct Production SQL, P9, Verified Session v1, alternate auth/session architecture, speculative profile repair, provider webhook pipeline, Slice B/C implementation or unrelated infrastructure hardening.
- No Production/provider requests in this planning task. Future merge, deployment, mailbox/provider inspection and Production QA each require explicit, scoped human authorization; no approval is inherited from historical runs.
- Never put passwords, tokens, DSNs, verification/recovery URLs, OTPs, raw mail bodies, auth metadata or credential-derived values in chat/logs/artifacts. Human enters secrets directly; screenshots/traces must exclude secret-bearing screens and URLs.
- Public resend/reset responses remain enumeration-resistant. Existing server resend limit is 5/24h; local resend cooldown is 60 seconds and is not proof of consent or backend enforcement.
- Local tests use explicit fakes and deny all external network. Real inbox/callback/password outcomes cannot be replaced by mocked, source-only or HTTP-success PASS.

## Review Focus

- Encoded/self-referential destinations and an expired session during consent submission must lead to a safe login/destination without a redirect loop (Task 1).
- An account switch before a slow summary resolves must never show the previous actor's label/avatar/stats (Task 3).
- A missing profile, RLS/read failure and optional count failure must remain distinct without leaking actor/private fields or inventing zero (Task 2).
- Returned provider errors, thrown errors and an unknown recipient must have equivalent safe public responses while preserving redacted operator diagnosis (Task 5).
- Recovery re-render/replayed callback and delivered-without-received mail must not create duplicate exchanges or a false lifecycle PASS (Tasks 6-8).

---

## Source Baseline and File Responsibility Map

Reviewed source baseline is main ancestor `54ac72f8263bdefcf1b2ca247913b09b484cfbb1`; design branch base is `2ae43df093ef39c910d13bdcbf2c11c8a897890b`. At execution, verify HEAD/worktree and reread mapped files before editing; rebase conflicts require review, not blind application.

| Owner | Exact files and responsibility |
| --- | --- |
| Consent | `src/components/legal/LegalConsentPage.tsx`, `src/lib/legal-consent-navigation.ts` (new safe destination wrapper), `tests/visual/legal-consent-harness/main.tsx`, `tests/visual/legal-consent-state-matrix.mjs`, `scripts/test-legal-consent-visual.mjs`, `scripts/test-legal-consent-auth-flow.mjs`, `scripts/test-auth-redirect-safety.mjs` |
| Summary | `src/pages/api/users/me/summary.ts`, `src/lib/user-summary.ts` (new shared response contract), `scripts/test-user-summary-api-safety.mjs` |
| Header | `src/components/site/HeaderUserMenu.tsx`, `src/lib/header-identity.ts` (new pure presentation helper), `tests/visual/header-identity-harness/index.html`, `tests/visual/header-identity-harness/main.tsx`, `tests/visual/header-identity-harness/vite.config.ts`, `scripts/test-header-identity.mjs` (four new local test files) |
| Auth/legal copy | `src/lib/auth-messages.ts` (new typed catalog), `src/components/forum/AuthPanel.tsx`, `src/components/legal/LegalConsentPage.tsx`, `src/components/auth/AuthCallback.tsx`, `src/components/auth/ResetPasswordForm.tsx`, `src/pages/login/index.astro`, `src/pages/legal-consent/index.astro`, `src/pages/auth/callback.astro`, `src/pages/auth/reset-password/index.astro`, `src/layouts/CommunityLayout.astro`, `scripts/test-auth-legal-acknowledgement.mjs`, existing legal visual harness/matrix/scripts |
| Email observability | `src/pages/api/auth/resend-confirmation.ts`, `src/lib/server/auth-email-observability.ts` (new category-only diagnostic helper), `src/lib/legal-consent-adapters.ts`, `src/components/forum/AuthPanel.tsx`, `scripts/test-auth-email-observability.mjs` (new local API/component tests), existing legal visual harness |
| Recovery | `src/components/auth/ResetPasswordForm.tsx`, `src/components/auth/AuthCallback.tsx`, `src/lib/password-recovery-adapter.ts`, `tests/visual/legal-consent-harness/main.tsx`, `scripts/test-password-recovery.mjs` (last two named new module/script where applicable) |
| Evidence | `docs/email-verification-deliverability-checklist.md`, `docs/ops/product-recovery-slice-a-acceptance.md`, `scripts/lib/slice-a-acceptance.mjs`, `scripts/test-slice-a-acceptance.mjs` (last three new) |
| Integration | `package.json`, `scripts/qa/profiles/release.mjs`, `scripts/qa/test-qa-harness-profiles.mjs`, `docs/ops/product-recovery-slice-a-acceptance.md` |

Existing `src/lib/auth-redirect.ts`, `src/lib/legal-policy.ts`, `src/lib/legal-consent-client.ts`, `src/components/legal/LegalConsentGate.tsx`, `src/components/auth/useBrowserAuthState.ts`, `src/lib/supabase-browser.ts` and server mutation guards are preserved interfaces, not replacement systems. Only the header consumes the summary endpoint today; update both ends together via its shared type.

Test snippets use `node:assert/strict` as `assert` and the installed `playwright` API, not a new test framework. Where the existing visual script has a local boolean `assert`, retain it for its old checks and import strict assertions as `nodeAssert` for these new assertions. Wait for explicit harness outputs before assertions, not arbitrary sleeps. Named fixtures are created in their owning test script: actorId/ownedDependencies/ownedContext extend the existing summary fixtures; validContext is a valid local resend request with stub runtime bindings; emailUser is a fake Supabase `User` with safe email `qa@example.invalid`; receipt fixtures contain only the explicit Task 7 schema. No fixture comes from process credentials or Production.

### A1: Six Confirmed Baseline Defects

Add each regression before its owning implementation. Save RED assertion names and exit status, not raw user/provider payloads. A missing module is initial scaffolding failure, not proof of a behavioral defect: wire tests to the current behavior first and observe the specified assertion fail. There is no independent commit of a knowingly broken product tree.

| Confirmed source defect | Behavioral RED / owner |
| --- | --- |
| Current consent renders success interstitial | No current-success DOM and one replace, Task 1 |
| Header hides initial/name until summaryReady | Nonempty label/initial with unresolved and rejected summary, Task 3 |
| Summary Promise.all couples optional aggregates to profile | Optional count rejection still yields own minimal profile, Task 2 |
| AuthPanel duplicates age/legal copy in two languages | One selected-language sentence with actual eligibility controls, Task 4 |
| Footer appends minimumAge to ordinary brand | Neutral brand without ordinary 16+ badge, Task 4 |
| Resend ignores returned error and swallows throws without diagnosis | Returned/throw category observed while public response stays generic, Task 5 |

## Task 1: Replace-Only Consent Navigation

**Files:** Modify the Consent row files; create `src/lib/legal-consent-navigation.ts`.

**Interfaces:** Consume existing `LegalConsentAuthAdapter.getSession(): Promise<ConsentSession|null>`, `LegalConsentAdapter.getCurrentConsent(token): Promise<LegalConsentStatus>`, `recordCurrentConsent({accessToken,source}): Promise<LegalConsentStatus>` and `LegalConsentNavigationAdapter.replace(url): void`. Produce `getSafeConsentNext(input: unknown): string`, wrapping existing `getSafeNext` and using `/feed/` for auth/login/legal-consent loop destinations; preserve legitimate internal destinations and normalized origin rules.

- [ ] Add assertions to the existing local Playwright script/harness; name tests `currentConsentReplaces`, `requiredConsentRecordsThenReplaces`, `expiredSubmissionReturnsToLogin`, `consentNextRejectsLoops`. Existing adapters record `replace:`/`navigate:` into the harness output.

```ts
await page.getByRole('button', { name: 'consent-already-current', exact: true }).click();
await page.waitForFunction(() => document.querySelector('output')?.textContent?.includes('replace:/feed/'));
assert.equal(await page.getByText('当前政策版本已确认。', { exact: true }).count(), 0);
assert.equal(getSafeConsentNext('/legal-consent/?next=%2Flegal-consent%2F'), '/feed/');
assert.equal(getSafeConsentNext('https://example.invalid'), '/feed/');
assert.equal(getSafeConsentNext('/circles/'), '/circles/');
```

- [ ] RED: `node scripts/test-legal-consent-visual.mjs` must fail the current-consent assertion against existing behavior, not external networking. Run `node --experimental-strip-types scripts/test-auth-redirect-safety.mjs` for new loop assertions.
- [ ] Implement the helper signature above; `LegalConsentPage` redirects current immediately and redirects only after successful recording for required consent. Keep checking/redirecting status bounded, no terminal success interstitial. Expired get/record sessions show a login action whose safe return includes the consent destination; error has retry/logout. Guard double submit, duplicate replacement and unmounted requests. Preserve bundle/idempotency and protected server gates.
- [ ] Extend injected cases for 401 during submit, delayed status, retry success, logout, outdated/current bundles and encoded external/self-loop destinations. Assert no record for already-current, exactly one record for required success and no navigation on failed record.
- [ ] GREEN: `node scripts/test-legal-consent-visual.mjs`, `node scripts/test-legal-consent-auth-flow.mjs`, `node --experimental-strip-types scripts/test-auth-redirect-safety.mjs`, `node scripts/test-legal-consent-page-gate.mjs`. Expect all assertions passed, local-only visual matrix complete and existing mutation guards retained.
- [ ] Commit with explicit staging:

```sh
git add src/components/legal/LegalConsentPage.tsx src/lib/legal-consent-navigation.ts tests/visual/legal-consent-harness/main.tsx tests/visual/legal-consent-state-matrix.mjs scripts/test-legal-consent-visual.mjs scripts/test-legal-consent-auth-flow.mjs scripts/test-auth-redirect-safety.mjs
git commit -m "fix: replace redundant current consent interstitial"
```

## Task 2: Profile-First Summary with Honest Optional Enrichment

**Files:** Modify `src/pages/api/users/me/summary.ts`, `scripts/test-user-summary-api-safety.mjs`; create `src/lib/user-summary.ts`.

**Interfaces:** Preserve `createSummaryGet(dependencies)` and actor-scoped authentication. Produce `UserSummarySuccess={ok:true;profile:{id:string;username:string|null;display_name:string|null;profile_href:string;avatar_resolved_url:string|null};stats:{post_count:number|null;received_like_count:number|null};availability:{avatar:'ready'|'unavailable';posts:'ready'|'unavailable';commentLikes:'ready'|'unavailable'}}`. Produce `UserSummaryFailure={ok:false;code:'UNAUTHORIZED'|'PROFILE_NOT_FOUND'|'PROFILE_UNAVAILABLE'}`. Extend dependencies with `observe(event:{stage:'auth'|'profile'|'avatar'|'posts'|'comments';status:'ok'|'missing'|'unavailable';durationMs:number}):void`; exceptions in observation never change response. Profile errors throw rather than becoming missing/null.

- [ ] Extend the current Vite/Cloudflare-stub Node test using its injected clients; add `optionalCountsDoNotHideProfile`, `profileMissingDiffersFromUnavailable`, `summaryNeverLeaksPrivateFields`.

```ts
const handler = createSummaryGet({ ...ownedDependencies,
  countPostLikes: async () => { throw new Error('fixture read denied'); } });
const response = await handler(ownedContext);
const body = await response.json();
assert.equal(response.status, 200);
assert.equal(body.profile.id, actorId);
assert.equal(body.stats.post_count, null);
assert.equal(body.stats.received_like_count, null);
assert.equal(body.availability.posts, 'unavailable');
assert.equal(response.headers.get('cache-control'), 'no-store');
assert.deepEqual(Object.keys(body.profile).sort(),
  ['avatar_resolved_url','display_name','id','profile_href','username'].sort());
```

- [ ] RED: `node scripts/test-user-summary-api-safety.mjs`; expect current optional rejection to yield 500 instead of own profile 200. Retain all existing bearer, own-actor and private-field assertions.
- [ ] Implement shared types and independent settled optional reads in the endpoint. Bound optional enrichment at 1500ms per request using one shared deadline; attach rejection handlers and pass abort signals only where supported. Profile missing ->404 PROFILE_NOT_FOUND; query/RLS unavailable ->503 PROFILE_UNAVAILABLE; mismatch ->404 without the other profile. Avatar failure/null ->null unavailable. Post_count remains known if posts succeeded; received_like_count is null unless both contributing aggregates succeeded. A genuine measured zero stays zero. No writes or profile upsert.
- [ ] Test never-settling/late rejecting reads, comment-only failure, avatar-only failure, missing row, thrown/RLS profile read, malformed resolver URL, unauthorized and mismatched actor. Reject arbitrary/unsafe avatar URLs using the existing owner resolver's constraints, not metadata. Assert diagnostics contain only the declared stage/status/duration keys and no query/error strings.
- [ ] GREEN: `node scripts/test-user-summary-api-safety.mjs`; expect all privacy and degradation cases PASS, including deadline test and successful old numeric values. No external requests.
- [ ] Commit:

```sh
git add src/pages/api/users/me/summary.ts src/lib/user-summary.ts scripts/test-user-summary-api-safety.mjs
git commit -m "fix: isolate optional enrichment from account summary"
```

## Task 3: Immediate Private Header Identity

**Files:** Modify `src/components/site/HeaderUserMenu.tsx`; create the Header row helper/harness/script files.

**Interfaces:** Consume Task 2 `UserSummarySuccess`. Produce `buildHeaderIdentity(input:{user:User;profile:UserSummarySuccess['profile']|null;locale:'zh-CN'|'en'}):{label:string;initial:string;avatarUrl:string|null}` in `src/lib/header-identity.ts`. Add optional `identityAdapter` prop to `HeaderUserMenu` with `{state:{viewState:AuthViewState;user:User|null};getAccessToken():Promise<string|null>;loadSummary(token:string,signal:AbortSignal):Promise<UserSummarySuccess>}`; production default uses unchanged browser Auth hook/session and the same summary fetch. Always call hooks unconditionally; this seam only injects the existing integration in local tests.

- [ ] Build a Vite localhost harness rendering the real header component with injected auth/summary promises, controlled account-switch buttons and fake clock. Use Playwright 390x844, 430x932 and 1440x900, deny non-local requests and inspect screenshots; test `immediateFallback`, `enrichmentDeadline`, `staleActorIgnored`, `brokenAvatarRestoresInitial`.

```ts
assert.equal(buildHeaderIdentity({ user: emailUser, profile: null, locale: 'en' }).label, 'qa');
await page.getByRole('button', { name: 'Sign in with pending summary' }).click();
assert.match((await page.locator('[data-testid="header-identity-label"]').textContent()) ?? '', /\S/);
await page.clock.fastForward(3001);
assert.match((await page.locator('[data-testid="header-identity-initial"]').textContent()) ?? '', /\S/);
await page.getByRole('button', { name: 'Switch actor' }).click();
await page.getByRole('button', { name: 'Resolve previous summary' }).click();
assert.equal((await page.locator('[data-testid="header-identity-label"]').textContent())?.includes('Previous actor'), false);
```

- [ ] RED: `node scripts/test-header-identity.mjs`; after wiring the adapter to existing header logic, expect unresolved-summary label/initial assertions to fail. Do not treat a missing harness as the baseline defect.
- [ ] Implement the helper signature and adapter. Label order: loaded display_name -> username -> auth metadata display_name -> safe email local-part -> shortened auth ID -> localized generic label. Trim, remove controls, bound label to 48 Unicode code points, render text only; reject URL-like/token-like/control-bearing email local parts, use ID/generic instead. Metadata is never authority. Local-part labels remain only in the private menu and are never persisted/public/logged.
- [ ] Render fallback in the signed-in render immediately, no summary-ready skeleton over identity. Abort at exactly 3000ms or account/unmount change; use generation/actor guard even if request ignores abort. Reset old profile/stats synchronously on actor change. Image error clears resolved avatar in both header/popover; fixed dimensions prevent shifts. Null statistics show unavailable, not zero; allow one explicit retry, no polling. No arbitrary metadata avatar URL or external avatar service.
- [ ] GREEN: `node scripts/test-header-identity.mjs` and `node scripts/test-user-summary-api-safety.mjs`. Cover all fallback levels, whitespace/unsafe labels, summary 401/404/500/rejection, slow token read, image failure, switch, logout and refresh. Deadline includes token lookup; no post-timeout update. Screenshots must show nonblank identity without overflow at all three sizes.
- [ ] Commit:

```sh
git add src/components/site/HeaderUserMenu.tsx src/lib/header-identity.ts tests/visual/header-identity-harness/index.html tests/visual/header-identity-harness/main.tsx tests/visual/header-identity-harness/vite.config.ts scripts/test-header-identity.mjs
git commit -m "fix: show immediate account identity with bounded enrichment"
```

## Task 4: Concise Auth/Legal Copy and Neutral Branding

**Files:** Modify the Auth/legal copy row files and its existing harness/matrix; create `src/lib/auth-messages.ts`.

**Interfaces:** Produce `AuthLocale='zh-CN'|'en'`, `getAuthMessages(locale:AuthLocale):AuthMessages`; `AuthMessages` has string keys `loginHeading`, `signupHeading`, `email`, `password`, `newPassword`, `confirmPassword`, `login`, `signup`, `consentSentence`, `terms`, `privacy`, `guidelines`, `pendingCheckInbox`, `resend`, `requestReset`, `updatePassword`, `retry`, `logout`, `invalidCredentials`, `unavailable`, `expiredRecovery`, plus `eligibility(minimumAge:number):string` and `cooldown(seconds:number):string`. Add further existing auth-state labels to this same catalog, never a second copy source. Add `locale?:AuthLocale` (default zh-CN) to AuthPanel, LegalConsentPage, AuthCallback and ResetPasswordForm. Astro wrappers explicitly pass zh-CN until Slice B supplies context; no navigator/country/cookie detector.

- [ ] Update old static bilingual assertions into selected-language behavioral assertions without deleting policy enforcement tests. Add `singleLanguageRegistration`, `eligibilityStillRequired`, `neutralFooter`.

```ts
await page.getByRole('button', { name: 'register-unchecked', exact: true }).click();
assert.equal(await page.getByRole('checkbox').count(), 2);
assert.equal(await page.getByRole('button', { name: '注册', exact: true }).isDisabled(), true);
assert.equal(await page.getByText('Terms', { exact: true }).count(), 0);
assert.equal(LEGAL_POLICY.minimumAge, 16);
assert.equal(LEGAL_POLICY.bundleVersion, '2026-07');
assert.doesNotMatch(layoutSource, /siteName\s*}\s*·\s*\{LEGAL_POLICY\.minimumAge/);
```

- [ ] RED: `node scripts/test-auth-legal-acknowledgement.mjs` and `node scripts/test-legal-consent-visual.mjs`; expect dense mixed-language/footer assertions to fail after adjusting assertions, not eligibility/version assertions. Use the existing `LEGAL_POLICY.bundleVersion` property verified in source.
- [ ] Implement catalog/locale signatures and concise chosen-language sentence with real existing Terms/Privacy/Guidelines links. Separate compact age eligibility attestation from the single legal checkbox wherever the existing combined age/legal acknowledgement applies, including required-consent form. Both start unchecked; both required before the existing accepted contract; no new server consent fields or browser consent proof. Login/registration mode changes clear controls; recovery stays exempt. Footer is neutral OpenGlass Hub with existing legal navigation, no ordinary 16+ badge; use existing labelZh alone for the current Chinese shell rather than bilingual link labels. Slice B later supplies the global selected language. Remove duplicated auth wrapper paragraphs rather than moving them elsewhere.
- [ ] Replace definite sent/delivered claims with neutral request/check-inbox wording; no raw provider messages. Preserve 60-second cooldown and actual link destinations. Test both locales separately, loading/error/current/required/expired states and 390/430/desktop fit. No page-wide theme/i18n redesign; preserve existing state matrix coverage and document any changed inventory.
- [ ] GREEN: `node scripts/test-auth-legal-acknowledgement.mjs`, `node scripts/test-legal-consent-auth-flow.mjs`, `node scripts/test-legal-consent-visual.mjs`, `node scripts/test-legal-consent-page-gate.mjs`. Expect unchanged policy values and server tests plus concise single-language selected UI.
- [ ] Commit with the exact Auth/legal copy paths:

```sh
git add src/lib/auth-messages.ts src/components/forum/AuthPanel.tsx src/components/legal/LegalConsentPage.tsx src/components/auth/AuthCallback.tsx src/components/auth/ResetPasswordForm.tsx src/pages/login/index.astro src/pages/legal-consent/index.astro src/pages/auth/callback.astro src/pages/auth/reset-password/index.astro src/layouts/CommunityLayout.astro scripts/test-auth-legal-acknowledgement.mjs scripts/test-legal-consent-auth-flow.mjs scripts/test-legal-consent-visual.mjs tests/visual/legal-consent-harness/main.tsx tests/visual/legal-consent-state-matrix.mjs
git commit -m "fix: simplify auth consent copy without changing policy"
```

## Task 5: Diagnose Resend Failures without Enumeration

**Files:** Modify the Email observability row files/harness; create its helper and test script.

**Interfaces:** Produce `AuthEmailEvent={flow:'RESEND';stage:'provider';outcome:'accepted'|'rate_limited'|'rejected'|'unavailable';durationMs:number}` and `classifyAuthEmailFailure(error:unknown):AuthEmailEvent['outcome']`. Add `createResendPost(dependencies?:{resend:(email:string,redirectTo:string)=>Promise<{error:unknown|null}>;consumeLimit:(input:{ipHash:string;maxAttempts:number;windowHours:number})=>Promise<ForumRateLimitResult>;observe:(event:AuthEmailEvent)=>void}):APIRoute`, using existing `ForumRateLimitResult` from `src/lib/server/rate-limit.ts`; production defaults retain current Supabase client, env validation, JSON/email validation, safe redirect and hashed-IP limiter. Inject consumeLimit as well as resend in every local test so the limiter RPC cannot reach a provider. Extend existing auth adapter with optional `requestPasswordReset(input:{email:string;redirectTo:string}):Promise<{error:Error|null}>` for local reset request tests; do not add an alternative email sender.

- [ ] Add a Cloudflare-stub API test and existing AuthPanel harness cases `returnedProviderErrorObserved`, `thrownProviderErrorObserved`, `unknownRecipientIndistinguishable`, `resetRequestUsesSafeCallback`.

```ts
const events = [];
const post = createResendPost({
  resend: async () => ({ error: { status: 503, message: 'fixture-sensitive-payload' } }),
  consumeLimit: async () => ({ allowed: true, reason: 'ALLOWED' }),
  observe: event => events.push(event)
});
const response = await post(validContext);
assert.equal(response.status, 200);
assert.equal((await response.json()).ok, true);
assert.equal(events[0].outcome, 'unavailable');
assert.deepEqual(Object.keys(events[0]).sort(), ['durationMs','flow','outcome','stage']);
assert.equal(JSON.stringify(events).includes('fixture-sensitive-payload'), false);
```

- [ ] RED: `node scripts/test-auth-email-observability.mjs`; wire current resend behavior through the seam first, then observe the missing category assertion fail for returned and thrown errors.
- [ ] Implement the declared category helper and route factory; inspect returned errors, catch exceptions, emit only the exact schema and no free-text/status-body/email/IP. Unknown errors -> unavailable; observation failure never alters generic response. No success metric interpreted as inbox delivery. Keep malformed input/rate limit boundaries and equal valid-email responses for known/unknown/provider failure. Browser signup/reset use selected-language safe generic result/error categories, no raw console telemetry.
- [ ] GREEN: `node scripts/test-auth-email-observability.mjs`, `node scripts/test-legal-consent-auth-flow.mjs`, `node scripts/test-legal-consent-visual.mjs`. Test accepted/returned/thrown/unknown errors, observer throw, limiter denial before provider invocation, no secret-bearing output and proper reset redirect.
- [ ] Commit:

```sh
git add src/pages/api/auth/resend-confirmation.ts src/lib/server/auth-email-observability.ts src/lib/legal-consent-adapters.ts src/components/forum/AuthPanel.tsx scripts/test-auth-email-observability.mjs tests/visual/legal-consent-harness/main.tsx
git commit -m "fix: retain redacted resend failure diagnostics"
```

## Task 6: Bounded Recovery/Callback Session Handling

**Files:** Modify `src/components/auth/ResetPasswordForm.tsx`, `src/components/auth/AuthCallback.tsx`, `tests/visual/legal-consent-harness/main.tsx`; create `src/lib/password-recovery-adapter.ts`, `scripts/test-password-recovery.mjs`.

**Interfaces:** Produce `PasswordRecoveryAdapter={exchangeCode(code:string):Promise<{error:Error|null}>;hasSession():Promise<boolean>;onRecoverySession(callback:()=>void):()=>void;updatePassword(password:string):Promise<{error:Error|null}>}` and optional `recoveryAdapter` prop on ResetPasswordForm. Production adapter delegates to existing Supabase exchange/getSession/onAuthStateChange/updateUser; preserve existing recovery states/deadline 2800ms and safe callback logic. Consume Task 4 locale catalog and Task 1 safe consent destination wrapper for callback routing.

- [ ] Add real-component local harness tests `recoveryExchangeOnce`, `expiredRecoveryActionable`, `passwordNotTrimmed`, `callbackErrorRedacted`; tests do not prove real password rejection.

```ts
await page.getByRole('button', { name: 'Recovery with code' }).click();
await page.waitForFunction(() => document.querySelector('output')?.textContent?.includes('exchange-count:1'));
await page.getByRole('button', { name: 'Emit recovery session' }).click();
assert.equal((await page.locator('output').textContent())?.includes('exchange-count:2'), false);
await page.getByLabel('新密码', { exact: true }).fill(' fixture password ');
await page.getByLabel('确认密码', { exact: true }).fill(' fixture password ');
await page.getByRole('button', { name: '更新密码', exact: true }).click();
await page.waitForFunction(() => document.querySelector('output')?.textContent?.includes('password-preserved:true'));
```

- [ ] RED: `node scripts/test-password-recovery.mjs`; after adapter wiring, assert existing ready-dependent effect reentry or trimmed-password failure. Log only exchange count/password-preserved boolean, never even fixture passwords.
- [ ] Implement one exchange per mounted recovery attempt/code, event listener cleanup and bounded recovery readiness; no code/session in logs. Passwords are validated without trimming/changing the supplied password. Expired/invalid link offers another reset request/login, no protected action; safe error dictionary replaces raw callback payloads. Never treat arbitrary SIGNED_IN as proof that an unvalidated recovery code was accepted; follow the existing supported Supabase recovery contract, test ordinary-session and recovery-session cases separately.
- [ ] GREEN: `node scripts/test-password-recovery.mjs`, `node scripts/test-legal-consent-visual.mjs`, `node --experimental-strip-types scripts/test-auth-redirect-safety.mjs`, `node scripts/test-legal-consent-page-gate.mjs`. Include listener cleanup, timeout, failed exchange, replay, password mismatch, malicious next and current/outdated-consent callback destinations.
- [ ] Commit:

```sh
git add src/components/auth/ResetPasswordForm.tsx src/components/auth/AuthCallback.tsx src/lib/password-recovery-adapter.ts tests/visual/legal-consent-harness/main.tsx scripts/test-password-recovery.mjs
git commit -m "fix: bound recovery initialization and preserve password input"
```

## Task 7: Evidence-First Mail and Lifecycle Acceptance Contract

**Files:** Modify `docs/email-verification-deliverability-checklist.md`; create `docs/ops/product-recovery-slice-a-acceptance.md`, `scripts/lib/slice-a-acceptance.mjs`, `scripts/test-slice-a-acceptance.mjs`.

**Interfaces:** Produce `validateSliceAAcceptance(input:unknown):{status:'PASS'|'PARTIAL'|'FAIL';missing:string[];providerLimitations:string[]}`. Evidence schema version=1 has deployedCommit, observedAtUtc, authorization reference (not a credential), legalExternalReviewStatus and checks for the eleven names below. Each check has status PASS/PARTIAL/FAIL/NOT_RUN and bounded safe evidence references. Mail cases are `SIGNUP|RESEND|PASSWORD_RESET`, provider `GMAIL|OUTLOOK|QQ|163`, UTC request/response/event/receipt times or explicit UNKNOWN, normalized app/Auth/SMTP/Brevo outcomes, mailbox receipt boolean and callback outcome. Password outcomes are booleans only. No arbitrary raw payload object or secret-bearing string field. Validator CLI lives in the same module: `node scripts/lib/slice-a-acceptance.mjs --receipt <local-json-path>`; it prints names/status only and exits nonzero for not-PASS.

- [ ] Write validator tests `deliveryWithoutReceiptIsPartial`, `missingRecoveryProofIsPartial`, `unknownTimesStayUnknown`, `secretFieldsRejected`, `legalNotConfirmedDoesNotBlock`, `additionalProviderLimitationIsReported`.

```js
assert.equal(validateSliceAAcceptance(deliveredButNotReceivedFixture).status, 'PARTIAL');
assert.equal(validateSliceAAcceptance(oldPasswordNotTestedFixture).status, 'PARTIAL');
assert.equal(validateSliceAAcceptance(completeOwnedGmailFixture).status, 'PASS');
assert.equal(validateSliceAAcceptance({ ...completeOwnedGmailFixture, password: 'fixture' }).status, 'FAIL');
assert.equal(validateSliceAAcceptance({ ...completeOwnedGmailFixture,
  legalExternalReviewStatus: 'NOT_CONFIRMED' }).status, 'PASS');
```

- [ ] RED: `node scripts/test-slice-a-acceptance.mjs`; expect missing validator initially; implement its schema with tests before the operational runbook. These fixture passes prove only validator behavior, never Production acceptance.
- [ ] Implement the validator signature and explicit-field allowlist; reject secret keys/URLs/raw error bodies, missing deployed SHA, absent actual receipt/callback and incomplete password outcomes. Non-Gmail coverage limitations do not silently become PASS tests; primary Gmail is mandatory. If a supplied owned Outlook case fails, record the failure rather than reclassifying it as unavailable access. NOT_CONFIRMED is informational; REQUIRED_FOR_POLICY_CHANGE stops that change. Never infer missing times from probe IDs/order or manual reset confirmation.
- [ ] Write the evidence-first runbook with these ordered actions for each of SIGNUP, RESEND and PASSWORD_RESET: identify scoped authorization and owned inbox; observe browser request and normalized Auth response; obtain operator Auth evidence if available; operator verifies SMTP enabled/configured/sender/domain/limits without exporting secrets; correlate Brevo transactional accepted/rejected/deferred/bounced/delivered event; human checks Inbox/Spam and receipt UTC; human follows link privately and confirms callback/reset outcome. Unknown stages remain UNKNOWN; do not change SMTP/config until diagnosis justifies a separately approved change. Request success and provider delivered do not prove receipt.
- [ ] Document unique `openglasshub+qa-acceptance-...@gmail.com` owned alias only after confirming current mailbox access/permission; never assume previous signup authorization persists. Primary Gmail receipt required; ask for owned Outlook, record unavailable access as coverage limitation. QQ/163 are additional owned-access coverage, not automatic engineering blockers. Human opens email/links and enters passwords privately; pause automation during secret-bearing navigation and disable traces/URL logs/screenshots until URLs are sanitized. Do not export browser storage/HAR/mail contents.
- [ ] Document actual recovery handoff: request -> human Inbox/link -> browser recovery session -> human new password -> logout -> exactly one old-password rejection -> new-password acceptance. Also fresh signup, verification, safe destination, no redundant success, immediate identity, refresh/navigation/context reopen, profile route usable, logout/relogin and resend using a separate unverified owned alias before confirmation. Keep account creation/mail attempts bounded and no destructive account cleanup without authorization.
- [ ] GREEN: `node scripts/test-slice-a-acceptance.mjs`; all schema/privacy/false-PASS tests pass locally. Review runbook has no SQL/provider command or implicit mutation grant.
- [ ] Commit:

```sh
git add docs/email-verification-deliverability-checklist.md docs/ops/product-recovery-slice-a-acceptance.md scripts/lib/slice-a-acceptance.mjs scripts/test-slice-a-acceptance.mjs
git commit -m "test: define evidence-backed auth lifecycle acceptance"
```

## Task 8: Regression Integration, Independent Review and Gated Deployed Acceptance

**Files:** Modify `package.json`, `scripts/qa/profiles/release.mjs`, `scripts/qa/test-qa-harness-profiles.mjs`, `docs/ops/product-recovery-slice-a-acceptance.md`. Ephemeral private receipt is `.tmp/slice-a-acceptance.json`; never stage it. Only redacted outcome summaries belong in docs.

**Interfaces:** Consume Tasks 1-7 test commands and Task 7 validator. Produce npm script `test:product-recovery-slice-a` running the existing consent/redirect/summary tests and new header/email/recovery/evidence tests serially. Register one deterministic local release command `product-recovery-slice-a` in existing release COMMANDS/selected checks, without changing prod profile, target authorization or network guards. Produce final human-reviewed acceptance summary, not a deployment runner.

- [ ] Add `releaseIncludesSliceALocalChecks` to existing QA profile tests. Assert selected RELEASE checks contain `product-recovery-slice-a`, its command maps to the local npm script and none requires Production; retain existing profile/safety checks.

```js
const result = resolveReleaseChecks({ profile: QA_PROFILES.RELEASE,
  risk: 'HIGH', expandedAreas: ['auth'] });
assert.equal(result.selectedChecks.some(item => item.id === 'product-recovery-slice-a'), true);
assert.equal(validateSliceAAcceptance({ schemaVersion: 1, checks: {} }).status, 'FAIL');
```

- [ ] RED: `node scripts/qa/test-qa-harness-profiles.mjs` before registration must fail missing local check. `node scripts/test-slice-a-acceptance.mjs` pins absent real evidence as not-PASS; absence is not repaired by labeling source checks as acceptance.
- [ ] Implement script/registration only; no expansion of generic QA framework. Verify every selected test uses localhost/fakes, including worker bindings; stop if local QA asks for external credentials instead of bypassing its safety boundaries.
- [ ] GREEN engineering: `npm run test:product-recovery-slice-a`, `node scripts/qa/test-qa-harness-profiles.mjs`, `npm test`, `npm run build`, `npm run qa:release`, `git diff --check`. Inspect Playwright output/screenshots at 390/430/1440; ensure no clipping, nonblank identity, functional consent/login/recovery controls and external-network denial. Record exact exit status/counts and failures, not inferred success.
- [ ] Commit engineering integration with explicit staging:

```sh
git add package.json scripts/qa/profiles/release.mjs scripts/qa/test-qa-harness-profiles.mjs docs/ops/product-recovery-slice-a-acceptance.md
git commit -m "test: integrate slice A local release regressions"
```

- [ ] Obtain fresh independent review of the whole implementation diff, auth/consent/privacy contracts and tests; close confirmed issues with focused RED/GREEN commits before PR. Reviewer must not be the implementer; if unavailable, report pending, not reviewed. Push the implementation branch and create PR only in the later authorized execution phase; attach its URL to the task. No merge without human authorization.
- [ ] Stop at the PR boundary unless human separately authorizes merge/deployment. After an authorized deployed revision is identified, request separate bounded Production QA/operator/inbox authorization. Only then execute Task 7 human-handoff runbook in the browser; no direct SQL, automatic provider reconfiguration, P9 or alternate session program. Engineering green may be reported while deployed acceptance remains NOT_RUN/PARTIAL.
- [ ] GREEN deployed acceptance: validate the private receipt with `node scripts/lib/slice-a-acceptance.mjs --receipt .tmp/slice-a-acceptance.json`; require real evidence and PASS for `AUTH_SIGNUP`, `AUTH_EMAIL_VERIFICATION`, `AUTH_LOGIN`, `AUTH_SESSION_PERSISTENCE`, `DEFAULT_IDENTITY`, `CONSENT_FLOW`, `AUTH_RESEND_VERIFICATION`, `AUTH_LOGOUT`, `AUTH_RELOGIN`, `AUTH_PASSWORD_RECOVERY`, `EMAIL_DELIVERY`. Record tested provider scope and separate legal status. A missing email/old-password test/operator ambiguity remains explicit; no lifecycle PASS from build/tests/source alone.
- [ ] After human confirmation of the redacted evidence summary, stage documentation only and commit `docs: record authorized slice A acceptance outcomes`. A blocked/incomplete run records its actual status instead; do not invent a complete receipt. No automatic readiness claim for Slice B/C or large-scale capacity.

```sh
git add docs/ops/product-recovery-slice-a-acceptance.md
git commit -m "docs: record authorized slice A acceptance outcomes"
```

## Coordinator Self-Review and Human Boundary

1. Spec coverage: A1 baseline map covers six confirmed defects; Tasks 1/3/2/4/5/6-7/8 cover A2/A3/A4/A5/A6/A7/A8-A9 respectively. Current/outdated consent, profile usability and refresh are included. B/C remain distinct future projects.
2. Granularity: eight independently reviewable deliverables, each with test assertions, explicit RED/GREEN commands and focused staging; baseline/harness setup stays with its owning behavior. Task 8 has explicit engineering, review/PR and separately authorized deployed phases rather than claiming one local test proves delivery.
3. Types: one shared summary contract consumed by the header; nullable stats preserve unavailable vs zero; adapter seams reuse existing Auth/consent clients. All introduced helper names/CLI fields have an owning task. Reset has its own bounded adapter, not a new identity authority.
4. Review Focus: redirect/expired submission ->1; stale account ->3; missing/RLS/optional data ->2; provider failures/enumeration ->5; recovery replay and false delivery PASS ->6-8. Privacy assertions cover API, diagnostics and receipts.
5. Proportion: signatures, concrete assertions and commands rather than product bodies; no micro-project per assertion. Scope excludes global Settings, product detail, Slice B/C implementation, unrelated infra and deferred programs. Only documentation is changed while preparing this plan.

SELF_REVIEW=PASS; SLICE_A_TASK_COUNT=8; IMPLEMENTATION_STARTED=false. Plan readiness is not product acceptance. Human must review this plan and choose subagent-driven or native execution before work starts; subagent-driven is recommended because auth, private identity and evidence contracts merit independent task review. No execution, merge, deploy or provider/Production authorization is granted here.
