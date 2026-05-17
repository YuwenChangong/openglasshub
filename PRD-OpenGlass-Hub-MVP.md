# OpenGlass Hub by Gaze — MVP 产品需求文档

> 版本：v1.1 | 日期：2026-05-17 | 状态：Draft | 适用阶段：Solo-founder MVP

---

## 1. 产品定位

**一句话定义：** AR/AI 眼镜领域的跨品牌知识库、选购指南与开发者资源中心，由 Gaze 团队维护。

**核心价值主张：**
- **中立性**：覆盖 XREAL、RayNeo、Rokid 等主流 AR/AI 眼镜品牌，不偏向任何厂商
- **专业性**：以结构化产品数据和深度选购指南为核心，非新闻搬运
- **实用性**：开发者工具链、Gaze OS 资源、社区入口一站式获取
- **零后端**：纯静态站点，内容通过 Git + Markdown/MDX 管理，部署于 Cloudflare Pages

**差异化定位：**

| 维度 | OpenGlass Hub | 典型 XR 媒体 |
|------|---------------|-------------|
| 范围 | AR/AI 眼镜优先 | 泛 XR / VR 为主 |
| 内容形态 | 结构化产品库 + 深度指南 | 新闻资讯为主 |
| 立场 | 中立跨品牌 | 常有品牌倾向 |
| 架构 | 纯静态 / 零后端 | 传统 CMS |

---

## 2. 目标用户

| 画像 | 核心需求 |
|------|----------|
| **AR 眼镜潜在买家** | 跨品牌产品对比、按场景选购推荐 |
| **AR 应用开发者** | SDK 汇总、开发环境搭建、Gaze OS 技术文档 |
| **Gaze OS 关注者** | Gaze OS 介绍、功能路线图、社区讨论 |
| **行业研究者/媒体** | 产品数据库、技术趋势概览 |

---

## 3. MVP 功能列表

### 3.1 内容系统

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 品牌/产品索引页 | P0 | 按品牌列出 AR/AI 眼镜产品，含基础参数 |
| 单品详情页 | P0 | 规格参数、**适用场景标签**、**信息验证状态**、优缺点 |
| 跨品牌对比页 | P0 | 2-4 款产品横向对比表格 |
| 选购指南 | P0 | 按预算/场景的推荐文章（3 篇） |
| Gaze OS 介绍页 | P0 | Gaze OS 定位、功能概述、路线图（当前无安装版本，标注为未来计划） |
| 开发者资源页 | P1 | SDK 汇总、开发环境搭建教程、示例项目链接 |
| 社区入口页 | P0 | Discord / 微信 / GitHub Discussions 链接聚合 |

**产品页数据模型（替代传统评分）：**

```yaml
suitability:
  - label: "日常影音"
    level: recommended   # recommended | suitable | limited
  - label: "开发者"
    level: recommended
  - label: "户外使用"
    level: limited
verification:
  status: verified       # verified | unverified | outdated
  source: "官方规格书"
  lastChecked: "2026-05-10"
```

### 3.2 导航与发现

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 全局导航栏 | P0 | Logo + 主导航 + 搜索入口 |
| 全文搜索 | P0 | Starlight 内置搜索 或 Pagefind |
| 面包屑导航 | P0 | Starlight 默认支持 |
| 标签/分类 | P1 | 按品牌、场景的内容标签 |

### 3.3 SEO 与性能

| 功能 | 优先级 | 说明 |
|------|--------|------|
| Sitemap | P0 | Astro 自动生成 XML Sitemap |
| Meta 标签 | P0 | 每页独立 title / description / og 标签 |
| 结构化数据 | P1 | Product / Article Schema（静态注入） |
| 性能目标 | P0 | Lighthouse ≥ 90，Core Web Vitals 达标 |

### 3.4 基础设施

| 功能 | 优先级 | 说明 |
|------|--------|------|
| Cloudflare Pages 部署 | P0 | Git 推送自动构建 + 全球 CDN |
| 自定义域名 | P0 | openglass.gaze.dev 或类似 |
| 响应式设计 | P0 | 移动端 / 平板 / 桌面适配 |
| 404 页面 | P0 | 自定义 404 |
| 分析 | P1 | Cloudflare Web Analytics（无 Cookie、隐私友好） |

---

## 4. 非目标（MVP 明确不做）

