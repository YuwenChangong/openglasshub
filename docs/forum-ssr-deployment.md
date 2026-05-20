# Forum SSR 部署指南

> 论坛系统从"静态页面 + API Functions"架构迁移到"SSR 页面"架构

## 架构变更总结

### 旧架构
- 论坛页面（动态、帖子、圈子）是静态 React 组件
- 前端通过 `functions/api/forum/*.ts` API 获取数据
- URL 使用查询参数：`/post/?id=xxx`、`/circle/?slug=xxx`

### 新架构
- 论坛页面是 Astro SSR 页面（`/feed/`、`/posts/[id]/`、`/circles/`、`/circles/[slug]/`）
- 页面在 Cloudflare Worker 端直接查询 Supabase，输出完整 HTML
- URL 使用语义化路径：`/posts/xxx/`、`/circles/xxx/`
- SEO 友好：爬虫可直接抓取完整内容

---

## 路由映射

| 旧路由 | 新路由 | 渲染方式 |
|--------|--------|----------|
| `/post/?id=xxx` | `/posts/{id}/` | SSR |
| `/circle/?slug=xxx` | `/circles/{slug}/` | SSR |
| `/feed/` (静态) | `/feed/` (SSR) | SSR |
| `/circles/` (静态) | `/circles/` (SSR) | SSR |

---

## 环境变量配置

在 Cloudflare Pages Dashboard 中设置：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `SUPABASE_URL` | Supabase 项目 URL | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase 匿名公钥 | `eyJhbGciOiJIUz...` |

### Wrangler 本地开发

使用 `.dev.vars` 文件（不提交到 Git）：

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUz...
```

---

## 文件结构

```
src/
├── lib/
│   └── supabase-server.ts          # SSR 用 Supabase 客户端
├── layouts/
│   └── ForumLayout.astro           # 论坛页面通用布局
├── pages/
│   ├── feed/index.astro            # 帖子动态列表（SSR）
│   ├── posts/[id].astro            # 帖子详情（SSR）
│   ├── circles/index.astro         # 圈子列表（SSR）
│   ├── circles/[slug].astro        # 圈子帖子列表（SSR）
│   └── forum/index.astro           # 发帖页面（静态，客户端 React）
└── components/
    └── forum/
        └── AuthPanel.tsx           # 登录/认证面板（客户端）
```

---

## 已删除文件

| 文件 | 原因 |
|------|------|
| `src/pages/post/index.astro` | 替换为 `/posts/[id].astro` |
| `src/pages/circle/index.astro` | 替换为 `/circles/[slug].astro` |
| `src/components/forum/PostPage.tsx` | 逻辑合并到 SSR 页面 |
| `src/components/forum/CirclePage.tsx` | 逻辑合并到 SSR 页面 |
| `src/components/forum/FeedList.tsx` | 逻辑合并到 SSR 页面 |
| `src/components/forum/CirclesList.tsx` | 逻辑合并到 SSR 页面 |
| `src/components/forum/CirclePosts.tsx` | 逻辑合并到 SSR 页面 |
| `src/components/forum/PostDetail.tsx` | 逻辑合并到 SSR 页面 |

API Functions（`functions/api/forum/`）保留，供发帖表单和未来客户端交互使用。

---

## 构建与部署

```bash
# 本地构建
npm run build

# 本地预览（需要 wrangler）
npx wrangler pages dev dist

# 部署到 Cloudflare Pages
npx wrangler pages deploy dist
```

构建输出中，SSR 页面编译为 `_worker.js/pages/*.mjs` 模块，静态页面输出为 `index.html`。

---

## RLS 安全策略

所有 SSR 页面查询均使用 anon key + RLS，确保安全性：

- `forum_posts` 表：仅返回 `status = 'published'` 的帖子
- `forum_circles` 表：公开可读
- 发帖操作仍通过 `functions/api/forum/posts.ts`，使用 Bearer token 认证

---

## SEO 优势

| 特性 | 旧方案 | 新方案 |
|------|--------|--------|
| 帖子内容对爬虫可见 | 纯客户端渲染 | SSR 输出完整 HTML |
| 语义化 URL | 查询参数 | `/posts/{id}/` |
| Canonical URL | 无 | 自动生成 |
| JSON-LD 结构化数据 | 无 | Article Schema |
| Open Graph 标签 | 通用 | 帖子标题 + 摘要 |
| noindex（404 页） | 无 | 自动设置 |

---

## 迁移检查清单

- [x] `@astrojs/cloudflare@12.6.13` 安装
- [x] `astro.config.mjs` output 设为 `static`（Astro 5.18+ 兼容）
- [x] `src/lib/supabase-server.ts` 创建
- [x] 4 个 SSR 页面创建
- [x] `ForumLayout.astro` 创建
- [x] 旧页面和组件删除
- [x] `npm run build` 成功
- [x] Cloudflare Worker 模块正确生成
- [ ] Cloudflare Pages 环境变量配置
- [ ] 部署并验证 SSR 路由
- [ ] Google Search Console 提交新 URL