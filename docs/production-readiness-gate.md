# Production Readiness Gate

## Current commit

- Branch: `hardening/production-readiness-gate`
- Base main commit: `798c9134c04d6ff07b499cca5d441bdb5f792930`

## Target readiness level

- Target: public beta / 正式开放测试

## Gate summary

- Status: `NO-GO`
- Reason: core hardening is improved, but production authenticated live QA is still incomplete and cannot be truthfully signed off without a real ordinary-user account, a real admin account, and remote Supabase/Cloudflare production checklist confirmation.
- Public production route smoke check passed on `https://openglasshub.pages.dev`
- Unauthenticated admin/API block check passed on public production
- Local build and static audits passed after this hardening round

## Blocking issues

1. Production ordinary-user login/upload/post/comment/circle creation loop has not been fully verified end-to-end with a real production account.
2. Production admin moderation loop has not been fully verified end-to-end with a real production admin account.
3. Supabase production migration/config confirmation is still manual and not proven from this workspace.
4. Dependency advisories still exist and are accepted only temporarily, not fully remediated.
5. Public production feed currently shows at least one suspicious test post containing “私聊我 / 完整资料 / 入口” style wording, which indicates existing moderated cleanup on production data is still incomplete.

## Fixed issues

1. Posts/comments no longer auto-publish `review` outcomes as public content.
2. Circle creation now runs moderation on `name` and `description`; suspicious or rejected content is blocked before public creation.
3. Upload Turnstile flow is hardened to a risk-based mode with explicit env control: `UPLOAD_TURNSTILE_MODE= risk_based | required | off`.
4. Normal authenticated low-risk uploads remain available; high-risk large uploads can still require Turnstile when configured.
5. Deprecated `functions/` path is documented as not part of current Astro Cloudflare Pages runtime.

## Accepted risks

1. `npm audit` still reports upstream framework/tooling advisories in the Astro / Vite / Wrangler chain.
2. Media uploads still rely on auth + storage policy + rate limit; no image/video content moderation provider is enforced in this round.
3. `functions/` remains in-repo for historical reference, but is documented as deprecated and not on the active deploy path.
4. This round did not complete production authenticated QA because no real production ordinary-user/admin credentials are available in this workspace.

## Production config checklist

### Cloudflare Pages

- [ ] Production branch is `main`
- [ ] Production deployment points to latest approved main commit
- [ ] Latest production build succeeds
- [ ] Preview and production env vars are separated
- [ ] `SESSION` KV binding exists
- [ ] R2 binding exists
- [ ] `PUBLIC_SUPABASE_URL` present
- [ ] `PUBLIC_SUPABASE_ANON_KEY` present
- [ ] `SUPABASE_URL` present
- [ ] `SUPABASE_ANON_KEY` present
- [ ] `RATE_LIMIT_SALT` present
- [ ] `PUBLIC_TURNSTILE_SITE_KEY` present and is site-key only
- [ ] `TURNSTILE_SECRET_KEY` present and remains server-only
- [ ] `UPLOAD_TURNSTILE_MODE` set to `risk_based` or stricter
- [ ] `DEV_TURNSTILE_BYPASS` is `false` in production
- [ ] Turnstile hostname allowlist includes production domain
- [ ] Source map policy reviewed
- [ ] No public env var contains service-role credentials

### Supabase

- [ ] Moderation migration applied on production
- [ ] `posts.moderation_status` exists
- [ ] `comments.moderation_status` exists
- [ ] Public queries exclude `pending_review`, `rejected`, `hidden_by_admin`
- [ ] Storage policies reviewed for post-media / circle-covers / profile assets
- [ ] Production auth redirect URLs include production domain
- [ ] Email confirmation flow works
- [ ] Admin role / moderator permissions confirmed
- [ ] Backup / export strategy confirmed

## Live QA checklist

### Public production checks completed in this round

- [x] `/` opens
- [x] `/feed/` opens
- [x] `/news/` opens
- [x] `/search/` opens
- [x] `/login/` opens
- [x] `/posts/new/` shows logged-out gated state
- [x] `/circles/new/` shows logged-out gated state
- [x] `/products/` opens
- [x] `/devices/xreal-one/` opens
- [x] `/admin/moderation/` shows login gate when unauthenticated
- [x] Unauthenticated `/api/admin/moderation/queue` blocked with `401`
- [x] Unauthenticated `/api/admin/forum/posts` blocked with `401`
- [x] Unauthenticated `/api/users/me/notifications` blocked with `401`
- [x] Unauthenticated `/api/forum/media-upload-guard` blocked with `401`
- [x] Production page source keyword search found no `sourceUrl`, `vr52`, `参数来源`, `资料来源`, `最后核对`, `SUPABASE_SERVICE_ROLE_KEY`, `sensitive-terms`, or `blocklist`

### Ordinary user

