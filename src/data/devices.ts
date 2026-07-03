export type DeviceCategory =
  | "ai_glasses"
  | "ar_glasses"
  | "xr_headset"
  | "display_glasses"
  | "developer_device";

export type DeviceStatus =
  | "released"
  | "announced"
  | "developer"
  | "discontinued"
  | "unknown";

export type DeviceUseCase =
  | "assistant"
  | "camera"
  | "display"
  | "productivity"
  | "development"
  | "entertainment";

export type DeviceVerificationLevel =
  | "official"
  | "retailer"
  | "community"
  | "estimated"
  | "unknown";

export type DeviceSourceLinkType = "official" | "retailer" | "review" | "community" | "other";

export type DeviceSourceLink = {
  label: string;
  url: string;
  type: DeviceSourceLinkType;
};

export type DeviceLibraryEntry = {
  slug: string;
  name: string;
  brand: string;
  category: DeviceCategory;
  status: DeviceStatus;
  short_description: string;
  use_cases: DeviceUseCase[];
  verification_level?: DeviceVerificationLevel;
  specs_verified?: boolean;
  last_checked_label?: string;
  source_links?: DeviceSourceLink[];
  comparison_highlights?: string[];
  limitations?: string[];
  price_label?: string;
  weight_label?: string;
  display_label?: string;
  fov_label?: string;
  platform_label?: string;
  source_note?: string;
  updated_label?: string;
};

export const deviceCategoryLabels: Record<DeviceCategory, string> = {
  ai_glasses: "AI 眼镜",
  ar_glasses: "AR 眼镜",
  xr_headset: "XR 头显",
  display_glasses: "显示眼镜",
  developer_device: "开发设备",
};

export const deviceStatusLabels: Record<DeviceStatus, string> = {
  released: "已发售",
  announced: "已公布",
  developer: "开发者向",
  discontinued: "已停售",
  unknown: "状态待确认",
};

export const deviceUseCaseLabels: Record<DeviceUseCase, string> = {
  assistant: "助手",
  camera: "拍摄",
  display: "显示",
  productivity: "效率",
  development: "开发",
  entertainment: "娱乐",
};

export const deviceVerificationLabels: Record<DeviceVerificationLevel, string> = {
  official: "官方来源",
  retailer: "部分已核对",
  community: "社区/经验信息",
  estimated: "估计信息",
  unknown: "尚未核实",
};

export const deviceVerificationDescriptions: Record<DeviceVerificationLevel, string> = {
  official: "当前条目主要基于官方页面或官方公开资料。",
  retailer: "当前条目混合了官方与零售渠道信息，仍可能不完整。",
  community: "当前条目包含社区经验或二手整理，适合方向判断，不宜视为最终规格。",
  estimated: "当前条目只保留大方向和保守估计，细项仍待核实。",
  unknown: "当前条目还没有形成可稳定引用的规格结论。",
};

const staticMvpNote =
  "Specs are intentionally conservative in this static version and may remain incomplete until better verification is available.";

function sourceLinks(...links: DeviceSourceLink[]) {
  return links;
}

