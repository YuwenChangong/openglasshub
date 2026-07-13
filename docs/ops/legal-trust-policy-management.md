# OpenGlass Hub Legal & Trust Policy Management

## Phase 1 scope

Phase 1 adds public legal and trust content only. It covers centralized policy configuration, bilingual public policy pages, restrained public legal links, the `/register/` redirect into the combined login/register page, and offline validation for this surface.

Phase 1 does not authorize production deployment by itself. It also does not add a consent checkbox, consent persistence, database migration, RLS, authenticated gating, or mutation-route enforcement.

## Central configuration

The single source of truth is [src/lib/legal-policy.ts](/D:/OpenGlass%20Hub%20interaction-release-fresh/src/lib/legal-policy.ts).

Current platform policy values:

- Platform name: `OpenGlass Hub`
- Minimum age: `16`
- Bundle version: `2026-07`
- Terms version: `2026-07`
- Privacy version: `2026-07`
- Guidelines version: `2026-07`
- Effective date: `2026-07-12`
- Supported languages: `zh-CN`, `en`

Update these values intentionally. Versions are explicit release constants and must not be derived automatically from build time.

## Updating policy content

When updating the legal bundle:

1. Update the relevant version constant in [src/lib/legal-policy.ts](/D:/OpenGlass%20Hub%20interaction-release-fresh/src/lib/legal-policy.ts).
2. Update the effective date intentionally.
3. Revise both Chinese and English content together.
4. Keep Chinese and English meaning aligned even if wording is not literal.
5. Re-run `npm run test:legal-content` and the full regression suite.

Chinese and English parity is required for every public legal page in this phase.

## Public contact configuration

Public operator and contact configuration is read from public environment variables, not secrets:

- `PUBLIC_LEGAL_OPERATOR_NAME`
- `PUBLIC_SUPPORT_EMAIL`
- `PUBLIC_ABUSE_EMAIL`
- `PUBLIC_PRIVACY_EMAIL`
- `PUBLIC_IP_EMAIL`

These values must be genuine public launch values before launch. Do not add fake placeholders, private developer email addresses, or non-working forms.

Missing public operator/contact configuration blocks a fully ready legal launch classification. Phase 1 may be classified as configuration-required until those public values exist.

## Review requirements

Every policy revision should go through:

- product/ops review for feature accuracy
- bilingual content review for parity
- visual review on desktop and mobile
- qualified lawyer review before public launch

The `16+` rule is a platform policy, not a universal legal-compliance guarantee. Users remain subject to mandatory applicable local laws.

## Deferred follow-up phases

Phase 2:
- one combined, unchecked-by-default `16+` acknowledgement checkbox on every password login and registration attempt
- agreement to the Terms of Service and Community Guidelines, plus acknowledgement of the Privacy Policy
- separate, keyboard-accessible policy links within that one checkbox label
- frontend/auth-entry enforcement only, with no server acceptance record, localStorage proof, or cookie proof
- password recovery and resend confirmation remain recovery/verification actions, not acceptance
- policy links open without submitting or changing the current auth mode

Phase 3:
- Phase 3A now defines a versioned `legal_policy_acceptances` history table. It keeps one row per user and policy bundle, preserves old bundle rows, and reconfirms the active bundle by updating confirmation metadata only.
- Supported acceptance sources are `registration`, `login`, `policy_update`, `legacy_account_gate`, and `authenticated_callback`. Versions, minimum age, timestamps, counters, and the authenticated user identity are server-controlled.
- RLS permits an authenticated user to read only their own rows. Direct browser insert, update, and delete privileges are revoked. The authenticated API verifies the bearer identity before creating its narrowly scoped service-role repository and calling the server-only upsert RPC.
- `GET /api/legal/consent` returns only current-bundle status. `POST /api/legal/consent` accepts only `{ "accepted": true, "source": "..." }`, enforces JSON and a 1 KiB body limit, rejects client IDs/versions/timestamps, and limits current-bundle reconfirmations to one per authenticated user per minute.
- Future deployment of the write endpoint requires the existing Supabase service-role secret to be configured as the server-only `SUPABASE_SERVICE_ROLE_KEY` runtime binding. Never expose it to browser code, public configuration, logs, or documentation examples.
- The migration is committed for future release order only. It has not been run against production, staging, preview, or local Supabase. Rollback requires a reviewed database migration and must account for retained legal-history records rather than deleting them casually.
- Phase 3A intentionally does not wire the API into login/signup or the public `/legal-consent/` page. It also does not globally gate authenticated pages.

Phase 3B:
- login/signup persistence integration
- authenticated consent page and current-consent gate

Phase 3B1:
- password login records the current bundle only after Supabase returns an in-memory authenticated session; normal navigation waits for the authenticated API result.
- signup with an immediate session records source `registration`. Signup pending email confirmation records nothing and lets the first authenticated callback route to `/legal-consent/`.
- the callback checks current status, never records acknowledgement automatically, and routes missing, outdated, or unavailable status to the consent page with a sanitized internal destination.
- `/legal-consent/` supports signed-out guidance, current-status display, one combined acknowledgement, retry, and logout. It does not expose history, row IDs, tokens, or client-controlled versions.
- Phase 3B1 requires the server-only service-role runtime binding and the unapplied migration before any production write can work. Phase 3B2 remains responsible for broader session/page gating.