- [ ] Login works
- [ ] Logout works
- [ ] Avatar upload works
- [ ] Profile save works
- [ ] Clean text post publishes
- [ ] Clean comment publishes
- [ ] Suspicious post becomes pending or is blocked
- [ ] Explicitly violating post is rejected
- [ ] Image post works
- [ ] Video post works or is intentionally disabled
- [ ] Notifications load
- [ ] Search works
- [ ] Circle detail opens
- [ ] Own profile opens
- [ ] Second normal user cannot view pending/rejected/hidden content

### Admin

- [ ] `/admin/moderation/` opens
- [ ] Pending queue visible
- [ ] Approve works
- [ ] Reject works
- [ ] Hide works
- [ ] Rejected/hidden content disappears from public feed
- [ ] Direct URL access for rejected/hidden content is blocked
- [ ] `/admin/forum/` opens
- [ ] `/admin/reports/` opens
- [ ] `/admin/media/` opens
- [ ] `/admin/news/` opens
- [ ] Non-admin gets blocked from admin pages/APIs

## Security checklist

- [x] No `SUPABASE_SERVICE_ROLE_KEY` usage in active `src/`
- [x] No native `window.alert` / `window.confirm` / `window.prompt` in active `src/`
- [x] Public product source ledger stays out of client build
- [x] Pending/rejected moderation content is filtered from public feed/search/profile/detail paths
- [x] Non-admin admin API requests return unauthorized/forbidden
- [x] Production page-source keyword search returned no product source ledger leakage
- [ ] Production authenticated admin access blocked check confirmed live

## Upload/media checklist

### Current intended gate

- Avatar upload: auth required, file type checked, size checked, storage path scoped by user, rate limited
- Circle cover upload: auth required, file type checked, size checked, storage path scoped by user, rate limited
- Post image upload: auth required, file type checked, size checked, post ownership enforced, rate limited
- Post video upload: auth required, type checked, size checked, post ownership enforced, rate limited
- News media upload: admin-only path must be verified manually before GO

### Additional notes

- `UPLOAD_TURNSTILE_MODE` defaults to `risk_based`
- `risk_based` currently keeps normal logged-in uploads usable and only allows optional stricter enforcement for high-risk uploads
- SVG upload is not allowed in the current user media paths

## Moderation checklist

- [x] Post title/body moderated
- [x] Comment body moderated
- [x] Circle name/description moderated
- [x] Review outcomes for posts/comments are not publicly auto-published
- [x] Public reads require `moderation_status = published`
- [ ] Admin moderation queue must still be verified live in production

## Dependency checklist

- `npm audit --audit-level=moderate` must be reviewed before GO
- Current decision:
  - do not run blind `npm audit fix --force`
  - accept remaining upstream framework/tooling advisories only temporarily
  - schedule a dedicated upgrade window for Astro / Vite / Wrangler chain before broad launch
- Current advisory set observed locally:
  - `astro` high severity advisories
  - `vite` high severity advisories
  - `undici` high severity advisories through `wrangler` / `miniflare`
  - `ws` high severity advisories through `wrangler` / `miniflare`
  - `@astrojs/cloudflare` moderate advisory chain
  - `@babel/core` and `js-yaml` moderate advisories

## Screenshot / evidence notes

- Public production screenshots:
  - `.tmp-qa/production-readiness-gate/live-qa/home.png`
  - `.tmp-qa/production-readiness-gate/live-qa/feed.png`
  - `.tmp-qa/production-readiness-gate/live-qa/news.png`
  - `.tmp-qa/production-readiness-gate/live-qa/search.png`
  - `.tmp-qa/production-readiness-gate/live-qa/login.png`
  - `.tmp-qa/production-readiness-gate/live-qa/posts_new.png`
  - `.tmp-qa/production-readiness-gate/live-qa/circles_new.png`
  - `.tmp-qa/production-readiness-gate/live-qa/products.png`
  - `.tmp-qa/production-readiness-gate/live-qa/devices_xreal_one.png`
  - `.tmp-qa/production-readiness-gate/live-qa/admin_moderation.png`
  - `.tmp-qa/production-readiness-gate/live-qa/mobile_feed.png`
  - `.tmp-qa/production-readiness-gate/live-qa/mobile_products.png`
  - `.tmp-qa/production-readiness-gate/live-qa/mobile_devices_xreal_one.png`

## Rollback plan

- See `docs/production-incident-runbook.md`

## Backup / recovery notes

- Confirm Supabase backup/export process before GO
- Confirm Cloudflare Pages prior deployment rollback path before GO
- Confirm moderator/admin emergency hide flow before GO

## Final go / no-go decision

- `NO-GO: 仍不建议正式开放外部测试`
- Required to flip to `GO`:
  1. real production ordinary-user QA pass
  2. real production admin QA pass
  3. production config checklist completed
  4. moderation migration and admin moderation loop verified on remote production data