export const deviceLibrary: DeviceLibraryEntry[] = [
  {
    slug: "xreal-one",
    name: "XREAL One",
    brand: "XREAL",
    category: "display_glasses",
    status: "released",
    short_description: "偏向便携大屏和第二屏体验的显示眼镜，核心仍是连接外部设备使用。",
    use_cases: ["display", "entertainment", "productivity"],
    verification_level: "official",
    specs_verified: true,
    last_checked_label: "2026-07 官方页复核",
    comparison_highlights: ["更偏外接显示路线", "定位接近便携第二屏"],
    limitations: ["生态体验仍依赖外部主机", "详细兼容性未在此页逐项展开"],
    price_label: "USD 399",
    display_label: "Micro-OLED / 1080p per eye",
    fov_label: "50°",
    platform_label: "Nebula / 外接主机",
    source_note: staticMvpNote,
    source_links: sourceLinks(
      { label: "XREAL One 官方页", url: "https://us.shop.xreal.com/products/xreal-one", type: "official" },
    ),
    updated_label: "2026-07 static comparison v1",
  },
  {
    slug: "xreal-air-2",
    name: "XREAL Air 2",
    brand: "XREAL",
    category: "display_glasses",
    status: "released",
    short_description: "成熟度较高的显示眼镜，适合观影、掌机和轻办公第二屏。",
    use_cases: ["display", "entertainment", "productivity"],
    verification_level: "official",
    specs_verified: true,
    last_checked_label: "2026-07 官方页复核",
    comparison_highlights: ["成熟度较高", "更适合入门显示眼镜判断"],
    limitations: ["实际佩戴适配因脸型不同会有差异"],
    price_label: "USD 199",
    display_label: "Micro-OLED / 1080p per eye",
    fov_label: "46°",
    source_note: staticMvpNote,
    source_links: sourceLinks(
      { label: "XREAL Air 2 官方页", url: "https://us.shop.xreal.com/products/xreal-air-2", type: "official" },
    ),
    updated_label: "2026-07 static comparison v1",
  },
  {
    slug: "rayneo-air-4-pro",
    name: "RayNeo Air 4 Pro",
    brand: "RayNeo",
    category: "display_glasses",
    status: "released",
    short_description: "更偏影音体验的高阶显示眼镜，仍然依赖外部设备提供内容。",
    use_cases: ["display", "entertainment"],
    verification_level: "retailer",
    specs_verified: false,
    last_checked_label: "2026-07 品牌页与零售页交叉查看",
    comparison_highlights: ["偏影音大屏体验", "定位接近中高阶显示眼镜"],
    limitations: ["更多细分规格仍待统一官方说明", "价格可能因地区渠道变化"],
    price_label: "USD 299",
    weight_label: "76g",
    display_label: "Micro-OLED",
    source_note: staticMvpNote,
    source_links: sourceLinks(
      { label: "RayNeo 官方站", url: "https://www.rayneo.com/", type: "official" },
      { label: "RayNeo 产品页", url: "https://www.rayneo.com/", type: "retailer" },
    ),
    updated_label: "2026-07 static comparison v1",
  },
  {
    slug: "rayneo-x2",
    name: "RayNeo X2",
    brand: "RayNeo",
    category: "ar_glasses",
    status: "released",
    short_description: "更接近独立 AR 路线，强调导航、翻译、信息叠加而不是大屏观影。",
    use_cases: ["assistant", "camera", "productivity"],
    verification_level: "official",
    specs_verified: false,
    last_checked_label: "2026-07 官方产品页复核",
    comparison_highlights: ["更接近独立 AR 信息层", "不是典型观影大屏产品"],
    limitations: ["完整量产成熟度信息仍需持续跟进", "这里未展开地区可用性差异"],
    display_label: "Waveguide display",
    platform_label: "独立计算",
    source_note: staticMvpNote,
    source_links: sourceLinks(
      { label: "RayNeo X2 官方页", url: "https://www.rayneo.com/en-ca/products/tcl-rayneo-x2", type: "official" },
    ),
    updated_label: "2026-07 static comparison v1",
  },
  {
    slug: "rokid-max",
    name: "Rokid Max",
    brand: "Rokid",
    category: "display_glasses",
    status: "released",
    short_description: "典型显示眼镜路线，适合观影、游戏和随身大屏使用。",
    use_cases: ["display", "entertainment"],
    verification_level: "retailer",
    specs_verified: false,
    last_checked_label: "2026-07 官方站交叉查看",
    comparison_highlights: ["显示眼镜代表路线之一", "更偏内容消费与游戏"],
    limitations: ["部分规格常见于渠道页，统一口径仍需持续确认"],
    price_label: "USD 439",
    display_label: "Micro-OLED / 1080p per eye",
    fov_label: "50°",
    source_note: staticMvpNote,
    source_links: sourceLinks(
      { label: "Rokid 官方站", url: "https://global.rokid.com/", type: "official" },
    ),
    updated_label: "2026-07 static comparison v1",
  },
  {
    slug: "rokid-glasses",
    name: "Rokid Glasses",
    brand: "Rokid",
    category: "ai_glasses",
    status: "released",
    short_description: "更偏 AI 入口与轻量拍摄/语音交互，不是以大屏显示为核心。",
    use_cases: ["assistant", "camera"],
    verification_level: "community",
    specs_verified: false,
    last_checked_label: "2026-07 品牌资料与公开讨论交叉查看",
    comparison_highlights: ["更接近 AI 入口", "不是显示优先路线"],
    limitations: ["公开可核对规格仍不完整", "不同市场版本信息可能不一致"],
    weight_label: "49g",
    platform_label: "AI glasses",
    source_note: "公开可核对的硬件信息仍偏少，这里只保留方向性信息。",
    source_links: sourceLinks(
      { label: "Rokid 官方站", url: "https://global.rokid.com/", type: "official" },
      { label: "社区讨论参考", url: "https://global.rokid.com/", type: "community" },
    ),
    updated_label: "2026-07 static comparison v1",
  },
  {
    slug: "viture-pro",
    name: "VITURE Pro",
    brand: "VITURE",
    category: "display_glasses",
    status: "released",
    short_description: "偏便携娱乐和第二屏的显示眼镜，强调连接配件和移动使用场景。",
    use_cases: ["display", "entertainment", "productivity"],
    verification_level: "official",
    specs_verified: true,
    last_checked_label: "2026-07 官方页复核",
    comparison_highlights: ["偏移动娱乐生态", "适合第二屏与配件组合判断"],
    limitations: ["完整配件组合差异未在此页逐项拆开"],
    price_label: "USD 459",
    weight_label: "77g",
    display_label: "Micro-OLED / 1080p per eye",
    fov_label: "52°",
    source_note: staticMvpNote,
    source_links: sourceLinks(
      { label: "VITURE 官方站", url: "https://www.viture.com/", type: "official" },
    ),
    updated_label: "2026-07 static comparison v1",
  },
  {
    slug: "inmo-go3",
    name: "INMO GO3",
    brand: "INMO",
    category: "ar_glasses",
    status: "released",
    short_description: "偏实时字幕、翻译和轻量提示的 AR/AI 眼镜，不走沉浸式大屏路线。",
    use_cases: ["assistant", "productivity"],
    verification_level: "official",
    specs_verified: false,
    last_checked_label: "2026-07 官方页复核",
    comparison_highlights: ["更偏轻量提示与字幕翻译", "不是沉浸式 XR 头显"],
    limitations: ["更多系统能力仍需以实机体验验证", "这里未细分全部交互限制"],
    weight_label: "≈58g",
    display_label: "Micro-LED + waveguide",
    fov_label: "30°",
    platform_label: "RTOS",
    source_note: staticMvpNote,
    source_links: sourceLinks(
      { label: "INMO GO3 官方页", url: "https://www.inmoxr.com/pages/inmo-go3-ai-glasses", type: "official" },
    ),
    updated_label: "2026-07 static comparison v1",
  },
  {
    slug: "ray-ban-meta",
    name: "Ray-Ban Meta",
    brand: "Meta x Ray-Ban",
    category: "ai_glasses",
    status: "released",
    short_description: "无显示 AI 眼镜，核心是拍摄、音频和语音助手，而不是画面显示。",
    use_cases: ["assistant", "camera"],
    verification_level: "official",
    specs_verified: false,
    last_checked_label: "2026-07 官方页复核",
    comparison_highlights: ["无显示设计", "更偏拍摄、音频与助手体验"],
    limitations: ["并不适合用来替代显示眼镜", "AI 能力受地区与账户可用性影响"],
    platform_label: "Meta AI",
    source_note: staticMvpNote,
    source_links: sourceLinks(
      { label: "Ray-Ban Meta 官方页", url: "https://www.ray-ban.com/usa/ray-ban-meta-ai-glasses", type: "official" },
    ),
    updated_label: "2026-07 static comparison v1",
  },
  {
    slug: "brilliant-labs-frame",
    name: "Brilliant Labs Frame",
    brand: "Brilliant Labs",
    category: "developer_device",
    status: "developer",
    short_description: "偏开放实验和快速原型的开发设备，不是面向大众娱乐的完整 XR 平台。",
    use_cases: ["assistant", "development"],
    verification_level: "official",
    specs_verified: false,
    last_checked_label: "2026-07 官方页复核",
    comparison_highlights: ["强调开放实验", "更适合原型和开发者探索"],
    limitations: ["不宜直接当作大众消费成品比较", "量产成熟度和支持范围需持续关注"],
    price_label: "USD 349",
    weight_label: "40g",
    platform_label: "Noa",
    source_note: staticMvpNote,
    source_links: sourceLinks(
      { label: "Brilliant Labs Frame 官方页", url: "https://brilliant.xyz/products/frame", type: "official" },
    ),
    updated_label: "2026-07 static comparison v1",
  },
  {
    slug: "even-realities-g1",
    name: "Even Realities G1",
    brand: "Even Realities",
    category: "ar_glasses",
    status: "unknown",
    short_description: "偏低干扰信息提示的智能眼镜，更适合轻量通知和短信息显示。",
    use_cases: ["assistant", "productivity"],
    verification_level: "unknown",
    specs_verified: false,
    last_checked_label: "2026-07 公开信息复查",
    comparison_highlights: ["方向偏轻提示信息层", "适合放进观察名单而不是规格对赌"],
    limitations: ["公开硬件细节仍偏少", "现阶段不适合做精确参数比较"],
    display_label: "Lightweight prompt display",
    fov_label: "25°",
    source_note: "Public hardware details remain sparse in current repo notes. Specs are intentionally kept minimal.",
    source_links: sourceLinks(
      { label: "Even Realities G1 页", url: "https://www.evenrealities.com/en-FI/g1", type: "official" },
    ),
    updated_label: "2026-07 static comparison v1",
  },
  {
    slug: "apple-vision-pro",
    name: "Apple Vision Pro",
    brand: "Apple",
    category: "xr_headset",
    status: "released",
    short_description: "高端独立空间计算头显，适合研究完整系统级体验与空间交互。",
    use_cases: ["productivity", "development", "entertainment"],
    verification_level: "official",
    specs_verified: false,
    last_checked_label: "2026-07 官方页复核",
    comparison_highlights: ["完整空间计算平台", "和轻量眼镜路线明显不同"],
    limitations: ["不适合和轻量眼镜只按单一参数横比", "重量与佩戴负担这里只保留高层信息"],
    price_label: "USD 3499",
    display_label: "Micro-OLED",
    platform_label: "visionOS",
    source_note: staticMvpNote,
    source_links: sourceLinks(
      { label: "Apple Vision Pro 官方页", url: "https://www.apple.com/apple-vision-pro/", type: "official" },
    ),
    updated_label: "2026-07 static comparison v1",
  },
  {
    slug: "xreal-air-2-ultra",
    name: "XREAL Air 2 Ultra",
    brand: "XREAL",
    category: "developer_device",
    status: "developer",
    short_description: "更偏空间交互和开发验证的设备，不是单纯的观影升级款。",
    use_cases: ["development", "productivity"],
    verification_level: "official",
    specs_verified: false,
    last_checked_label: "2026-07 官方页复核",
    comparison_highlights: ["更偏开发验证", "不只是显示眼镜迭代款"],
    limitations: ["开发者向定位意味着大众购买判断要更谨慎", "完整传感器边界未在此页详列"],
    price_label: "USD 699",
    display_label: "Micro-OLED / 1080p per eye",
    fov_label: "52°",
    platform_label: "Nebula / 外接主机",
    source_note: staticMvpNote,
    source_links: sourceLinks(
      { label: "XREAL Air 2 Ultra 官方页", url: "https://us.shop.xreal.com/products/xreal-air-2-ultra/", type: "official" },
    ),
    updated_label: "2026-07 static comparison v1",
  },
];

export function getDeviceLibraryEntry(slug: string) {
  return deviceLibrary.find((device) => device.slug === slug) ?? null;
}
