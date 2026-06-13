import deviceSpecCandidates from "../data/device-spec-candidates.json";

export const deviceSpecLabels = {
  display_type: "显示类型",
  resolution: "分辨率",
  refresh_rate: "刷新率",
  brightness: "亮度",
  field_of_view: "视场角",
  ppd: "PPD",
  color_gamut: "色域",
  waveguide_type: "波导类型",
  lens_type: "镜片类型",
  diopter_support: "屈光支持",
  myopia_adjustment: "近视调节",
  transparency: "透视能力",
  dimming: "调光",
  chipset: "芯片 / 平台",
  memory: "内存",
  storage: "存储",
  sensors: "传感器",
  camera: "相机",
  microphone: "麦克风",
  speakers: "扬声器",
  connectivity: "连接方式",
  ports: "接口",
  battery_life: "续航",
  battery_capacity: "电池容量",
  charging: "充电",
  power_source: "供电方式",
  weight: "重量",
  dimensions: "尺寸",
  frame_style: "框型",
  ip_rating: "防护等级",
  supported_devices: "兼容设备",
  os_compatibility: "系统兼容",
  sdk_availability: "SDK / 开发支持",
  price: "价格",
  region: "地区",
  availability: "可得性",
  release_year: "发布时间",
} as const;

type DeviceSpecField = keyof typeof deviceSpecLabels;
type DeviceSpecs = Partial<Record<DeviceSpecField, string>>;

type DeviceSnapshot = {
  brand?: string;
  model_name?: string;
  source_url?: string;
  product_url?: string;
  last_checked_at?: string;
  short_description?: string;
  official_image_url?: string | null;
  confidence?: number;
  missing_fields?: string[];
  specs?: DeviceSpecs;
};

type DeviceBase = {
  slug: string;
  title: string;
  brandKey: string;
  brandLabel: string;
  routeKey: string;
  routeLabel: string;
  short: string;
  summary: string;
  fit: string;
  avoid: string;
  sourceLabel: string;
  sourceUrl: string;
};

export const routeCatalog = [
  {
    key: "display",
    label: "显示型",
    title: "显示型路线",
    description: "更适合观影、掌机、PC 第二屏和便携大屏。重点看显示、连接和佩戴稳定性。",
    notes: [
      "先确认接口是否支持视频输出与供电。",
      "真正值得比较的是清晰度、亮度、舒适度和长时间使用稳定性。",
    ],
  },
  {
    key: "ai",
    label: "AI 眼镜",
    title: "AI 眼镜路线",
    description: "更适合语音入口、拍摄记录、翻译、导航和轻量 AI 助手。",
    notes: [
      "先看有没有显示能力，再判断日常入口价值。",
      "不要直接拿来和显示型 AR 眼镜做大屏对比。",
    ],
  },
  {
    key: "standalone",
    label: "独立 AR",
    title: "独立 AR / 系统型路线",
    description: "更接近系统化体验，适合研究导航、翻译、系统交互与输入方式。",
    notes: [
      "重点看输入方式与系统能力是否真实落地。",
      "要特别关注生态成熟度和对配套 App 的依赖程度。",
    ],
  },
  {
    key: "experimental",
    label: "实验路线",
    title: "开放实验 / 开发路线",
    description: "更适合研发验证，重点是 SDK、输入与系统边界，而不是消费级完成度。",
    notes: [
      "优先确认 SDK、权限、安装路径和调试链路。",
      "这类设备更适合做实验样本，不适合直接当成熟消费产品判断。",
    ],
  },
] as const;

export const brandCatalog = [
  { key: "xreal", label: "XREAL" },
  { key: "rokid", label: "Rokid" },
  { key: "rayneo", label: "RayNeo" },
  { key: "inmo", label: "INMO" },
  { key: "viture", label: "VITURE" },
  { key: "meta", label: "Meta AI Glasses" },
  { key: "brilliant-labs", label: "Brilliant Labs" },
  { key: "even-realities", label: "Even Realities" },
] as const;

