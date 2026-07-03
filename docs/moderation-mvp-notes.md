# Community Moderation MVP Notes

## Production release update

- OpenGlass Hub Reports Optimization MVP released to production.
- Final commit: `cefe29bf7668a472a5681faf1abaf4df4973badc`
- Final classification: `PRODUCTION_RELEASE_GO`
- Reports Admin UX v1 completed with queue scanning, filter clarity, event timeline readability, and safer confirmation UX improvements.
- No migration was needed.
- Preview QA smoke passed on `https://reports-admin-ux-v1.openglasshub.pages.dev`.

## Reports Admin UX v1 production release

- Release status: `REPORTS_ADMIN_UX_DEPLOYED_GO`

### What shipped

- Clearer reports queue with better scanability
- Status / target / reason / priority badges
- Client-side search on loaded data
- Filter chips and clear filters
- Improved detail panel
- Readable event timeline
- Grouped risk-based actions
- Custom glass confirmation modal
- Duplicate-click protection
- Better loading / error / empty states
- Improved cleanup helper
- Readable self-action guard error

### Production verification

- Production smoke passed
- Authenticated `/admin/reports` loaded
- Reports list rendered
- Detail panel and timeline rendered
- Confirmation modal opened and closed without destructive action

### Auth incident note

- Production login briefly returned Supabase `Invalid API key` after deployment
- Root cause was a stale or mismatched `PUBLIC_SUPABASE_ANON_KEY`
- Fix path was updating repo `wrangler.toml` plus the Cloudflare production Supabase anon secret/config
- Final fresh-session auth no longer returned `Invalid API key`

### Safety

- No migration was run
- No destructive actions were performed
- No real users or production content were modified
- Temporary QA admin was revoked and deleted after verification
- No secrets were exposed

## Moderation action notifications v1

- Release status: `MODERATION_ACTION_NOTIFICATIONS_PRODUCTION_GO`
- Production release commit: `9a8667c16feddd9e050147c90e6d0528641ade24`

### Production release notes

- Production migration applied: `supabase/migrations/20260703_moderation_action_notifications.sql`
- Preview had no separate Supabase project, so production QA used disposable production-only accounts and content with explicit operator risk acceptance
- Verified shipped notification types in production:
  - `post_moderated`
  - `comment_moderated`
  - `user_warned`
  - `user_restricted`
- Production smoke passed after deploy
- Authenticated production notification checks passed for all four shipped moderation notification types
- Verified user-facing copy stayed generic and actorless
- Verified no reporter identity, admin identity, admin notes, signed media URLs, or raw moderation internals were exposed
- Existing social notification live regression was not fully feasible because disposable user comments entered pending review before a reply chain could be completed; automated code/audit coverage remained green
- Disposable production QA cleanup completed:
  - temporary admin role revoked
  - ordinary disposable auth user deleted
  - temporary admin auth user disabled after delete fallback
  - disposable posts/comments hidden
  - marker search returned zero public posts and circles

- Supported in-app notification triggers:
  - reported post hidden or rejected -> post author receives `post_moderated`
  - reported comment hidden or rejected -> comment author receives `comment_moderated`
  - warning action -> target user receives `user_warned`
  - suspend or ban action -> target user receives `user_restricted`
- Safe copy policy:
  - "Your post was removed after review."
  - "Your comment was removed after review."
  - "You received a warning after a moderation review."
  - "Your account access was restricted after a moderation review."
- Privacy exclusions:
  - no reporter identity or email
  - no admin identity or email
  - no admin notes
  - no raw moderation JSON
  - no signed media URLs
  - no internal rule names, lexicon matches, or safety scores
- V1 limitations:
  - in-app notifications only
  - no email notifications
  - no appeal flow
  - no detailed violation reason in the user-facing copy
  - no report submitter `report_reviewed` notification in v1

### Key shipped items

- Expanded report targets: `post` / `comment` / `circle` / `user` / admin-user workflows
- `report_events` audit trail
- Admin reports list / detail / filter / action flows
- User safety actions
- R2-backed full sensitive lexicon runtime
- Admin-only `clear-warning` restore path
- Production migration applied
- Production QA passed

- `posts` 已有 `status`，当前使用 `pending | published | hidden | deleted`，可复用为审核可见性层。
- `comments` 当前只有 `published | hidden | deleted`，缺少待审核状态，需要最小 migration 补 `pending`。
- `reports` 表已存在，字段足够支撑人工处理入口。
- 管理后台已有：
  - `D:\OpenGlass Hub\src\pages\admin\forum\index.astro`
  - `D:\OpenGlass Hub\src\pages\admin\reports\index.astro`
  - `D:\OpenGlass Hub\src\pages\api\admin\forum\posts.ts`
  - `D:\OpenGlass Hub\src\pages\api\admin\forum\reports.ts`
- 发帖 API 当前直接发布 `published`。
- 评论 API 当前直接发布 `published`。
- 本轮策略：
  - 复用 `status` 做可见性：`pending -> 待审核`，`published -> 公开`，`hidden -> 后台隐藏/拒绝后不可见`
  - 新增 `moderation_status / moderation_reason / moderation_score / moderated_at / moderated_by / moderation_provider`
  - 仅对评论 RLS 做最小修补，允许作者插入 `pending`
  - 公开读取继续依赖现有 RLS + API 查询过滤，不重写整体权限模型

