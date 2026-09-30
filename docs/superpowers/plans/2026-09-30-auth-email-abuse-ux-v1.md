# Auth Email Abuse and UX v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make signup, verification resend, password recovery, and conditionally password login truthful and bot-resistant without breaking auth during the pre-enforcement rollout.

**Architecture:** A shared Worker runtime mode (`off | prepare | required`) controls whether the client obtains Turnstile tokens and whether the resend Worker demands one. Supabase Auth alone verifies each token when its project CAPTCHA toggle is enabled; the Worker never Siteverifies a forwarded token. `prepare` is the deliberate code-deployed/provider-not-enforced state: absent or failed auth widget must not block ordinary auth before Supabase enforcement. The 60-second timer is UX, alongside the unchanged 5/24h server resend limiter.

**Tech Stack:** Astro 7.2.10 SSR with `@astrojs/cloudflare` 14.2.6 on Cloudflare Workers; React 19 (lockfile-resolved 19.2.8) AuthPanel; lockfile-resolved `@supabase/supabase-js` 2.112.4; Cloudflare Turnstile; Vite/Playwright and Node test scripts. These are the current package/lockfile versions, not dependency-change targets.

**Spec:** `docs/superpowers/specs/2026-09-30-auth-email-abuse-ux-v1-design.md` at approved commit `8e99e6af`.

## Global Constraints

- Base `origin/main` is `e6c5f60a8c98a5755321e00ce880885ae0415a7c`; work only on isolated `fix/auth-email-abuse-ux-v1`. Do not touch the unrelated dirty checkout.
- Supabase Auth is the only Turnstile verifier for signup, resend, recovery, and password login when its project CAPTCHA is enabled. Never Siteverify then forward the same token. Tokens are single-use, never logged or stored.
- Do not claim server-side bot protection while Supabase CAPTCHA is off or its actual Production enforcement is unverified. `LOGIN_REQUIRES_TOKEN=CONTRACT_REQUIRED_WHEN_CAPTCHA_ENABLED`; `PRODUCTION_LOGIN_TOKEN_ENFORCEMENT=UNKNOWN` until separately authorized observation.
- Preserve the hashed-IP resend RPC at **5 attempts / 24 hours**. Initial accepted signup starts the **60-second** client UX cooldown; localStorage is not the rate-limit boundary.
- No email-existence endpoint, service-role lookup, privileged `auth.users` query, or definite email-sent/account-exists copy from an ambiguous Auth result. Use `NO_RELIABLE_SIGNAL` unless a supported project signal is proven read-only.
- Forgot-password mode has no login/register tabs. Preserve PR #7: no runtime age/policy/consent gate or write, callback consent lookup, global LegalConsentGate, or mutation consent prerequisite; keep the compact signup legal notice.
- Human-observed fresh Gmail, QQ, and 163 verification delivery is PASS only for those tested providers. The reused QQ account did not trigger new mail. Do not claim all Chinese providers, restart Brevo/SMTP diagnosis, or investigate Mainland-China VPN compatibility.
- No Production provider configuration, SQL, new Production Auth email, merge, or deployment is authorized by writing or reviewing this plan. Later execution still needs separate reviewed authorization for rollout and acceptance.

## Review Focus

1. Missing/invalid `AUTH_CAPTCHA_MODE`: `off` only when absent; invalid explicit values fail configuration checks instead of silently disabling protection (Task 2 tests).
2. Widget script blocked while Supabase CAPTCHA is **off**: `prepare` login/signup/resend/recovery still use the legacy no-token path, with no false security claim (Task 3 tests).
3. A stale `off` or `prepare` browser tab after Supabase enforcement turns on: Auth rejection is actionable, never reported as sent/signed-in; refreshing obtains current no-store runtime mode (Tasks 4 and 5 tests).
4. Duplicate/obfuscated signup without a session: neutral copy and login/forgot actions, no fabricated delivery or account enumeration (Task 4 tests).
5. Refresh during/after cooldown: active countdown restores from absolute expiry, expired cooldown reveals resend without duplicate intervals or a fabricated 24h account-validity assertion (Task 4 tests).

---

## File Map and Shared Interfaces

