# Production Incident Runbook

Related docs:

- `D:\OpenGlass Hub\docs\post-launch-watchlist.md`
- `D:\OpenGlass Hub\docs\production-readiness-gate.md`
- `D:\OpenGlass Hub\docs\production-security-privacy-bug-audit.md`

## If the latest release causes a production incident

1. Identify the bad commit on `main`.
2. Revert it locally with `git revert <commit>` or rollback by re-deploying the previous Cloudflare Pages deployment.
3. Push the revert to `main` only after verifying build success.

## Emergency containment

1. Hide violating content through admin moderation tools.
2. If posting must be paused, temporarily disable write UI entry points and/or return maintenance errors from write APIs.
3. If media upload must be paused, block `/api/forum/media-upload-guard` and `/api/forum/external-video-upload` at the application layer.
4. If abuse spikes, raise Turnstile strictness by setting `UPLOAD_TURNSTILE_MODE=required`.
5. If OpenAI moderation fails or false positives spike, set `OPENAI_MODERATION_ENABLED=false` or switch `OPENAI_MODERATION_FAIL_MODE=local_only` / `review`, then redeploy.

## Data repair

1. Review affected `posts` / `comments` rows in Supabase.
2. Manually update `moderation_status` only if operationally necessary.
3. Verify admin role assignments before executing staff-only actions.

## Logs

1. Check Cloudflare Pages/Worker logs for request failures.
2. Check Supabase logs for RLS, auth, and storage errors.
3. Record timestamps, affected routes, user role, and deployment version.
4. Check OpenAI moderation provider errors, timeout spikes, and pending queue growth after fail-closed review fallback.

## User communication

1. Notify affected testers that a temporary issue was identified.
2. Explain whether content or uploads need to be retried.
3. Share the recovery window once the rollback or hotfix is live.
