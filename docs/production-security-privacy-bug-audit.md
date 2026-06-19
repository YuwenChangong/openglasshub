# Production Security / Privacy / Bug Audit

## Scope
- Repository: `D:\OpenGlass Hub`
- Branch audited from: `main`
- Audit branch: `audit/production-security-privacy-bug-scan`
- Focus: security, privacy, authz, moderation visibility, media/upload safety, source leakage, production stability
- Excluded by instruction: redesign, product-page rework, China readiness, destructive DB actions, broad moderation redesign

## Current commit
- Base `main` commit audited: `6ced4c6f` (`Polish notification bell icon proportions`)

## Environment checked
- Local build output: `dist/`
- Production site checked: `https://openglasshub.pages.dev`
- Runtime assumptions checked statically for Cloudflare Pages + Supabase + R2
- Cloudflare dashboard / Supabase remote dashboard secrets were **not** directly inspected from this audit run

## Executive summary
- No direct secret value leakage was found in `src`, public pages, or the public client bundle.
- No evidence was found that unauthenticated users can call admin APIs successfully.
- Public product source privacy remains intact: product source ledger is not exposed in page source or first-party client scripts.
- Public visibility filters for `pending_review` / `rejected` / `hidden_by_admin` content exist across feed, search, profile, circle, and post-detail read paths.
- One **high-severity** logic bug was confirmed: content flagged for **review** in post/comment creation was still being written as publicly published. This was fixed in this audit.
- Several **medium** follow-up risks remain, mainly around incomplete Turnstile enforcement on active forum write flows and circle creation not using moderation.
- Dependency audit reports multiple upstream vulnerabilities in Astro/Vite/Cloudflare adapter related packages; these need a planned dependency upgrade rather than a blind hotfix.

## Critical findings
- None.

## High findings
### F-001
- Severity: high
- Area: Moderation / public content visibility
- Evidence: `D:\OpenGlass Hub\src\pages\api\forum\posts.ts` and `D:\OpenGlass Hub\src\pages\api\forum\comments.ts` previously rejected only `moderation.decision === "reject"`, but still inserted `status: "published"` and `moderation_status: "published"` for `review` outcomes.
- Risk: suspicious content that should enter review queue could become public immediately, bypassing moderation intent.
- Recommended fix: persist `review` outcomes as `status: pending` + `moderation_status: pending_review`, return `pending_review: true`, and keep public readers filtered to published content only.
- Fixed in this audit: yes

### F-002
- Severity: high
- Area: Dependency / supply chain
- Evidence: `npm audit --audit-level=moderate` reports high-severity advisories affecting `astro`, `vite`, `undici`, `ws`, and transitive Cloudflare adapter stack.
- Risk: framework / dev-server / SSR vulnerabilities may become production-relevant depending on exploit path and deployment topology.
- Recommended fix: plan a controlled dependency upgrade for `astro`, `@astrojs/cloudflare`, `vite`, and transitive runtime packages; do not use `npm audit fix --force` blindly.
- Fixed in this audit: no

## Medium findings
### F-003
- Severity: medium
- Area: Bot / abuse control
- Evidence: active write/upload APIs currently do not call `validateTurnstileToken(...)`. Search hits show `src/lib/server/turnstile.ts` exists, but active forum endpoints rely on auth/rate-limit without active Turnstile verification.
- Risk: anti-abuse posture is weaker than intended design; authenticated spam or scripted abuse has fewer friction points.
- Recommended fix: either fully re-enable Turnstile on the intended flows with fresh-token handling, or formally retire the requirement and rely on rate limit + moderation intentionally.
- Fixed in this audit: no

### F-004
- Severity: medium
- Area: Moderation coverage
- Evidence: `D:\OpenGlass Hub\src\pages\api\forum\circles.ts` creates circles without calling moderation helpers; duplicate/name checks and rate limit exist, but no content review path exists for circle name/description.
- Risk: abusive or policy-violating circle names/descriptions could be created without entering review.
- Recommended fix: add the same local/provider moderation decision flow to circle creation, at least for name + description.
- Fixed in this audit: no

### F-005
- Severity: medium
- Area: Dist artifact privacy / audit noise
- Evidence: broad keyword scan over `dist\_worker.js` finds generic strings like `sourceUrl`, `secret`, `access_token`, and R2 helper internals in server worker chunks.
- Risk: no live secret values were found, but naive scans can misclassify framework/runtime code and server-only worker bundles as public leak.
- Recommended fix: keep using targeted audits (`audit-public-source-privacy`) and document which findings are expected false positives in build artifacts.
- Fixed in this audit: no

