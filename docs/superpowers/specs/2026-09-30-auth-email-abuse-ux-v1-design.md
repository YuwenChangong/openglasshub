# Auth Email Abuse and UX v1 Design

Date: 2026-09-30. Status: design direction approved; written specification awaiting human review. Implementation, provider configuration, Production testing, merge, and deployment are not authorized by this document.

## 1. Intent and Scope

Close Product Recovery Slice A's remaining signup, verification-resend, and password-recovery UX/abuse gaps without weakening account-enumeration resistance or PR #7's removal of runtime consent. The work belongs on `fix/auth-email-abuse-ux-v1`, based on `origin/main` `e6c5f60a8c98a5755321e00ce880885ae0415a7c`. This specification is documentation only; it is not the implementation plan or an acceptance receipt.

Fresh owned Gmail, QQ, and 163 verification mailboxes received signup messages, per the human's observations. A reused, already-registered QQ address did not receive a new confirmation. This is evidence for those three tested providers only, not all Chinese providers, all flows, or future delivery. No further Brevo/SMTP/DNS diagnosis or Production mail send is in scope. Mainland-China VPN compatibility is deferred.

## 2. Verified Source and Contract Evidence

| Evidence | Design consequence |
| --- | --- |
| Installed `@supabase/supabase-js` is `2.112.4`. Its installed `@supabase/auth-js` types support `captchaToken` for password `signUp`, `signInWithPassword`, `resend({ type: "signup" })`, and `resetPasswordForEmail`. The installed client sends the token to Auth in `gotrue_meta_security.captcha_token`. | Use supported SDK parameters, with no type casts or bespoke Auth wire format. |
| [Supabase Auth's current route source](https://github.com/supabase/auth/blob/master/internal/api/api.go) places `verifyCaptcha` on `/resend`, `/recover`, and `/token`; [Supabase CAPTCHA guidance](https://supabase.com/docs/guides/auth/auth-captcha) covers signup, sign-in, and password recovery. | When project CAPTCHA is enabled, Supabase Auth is the sole verifier for all four covered flows. Login must receive a token if project enforcement requires one. Current upstream source does not prove this project's deployed configuration. |
| [Supabase signup reference](https://supabase.com/docs/reference/javascript/auth-signup) documents obfuscated/fake user responses for some existing-user configurations. Current `AuthPanel.tsx` maps signup results to session-only data, discarding user and identities. | A null session is not proof that a fresh email was sent. Do not infer account existence from undocumented user fields. |
| `AuthPanel.tsx` starts its persisted 60-second resend timer only after a successful resend, not after initial signup. It renders the auth tab switch above the forgot-password branch. | Start cooldown after the first accepted signup request; conditionally omit tabs in recovery mode. |
| `resend-confirmation.ts` calls `consumeVerificationEmailResendLimit` with `maxAttempts: 5`, `windowHours: 24`, hashed IP, then Supabase `resend`; its public response is intentionally generic. | Retain this server-side 5/24h limit and neutral public semantics. Client countdown is UX only. |
| `wrangler.toml` references an existing public Turnstile site key and a separate upload-flow secret. | A public key's presence is not proof that the widget is Managed, hostname-restricted, paired with Supabase's secret, or that Auth CAPTCHA is enabled. Never move or reveal the upload secret. |
| [Cloudflare widget configuration](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/) supports dark theme, interaction-only appearance, and flexible size. [Cloudflare test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) support offline tests. | Use a small responsive managed widget and deterministic local fakes/test keys; live security still depends on Supabase's server-side verification. |

## 3. Unresolved Project Facts and Evidence Gates

These values describe **current project behavior**, not what SDK types permit. No Production signup, login, resend, recovery, provider-setting write, or email-existence lookup may be performed merely to fill the table.

| Field | Current value | Required read-only evidence before implementation assumptions are frozen |
| --- | --- | --- |
| `CAPTCHA_ENABLED` | `UNKNOWN` | A human with authorized Supabase Dashboard access reports the current Authentication > Bot and Abuse Protection CAPTCHA toggle, provider type, and whether the configured public widget is Managed/hostname-restricted. No key values enter chat, logs, or this repo. Existing Worker variables are insufficient evidence. |
| `LOGIN_REQUIRES_TOKEN` | `UNKNOWN` | Read-only confirmation of the current project's Auth CAPTCHA behavior/configuration. Official Auth routes show the token endpoint uses CAPTCHA middleware when enabled, but this alone does not establish the project's present setting. Treat login-token support as required for the proposed enablement, and verify it in a non-Production or separately authorized release gate before changing Production config. |
| `SUPABASE_DUPLICATE_SIGNAL` | `UNKNOWN`; conservative UI path is `NO_RELIABLE_SIGNAL` | Inspect supported current Auth configuration and safe, already-existing redacted response evidence for fresh, confirmed-existing, and unconfirmed-existing signup, if available. The human-observed absent mail for reused QQ does not establish the exact Auth response. Do not generate a fresh Production email, submit a duplicate Production signup, query `auth.users`, or expose a service role to settle this. Without proof, retain conditional, enumeration-resistant copy. |

If authorized read-only access cannot resolve any item, the implementation plan must carry that item as an explicit gate rather than silently assigning true/false. A later, separately authorized provider-rollout/acceptance step can settle operational facts. No explicit already-registered or unconfirmed-account state ships from a guessed signal.

## 4. Chosen Architecture and Alternatives

**Chosen:** browser Turnstile widget obtains one token per attempted Auth operation; the applicable Supabase Auth request consumes it exactly once. For resend, the Worker accepts the token, preserves the existing hashed-IP rate-limit call, and forwards that token in `supabase.auth.resend(... options.captchaToken)` without calling Siteverify. Signup, login, and reset continue through the browser's supported Supabase SDK. Supabase CAPTCHA must be configured and enabled for the anti-bot claim to be true.

**Rejected:** Worker Siteverify followed by forwarding the same token to Supabase. Turnstile tokens are single-use; double consumption can reject legitimate requests. Also rejected: a Worker-only check while signup/recovery remain directly callable at Supabase, because it is bypassable. Proxying all Auth operations through a new server subsystem is disproportionate and changes the established session boundary.

The Turnstile site key is public; its paired secret lives only in Supabase Auth's provider configuration, never in browser code, HTML, repository, receipts, or logs. The existing Worker upload Turnstile secret remains separate and unchanged. The auth UI must fail closed if its widget cannot load or supply a fresh token. Client-side presence alone is never described as server protection.

## 5. Components and Request Flow

| Unit | Responsibility and boundary |
| --- | --- |
| Auth Turnstile control | Load the official script once, render Managed + `appearance: "interaction-only"` + dark theme with flexible size (compact only where needed), expose a fresh token for the active operation, surface bounded unavailable/expired/error states, and reset after every consumed or failed attempt. No token persistence or diagnostic logging. |
| `AuthPanel` | Own login/signup/recovery/pending-verification view state, route only the active form's token to its Auth call, start initial resend cooldown on accepted no-session signup, render neutral account messaging and direct login/recovery actions, and omit tabs entirely in forgot mode. Preserve typed email on return where existing UX does. |
| Resend API | Validate bounded request shape including nonempty token, preserve hashed-IP 5/24h RPC and generic anti-enumeration response, then forward token to Supabase `resend`. Never Siteverify the forwarded token or log it. Rate-limit denial or configuration failure cannot trigger a provider request. |
| Auth adapters/fixtures | Accept optional supported `captchaToken` inputs so local tests can observe routing and deterministic failure/replay behavior without live Cloudflare or Supabase. No cast around unsupported SDK types. |
| Message catalog | Keep zh-CN/en copy aligned, distinguish an accepted request from delivered mail, and offer login/forgot actions without account-disclosure promises. |

Each signup, resend, reset, and (when required by project enforcement) password-login attempt requires its own token. Missing/expired/replayed tokens cannot result in an email-generating Supabase request when project CAPTCHA is enabled. Widget callbacks and local token state are reset/rearmed after every submitted attempt, including Auth errors and network failures; retry requires a newly issued token. Turnstile verification failures are mapped to short localized user messages, never raw provider codes.

The release configuration gate is operationally separate from this code PR: the human creates/confirms a Managed widget for the canonical Worker hostname in Cloudflare Turnstile, places its public site key in the established public runtime/build configuration, and privately configures that widget's secret in Supabase Authentication > Bot and Abuse Protection. No secret is requested in chat. Before enabling Supabase project-wide CAPTCHA in Production, the deployed login, signup, resend, and recovery clients must all be token-capable and validated under an authorized, bounded rollout. Enabling the provider toggle before compatible login code is live can break login; deploying code while the toggle is off cannot be counted as server-side anti-bot protection. A safe rollout sequence and rollback/verification checks belong in the later implementation plan and human configuration gate.

## 6. Signup and Recovery UX State

Use only a supported, reliable Supabase duplicate signal if one is demonstrated for this project's current Auth settings and does not undo deliberate obfuscation. Otherwise a no-session accepted signup enters a generic pending-request state: "如果这是新邮箱，我们会发送验证邮件。如果你已经注册过，请直接登录或使用‘忘记密码’。" English conveys the same condition. Direct `登录` and `忘记密码` actions are present. The UI never says a message was certainly sent, delivered, or that an account exists on a null-session response. A proven explicit already-registered error may use the requested direct recovery state, but may not expose a new privileged lookup or create a status difference that Supabase intentionally hides. An unconfirmed account is named only if safely distinguishable; otherwise it stays in the generic state and uses the existing bounded resend path.

After the first **accepted** signup/email-verification request that enters pending state, start the 60-second cooldown immediately. Persist its absolute expiry in the existing localStorage key, clamp displayed remaining seconds to `60..1` while active, update once per second, and clean up the single interval on expiry/unmount. Expiry clears the cooldown key and reveals the ready resend action; it does not erase the pending view. To make refresh genuinely restore both the pending view and active timer, keep only the normalized pending email and a separate bounded flow expiry (at most 24 hours) in sessionStorage; clear that record when invalid, after its own expiry, or when the user explicitly exits the flow. Never store a password, Turnstile token, verification link, or account-existence inference. A confirmed-existing state, if confidently proven, does not expose resend because signup was clicked. Accepted but indistinguishable responses may show resend after cooldown, with generic wording and server protection. Successful resend restarts the cooldown; an unsuccessful/provider-ambiguous request must not claim mail was sent. The endpoint may preserve a neutral handled-request response where account distinction is unknowable, while definite transport/configuration failure uses a safe generic error without provider details.

When `forgotMode=true`, render recovery context, email, active bot control, send-reset action, and back-to-login only. Render no login/signup tablist, password field, signup notice, or registration controls in that branch. Back-to-login restores login mode and clears transient feedback but does not erase the typed email. A password-reset request success is phrased conditionally because email existence and delivery are not public facts.

## 7. Security and Failure Rules

- No `/api/auth/email-exists`, `/api/auth/check-email`, admin or service-role email lookup, browser service key, or direct Production `auth.users` probe.
- No Turnstile token in URL, local/session storage, console, telemetry, server logs, receipts, or error strings. Redact request bodies in tests/traces; logs use bounded flow/outcome categories only.
- No Worker Siteverify on a token forwarded to Supabase. Existing upload Siteverify remains unchanged and uses separate tokens.
- A missing token or unavailable widget fails closed in the UI and resend API; Supabase server validation is the actual protection against direct Auth API calls. Expiration/replay are verified by Supabase only after its CAPTCHA configuration is enabled.
- The server resend limiter stays at 5 attempts per hashed IP per 24 hours. Its denial is authoritative; local cooldown never substitutes for it. Existing Supabase rate limits also remain.
- Public responses remain account-enumeration resistant. Definitive application-wide service failure may be reported generically, but account-specific failure may not be converted into an existence oracle.
- PR #7 behavior remains: no runtime age gate, blocking policy checkbox, login/signup consent write, callback consent lookup, global LegalConsentGate, or consent prerequisite on normal authenticated mutations. Preserve signup's compact nonblocking legal links and historical records.
- No Production SQL, P9, provider configuration mutation, Production email request, merge, or deployment is part of this engineering design/review step.

## 8. Verification and Acceptance Plan for Later Implementation

Begin with RED tests for initial cooldown, immediate resend availability, forgot tabs, missing bot proof on signup/resend/reset, and false check-inbox state for reused accounts. GREEN coverage must exercise fresh/explicit-duplicate/obfuscated/unconfirmed responses, generic wording, the 60-second tick/expiry/refresh/restart, limiter preservation, all four SDK token paths as required, missing/expired/replayed tokens, widget failure/reset, no token logging or secret exposure, and back-to-login behavior. Local tests use injected adapters, fake clock/storage, and official Turnstile test support; no live provider dependency or Production mail. Focused tests precede full Slice A, `npm test`, build, `qa:release`, and `git diff --check`.

Inspect local browser states at 390, 430, and 1440 pixels: login, signup, pending with 60-second cooldown, resend ready, recovery, Turnstile interaction, and Turnstile error. Check no horizontal overflow, duplicate buttons, auth tabs in recovery, or resurrected consent UI. Independently review the whole branch for bypass, double consumption, token/secret leakage, enumeration, rate-limit weakening, false mail claims, and PR #7 regression. Real Production acceptance remains `PARTIAL_PENDING_THIS_FIX` until a separately authorized, configured and deployed test verifies server enforcement and the actual user journeys.

## 9. Review Decisions Needed

1. Confirm this written design, including the conservative `NO_RELIABLE_SIGNAL` UI default while exact duplicate behavior is unknown.
2. Supply or authorize only read-only, value-blind evidence for the three unknowns in Section 3; do not paste keys or submit new Production Auth requests for this review.
3. After written-spec approval, produce and review a separate implementation plan before any product-code change. Later human configuration, PR review, merge, deployment, and Production acceptance remain distinct gates.