export const deviceCatalog = {
  "xreal-one": {
    slug: "xreal-one",
    title: "XREAL One",
    brandKey: "xreal",
    brandLabel: "XREAL",
    routeKey: "display",
    routeLabel: "显示型",
    short: "偏显示体验与空间显示路线，适合先判断大屏、连接体验和进阶显示需求。",
    summary: "XREAL One 更适合作为显示型路线入口，核心看点是显示、连接和佩戴连续性，不是把它当独立系统。",
    fit: "看电影、掌机、PC 第二屏，重视显示稳定性。",
    avoid: "希望脱离手机或电脑独立运行完整应用。",
    sourceLabel: "XREAL One 系列连接说明",
    sourceUrl: "https://tutorials.xreal.com/docs/glasses/one-series/first-use/connect-device/",
  },
  "xreal-one-pro": {
    slug: "xreal-one-pro",
    title: "XREAL One Pro",
    brandKey: "xreal",
    brandLabel: "XREAL",
    routeKey: "display",
    routeLabel: "显示型",
    short: "继续看显示质量、佩戴舒适度和更进阶的空间显示边界。",
    summary: "One Pro 依旧属于显示型路线，重点在显示体验升级与佩戴优化。",
    fit: "追求更高显示体验，同路线升级。",
    avoid: "把它当独立 AR 系统替代。",
    sourceLabel: "XREAL One 系列连接说明",
    sourceUrl: "https://tutorials.xreal.com/docs/glasses/one-series/first-use/connect-device/",
  },
  "xreal-air-2-pro": {
    slug: "xreal-air-2-pro",
    title: "XREAL Air 2 Pro",
    brandKey: "xreal",
    brandLabel: "XREAL",
    routeKey: "display",
    routeLabel: "显示型",
    short: "适合对比上一代主流显示型眼镜的佩戴与日常连接体验。",
    summary: "Air 2 Pro 适合做显示型路线对照机型，用来核对日常连接、佩戴舒适度和显示效果。",
    fit: "显示型路线对比，日常便携观影。",
    avoid: "需要独立系统或复杂本机应用生态。",
    sourceLabel: "XREAL 官网",
    sourceUrl: "https://www.xreal.com/",
  },
  "xreal-air-2-ultra": {
    slug: "xreal-air-2-ultra",
    title: "XREAL Air 2 Ultra",
    brandKey: "xreal",
    brandLabel: "XREAL",
    routeKey: "experimental",
    routeLabel: "实验路线",
    short: "更偏开发与空间计算实验路线，先核对 SDK 和输入边界。",
    summary: "Air 2 Ultra 更适合开发和空间计算实验，不该按纯消费观影逻辑判断。",
    fit: "开发验证，空间计算实验。",
    avoid: "只想开箱即用的稳定消费体验。",
    sourceLabel: "XREAL 官网",
    sourceUrl: "https://www.xreal.com/",
  },
  "rokid-max": {
    slug: "rokid-max",
    title: "Rokid Max",
    brandKey: "rokid",
    brandLabel: "Rokid",
    routeKey: "display",
    routeLabel: "显示型",
    short: "偏显示路线，适合判断大屏观影和连接体验。",
    summary: "Rokid Max 是典型显示型眼镜路线，关键是显示参数、连接方式和长时间佩戴稳定性。",
    fit: "观影、大屏、游戏外接显示。",
    avoid: "把它当无手机依赖的独立系统。",
    sourceLabel: "Rokid Max 官方页",
    sourceUrl: "https://max.rokid.com/product/index.html",
  },
  "rokid-glasses": {
    slug: "rokid-glasses",
    title: "Rokid Glasses",
    brandKey: "rokid",
    brandLabel: "Rokid",
    routeKey: "ai",
    routeLabel: "AI 眼镜",
    short: "偏 AI 眼镜日常入口，适合比较看屏和智能入口的差异。",
    summary: "Rokid Glasses 更偏 AI 眼镜入口，关注点应是语音、拍摄、翻译和日常交互边界。",
    fit: "语音、拍摄、轻 AI 助手入口。",
    avoid: "期待显示型大屏体验。",
    sourceLabel: "Rokid AI Glasses 官方页",
    sourceUrl: "https://global.rokid.com/products/rokid-ai-glasses-style",
  },
  "rayneo-x2": {
    slug: "rayneo-x2",
    title: "RayNeo X2",
    brandKey: "rayneo",
    brandLabel: "RayNeo",
    routeKey: "standalone",
    routeLabel: "独立 AR",
    short: "更接近独立 AR 与轻量系统路线，适合研究导航、翻译和系统边界。",
    summary: "RayNeo X2 更接近独立 AR 路线，核心在系统能力与输入边界，而非大屏显示。",
    fit: "独立 AR 方向研究，导航和翻译等系统能力验证。",
    avoid: "只看显示效果，只要低门槛上手。",
    sourceLabel: "RayNeo X2 官方页",
    sourceUrl: "https://www.rayneo.com/products/tcl-rayneo-x2",
  },
  "inmo-air-2": {
    slug: "inmo-air-2",
    title: "INMO Air 2",
    brandKey: "inmo",
    brandLabel: "INMO",
    routeKey: "standalone",
    routeLabel: "独立 AR",
    short: "关注轻量 AR 佩戴、显示入口与日常系统边界。",
    summary: "INMO Air 2 适合做轻量 AR 路线观察，关注点应放在输入能力、佩戴和系统边界。",
    fit: "轻量 AR 场景与系统边界验证。",
    avoid: "把它当成熟消费显示设备。",
    sourceLabel: "INMO 官方",
    sourceUrl: "https://inmoglobal.com/",
  },
  "viture-pro": {
    slug: "viture-pro",
    title: "VITURE Pro",
    brandKey: "viture",
    brandLabel: "VITURE",
    routeKey: "display",
    routeLabel: "显示型",
    short: "适合对比显示型路线里的便携观影与连接体验。",
    summary: "VITURE Pro 更偏显示型路线，适合和 XREAL、Rokid Max 做显示和连接路径对比。",
    fit: "显示型路线对比，便携观影。",
    avoid: "把它当独立 AI 或 AR 系统。",
    sourceLabel: "VITURE 官方",
    sourceUrl: "https://www.viture.com/",
  },
  "ray-ban-meta": {
    slug: "ray-ban-meta",
    title: "Ray-Ban Meta",
    brandKey: "meta",
    brandLabel: "Meta AI Glasses",
    routeKey: "ai",
    routeLabel: "AI 眼镜",
    short: "更偏无显示智能眼镜路线，重点看语音入口、拍摄与日常佩戴。",
    summary: "Ray-Ban Meta 是无显示智能眼镜路线，核心价值在语音和拍摄入口，而非大屏显示。",
    fit: "拍摄、语音交互、日常佩戴。",
    avoid: "期待 AR 大屏或空间显示体验。",
    sourceLabel: "Ray-Ban Meta 官方页",
    sourceUrl: "https://www.ray-ban.com/usa/ray-ban-meta-ai-glasses",
  },
  "brilliant-labs-frame": {
    slug: "brilliant-labs-frame",
    title: "Brilliant Labs Frame",
    brandKey: "brilliant-labs",
    brandLabel: "Brilliant Labs",
    routeKey: "experimental",
    routeLabel: "实验路线",
    short: "开放实验方向，适合观察 AI 入口与硬件实验边界。",
    summary: "Frame 更适合实验和开发探索，重心在开放性与验证价值，而不是消费级完成度。",
    fit: "实验验证，开发探索。",
    avoid: "直接当成熟消费产品。",
    sourceLabel: "Brilliant Frame 硬件文档",
    sourceUrl: "https://docs.brilliant.xyz/frame/hardware/",
  },
  "even-realities-g1": {
    slug: "even-realities-g1",
    title: "Even Realities G1",
    brandKey: "even-realities",
    brandLabel: "Even Realities",
    routeKey: "ai",
    routeLabel: "AI 眼镜",
    short: "更偏低干扰提示与日常佩戴，适合看轻量信息入口路线。",
    summary: "G1 更适合作为轻量提示型智能眼镜样本，不该按大屏 AR 路线判断。",
    fit: "日常佩戴、低干扰通知、轻量信息入口。",
    avoid: "期待沉浸式显示或开放 AR 平台。",
    sourceLabel: "Even Realities 官方页",
    sourceUrl: "https://www.evenrealities.com/en-FI/g1",
  },
} satisfies Record<string, DeviceBase>;

