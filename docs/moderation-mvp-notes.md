# Community Moderation MVP Notes

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