| File | Responsibility |
| --- | --- |
| `src/lib/auth-captcha-mode.ts` (new) | `AuthCaptchaMode = "off" | "prepare" | "required"`; `parseAuthCaptchaMode(raw: string | undefined): AuthCaptchaMode`. Missing means `off`; other values are errors. No provider-state inference. |
| `src/pages/login/index.astro` | Read `AUTH_CAPTCHA_MODE` and dedicated public `PUBLIC_AUTH_TURNSTILE_SITE_KEY` from the Worker runtime; pass mode/site key to client-only `AuthPanel`. Set no-store on this dynamic auth response so a fresh visit observes the current mode. |
| `src/components/forum/AuthTurnstile.tsx` (new) | Managed, dark, interaction-only widget; flexible/compact responsive sizing; one-shot `AuthCaptchaAdapter` with `acquireToken(): Promise<string | null>` and `reset(): void`; no persisted token. |
| `src/components/forum/AuthPanel.tsx` | Mode-aware token calls, first-signup cooldown, generic duplicate state, forgot-mode layout and actions. Optional injected `captchaAdapter` supports deterministic tests. |
| `src/lib/legal-consent-adapters.ts` | Add optional `captchaToken?: string` to login/signup/reset adapter inputs without changing consent behavior. |
| `src/pages/api/auth/resend-confirmation.ts` | Accept optional `captchaToken`; in `required`, reject missing token before limiter/provider request; in `prepare`, forward if present; in `off`, preserve old path. Supabase verifies token; Worker never Siteverifies it. |
| `src/lib/auth-messages.ts` | zh-CN/en conditional mail and bounded CAPTCHA error copy. |
| `wrangler.toml` | Add explicit `AUTH_CAPTCHA_MODE = "off"` to preview and production only in the code PR. Dedicated auth public site key is not invented or committed until a separately reviewed configuration step. Existing upload Turnstile bindings stay unchanged. |
| `scripts/test-auth-email-abuse-ux.mjs` (new), `scripts/test-auth-captcha-mode.mjs` (new), existing auth/email tests and visual harness | Local RED/GREEN, runtime-mode, API, browser, cooldown, and regression checks. External HTTP/WebSocket denied except loopback. |
| `docs/ops/product-recovery-slice-a-acceptance.md` | Record scoped Gmail/QQ/163 human observations and the new bot-protection configuration/acceptance gate without claiming Production Slice A PASS. |

`AuthPanel` receives `captchaMode: AuthCaptchaMode`, `authTurnstileSiteKey?: string`, and test-only `captchaAdapter?: AuthCaptchaAdapter`; its default mode in local fixtures is `off`. The live widget is mounted only for `prepare` with a usable site key or for `required`. In `prepare`, missing site key, script failure, challenge error, or no token falls back to an ordinary no-token Auth request; this is intentional only while provider enforcement is off. In `required`, those conditions block locally with a bounded safety message. A submitted token is reset after any attempt. `required` must not be activated without a valid widget/site key and all-flow preflight.

The login route and resend API parse the **same Worker runtime binding**, not independently compiled frontend constants. Fresh auth pages see a no-store SSR mode prop. A tab opened in `off` can remain open through `off -> prepare -> Supabase CAPTCHA ON` and still send no token; a stale `prepare` tab can also lack a valid token. Once Supabase enforcement is ON, both must receive bounded refresh/retry guidance on CAPTCHA rejection, never a success/email-sent/signed-in state. A refresh reads the current no-store SSR mode. No public email-existence endpoint is created. A malformed runtime mode is a configuration error, never an implicit downgrade to `off`.

## Task 1: Establish the Eight RED Regressions

**Files:** Create `scripts/test-auth-email-abuse-ux.mjs`; modify `scripts/test-auth-email-observability.mjs`, `tests/visual/legal-consent-harness/main.tsx` only for deterministic scenarios.

**Interfaces:** Browser fixture records calls but never logs passwords, tokens, or addresses beyond fixed `.invalid` test data. API fixture keeps injected `createResendPost` dependencies.