export type DeviceKey = keyof typeof deviceCatalog;
export type DeviceCatalogEntry = (typeof deviceCatalog)[DeviceKey];
export type BrandKey = (typeof brandCatalog)[number]["key"];

const snapshotItems = Array.isArray(deviceSpecCandidates?.items) ? deviceSpecCandidates.items : [];
const snapshotMap = new Map<string, DeviceSnapshot>(
  snapshotItems
    .filter((item) => item && typeof item.slug === "string")
    .map((item) => [String(item.slug), item as DeviceSnapshot]),
);

export const specGroups = [
  {
    key: "display",
    label: "显示与佩戴",
    fields: [
      "display_type",
      "resolution",
      "refresh_rate",
      "brightness",
      "field_of_view",
      "ppd",
      "color_gamut",
      "waveguide_type",
      "lens_type",
      "diopter_support",
      "myopia_adjustment",
      "transparency",
      "dimming",
      "weight",
      "dimensions",
      "frame_style",
      "ip_rating",
    ] as const,
  },
  {
    key: "system",
    label: "系统与交互",
    fields: [
      "chipset",
      "memory",
      "storage",
      "sensors",
      "camera",
      "microphone",
      "speakers",
      "sdk_availability",
      "supported_devices",
      "os_compatibility",
    ] as const,
  },
  {
    key: "power",
    label: "连接与供电",
    fields: [
      "connectivity",
      "ports",
      "battery_life",
      "battery_capacity",
      "charging",
      "power_source",
    ] as const,
  },
  {
    key: "market",
    label: "购买与可得性",
    fields: ["price", "region", "availability", "release_year"] as const,
  },
] as const;