| 不做 | 原因 |
|------|------|
| 用户系统（注册/登录/个人资料） | 零后端约束 |
| 站内论坛/评论系统 | 社区外链至 Discord / 微信 / GitHub |
| UGC 内容（投稿/打分） | Solo-founder 运营，无审核人力 |
| 电商/Affiliate 链接 | MVP 阶段不涉及 |
| VR 主分类内容 | AR/AI 眼镜优先定位 |
| Apple Vision Pro 独立产品页 | 标记为「空间计算参考」，仅在对比中出现 |
| 多语言（英文） | MVP 仅中文 |
| CMS 后台 | Git + Markdown 工作流 |
| 广告系统 | 无 |
| 数据库 | 无 |
| 实时价格/库存 | 无动态数据能力 |

---

## 5. 主导航结构

```
首页  │  产品库  │  选购指南  │  开发者  │  Gaze OS  │  社区
```

| 导航项 | 子级 | 说明 |
|--------|------|------|
| **首页** | — | 精选产品、最新指南、快速入口 |
| **产品库** | 品牌 → 产品详情 | 按品牌浏览，支持对比 |
| **选购指南** | 3 篇指南 | 按预算 / 按场景 |
| **开发者** | SDK / 教程 / 示例 | AR 应用开发资源 |
| **Gaze OS** | 介绍 / 路线图 | Gaze 生态专区（注明：当前无安装版本） |
| **社区** | Discord / 微信 / GitHub | 社区入口聚合 |

**页脚：** 关于我们 · 联系方式 · GitHub · Discord · 微信 | CC BY-SA 4.0 | © 2026 Gaze · 免责声明链接

---

## 6. 内容类型

### 6.1 产品页（text-first，无未经授权图片）

产品页以**文字信息卡片**为主，不嵌入产品实拍图（MVP 阶段避免版权风险）。可使用官方链接指向厂商产品页。

```yaml
---
title: "XREAL Air 2 Ultra"
description: "XREAL Air 2 Ultra 规格参数、适用场景与开发者体验概览"
brand: "XREAL"
category: "product"
tags: ["AR眼镜", "6DoF", "XREAL"]
publishDate: "2026-05-15"
author: "Gaze Team"
verification:
  status: verified
  source: "XREAL 官方规格书"
  lastChecked: "2026-05-10"
suitability:
  - { label: "日常影音", level: recommended }
  - { label: "开发者", level: recommended }
  - { label: "户外", level: limited }
officialUrl: "https://www.xreal.com/air2ultra"
---
```

### 6.2 指南文章

| 类型 | 字数 | 数量（MVP） |
|------|------|-------------|
| 选购指南（按预算） | 3000-5000 字 | 1 |
| 选购指南（按场景） | 3000-5000 字 | 1 |
| 技术入门解析 | 2000-4000 字 | 1 |

### 6.3 Gaze OS 内容

| 类型 | 说明 |
|------|------|
| 介绍页 | 定位、功能概述、愿景（**明确标注当前无公开安装版本，为未来计划**） |

### 6.4 开发者资源

| 类型 | 说明 |
|------|------|
| 资源汇总页 | 各品牌 SDK 链接、开发文档、社区示例项目 |

### 6.5 社区页面

聚合 Discord 邀请链接、微信群二维码图片、GitHub Discussions 入口。

---

## 7. 上线清单

### 7.1 MVP 上线范围（最终）

| 类别 | 数量 | 说明 |
|------|------|------|
| 产品详情页 | 8-10 页 | 覆盖 XREAL / RayNeo / Rokid 等品牌，每品牌 2-3 款 |
| 选购指南 | 3 篇 | 按预算 × 1 + 按场景 × 1 + 技术入门 × 1 |
| 跨品牌对比页 | 1 页 | 核心产品横向对比 |
| Gaze OS 介绍 | 1 页 | 定位与功能概述（标注为未来计划） |
| 开发者资源 | 1 页 | SDK 与开发文档汇总 |
| 社区入口 | 1 页 | Discord / 微信 / GitHub |
| 首页 | 1 页 | 精选 + 导航 |
| 关于我们 | 1 页 | 团队介绍 + 免责声明 |
| **合计** | **约 17 页** | |

### 7.2 技术准备

- [ ] Astro + Starlight 项目初始化
- [ ] TypeScript 配置
- [ ] Tailwind CSS 集成
- [ ] Cloudflare Pages 部署配置
- [ ] 自定义域名 + SSL
- [ ] Sitemap 生成（Astro 内置）
- [ ] robots.txt
- [ ] 搜索功能（Starlight 内置 或 Pagefind）
- [ ] 响应式设计测试
- [ ] Lighthouse ≥ 90
- [ ] 404 页面
- [ ] Open Graph / Twitter Card 元标签
- [ ] Cloudflare Web Analytics 接入

### 7.3 法律合规