- [ ] Add named failing assertions for `FIRST_SIGNUP_RESEND_COOLDOWN_MISSING`, `RESEND_AVAILABLE_IMMEDIATELY_AFTER_INITIAL_EMAIL`, `FORGOT_PASSWORD_STILL_SHOWS_LOGIN_SIGNUP_TABS`, `SIGNUP_EMAIL_SEND_WITHOUT_BOT_PROOF`, `RESEND_EMAIL_WITHOUT_BOT_PROOF`, `PASSWORD_RESET_EMAIL_WITHOUT_BOT_PROOF`, `PASSWORD_LOGIN_WITHOUT_BOT_PROOF`, and `EXISTING_ACCOUNT_FALSE_CHECK_INBOX_STATE`. Run all four missing-proof cases with explicitly injected `captchaMode=required`; the password-login case asserts zero sign-in SDK calls without a fresh token. `off` and pre-enforcement `prepare` login must remain permissive when the widget is unavailable. Use a fake clock for initial cooldown and a no-session obfuscated result for the duplicate case.
- [ ] Run `node scripts/test-auth-email-abuse-ux.mjs` and `node scripts/test-auth-email-observability.mjs` with external networking denied. Record each expected RED failure; do not accept setup/module-load failures as proof.
- [ ] Commit only the RED tests/fixture changes with explicit paths. No production code before these eight assertions fail for the intended reasons.

## Task 2: Runtime Mode Contract and Safe Pre-Enforcement Default

**Files:** Create `src/lib/auth-captcha-mode.ts`, `scripts/test-auth-captcha-mode.mjs`; modify `src/pages/login/index.astro`, `wrangler.toml`, and the Worker environment contract test if needed.

**Interfaces:** `parseAuthCaptchaMode(undefined) === "off"`; `off|prepare|required` pass through; invalid explicit input throws a bounded configuration error. `AuthPanel` receives `captchaMode` and public auth site key from the SSR page. No secret prop exists.

- [ ] Write tests for absent/valid/invalid mode, missing site key behavior in `off` and `prepare`, and no-store SSR wiring; run `node scripts/test-auth-captcha-mode.mjs` to RED.
- [ ] Implement the pure parser and SSR prop wiring. Add explicit `off` values to preview/production Worker vars; leave the dedicated auth site key unset. Do not reuse the upload widget by assumption.
- [ ] Run `node scripts/test-auth-captcha-mode.mjs` to GREEN, then `npm run test:workers-env-contract` and `npm run test:workers-config`; check that the code-deployed/provider-off state does not depend on Turnstile availability.
- [ ] Commit the parser, route, config, and tests with explicit paths.

## Task 3: Managed Turnstile Control and Transitional Behavior

**Files:** Create `src/components/forum/AuthTurnstile.tsx`; modify `src/components/forum/AuthPanel.tsx`, `tests/visual/legal-consent-harness/main.tsx`, `scripts/test-auth-email-abuse-ux.mjs`.

**Interfaces:** `AuthCaptchaAdapter.acquireToken(): Promise<string | null>` and `.reset(): void`; `AuthPanel` can inject this adapter in tests. Real control renders official Turnstile in Managed/dark/interaction-only mode, flexible size when supported, and obtains one token per attempt.

- [ ] Add RED tests for `off` never loading a widget, `prepare` passing a fresh token when available but proceeding without one when widget/site key/script fails, `required` blocking on missing/error/expired widget state, and reset after each submitted attempt. Include a direct mocked-widget callback test and a 390/430 width assertion.
- [ ] Implement the smallest control and mode-aware acquisition path; keep the token only in memory until one request, then reset. Never call Worker Siteverify and never expose the secret.
- [ ] Run `node scripts/test-auth-email-abuse-ux.mjs` to GREEN for widget/mode cases; check no token appears in console/error output or storage. Commit only related files.

## Task 4: AuthPanel Email Truthfulness, Cooldown, Recovery Layout, and SDK Tokens

**Files:** Modify `src/components/forum/AuthPanel.tsx`, `src/lib/legal-consent-adapters.ts`, `src/lib/auth-messages.ts`, `tests/visual/legal-consent-harness/main.tsx`, `scripts/test-auth-email-abuse-ux.mjs`, and existing source-contract tests only where the preserved behavior has a new safe expression.

**Interfaces:** Use supported SDK `options.captchaToken` on `signUp` and `signInWithPassword`, and `captchaToken` in `resetPasswordForEmail` options. Adapter arguments mirror those optional fields. Keep the `pendingVerificationEmail` state separate from any account-existence claim.

