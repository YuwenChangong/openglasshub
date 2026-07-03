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

export type DeviceLibraryEntry = {
  slug: string;
  name: string;
  brand: string;
  category: DeviceCategory;
  status: DeviceStatus;
  short_description: string;
  use_cases: DeviceUseCase[];
  price_label?: string;
  weight_label?: string;
  display_label?: string;
  fov_label?: string;
  platform_label?: string;
  source_note?: string;
  source_url?: string;
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

const conservativeSourceNote =
  "Device Library MVP uses static local data. Specs stay intentionally conservative and can be replaced by sourced data later.";

export const deviceLibrary: DeviceLibraryEntry[] = [
  {
    slug: "xreal-one",
    name: "XREAL One",
    brand: "XREAL",
    category: "display_glasses",
    status: "released",
    short_description:
      "偏向便携大屏和第二屏体验的显示眼镜，核心仍是连接外部设备使用。",
    use_cases: ["display", "entertainment", "productivity"],
    price_label: "USD 399",
    display_label: "Micro-OLED / 1080p per eye",
    fov_label: "50°",
    platform_label: "Nebula / 外接主机",
    source_note: conservativeSourceNote,
    source_url: "https://us.shop.xreal.com/products/xreal-one",
    updated_label: "2026-07 static MVP",
  },
  {
    slug: "xreal-air-2",
    name: "XREAL Air 2",
    brand: "XREAL",
    category: "display_glasses",
    status: "released",
    short_description:
      "成熟度较高的显示眼镜，适合观影、掌机和轻办公第二屏。",
    use_cases: ["display", "entertainment", "productivity"],
    price_label: "USD 199",
    display_label: "Micro-OLED / 1080p per eye",
    fov_label: "46°",
    source_note: conservativeSourceNote,
    source_url: "https://us.shop.xreal.com/products/xreal-air-2",
    updated_label: "2026-07 static MVP",
  },
  {
    slug: "rayneo-air-4-pro",
    name: "RayNeo Air 4 Pro",
    brand: "RayNeo",
    category: "display_glasses",
    status: "released",
    short_description:
      "更偏影音体验的高阶显示眼镜，仍然依赖外部设备提供内容。",
    use_cases: ["display", "entertainment"],
    price_label: "USD 299",
    weight_label: "76g",
    display_label: "Micro-OLED",
    source_note: conservativeSourceNote,
    source_url: "https://www.rayneo.com/",
    updated_label: "2026-07 static MVP",
  },
  {
    slug: "rayneo-x2",
    name: "RayNeo X2",
    brand: "RayNeo",
    category: "ar_glasses",
    status: "released",
    short_description:
      "更接近独立 AR 路线，强调导航、翻译、信息叠加而不是大屏观影。",
    use_cases: ["assistant", "camera", "productivity"],
    display_label: "Waveguide display",
    platform_label: "独立计算",
    source_note: conservativeSourceNote,
    source_url: "https://www.rayneo.com/en-ca/products/tcl-rayneo-x2",
    updated_label: "2026-07 static MVP",
  },
  {
    slug: "rokid-max",
    name: "Rokid Max",
    brand: "Rokid",
    category: "display_glasses",
    status: "released",
    short_description:
      "典型显示眼镜路线，适合观影、游戏和随身大屏使用。",
    use_cases: ["display", "entertainment"],
    price_label: "USD 439",
    display_label: "Micro-OLED / 1080p per eye",
    fov_label: "50°",
    source_note: conservativeSourceNote,
    source_url: "https://global.rokid.com/",
    updated_label: "2026-07 static MVP",
  },
  {
    slug: "rokid-glasses",
    name: "Rokid Glasses",
    brand: "Rokid",
    category: "ai_glasses",
    status: "released",
    short_description:
      "更偏 AI 入口与轻量拍摄/语音交互，不是以大屏显示为核心。",
    use_cases: ["assistant", "camera"],
    weight_label: "49g",
    platform_label: "AI glasses",
    source_note: conservativeSourceNote,
    source_url: "https://global.rokid.com/",
    updated_label: "2026-07 static MVP",
  },
  {
    slug: "viture-pro",
    name: "VITURE Pro",
    brand: "VITURE",
    category: "display_glasses",
    status: "released",
    short_description:
      "偏便携娱乐和第二屏的显示眼镜，强调连接配件和移动使用场景。",
    use_cases: ["display", "entertainment", "productivity"],
    price_label: "USD 459",
    weight_label: "77g",
    display_label: "Micro-OLED / 1080p per eye",
    fov_label: "52°",
    source_note: conservativeSourceNote,
    source_url: "https://www.viture.com/",
    updated_label: "2026-07 static MVP",
  },
  {
    slug: "inmo-go3",
    name: "INMO GO3",
    brand: "INMO",
    category: "ar_glasses",
    status: "released",
    short_description:
      "偏实时字幕、翻译和轻量提示的 AR/AI 眼镜，不走沉浸式大屏路线。",
    use_cases: ["assistant", "productivity"],
    weight_label: "≈58g",
    display_label: "Micro-LED + waveguide",
    fov_label: "30°",
    platform_label: "RTOS",
    source_note: conservativeSourceNote,
    source_url: "https://www.inmoxr.com/pages/inmo-go3-ai-glasses",
    updated_label: "2026-07 static MVP",
  },
  {
    slug: "ray-ban-meta",
    name: "Ray-Ban Meta",
    brand: "Meta x Ray-Ban",
    category: "ai_glasses",
    status: "released",
    short_description:
      "无显示 AI 眼镜，核心是拍摄、音频和语音助手，而不是画面显示。",
    use_cases: ["assistant", "camera"],
    platform_label: "Meta AI",
    source_note: conservativeSourceNote,
    source_url: "https://www.ray-ban.com/usa/ray-ban-meta-ai-glasses",
    updated_label: "2026-07 static MVP",
  },
  {
    slug: "brilliant-labs-frame",
    name: "Brilliant Labs Frame",
    brand: "Brilliant Labs",
    category: "developer_device",
    status: "developer",
    short_description:
      "偏开放实验和快速原型的开发设备，不是面向大众娱乐的完整 XR 平台。",
    use_cases: ["assistant", "development"],
    price_label: "USD 349",
    weight_label: "40g",
    platform_label: "Noa",
    source_note: conservativeSourceNote,
    source_url: "https://brilliant.xyz/products/frame",
    updated_label: "2026-07 static MVP",
  },
  {
    slug: "even-realities-g1",
    name: "Even Realities G1",
    brand: "Even Realities",
    category: "ar_glasses",
    status: "unknown",
    short_description:
      "偏低干扰信息提示的智能眼镜，更适合轻量通知和短信息显示。",
    use_cases: ["assistant", "productivity"],
    display_label: "Lightweight prompt display",
    fov_label: "25°",
    source_note:
      "Public hardware details remain sparse in current repo notes. Specs are intentionally kept minimal.",
    source_url: "https://www.evenrealities.com/en-FI/g1",
    updated_label: "2026-07 static MVP",
  },
  {
    slug: "apple-vision-pro",
    name: "Apple Vision Pro",
    brand: "Apple",
    category: "xr_headset",
    status: "released",
    short_description:
      "高端独立空间计算头显，适合研究完整系统级体验与空间交互。",
    use_cases: ["productivity", "development", "entertainment"],
    price_label: "USD 3499",
    display_label: "Micro-OLED",
    platform_label: "visionOS",
    source_note: conservativeSourceNote,
    source_url: "https://www.apple.com/apple-vision-pro/",
    updated_label: "2026-07 static MVP",
  },
  {
    slug: "xreal-air-2-ultra",
    name: "XREAL Air 2 Ultra",
    brand: "XREAL",
    category: "developer_device",
    status: "developer",
    short_description:
      "更偏空间交互和开发验证的设备，不是单纯的观影升级款。",
    use_cases: ["development", "productivity"],
    price_label: "USD 699",
    display_label: "Micro-OLED / 1080p per eye",
    fov_label: "52°",
    platform_label: "Nebula / 外接主机",
    source_note: conservativeSourceNote,
    source_url: "https://us.shop.xreal.com/products/xreal-air-2-ultra/",
    updated_label: "2026-07 static MVP",
  },
];

export function getDeviceLibraryEntry(slug: string) {
  return deviceLibrary.find((device) => device.slug === slug) ?? null;
}
