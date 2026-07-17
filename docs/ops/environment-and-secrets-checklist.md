# Environment And Secrets Checklist

## Rules

- Secret values must never be committed, printed, screenshotted, or pasted into chat.
- Secret values must never be stored in docs.
- Preview QA is read-only by default. If preview shares the production Supabase ref, it is production-backed and must follow `preview-qa-safety.md`; routine write QA requires staging.

## Required production runtime vars by name only

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `PUBLIC_TURNSTILE_SITE_KEY`
- `R2_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_BASE_URL`
- `MODERATION_PROVIDER`
- `MODERATION_PROVIDER_UNAVAILABLE_POLICY`
- `OPENAI_MODERATION_ENABLED`
- `OPENAI_MODERATION_FAIL_MODE`
- `OPENAI_MODERATION_MODEL`
- `OPENAI_MODERATION_TIMEOUT_MS`
- `OPENAI_MODERATION_LOG_LEVEL`
- `OPENAI_POST_IMAGE_MODERATION_ENABLED`
- `OPENAI_PROFILE_IMAGE_MODERATION_ENABLED`
- `OPENAI_CIRCLE_COVER_MODERATION_ENABLED`
- `OPENAI_VIDEO_THUMBNAIL_MODERATION_ENABLED`
- `VIDEO_POST_FAIL_MODE`
- `VIDEO_POST_REQUIRES_THUMBNAIL_MODERATION`
- `OPENAI_FORUM_POLICY_ENABLED`
- `OPENAI_FORUM_POLICY_MODEL`
- `OPENAI_FORUM_POLICY_TIMEOUT_MS`
- `OPENAI_FORUM_POLICY_FAIL_MODE`
- `UPLOAD_TURNSTILE_MODE`
- `DEV_TURNSTILE_BYPASS`

## Required preview runtime vars by name only

- Same names as production runtime vars above.

## Required production secrets by name only

- `TURNSTILE_SECRET_KEY`
- `RATE_LIMIT_SALT`
- `OPENAI_API_KEY`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

## Approval-gated server-only secret

- `SUPABASE_SERVICE_ROLE_KEY` is a server-only encrypted secret for the narrow
  legal-consent and moderation-notification RPC writers. A future rate-limit RPC
  wrapper may use it only after its separate R1 proof and implementation
  approvals. It is not a public runtime variable, browser setting, or generic
  privileged client credential.

## Required preview secrets by name only

- `TURNSTILE_SECRET_KEY`
- `RATE_LIMIT_SALT`
- `OPENAI_API_KEY`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` only when the separately approved narrow
  server-side RPC callers are deployed and the Preview metadata proof confirms
  an encrypted binding.

## Required bindings

- `SESSION` KV
- `MODERATION_ASSETS` R2

## Required R2 object

- `moderation/local-sensitive-lexicon.zh.json`

## Operational notes

- Full sensitive lexicon must remain R2-backed.
- Do not bundle the full lexicon into the worker or client.
- Preview QA must not create content by default. Production-backed write QA is an explicit, guarded exception; routine write QA belongs in staging.