function normalizeValue(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return null;
  return trimmed;
}

export function formatSnapshotDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

export function formatConfidence(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return `${Math.round(value * 100)}%`;
}

export function getDeviceSnapshot(slug: string) {
  return snapshotMap.get(slug) ?? null;
}

export function getKnownSpecs(slug: string) {
  const snapshot = getDeviceSnapshot(slug);
  if (!snapshot?.specs) return [] as Array<{ field: DeviceSpecField; label: string; value: string }>;

  return Object.entries(deviceSpecLabels)
    .map(([field, label]) => {
      const value = normalizeValue(snapshot.specs?.[field as DeviceSpecField]);
      return value ? { field: field as DeviceSpecField, label, value } : null;
    })
    .filter(Boolean) as Array<{ field: DeviceSpecField; label: string; value: string }>;
}

export function getSpecGroups(slug: string) {
  const specs = getKnownSpecs(slug);
  return specGroups
    .map((group) => ({
      ...group,
      items: group.fields
        .map((field) => specs.find((item) => item.field === field))
        .filter(Boolean) as Array<{ field: DeviceSpecField; label: string; value: string }>,
    }))
    .filter((group) => group.items.length > 0);
}

export function getPreviewSpecs(slug: string) {
  const order: DeviceSpecField[] = [
    "display_type",
    "resolution",
    "refresh_rate",
    "brightness",
    "field_of_view",
    "camera",
    "battery_life",
    "weight",
    "price",
  ];
  const knownSpecs = getKnownSpecs(slug);
  return order
    .map((field) => knownSpecs.find((item) => item.field === field))
    .filter(Boolean)
    .slice(0, 4) as Array<{ field: DeviceSpecField; label: string; value: string }>;
}

export function getDeviceBySlug(slug: string) {
  if (!slug || !(slug in deviceCatalog)) return null;
  const base = deviceCatalog[slug as DeviceKey];
  const snapshot = getDeviceSnapshot(slug);
  return {
    ...base,
    snapshot,
    knownSpecs: getKnownSpecs(slug),
    specGroups: getSpecGroups(slug),
    previewSpecs: getPreviewSpecs(slug),
    knownSpecCount: getKnownSpecs(slug).length,
    lastCheckedLabel: formatSnapshotDate(snapshot?.last_checked_at),
    confidence: typeof snapshot?.confidence === "number" ? snapshot.confidence : null,
    confidenceLabel: formatConfidence(snapshot?.confidence),
    missingFields:
      snapshot?.missing_fields
        ?.map((field) => deviceSpecLabels[field as DeviceSpecField] ?? field)
        .filter(Boolean) ?? [],
  };
}

export function getVisibleDevices(options: { brandKey?: string | null; routeKey?: string | null }) {
  return Object.values(deviceCatalog)
    .filter((device) => {
      if (options.brandKey && device.brandKey !== options.brandKey) return false;
      if (options.routeKey && device.routeKey !== options.routeKey) return false;
      return true;
    })
    .map((device) => getDeviceBySlug(device.slug))
    .filter(Boolean);
}

export function getBrandByKey(brandKey: string | null | undefined) {
  if (!brandKey) return null;
  return brandCatalog.find((brand) => brand.key === brandKey) ?? null;
}

export function getBrandCount(brandKey: string) {
  return Object.values(deviceCatalog).filter((device) => device.brandKey === brandKey).length;
}

export function getRouteCount(routeKey: string) {
  return Object.values(deviceCatalog).filter((device) => device.routeKey === routeKey).length;
}

export function getDevicesByBrand(brandKey: string) {
  return getVisibleDevices({ brandKey, routeKey: null });
}
