# Post-Launch Watchlist

## First 24 hours

Every 2–4 hours, check:

- Cloudflare deployment status
- Cloudflare Functions / Pages errors
- Supabase auth errors
- Supabase database errors
- R2 / storage usage
- New signups count
- Posts count
- Comments count
- Pending moderation count
- Rejected / hidden count
- Reports count
- Media upload failures
- `500` errors
- Suspicious spam patterns

## First 72 hours

Check daily:

- User growth
- Active posting
- Moderation queue size
- Reports
- Upload cost trend
- Slow pages
- Login failures
- Email verification failures
- Mobile feedback
- China mainland access feedback
- OpenAI provider errors
- Pending queue spikes after provider failures or false positives
- Profile save rejections after moderation
- Circle cover / avatar / banner moderation failures

## Emergency actions

### Temporarily pause posting

- Hide or disable `/posts/new/` entry points in the UI.
- Return temporary maintenance responses from post / comment write APIs if abuse or instability spikes.

### Temporarily pause image / video uploads

- Block or short-circuit `POST /api/forum/media-upload-guard`.
- Block or short-circuit `POST /api/forum/external-video-upload`.
- Keep existing published content readable while stopping new media writes.

### Hide violating content fast

- Use `/admin/moderation/` to approve, reject, or hide content.
- Prioritize hiding publicly visible abusive posts or comments before deeper investigation.

### Make moderation stricter

- Tighten moderation thresholds or fallback behavior in the current moderation configuration.
- Prefer stricter pending / reject behavior over fully disabling the forum when abuse is isolated.

### Roll back Cloudflare deployment

- Re-deploy the previous healthy Cloudflare Pages production deployment from the dashboard if the latest release is unstable.

### Revert the latest `main` commit

- Identify the offending commit.
- Run `git revert <commit>` locally.
- Rebuild, verify, and push the revert to `main`.

### Review Supabase logs

- Check Auth logs for login / signup failures.
- Check Database logs for RLS, constraint, or timeout issues.
- Check Storage logs for upload failures and permission errors.

### Review Cloudflare logs

- Check Pages / Functions request failures.
- Check status code spikes, route-specific failures, and deployment history.

## Accepted risks

- `npm audit` high risk dependency waiting for upgrade window
- OpenAI is the primary moderation provider when enabled, with local hard-block retained
- Full video moderation still not implemented
- `functions/` deprecated but not deployed
- Public beta needs manual monitoring
