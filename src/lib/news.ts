export type NewsCategory = "社区观察" | "行业整理" | "项目进展" | "开发者";

export interface NewsEntry {
  slug: string;
  title: string;
  category: NewsCategory;
  summary: string;
  publishedAt: string;
  coverImageUrl?: string;
  coverAlt?: string;
  mediaType: "none" | "image" | "video";
  mediaUrl?: string;
  sourceUrl?: string;
  sourceLabel?: string;
  body: string[];
}

export const curatedNews: NewsEntry[] = [
  {
    slug: "community-discussion-shifts-to-real-usage",
    title: "管理员精选：中文 AR/AI 眼镜讨论开始回到真实使用问题",
    category: "社区观察",
    summary: "从参数表和宣传词回到佩戴体验、兼容性、续航和系统限制，是当前更有价值的讨论方向。",
    publishedAt: "2026-05-23",
    sourceLabel: "OpenGlass Hub 编辑部",
    mediaType: "none",
    body: [
      "过去一段时间里，很多中文讨论仍然停留在参数、宣传视频和品牌口号层面。但真正会影响购买决策和长期使用体验的，通常是更具体的问题，例如佩戴舒适度、外接链路稳定性、语音和输入方式、权限边界，以及是否存在明确的开发入口。",
      "OpenGlass Hub 会把这类更接近真实体验的内容优先放到社区前台。热点不是越热闹越好，而是要对后来的读者有复用价值。",
      "如果你已经在使用某款设备，最值得分享的并不是一句“好不好”，而是它在具体场景里做得对或做得不对的地方。"
    ],
  },
  {
    slug: "product-watch-focus-on-system-boundaries",
    title: "编辑精选：看 AR/AI 眼镜，不应只看硬件，也要看系统边界",
    category: "行业整理",
    summary: "很多设备的分野并不只来自显示能力，而来自系统权限、可安装路径和输入方式的约束。",
    publishedAt: "2026-05-22",
    sourceLabel: "OpenGlass Hub 编辑部",
    mediaType: "none",
    body: [
      "同样是“眼镜”，不同产品的实际能力可能完全不同。有些更像显示终端，有些强调拍摄和 AI 入口，有些则试图提供更完整的独立系统体验。",
      "对用户和开发者来说，真正需要长期追踪的是系统边界：是否能安装第三方应用，是否开放开发接口，是否允许持续调用摄像头或麦克风，输入方式是否足够稳定，这些都会直接影响设备的长期价值。",
      "因此“热点”内容的重点，不应该是追逐一张参数表，而应该帮助用户更快理解产品分层。"
    ],
  },
  {
    slug: "gaze-launcher-remains-an-early-project",
    title: "项目更新：Gaze Launcher 仍处于开发和验证阶段",
    category: "项目进展",
    summary: "Gaze Launcher 当前仍是一个实验性方向，用于验证更适合眼镜的启动方式与交互路径。",
    publishedAt: "2026-05-21",
    sourceLabel: "项目观察",
    mediaType: "none",
    body: [
      "Gaze Launcher 现阶段并不是一个已经成熟、可安装的产品。它更接近一个正在验证中的交互方向：如何让用户在眼镜上用更少步骤完成启动、切换和任务调用。",
      "这类项目更新仍然会进入“热点”，但它与设备新闻、社区观察不同，不应被包装成已经落地的量产能力。",
      "后续如果形成更稳定的路线或可演示能力，再进入更完整的产品页和项目日志。"
    ],
  },
  {
    slug: "developer-conversations-now-focus-on-permissions-and-input",
    title: "管理员精选：开发者讨论的重点正在转向权限、输入和媒体能力",
    category: "开发者",
    summary: "比起单纯问有没有 SDK，更重要的是搞清楚摄像头、麦克风、安装路径和输入链路是否可用。",
    publishedAt: "2026-05-20",
    sourceLabel: "OpenGlass Hub 编辑部",
    mediaType: "none",
    body: [
      "很多开发者在看 AR/AI 眼镜平台时，第一反应是找 SDK。但真正进入实现阶段后，最先撞到的问题通常不是 SDK 文档，而是权限、安装链路、输入方式和系统限制。",
      "如果平台不能稳定处理媒体、通知、前后台切换或持续输入，那么很多看起来“能做”的场景最终都落不了地。",
      "因此 OpenGlass Hub 的开发者相关内容，会优先强调真实可验证的边界，而不是只罗列平台入口。"
    ],
  },
];

export function getNewsEntry(slug: string) {
  return curatedNews.find((entry) => entry.slug === slug);
}