Phase 4:
- mutation-route enforcement
- release gate for versioned consent requirements

Do not treat Phase 1 alone as permission to deploy a full legal-compliance system.
# Phase 3B1 offline visual harness

The Phase 3B1 login, callback, and consent components accept optional typed auth, consent, and navigation adapters. Production pages do not supply them and retain the existing Supabase browser client, consent API helper, and browser navigation behavior. The adapters are not selectable through URL parameters, cookies, local storage, headers, or public environment variables.

The test-only harness is located at `tests/visual/legal-consent-harness/`. It is served by `npm run test:legal-consent-visual` with a temporary local Vite server and uses only in-memory fake sessions and consent responses. It is outside `src/pages`, is not linked from the application, and the visual test rejects non-local network requests. The command captures the desktop and mobile state matrix, interaction/accessibility checks, overflow results, redacted call records, and screenshots in an OS temp evidence directory.

The canonical 30-state manifest is `tests/visual/legal-consent-state-matrix.mjs`. States 1 through 25 require screenshots at 1440x900, 430x932, and 390x844, for a minimum of 75 screenshots. Callback outcomes 26 through 30 require structured redirect results instead. The generated `matrix.json` must show 30 expected, executed, and passed states, no missing or duplicate IDs, five passing redirect assertions, 75 or more screenshots, and zero unexpected external requests. Evidence is saved under `openglass-legal-consent-phase3b1-matrix-*` in the OS temp directory. Phase 3B1 cannot be marked ready from partial coverage.

## Phase 3B2A page gate

`src/lib/legal-consent-route-policy.ts` is the single page-route policy: exempt routes remain available, community reading routes remain public only while signed out, and notifications, account, create/edit/manage, and admin routes require both a session and current consent. `CommunityLayout.astro` mounts the reusable gate and hides gated page content until the client session and consent status resolve. Missing, outdated, or failed authenticated consent status does not reveal protected content. It redirects only to sanitized internal login or legal-consent destinations and uses replace navigation to limit loops. Admin consent is additional to, never a replacement for, existing role checks.

This is page/session enforcement only. Mutation APIs remain intentionally unchanged until Phase 4, so direct API bypass is not prevented by Phase 3B2A. Production migration/runtime configuration, public legal contact values, and qualified legal review remain pending.

## Phase 4A1 redirect-sanitization blocker

Phase 4A1 is blocked on redirect sanitization. `src/pages/api/auth/resend-confirmation.ts#POST` remains incomplete after source evidence showed that `getSafeNext` accepts `/\\evil.example` through its leading-slash branch, and the value can reach `window.location.replace` after the auth callback as an external origin. Production remains NO_GO.

Remediation must be a separate centralized runtime-security task for `src/lib/auth-redirect.ts`, not a legal-consent guard change. Every `getSafeNext` caller requires review, including login, signup, callback, consent, header, and CTA flows; password recovery uses a separate redirect helper and must also be checked as part of the same remediation review. After a reviewed runtime fix, the resend-confirmation endpoint requires a separate source re-audit before Batch 3 can resume.

## Phase 3B2B route coverage

`tests/fixtures/legal-consent-page-routes.mjs` is the authoritative page-route inventory. `npm run test:legal-consent-route-coverage` compares discovered Astro page files to that inventory, verifies a single central classification for each pattern, and confirms the shared CommunityLayout hosts the gate. New production pages must be added to this inventory and classified before release. API and test-only routes are deliberately excluded. Page-level coverage does not protect direct mutation APIs; that remains Phase 4.

The current audit covers 44 production Astro routes: 23 exempt, 7 public-conditional, and 14 authenticated-and-consented, with zero coverage gaps. No Phase 3B2B page types required additional visual evidence because the audit introduced no new layout integration; the Phase 3B1 and 3B2A offline matrices remain the canonical UI evidence. The mobile-header regression is an external-server consumer: start `node node_modules/astro/astro.js dev --host 127.0.0.1 --port 4323`, wait for an HTTP 200 from `http://127.0.0.1:4323/`, run the test, then stop only that spawned process. It passed twice consecutively with the known local feed/circles binding warnings.

## Phase 4A1 checkpoint

The policy-level mutation inventory is checkpointed before deep execution tracing. All 66 methods are deterministically assigned to six pending batches. Evidence-backed tracing must reach 66/66 before Phase 4A1 can be ready; no mutation endpoint is protected at this checkpoint, and Phase 4A2 remains the first representative route integration phase.

## Phase 4A1 release blocker checkpoint

The `src/pages/api/admin/users/[id]/ban.ts#POST` privilege blocker was cleared by re-audit after remediation commit `56af1cf6b7c4e0aa5df8f35539d5e4cceea80217`. `applyUserSafetyAction` re-reads server-side actor and target roles and fails closed before safety-state access: moderators may target only users; administrators may target users or moderators but never administrators; self, missing, and unknown roles deny. The historical blocker evidence and regression checks remain in the ordering audit. Batch 3 is still pending and Phase 4A1 remains `NO_GO` until every trace is complete.

Run the normal production build after changes and inspect its output for harness names and fake fixture values. The harness is not a production route and does not introduce global page gating or mutation enforcement. Database migration/runtime configuration, public operator contact configuration, and qualified legal review remain separate prerequisites for release.
