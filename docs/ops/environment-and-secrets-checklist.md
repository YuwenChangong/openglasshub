# Environment And Secrets Checklist

## Rules

- Secret values must never be committed, printed, screenshotted, or pasted into chat.
- Secret values must never be stored in docs.
- Preview currently uses production-equivalent non-secret runtime values, so preview QA must use disposable test data only.

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

## Required preview secrets by name only

- `TURNSTILE_SECRET_KEY`
- `RATE_LIMIT_SALT`
- `OPENAI_API_KEY`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

## Required bindings

- `SESSION` KV
- `MODERATION_ASSETS` R2

## Required R2 object

- `moderation/local-sensitive-lexicon.zh.json`

## Operational notes

- Full sensitive lexicon must remain R2-backed.
- Do not bundle the full lexicon into the worker or client.
- Preview QA must treat content writes as production-equivalent data risk.
