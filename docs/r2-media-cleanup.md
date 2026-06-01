# R2 媒体清理说明（论坛）

本文档说明 OpenGlass Hub 论坛媒体的两层清理策略：

1. 帖子删除时的同步清理（代码逻辑）
2. 未绑定临时文件的生命周期清理（R2 Lifecycle）

## 1) 帖子删除时同步清理

删除接口：`DELETE /api/forum/posts?id=<post_id>`

当前行为：

1. 校验登录态 + 作者身份（仅作者可删自己的帖子）。
2. 查询该帖关联 `post_media` 记录。
3. 按 `storage_path` 识别媒体来源：
   - R2 对象（`tmp/...` 或 `posts/...`）→ 调用 R2 DeleteObjects
   - Supabase Storage 对象（其余路径）→ 调用 `post-media` bucket remove
4. 只有当媒体对象删除成功时，才继续删除 `post_media` 行与帖子本身。
5. 任一媒体删除失败，接口返回：
   - `POST_DELETE_MEDIA_PARTIAL_FAILURE`
   - 含失败阶段、失败原因、相关 `storage_path`（若有）
   - 不会假装成功，不会继续删除帖子。

## 2) R2 临时文件生命周期（必须手动配置）

用途：清理“只上传未发帖”的遗留临时对象，避免 `tmp/` 持续堆积。

### Cloudflare Dashboard 配置步骤

1. 打开 Cloudflare Dashboard
2. 进入 **R2**
3. 选择论坛媒体 bucket（`R2_BUCKET_NAME` 指向的 bucket）
4. 进入 **Settings**
5. 打开 **Object Lifecycle Rules**
6. 新增规则：
   - Rule name: `tmp-expire-1d`
   - Prefix: `tmp/`
   - Action: `Delete uploaded objects after`
   - Days: `1`
7. 保存

### 重要限制

- 仅清理 `tmp/` 前缀
- **不要** 对 `posts/` 前缀加自动过期
- 已绑定到帖子并仍在使用的媒体不应被生命周期规则误删

## 3) 诊断建议

若删除帖子返回失败：

1. 查看接口响应中的 `failures` 数组
2. 根据 `stage` 判断问题位置：
   - `r2_delete`：R2 删除失败（凭据、权限、对象键、桶配置）
   - `supabase_storage_delete`：Supabase bucket 删除失败（策略、路径）
   - `post_media_delete`：数据库行删除失败（RLS/约束）
3. 优先修复存储删除问题后再重试删除帖子。
