# OpenGlass Hub RC-4 Public Preview Launch Checklist

> Routine preview and production verification is read-only by default. A Cloudflare preview that uses the production Supabase project is production-backed and must follow the destructive-QA safety procedure, not this checklist.

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
- Preview validation should include read-only media rendering on public news, profile, post, and circle pages.
- Do not create media, posts, comments, circles, reports, accounts, or roles as part of this checklist.

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

## 11. Read-only QA Before Cutover

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
- Auth:
  - verify signed-out routes and authentication error handling without creating accounts
- Admin:
  - inspect dashboards and authorization boundaries without taking actions
- Mobile:
  - homepage
  - feed
  - circle detail
  - post detail
  - search page
  - news detail

## 12. Explicit Destructive QA (exception only)

- Routine release QA must not use destructive writes.
- Use a dedicated staging/preview Supabase project for any write QA. A preview sharing the production Supabase ref counts as production data.
- Any approved production-backed write run requires all of the following before any client or browser write:
  - `QA_EXPECTED_SUPABASE_REF` exactly matches the actual target ref.
  - `QA_PRODUCTION_SUPABASE_REF` is supplied through operator or CI environment configuration.
  - `QA_ALLOW_PRODUCTION_WRITES=1` and `--confirm-run <unique-run-id>` are both present for a production target.
  - exact artifact IDs are recorded, cleanup is verified, and zero public residue remains.
- Cleanup failure is a failed release gate. Do not use broad title, marker, or owner-prefix deletion in future workflows.
- Stop immediately on target ambiguity, target mismatch, missing confirmation, unexpected artifact discovery, or failed cleanup verification.
- V2 destructive QA is staging-first: it records exact artifact IDs, cleans them in `finally`, and verifies zero exact-ID residue. It is not a routine smoke or release command, and no real staging adapter is configured yet.

## 13. Validation Commands

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
