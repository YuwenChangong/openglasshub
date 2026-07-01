# Community Moderation MVP Notes

## Production release update

- OpenGlass Hub Reports Optimization MVP released to production.
- Final commit: `cefe29bf7668a472a5681faf1abaf4df4973badc`
- Final classification: `PRODUCTION_RELEASE_GO`

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

