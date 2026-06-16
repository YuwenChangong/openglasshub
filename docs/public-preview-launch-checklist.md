# OpenGlass Hub RC-4 Public Preview Launch Checklist

## 1. Scope

- This checklist is for the public preview on `https://openglasshub.pages.dev`.
- It covers launch hardening only: metadata, routing, abuse control, auth readiness, storage/RLS checks, admin readiness, rollback notes, and validation.
- It does not loosen Supabase RLS, change bucket privacy, or introduce service-role access inside `src`.

## 2. Production Environment Variables

### Cloudflare Pages / Worker runtime

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `R2_PUBLIC_BASE_URL`
- `TURNSTILE_SECRET_KEY`
- `RATE_LIMIT_SALT`
- `DEV_TURNSTILE_BYPASS=false`

### Browser-exposed variables

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `PUBLIC_TURNSTILE_SITE_KEY`

### Notes

- `PUBLIC_*` values are visible to browser clients and must not contain secrets.
- `SUPABASE_ANON_KEY` is expected in both server and browser contexts for SSR + client auth flows.
- `TURNSTILE_SECRET_KEY` must exist only in Cloudflare Pages server env.
- `R2_PUBLIC_BASE_URL` must point to the production public base URL for R2-delivered forum/news/profile media.

## 3. Supabase Migration and RLS Readiness

- Confirm all required migrations have been applied in the target Supabase project before preview cutover.
- Check forum schema migrations, notification permissions migrations, profile/media migrations, and news/forum security migrations are present in `supabase/migrations/`.
- Confirm no pending local migration exists for this RC-4 hardening step.
- Confirm `public.circles`, `public.posts`, `public.comments`, `public.post_media`, `public.news_articles`, `public.profiles`, and related views/RPCs are present.
- Confirm storage policies exist for:
  - forum post media upload paths
  - circle cover upload paths under `post-media/circle-covers/...`
  - profile avatar/banner paths if profile media is enabled

### Required checks

- Anonymous users can read only intended public content.
- Authenticated users can write only their own allowed resources.
- Deleted circles are not visible on public circle pages.
- No new RC-4 code path uses `SUPABASE_SERVICE_ROLE_KEY`.

## 4. Storage Policy Audit

- `post-media` stays private unless an existing policy intentionally allows public object reads for specific prefixes.
- Circle cover access must continue to rely on signed URL resolution or existing prefix-specific SELECT policies.
- R2 delivery remains limited to already-public optimized media use cases.
- Preview validation should include:
  - create post with image/video
  - create circle with cover
  - open public news/article pages with media
  - open public profile pages with avatar/banner if configured

## 5. Turnstile and Rate Limit Readiness

- Turnstile must remain fail-closed on protected write actions:
  - create post
  - create comment
  - create circle
  - media upload guard
  - external video upload
- Expected user-facing errors:
  - `TURNSTILE_REQUIRED`
  - `TURNSTILE_INVALID`
- Rate limiting currently uses the shared Supabase-backed helper and must:
  - normalize `bytes` to a finite non-negative integer
  - block only on real limit hits with `RATE_LIMITED`
  - fail open if the rate-limit backend is unavailable
- Rate-limit backend failure must log server warnings and must not block core forum writes.

## 6. Email Verification / Brevo SMTP

- Configure Brevo SMTP in Supabase Auth, not in browser code.
- Verify sender domain, SPF, DKIM, and DMARC alignment before launch.
- Test flows:
  - signup confirmation email
  - resend confirmation endpoint
  - password reset email
- Confirm resend behavior does not leak whether an email exists.
- Keep resend throttling enabled.

See also: `docs/email-verification-deliverability-checklist.md`

## 7. Admin Readiness

- Confirm at least one real admin account can access:
  - `/admin/forum/`
  - `/admin/reports/`
  - `/admin/media/`
  - `/admin/circles/`
  - `/admin/news/`
- Confirm admin role assignment exists in the target Supabase environment.
- Confirm non-admin authenticated users receive denial on admin APIs/pages.
- Confirm owner-only circle management still works independently of admin access.

## 8. SEO / Crawl Controls

- `robots.txt` must disallow:
  - `/admin/`
  - `/api/`
  - `/login/`
  - `/auth/callback/`
  - `/auth/reset-password/`
  - `/me/`
  - `/notifications/`
  - `/posts/new/`
  - `/circles/new/`
  - `/search/`
  - `/users/`
- `sitemap.xml` should contain only public routes worth indexing.
- Keep `/u/<username>/` as the preferred public profile URL; do not index `/users/<id>/`.
- Verify important pages have:
  - title
  - meta description
  - canonical where appropriate
  - OpenGraph/Twitter base metadata

## 9. Logging / Error Visibility

- Watch Cloudflare Pages function logs for:
  - Turnstile verification failures
  - rate-limit backend warnings
  - news/forum query failures
  - storage signed URL resolution warnings
- Avoid leaking secrets, raw auth tokens, or service credentials in logs.
- Keep user-facing API errors sanitized.

## 10. Backup / Rollback Notes

- Snapshot the target Supabase project before major schema rollout.
- Keep the currently deployed Pages build available for rollback.
- If a launch regression appears:
  - roll back Pages deployment first if it is code-only
  - revert the most recent migration only with a reviewed SQL down-plan
  - do not hotfix by weakening RLS or exposing storage publicly

## 11. Manual QA Before Cutover

- Public routes:
  - `/`
  - `/feed/`
  - `/circles/`
  - `/news/`
  - `/products/`
  - `/devices/`
  - `/guides/`
  - `/developers/`
  - `/gaze-launcher/`
- Forum writes:
  - create text post
  - create image/video post
  - create comment/reply
  - like/unlike post
  - like/unlike comment
  - delete own post/comment
  - create circle with and without cover
- Auth:
  - login/signup
  - email confirmation
  - resend confirmation
  - reset password
- Admin:
  - moderate reports
  - inspect forum/media/circle/news dashboards
- Mobile:
  - homepage
  - feed
  - circle detail
  - post detail
  - search page
  - news detail

## 12. Validation Commands

Run before push:

```powershell
npm run build
npm run test:profile-audit
npm run test:forum-permissions
git diff --check

Get-ChildItem -Path "src" -Recurse -File |
Select-String -Pattern "SUPABASE_SERVICE_ROLE_KEY","service_role" -CaseSensitive:$false |
Select-Object Path, LineNumber, Line

Get-ChildItem -Path "src" -Recurse -File |
Select-String -Pattern "window.confirm","window.alert","window.prompt" -CaseSensitive:$false |
Select-Object Path, LineNumber, Line
```

## 13. Release Gate

Only tag / announce public preview after:

- required env values are set in Pages
- target Supabase migrations are confirmed applied
- storage policies are confirmed
- Turnstile works in Preview and production branch
- resend confirmation and password reset emails arrive
- at least one admin account is verified
- build and audits pass