- [ ] Add/finish RED cases for fresh, explicit duplicate, obfuscated duplicate, and safely indistinguishable unconfirmed responses; assert generic conditional wording unless a supported signal is proven. Verify direct login/forgot actions and no privileged lookup. Assert `PASSWORD_LOGIN_WITHOUT_BOT_PROOF` blocks the SDK in `required`, while `off` and provider-OFF `prepare` keep normal login usable without a widget.
- [ ] Add RED fake-clock/storage cases for initial 60 seconds, one-second ticks, disabled resend, refresh restoration, expiry at zero, no duplicate timer, successful resend restart, and a sessionStorage pending-email record with **no invented 24h validity**. Simulate provider `captcha_failed` after enforcement in stale `off` and stale `prepare` tabs for `STALE_OFF_LOGIN_AFTER_ENFORCEMENT`, `STALE_OFF_SIGNUP_AFTER_ENFORCEMENT`, and `STALE_OFF_RECOVERY_AFTER_ENFORCEMENT`, plus corresponding `prepare` cases. Assert no signed-in state or email-sent claim, bounded refresh/retry guidance, and a fresh no-store login response supplying the current runtime mode.
- [ ] Add RED DOM cases for forgot mode: no auth tablist/password/signup controls, email/Turnstile/reset/back controls present; back restores login without clearing the typed email.
- [ ] Implement minimal state/copy/SDK changes, mapping CAPTCHA failures to bounded localized errors; do not promise email delivery. In `off` and widget-unavailable `prepare`, all four ordinary auth paths retain their previous no-token call semantics.
- [ ] Run `node scripts/test-auth-email-abuse-ux.mjs`, `node scripts/test-auth-legal-acknowledgement.mjs`, `node scripts/test-legal-consent-auth-flow.mjs`, `node scripts/test-runtime-consent-frontend.mjs`, and `node scripts/test-password-recovery.mjs` to GREEN. Commit related paths only.

## Task 5: Resend API Token Forwarding Without Rate-Limit or Enumeration Regression

**Files:** Modify `src/pages/api/auth/resend-confirmation.ts`, `scripts/test-auth-email-observability.mjs`, `scripts/test-auth-email-abuse-ux.mjs`.

**Interfaces:** `ResendPayload` adds `captchaToken?: string`; injected `resend(email: string, redirectTo: string, captchaToken?: string)` records forwarding without revealing value. Parse `AUTH_CAPTCHA_MODE` through Task 2's helper.

- [ ] Add RED route tests: `off` and `prepare` without token preserve requests and 5/24h limiter before Supabase enforcement; `prepare` with token forwards once; `required` without token makes zero limiter/provider calls; `required` with token invokes limiter once and forwards once; rate-limit denial makes zero provider calls; injected provider CAPTCHA rejection (expired/replay equivalent) returns a bounded retry state without raw error/token. For `STALE_OFF_RESEND_AFTER_ENFORCEMENT`, simulate a stale `off` tab sending no token while the Worker is currently in `prepare` (State C) or `required` (State D). Assert no false email-sent claim, bounded refresh/retry guidance, and a fresh no-store login response supplying the current mode; retain stale-`prepare` cases. Account-specific provider errors stay indistinguishable. Local fakes prove application handling, not live Supabase rejection.
- [ ] Implement validation/forwarding using Supabase `resend({ type: "signup", email, options: { emailRedirectTo, captchaToken } })`. Never Siteverify in the Worker. Preserve hashed-IP limiter order and existing generic response semantics for indistinguishable account outcomes.
- [ ] Run `node scripts/test-auth-email-observability.mjs` and `node scripts/test-auth-email-abuse-ux.mjs` to GREEN with external networking denied. Commit related files only.

## Task 6: Documentation, Full Local Verification, and Independent Review

**Files:** Modify `docs/ops/product-recovery-slice-a-acceptance.md`, `package.json` only if adding focused test scripts; review all changed files.

- [ ] Add the scoped human observations: fresh Gmail, QQ, and 163 signup-verification receipts PASS; reused QQ did not produce new mail; no universal Chinese-provider claim. Keep Production Slice A acceptance partial and Mainland-China VPN compatibility deferred. Document that mode `prepare` is not security enforcement.
- [ ] Verify the eight original RED cases and all four stale-`off` cases are GREEN, retain stale-`prepare` coverage, and run fresh focused auth, resend, password-recovery, and mode/widget tests. Then run `npm run test:product-recovery-slice-a`, `npm test`, `npm run build`, `npm run qa:release`, and `git diff --check`; record exact exits, not retries-as-PASS.
- [ ] Use the local browser/harness with external network blocked to inspect login, signup, pending 60s, resend ready, forgot, Turnstile interaction/error, and `off`/`prepare` widget-unavailable behavior at widths 390, 430, and 1440. Confirm no horizontal overflow, duplicate actions, or consent regressions.
- [ ] Obtain independent whole-branch review for bypass, token double-consumption/replay/logging, secret exposure, duplicate enumeration, resend limit, false mail claims, recovery/login breakage, PR #7 regression, and mobile overflow. Fix confirmed P0/P1/P2 findings and rerun affected/full checks.
- [ ] Stage explicit paths, commit logically, push `fix/auth-email-abuse-ux-v1`, and create a PR against `main` only after checks/review pass. Attach the PR to this task. Do not merge, deploy, change provider config, or mark Production acceptance complete.

