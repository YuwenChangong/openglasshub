# OpenAI Moderation Setup

## What this does

- Keeps local hard-block moderation as the first layer.
- Makes OpenAI the primary server-side moderation provider when enabled.
- Keeps manual admin review as the final safety layer.
- Supports text moderation for posts, comments, circles, and public profile fields.
- Supports optional image moderation for post images, profile avatar/banner, and circle covers.

## What this does not do

- Does not replace local rules.
- Does not send browser-side requests to OpenAI.
- Does not moderate full video content yet.
- Does not understand full uploaded video streams.

## Environment variables

- `OPENAI_API_KEY`
- `OPENAI_MODERATION_ENABLED=false`
- `OPENAI_MODERATION_MODEL=omni-moderation-latest`
- `OPENAI_MODERATION_FAIL_MODE=review`
- `OPENAI_MODERATION_TIMEOUT_MS=3500`
- `OPENAI_MODERATION_IMAGE_ENABLED=false`
- `OPENAI_POST_IMAGE_MODERATION_ENABLED=false`
- `OPENAI_PROFILE_IMAGE_MODERATION_ENABLED=false`
- `OPENAI_CIRCLE_COVER_MODERATION_ENABLED=false`
- `OPENAI_VIDEO_THUMBNAIL_MODERATION_ENABLED=false`
- `VIDEO_POST_REQUIRES_THUMBNAIL_MODERATION=false`
- `VIDEO_POST_FAIL_MODE=review`
- `OPENAI_MODERATION_LOG_LEVEL=minimal`

## Cloudflare setup

- Store `OPENAI_API_KEY` as a server-side secret only.
- Ensure `OPENAI_API_KEY` exists in both Preview and Production if `OPENAI_MODERATION_ENABLED=true`.
- Do not expose `OPENAI_API_KEY` through any `PUBLIC_*` variable.
- Start Preview stage 1 with:
  - `OPENAI_MODERATION_ENABLED=true`
  - `OPENAI_POST_IMAGE_MODERATION_ENABLED=false`
  - `OPENAI_PROFILE_IMAGE_MODERATION_ENABLED=false`
  - `OPENAI_CIRCLE_COVER_MODERATION_ENABLED=false`
  - `OPENAI_VIDEO_THUMBNAIL_MODERATION_ENABLED=false`
  - `OPENAI_MODERATION_FAIL_MODE=review`
- Start Production in text-only mode first:
  - `OPENAI_MODERATION_ENABLED=true`
  - `OPENAI_POST_IMAGE_MODERATION_ENABLED=false`
  - `OPENAI_PROFILE_IMAGE_MODERATION_ENABLED=false`
  - `OPENAI_CIRCLE_COVER_MODERATION_ENABLED=false`
  - `OPENAI_VIDEO_THUMBNAIL_MODERATION_ENABLED=false`

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

- Post images can be moderated with `OPENAI_POST_IMAGE_MODERATION_ENABLED=true`.
- Profile avatar / banner can be moderated with `OPENAI_PROFILE_IMAGE_MODERATION_ENABLED=true`.
- Circle covers can be moderated with `OPENAI_CIRCLE_COVER_MODERATION_ENABLED=true`.
- Uses short-lived signed read URLs for uploaded images.
- Does not send user email, JWT, IP, or secrets.
- If post image moderation flags content:
  - medium / unclear => `pending_review`
  - high severity => `rejected`
- If profile or circle cover moderation flags content:
  - save/update is blocked
  - rejected upload path is not promoted to public content

## Video limitation

- Full video moderation is not implemented.
- Current video moderation covers post text plus any available thumbnail/keyframe only.
- If `VIDEO_POST_REQUIRES_THUMBNAIL_MODERATION=true` and no thumbnail exists, the post goes to `pending_review`.

## Failure mode

- Recommended initial setting: `OPENAI_MODERATION_FAIL_MODE=review`
- Behavior:
  - `review`: provider failure keeps locally suspicious content in review, but clean local-allow content falls back to local-only
  - `local_only`: provider failure falls back to local decision
  - `reject`: provider failure rejects content
- Special case:
  - if OpenAI is enabled but the key is missing, invalid, timed out, or returns an unusable response, clean local-allow content falls back to local-only with an internal provider diagnostic instead of silently forcing all clean content into review

## Privacy notes

- API key is server-only.
- Do not send emails, JWTs, IPs, or other secrets to OpenAI.
- Do not expose raw category scores to the public UI.
- Do not log full user text or full signed image URLs.
- Do not expose profile moderation reasons or provider internals to ordinary users.

## Rollout stages

### Stage 1

- `OPENAI_MODERATION_ENABLED=true`
- `OPENAI_POST_IMAGE_MODERATION_ENABLED=false`
- `OPENAI_PROFILE_IMAGE_MODERATION_ENABLED=false`
- `OPENAI_CIRCLE_COVER_MODERATION_ENABLED=false`
- `OPENAI_VIDEO_THUMBNAIL_MODERATION_ENABLED=false`

### Stage 2

- `OPENAI_POST_IMAGE_MODERATION_ENABLED=true`

### Stage 3

- `OPENAI_PROFILE_IMAGE_MODERATION_ENABLED=true`
- `OPENAI_CIRCLE_COVER_MODERATION_ENABLED=true`

### Stage 4

- `OPENAI_VIDEO_THUMBNAIL_MODERATION_ENABLED=true`
- Optionally `VIDEO_POST_REQUIRES_THUMBNAIL_MODERATION=true`

## Rollback instructions

1. Set `OPENAI_MODERATION_ENABLED=false`
2. Or set `OPENAI_MODERATION_FAIL_MODE=local_only`
3. Set image flags back to `false`
2. Redeploy Cloudflare Pages / Functions
3. Keep local moderation active
4. Watch pending queue, provider errors, and user reports
