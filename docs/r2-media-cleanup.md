# R2 媒体清理说明（论坛）

2026-10-15按当前本地源码校正。本文不是Production操作授权；本地修复尚未部署，
Production配置与行为仍为UNKNOWN。唯一项目进度基线为PUBLIC_BETA_CURRENT_STATE.md。

## 0) 当前媒体路径和隔离前提

- 图片和独立缩略图通过Supabase Storage上传，不是R2图片上传。
- 视频先请求R2签名；客户端另有Supabase回退分支，但其真实可用性须单独验证，不能凭代码存在标PASS。
- R2原生绑定MODERATION_ASSETS与媒体S3访问的R2_*配置是不同机制。
- 当前wrangler.toml的Preview和Production使用相同绑定与媒体配置，不能视为隔离桶。
- 未发现可验证的测试桶专用配置/最小权限凭据；云端是否另有测试桶UNKNOWN，未访问Provider API枚举。
- 不允许通过手动往数据库塞R2图片记录来冒充网站原生图片上传。若要求图片也迁往R2，属于另需批准的产品变更。

## 1) 帖子删除时同步清理

删除接口：`DELETE /api/forum/posts?id=<post_id>`

当前行为：

1. 校验登录态、作者/既有审核角色、法律确认、写入安全限制及圈子可见性。
2. 读取该帖媒体记录，包含storage_path、thumbnail_url和owner/post绑定。
3. 先软删除帖子，再同步尝试受管原图、视频与缩略图清理；相同Key去重，共享引用保留。
4. 当前合法R2临时Key通过既有S3 DELETE适配；Supabase对象通过post-media remove。
   不符合owner/post规范的Key失败关闭，不猜测删除旧版或其他账户对象。
5. 仅清理完成的媒体行被删除；失败行保留Key，供显式重试。无自动重试或异步完成声明。
6. HTTP200、顶层ok=true/status=deleted只表示帖子软删除成功。
   cleanup.ok=false表示媒体/记录清理不完整，必须检查errors、warnings及deletedObjects。
   不能把帖子软删除成功、删除任务提交或空DELETE响应当成对象清理成功。
7. 作者可显式重复删除自己已删除的帖子以重试清理，原授权和圈子限制仍生效。
   已不存在对象按结构化缺失结果处理；新的读取、审核操作不因此获得已删除正文访问权。
8. 新浏览器/禁用缓存的媒体读取与存储对象核验是不同证据；不承诺清除所有旧浏览器/CDN缓存。

## 2) 生命周期限制

用途仅应是清理已经证明未被合法内容引用的遗留对象，不能代替本次显式DELETE与后置核验。
当前视频签名生成tmp/owner/post/...，已绑定视频仍可能保留该Key。未证明迁移到其他前缀前，
不能对整个tmp/直接设置到期删除，否则可能误删仍在使用的视频。
当前Production是否配置此类规则UNKNOWN；本任务不检查或更改Production生命周期。
旧说明中一律应用tmp-expire-1d的建议已撤回，不应照此对生产桶操作。

## 3) 最简人工隔离配置（当前未执行）

1. 在现有Cloudflare账户的R2控制台，优先选一个已存在、明确获准测试且不接生产的专用桶。
   没有则由负责人自行决定是否创建专用Standard测试桶；Codex不自动创建、升级或开通付费服务。
2. Manage R2 API Tokens中创建Object Read & Write凭据，只选择该测试桶，不选择All buckets或Admin权限。
   保留不含密钥的权限范围证据，证明不覆盖任何Production桶。仅有可用密钥不证明最小权限。
3. 当前应用的视频读取需要独立媒体URL。如使用测试桶的Public Development URL，负责人必须明确接受
   桶内合成测试对象短暂公开；不要启用生产桶，不复制真实媒体。r2.dev有开发用途限流，不能据此宣称生产性能PASS。
4. 仅在测试桶配置本地来源CORS，按真实测试请求最小化。例如当前本地应用来源为https://127.0.0.1:4328：

```json
[
  {
    "AllowedOrigins": ["https://127.0.0.1:4328"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "range"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"]
  }
]
```

5. 使用既有受保护本地凭据机制保存R2_ACCOUNT_ID、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY、
   R2_BUCKET_NAME、R2_PUBLIC_BASE_URL；只向Codex提供配置路径和不含密钥的隔离/权限证明。
   .local-e2e/r2-test/config.dpapi受Git忽略，可沿用CurrentUser DPAPI及owner/SYSTEM访问控制。
   .env.r2-test.local也受Git忽略，但Git忽略不等于加密或访问控制，不能只凭忽略就认定安全。
   不把Secret、签名URL、Cookie或Token发送到聊天，不改生产.env或Wrangler环境配置。
6. 确认当前Standard免费额度余量、无新增网络/服务费和负责人对测试桶的明确使用授权。
   新建桶不产生独立免费额度；预算警报不等于硬性防扣费。未能证明USD0则继续BLOCKED。

当前本地测试入口只允许loopback，尚未接入任何测试桶。配置/权限证据完备之后，才可在同一现有
本地测试路径中做最小、明确受限的目标适配；不能直接继承Preview或Production配置。
最多2个小型合成对象及明确请求上限需在执行前核对是否足以覆盖真实播放器与清理，不能承诺任意固定次数必定完成。
命名须包含本次独立运行标识，并保存精确创建Key到受保护内存清单；只删除此清单，禁止批量清空桶。
完成后逐Key删除并验证不存在；失败时保留明确清理义务，不能把生命周期等待当作已清理。

官方参考：[桶级R2权限](https://developers.cloudflare.com/r2/api/tokens/)、
[CORS](https://developers.cloudflare.com/r2/buckets/cors/)、
[开发媒体URL](https://developers.cloudflare.com/r2/buckets/public-buckets/)、
[Standard免费额度及计费](https://developers.cloudflare.com/r2/pricing/)。

## 4) 清理失败核对

若删除帖子返回失败：

1. 查看cleanup.ok、errors、warnings及deletedObjects中的storage/status。
2. 区分deleted、already_missing、retained_shared、skipped和failed；共享保留不表示物理删除。
3. 确认失败媒体记录仍存在，使用原身份/授权范围显式重试，不自动提升权限或绕过RLS。
4. 当前本地Supabase实际对象/行删除已验证；R2适配仅有Mock证据，不能写成真实R2 PASS。