## Separate Human Rollout and Rollback Gate (Not Authorized by This Plan Review)

| State | Supabase CAPTCHA | Worker `AUTH_CAPTCHA_MODE` | Auth behavior and proof boundary |
| --- | --- | --- | --- |
| A: code first | OFF (read-only confirm) | `off` | New code is deployed but Turnstile is not loaded or required. Login/signup/resend/recovery retain legacy behavior even with no auth widget/site key. Existing server resend 5/24h remains. **No bot-protection PASS.** |
| B: widget preparation | OFF | `prepare` | Dedicated public auth site key is configured by a separate reviewed Worker config change; real widget is attempted and its token forwarded when available. Missing/broken widget falls back to no-token Auth calls, so ordinary auth remains usable. Supabase secret/provider may be privately prepared only if the Dashboard allows saving them without enabling enforcement; otherwise stop and coordinate the next gate. **No bot-protection PASS.** |
| C: bounded transient provider enablement | ON, provider Turnstile | `prepare` temporarily | Enter only within a pre-approved State-C change/dwell window with a named rollback owner, success criteria, and deadline supplied by the later rollout authorization. Supabase now verifies tokens; missing/expired/replayed tokens may reach Auth but must be rejected without email/session. Stale `off`/`prepare` tabs and propagation are explicit risks. State C is never an indefinite stable Production state. |
| D: enforced app UX | ON | `required` | A separately reviewed Worker config deployment requires a token locally and on resend API. Recheck all four flows and direct missing/replay rejection under fresh authorization. Only observed server enforcement plus functional acceptance can support PASS. |

The **single source of truth for app mode** is the Worker `AUTH_CAPTCHA_MODE` binding, declared in reviewed `wrangler.toml` changes and read by both SSR login and resend API. `PUBLIC_AUTH_TURNSTILE_SITE_KEY` is a separate public auth-widget binding, not the existing upload widget binding; its value is supplied privately by the human/config review, never fabricated in code. Supabase's own toggle/provider/secret are independent provider settings. Mode changes B and D require reviewed configuration-only deployments; do not rely on an untracked Dashboard override that a later deploy could erase. Before step C, the human must read-only confirm `SUPABASE_CAPTCHA_ENABLED=false`, Turnstile provider selection/secret pairing, widget Managed mode and canonical-hostname restriction, and obtain a **pre-approved bounded State-C change/dwell window**. The later rollout authorization supplies its duration, deadline, owner, and request budget; this plan invents no numeric duration. Unknowns remain blockers to step C, not guessed defaults. Each verification attempt must have a pre-approved owned QA account/inbox and safe logs; this plan authorizes no new Production email.

**Rollback:** Before C, revert the app mode to `off` through a reviewed config deployment; provider remains off, so ordinary auth continues. During C, monitor bounded outcomes; unexpected legitimate auth failure or inability to deploy **and verify D within the authorized State-C window** stops the rollout. The authorized human first restores the recorded pre-change Supabase CAPTCHA state (for the intended OFF-to-ON rollout, turn enforcement OFF), confirms the state read-only, and records `BOT_PROTECTION=DEGRADED`. Do not leave Production indefinitely in ON + `prepare`, and do **not** revert token-capable app code while Supabase enforcement remains ON. Then, if needed, revert app mode to `prepare` or `off` through a reviewed deployment and perform only separately authorized bounded login/recovery checks. The server resend 5/24h and provider rate limits stay intact. Re-enable only after corrected code/widget config, fresh four-flow checks, and a new human approval. If provider settings cannot be staged without simultaneously enabling CAPTCHA, stop at B and obtain a coordinated change window; do not improvise an enablement order.

## Plan Review Gate

This document makes no implementation, Production configuration, deployment, or acceptance claim. The human reviews this plan and chooses execution method before product-code work. Even after execution approval, stages A-D require their own deployment/provider authorizations; they are not implied by a green code PR.