## Low findings
### F-006
- Severity: low
- Area: Legacy repository surface
- Evidence: `D:\OpenGlass Hub\functions\_lib\supabase.ts` still contains a deprecated `createServiceClient(...)` helper referencing `SUPABASE_SERVICE_ROLE_KEY`, while `functions/api/forum/posts.ts` is marked deprecated / ignored under current Astro Cloudflare worker output.
- Risk: not active in current deployment path, but it increases repository confusion and future misuse risk.
- Recommended fix: delete or quarantine deprecated `functions/` code if it is no longer part of deployment.
- Fixed in this audit: no

### F-007
- Severity: low
- Area: Admin route UX / disclosure surface
- Evidence: production `/admin/moderation/` returns HTTP 200 with a login gate shell and explanatory copy, while data APIs correctly return 401 without bearer token.
- Risk: no data leak observed, but admin route existence and page copy remain visible to unauthenticated visitors.
- Recommended fix: acceptable as-is if intentional; otherwise add stronger SSR auth gate/redirect for cleaner surface.
- Fixed in this audit: no

## False positives / accepted risks
- Broad secret scan hits on `access_token`, `refresh_token`, `secret`, and `jwt` inside bundled Supabase/runtime code did **not** reveal real environment values.
- `dist\_worker.js\pages\guides.astro.mjs` contains guide/article `sourceUrl` fields, but this is separate from the product-source privacy boundary; no product source ledger leakage was found.
- `functions/` service-role helper is deprecated and not part of the active Cloudflare worker route path according to in-file documentation and current Astro adapter flow.

## Required immediate fixes
- Fix moderation review-state persistence so review outcomes no longer publish immediately.
- Re-run build + moderation/static audits after the hotfix.

## Recommended follow-ups
- Decide whether Turnstile is required in production forum write flows; current implementation is incomplete rather than consistently on/off.
- Add moderation to circle creation.
- Plan framework dependency upgrades for `astro`, `@astrojs/cloudflare`, `vite`, `undici`, and `ws`.
- Consider removing deprecated `functions/` code to reduce service-role confusion.
- If desired, hard-redirect unauthenticated users away from `/admin/*` shell pages instead of rendering the login gate shell.
- Consider adding automated production-facing API smoke tests for unauth/admin/public visibility.

## Commands run
- `git checkout main`
- `git fetch origin`
- `git pull origin main`
- `git status --short`
- `git log --oneline -8`
- `git checkout -b audit/production-security-privacy-bug-scan`
- `npm run build`
- `npm test`
- `node scripts/audit-product-data.mjs --strict --verbose`
- `node scripts/audit-public-source-privacy.mjs --dist dist --strict --verbose`
- `node scripts/audit-moderation.mjs --strict --verbose`
- `npm run test:profile-audit`
- `npm run test:forum-permissions`
- `npm audit --audit-level=moderate`
- `git diff --check`
- PowerShell secret/token scans over `src`, `public`, `functions`, `scripts`, `docs`, `internal`, `supabase`, and `dist`
- PowerShell scan for `set:html`, `dangerouslySetInnerHTML`, `innerHTML`, `DOMParser`, `target="_blank"`, `javascript:`
- PowerShell scan for admin auth helper coverage and `.server` import boundary
- Production page/manual checks via headless browser on `https://openglasshub.pages.dev`

## Manual QA results
- Production public pages opened successfully: `/`, `/feed/`, `/circles/`, `/search/`, `/login/`, `/products/`, `/devices/xreal-one/`
- Production unauth admin shell check: `/admin/moderation/` renders login-gated shell; no admin data observed in page body.
- Production unauth API checks:
  - `/api/admin/moderation/queue` -> `401`
  - `/api/admin/forum/posts` -> `401`
  - `/api/users/me/notifications` -> `401`
  - `/api/forum/media-upload-guard` -> `401`
- Production device page source check on `/devices/xreal-one/` found **no** `sourceUrl`, `vr52`, `参数来源`, `资料来源`, `最后核对`, `SUPABASE_SERVICE_ROLE_KEY`, or `TURNSTILE_SECRET_KEY` in HTML.
- Production first-party client script spot-check found **no** product source privacy keywords.
- Mobile smoke check on production `/feed/` at `390px` width showed `scrollWidth === innerWidth`, no horizontal overflow in this sampled page.
- Production console smoke check on `/`, `/feed/`, `/products/`, `/devices/xreal-one/` found no fatal console errors during sampled navigation.
- Authenticated normal-user and moderator end-to-end production actions were **not** fully executed in this run because no dedicated live credentials were supplied to the audit session.

## Final status
- Critical findings: 0
- High findings: 2
- Medium findings: 3
- Low findings: 2
- Immediate hotfix applied in this audit: yes (`F-001`)
- Remaining blockers before calling the platform “fully hardened”: dependency upgrade plan, Turnstile policy decision, circle moderation coverage