- [ ] 站点免责声明页面（独立立场、非官方合作声明）
- [ ] 所有产品页使用文字卡片，不嵌入未授权产品图片
- [ ] 产品页包含官方链接（officialUrl）
- [ ] 避免使用品牌 Logo 作为站点装饰元素
- [ ] 内容协议：CC BY-SA 4.0
- [ ] 页脚声明：「非任何 AR 眼镜品牌的官方合作方」

### 7.4 SEO

- [ ] Google Search Console 验证
- [ ] 百度站长平台验证
- [ ] 核心页面 Meta Description
- [ ] 图片 Alt 标签
- [ ] 内链结构

### 7.5 社区

- [ ] Discord 服务器 + 频道
- [ ] 微信群 + 二维码
- [ ] GitHub Discussions

### 7.6 上线后（第一周）

- [ ] 社交媒体宣布
- [ ] 索引检查
- [ ] 首批反馈收集

---

## 8. 风险与缓解措施

| # | 风险 | 概率 | 缓解措施 |
|---|------|------|----------|
| 1 | **内容供给不足** — Solo founder 产出有限 | 高 | MVP 范围已缩减至 ~17 页；优先完成 P0 内容；P1 内容上线后 2 周内补齐 |
| 2 | **SEO 冷启动** — 新站无权重 | 高 | 提前提交 Sitemap；GitHub 仓库外链；社交媒体引流；长尾关键词优先 |
| 3 | **产品信息过时** | 中 | 每产品页含 `verification.lastChecked` 字段；季度审核流程；社区反馈（GitHub Issues） |
| 4 | **品牌中立性受质疑** — Gaze OS 内容存在 | 中 | Gaze OS 区域与产品库物理分离；评测内容不评分（用适用标签替代）；免责声明 |
| 5 | **法律风险 — 图片/商标** | 中 | MVP 全站使用文字卡片；不嵌入品牌 Logo；所有产品页含官方链接；免责声明页 |
| 6 | **Gaze OS 无安装版本** — 用户预期落差 | 中 | 介绍页明确标注「功能规划中，当前无公开安装版本」；不提供下载入口 |
| 7 | **社区沉寂** | 中 | 定期在 Discord 发起话题；Gaze OS 进展同步社区公告 |
| 8 | **Cloudflare Pages 限制** | 低 | 免费额度对 MVP 足够；监控用量 |

---

## 附录：技术栈（锁定）

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | **Astro** | 静态站点生成，原生 MDX 支持 |
| 文档主题 | **Starlight** | Astro 官方文档主题，内置搜索、侧边栏、面包屑 |
| 语言 | **TypeScript** | 类型安全 |
| 内容 | **Markdown / MDX** | Git 工作流，PR 审核 |
| 样式 | **Tailwind CSS** | 原子化 CSS，响应式 |
| 搜索 | **Starlight 内置搜索** 或 **Pagefind** | 零后端客户端搜索 |
| 部署 | **Cloudflare Pages** | Git 推送自动构建 + 全球 CDN |
| 分析 | **Cloudflare Web Analytics** | 无 Cookie、隐私友好 |

---

## 变更日志 (Changelog)

### v1.1 (2026-05-17)

| # | 变更 | 原因 |
|---|------|------|
| 1 | 上线内容要求从「30 篇」缩减至 ~17 页（8-10 产品 + 3 指南 + 1 Gaze OS + 1 开发者 + 1 社区 + 1 首页 + 1 关于） | Solo-founder MVP 的现实产出能力 |
| 2 | Gaze OS 内容明确标注「当前无安装版本，为未来计划」 | 避免用户对不存在的产品产生预期 |
| 3 | 产品评分（ratings）替换为**适用场景标签**（suitability tags）+ **信息验证状态**（verification status） | 更适合无主观评分的中立定位；verification 增强可信度 |
| 4 | 技术栈锁定为 Astro + Starlight + TypeScript + Markdown/MDX + Cloudflare Pages + Starlight search/Pagefind + Cloudflare Web Analytics | 消除歧义，实施可执行 |
| 5 | Apple Vision Pro 从主产品库移至「空间计算参考/对比」 | AVP 定位为空间计算设备，非 AR/AI 眼镜品类 |
| 6 | 法律合规强化：文字卡片替代图片、禁止未授权 Logo、官方链接、免责声明页 | 零预算 MVP 无法获取官方媒体授权 |
| 7 | 整体文档精简，移除冗余描述 | 保持实施导向 |
| 8 | 未新增任何功能 | 保持 MVP 范围收敛 |

---

*文档维护：Gaze 团队 · 变更需经产品负责人审核*