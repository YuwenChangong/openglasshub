# OpenAI Moderation Setup

## What this does

- Keeps local moderation as the first layer.
- Adds OpenAI moderation as a second server-side provider when enabled.
- Keeps manual admin review as the final safety layer.
- Supports text moderation for posts, comments, and circles.
- Supports image moderation for post images when `OPENAI_MODERATION_IMAGE_ENABLED=true`.

## What this does not do

- Does not replace local rules.
- Does not send browser-side requests to OpenAI.
- Does not moderate full video content yet.
- Does not moderate avatar or profile banner images in this first version.

## Environment variables

- `OPENAI_API_KEY`
- `OPENAI_MODERATION_ENABLED=false`
- `OPENAI_MODERATION_MODEL=omni-moderation-latest`
- `OPENAI_MODERATION_FAIL_MODE=review`
- `OPENAI_MODERATION_TIMEOUT_MS=3500`
- `OPENAI_MODERATION_IMAGE_ENABLED=false`
- `OPENAI_MODERATION_LOG_LEVEL=minimal`

## Cloudflare setup

- Store `OPENAI_API_KEY` as a server-side secret only.
- Do not expose `OPENAI_API_KEY` through any `PUBLIC_*` variable.
- Start Preview with:
  - `OPENAI_MODERATION_ENABLED=true`
  - `OPENAI_MODERATION_IMAGE_ENABLED=false`
  - `OPENAI_MODERATION_FAIL_MODE=review`
- Start Production in text-only mode first:
  - `OPENAI_MODERATION_ENABLED=true`
  - `OPENAI_MODERATION_IMAGE_ENABLED=false`

## Supabase impact

- No schema change required.
- Reuses existing `moderation_provider`, `moderation_reason`, `moderation_score`, `moderation_status`, `moderated_at`.
- Does not store raw OpenAI responses in public tables.

## Text moderation behavior

- Local reject: reject immediately, skip OpenAI.
- Local review: remains `pending_review`; OpenAI can escalate to reject, but not wash review into allow.
- Local allow + OpenAI allow: publish.
- Local allow + OpenAI review: `pending_review`.
- Local allow + OpenAI reject: reject.

## Image moderation behavior

- First version moderates post images only.
- Uses short-lived signed read URLs for uploaded images.
- Does not send user email, JWT, IP, or secrets.
- If image moderation flags content:
  - medium / unclear => `pending_review`
  - high severity => `rejected`

## Video limitation

- Video moderation currently means text + thumbnail/keyframe only.
- This version does not understand full video content.
- If a post has no safe image thumbnail, video body moderation remains text-only.

## Failure mode

- Recommended initial setting: `OPENAI_MODERATION_FAIL_MODE=review`
- Behavior:
  - `review`: provider failure routes content to review
  - `local_only`: provider failure falls back to local decision
  - `reject`: provider failure rejects content

## Privacy notes

- API key is server-only.
- Do not send emails, JWTs, IPs, or other secrets to OpenAI.
- Do not expose raw category scores to the public UI.
- Do not log full user text or full signed image URLs.

## Rollback instructions

1. Set `OPENAI_MODERATION_ENABLED=false`
2. Redeploy Cloudflare Pages / Functions
3. Keep local moderation active
4. Watch pending queue, provider errors, and user reports
