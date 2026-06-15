import deviceSpecCandidates from "../data/device-spec-candidates.json";
import productAssetSources from "../../docs/product-asset-sources.json";
import productDataSources from "../../docs/product-data-sources.json";

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
type DeviceCategory = "display_glasses" | "ai_glasses" | "standalone_xr" | "developer_device";
type BrandMarkType = "wordmark" | "monogram";
type BrandTone = "xreal" | "rayneo" | "rokid" | "viture" | "inmo" | "meta" | "frame" | "g1" | "vision";
type BrandLogo = {
  type: "image" | "wordmark";
  src?: string;
  text: string;
  alt: string;
  licenseNote?: string;
};
type AssetStatus = "official" | "official-cdn" | "press-kit" | "unverified" | "fallback-wordmark" | "placeholder";
type AssetQaStatus = "usable" | "lifestyle-only" | "placeholder" | "wrong-removed" | "needs-review";
type ProductPlaceholderType = "glasses" | "headset" | "frame" | "wordmark";
type ProductMedia = {
  imageUrl?: string | null;
  imageAlt: string;
  imageBackground: "light" | "dark" | "transparent";
  imageFit: "contain" | "cover";
  hasConfirmedImage: boolean;
  placeholderType: ProductPlaceholderType;
};
type ProductAssetManifest = {
  generated_at: string;
  brands: Array<{
    brandSlug: string;
    brandName: string;
    officialWebsiteUrl: string;
    assetExceptionReason?: string | null;
    logo: {
      assetStatus: AssetStatus;
      logoImageUrl?: string | null;
      sourceUrl?: string | null;
      licenseNote?: string | null;
      useInUi: boolean;
    };
  }>;
  products: Array<{
    slug: string;
    brandSlug: string;
    name: string;
    assetExceptionReason?: string | null;
    assetQaStatus?: AssetQaStatus;
    officialProductUrl?: string | null;
    buyUrl?: string | null;
    sourceUrl?: string | null;
    image: {
      assetStatus: AssetStatus;
      imageUrl?: string | null;
      sourceUrl?: string | null;
      licenseNote?: string | null;
      useInUi: boolean;
    };
    specSources?: Array<{ url: string; type: string }>;
  }>;
};

type ProductDataSourceManifest = {
  generated_at: string;
  products: Array<{
    slug: string;
    name: string;
    coverage?: {
      category?: boolean;
      status?: boolean;
      positioning?: boolean;
      shortSummary?: boolean;
      bestFor?: boolean;
      notIdealFor?: boolean;
      sourceUrl?: boolean;
    };
    sources: Array<{
      type: string;
      url: string;
      fields?: string[];
      review?: "official" | "needsReview";
    }>;
    notes?: string[];
    missingFields?: string[];
    needsReviewFields?: string[];
  }>;
};

type DeviceSnapshot = {
  brand?: string;
  model_name?: string;
  source_url?: string;
  product_url?: string;
  source_name?: string;
  last_checked_at?: string;
  short_description?: string;
  official_image_url?: string | null;
  confidence?: number;
  missing_fields?: string[];
  specs?: DeviceSpecs;
  slug?: string;
};

type BrandDefinition = {
  key: string;
  slug: string;
  name: string;
  displayName: string;
  shortIntro: string;
  positioning: string;
  websiteUrl: string;
  brandLogo: BrandLogo;
  logoAssetStatus?: AssetStatus;
  logoSourceUrl?: string | null;
  brandMarkType: BrandMarkType;
  brandMarkText: string;
  brandTone: BrandTone;
  logoImageUrl?: string | null;
  featuredProducts: string[];
};

type DeviceDefinition = {
  slug: string;
  brandKey: string;
  brandName: string;
  name: string;
  shortDescription: string;
  longDescription: string;
  positioning?: string;
  supportUrl?: string | null;
  releaseYear?: string | null;
  availability?: string | null;
  typeLabel?: string;
  statusLabel?: string;
  media?: Partial<ProductMedia>;
  imageAssetStatus?: AssetStatus;
  imageSourceUrl?: string | null;
  productImageUrl?: string | null;
  officialImageUrl?: string | null;
  imageAlt: string;
  productUrl?: string | null;
  officialProductUrl?: string | null;
  buyUrl?: string | null;
  sourceUrl: string;
  sourceName: string;
  lastCheckedAt?: string | null;
  category: DeviceCategory;
  routeLabel: string;
  routeDescription: string;
  bestFor: string[];
  notIdealFor: string[];
  keyLimitations?: string[];
  keySpecs?: DeviceSpecs;
  fullSpecs?: Partial<Record<"display" | "optics" | "hardware" | "battery" | "physical" | "compatibility" | "market", DeviceSpecs>>;
  pendingFields?: string[];
  needsReviewFields?: string[];
  manualCompleteness?: number | null;
};

const snapshotItems = Array.isArray(deviceSpecCandidates?.items) ? deviceSpecCandidates.items : [];
const snapshotMap = new Map<string, DeviceSnapshot>(
  snapshotItems
    .filter((item) => item && typeof item.slug === "string")
    .map((item) => [String(item.slug), item as DeviceSnapshot]),
);
const productAssetManifest = productAssetSources as ProductAssetManifest;
const productDataManifest = productDataSources as ProductDataSourceManifest;
const brandAssetMap = new Map(productAssetManifest.brands.map((brand) => [brand.brandSlug, brand]));
const productAssetMap = new Map(productAssetManifest.products.map((product) => [product.slug, product]));
const productDataMap = new Map(productDataManifest.products.map((product) => [product.slug, product]));

const manualSpecGroups = {
  display: "显示",
  optics: "光学",
  hardware: "硬件",
  battery: "续航与供电",
  physical: "机身与佩戴",
  compatibility: "兼容性",
  market: "发售与市场",
} as const;

function forceHttps(value?: string | null) {
  if (!value) return null;
  return value.replace(/^http:\/\//i, "https://");
}

function getBrandAsset(brandSlug: string) {
  return brandAssetMap.get(brandSlug) ?? null;
}

function getProductAsset(slug: string) {
  return productAssetMap.get(slug) ?? null;
}

function getProductDataEntry(slug: string) {
  return productDataMap.get(slug) ?? null;
}

function buildBrandLogo(brandSlug: string, text: string, alt: string): BrandLogo {
  const asset = getBrandAsset(brandSlug)?.logo;
  return {
    type: "wordmark",
    text,
    alt,
    licenseNote: asset?.licenseNote ?? "Typographic fallback, not official logo asset.",
  };
}

export const routeCatalog = [
  { key: "display_glasses", label: "显示眼镜", description: "强调大屏观影、游戏和第二屏体验。" },
  { key: "ai_glasses", label: "AI 眼镜", description: "强调语音、拍摄、提示与轻量交互入口。" },
  { key: "standalone_xr", label: "独立 XR", description: "更接近完整系统，强调空间计算与独立交互。" },
  { key: "developer_device", label: "开发设备", description: "更适合研究 SDK、传感器和输入边界。" },
] as const;

export const brandCatalog = [
  {
    key: "xreal",
    slug: "xreal",
    name: "XREAL",
    displayName: "XREAL",
    shortIntro: "显示路线完整，适合先看日常观影到空间显示增强。",
    positioning: "显示与空间显示增强。",
    websiteUrl: "https://www.xreal.com/",
    brandLogo: buildBrandLogo("xreal", "XREAL", "XREAL logo"),
    logoAssetStatus: getBrandAsset("xreal")?.logo.assetStatus,
    logoSourceUrl: getBrandAsset("xreal")?.logo.sourceUrl ?? null,
    brandMarkType: "wordmark",
    brandMarkText: "XREAL",
    brandTone: "xreal",
    featuredProducts: ["xreal-one", "xreal-one-pro", "xreal-air-2-pro"],
  },
  {
    key: "rayneo",
    slug: "rayneo",
    name: "RayNeo",
    displayName: "RayNeo",
    shortIntro: "同时覆盖显示眼镜和独立 XR 路线。",
    positioning: "显示到独立 XR。",
    websiteUrl: "https://www.rayneo.com/",
    brandLogo: buildBrandLogo("rayneo", "RayNeo", "RayNeo logo"),
    logoAssetStatus: getBrandAsset("rayneo")?.logo.assetStatus,
    logoSourceUrl: getBrandAsset("rayneo")?.logo.sourceUrl ?? null,
    brandMarkType: "wordmark",
    brandMarkText: "RayNeo",
    brandTone: "rayneo",
    featuredProducts: ["rayneo-x2"],
  },
  {
    key: "rokid",
    slug: "rokid",
    name: "Rokid",
    displayName: "Rokid",
    shortIntro: "同时做显示眼镜和 AI 入口。",
    positioning: "显示 + AI。",
    websiteUrl: "https://global.rokid.com/",
    brandLogo: buildBrandLogo("rokid", "Rokid", "Rokid logo"),
    logoAssetStatus: getBrandAsset("rokid")?.logo.assetStatus,
    logoSourceUrl: getBrandAsset("rokid")?.logo.sourceUrl ?? null,
    brandMarkType: "wordmark",
    brandMarkText: "Rokid",
    brandTone: "rokid",
    featuredProducts: ["rokid-max", "rokid-glasses"],
  },
  {
    key: "viture",
    slug: "viture",
    name: "VITURE",
    displayName: "VITURE",
    shortIntro: "主打显示型 XR 眼镜。",
    positioning: "便携显示。",
    websiteUrl: "https://www.viture.com/",
    brandLogo: buildBrandLogo("viture", "VITURE", "VITURE logo"),
    logoAssetStatus: getBrandAsset("viture")?.logo.assetStatus,
    logoSourceUrl: getBrandAsset("viture")?.logo.sourceUrl ?? null,
    brandMarkType: "wordmark",
    brandMarkText: "VITURE",
    brandTone: "viture",
    featuredProducts: ["viture-pro"],
  },
  {
    key: "inmo",
    slug: "inmo",
    name: "INMO",
    displayName: "INMO",
    shortIntro: "更偏轻量 AR 与提示式交互。",
    positioning: "轻量 AR。",
    websiteUrl: "https://www.inmoglobal.com/",
    brandLogo: buildBrandLogo("inmo", "INMO", "INMO logo"),
    logoAssetStatus: getBrandAsset("inmo")?.logo.assetStatus,
    logoSourceUrl: getBrandAsset("inmo")?.logo.sourceUrl ?? null,
    brandMarkType: "wordmark",
    brandMarkText: "INMO",
    brandTone: "inmo",
    featuredProducts: ["inmo-air-2"],
  },
  {
    key: "meta",
    slug: "meta",
    name: "META × RAY-BAN",
    displayName: "META × RAY-BAN",
    shortIntro: "以拍摄、音频和语音为主的 AI 眼镜路线。",
    positioning: "无显示智能眼镜。",
    websiteUrl: "https://www.ray-ban.com/usa/ray-ban-meta-ai-glasses",
    brandLogo: buildBrandLogo("meta", "META × RAY-BAN", "META × RAY-BAN"),
    logoAssetStatus: getBrandAsset("meta")?.logo.assetStatus,
    logoSourceUrl: getBrandAsset("meta")?.logo.sourceUrl ?? null,
    brandMarkType: "wordmark",
    brandMarkText: "META × RAY-BAN",
    brandTone: "meta",
    featuredProducts: ["ray-ban-meta"],
  },
  {
    key: "brilliant-labs",
    slug: "brilliant-labs",
    name: "Brilliant Labs",
    displayName: "Brilliant Labs",
    shortIntro: "更偏开放实验与开发探索。",
    positioning: "实验型设备。",
    websiteUrl: "https://brilliant.xyz/products/frame",
    brandLogo: buildBrandLogo("brilliant-labs", "Brilliant Labs", "Brilliant Labs logo"),
    logoAssetStatus: getBrandAsset("brilliant-labs")?.logo.assetStatus,
    logoSourceUrl: getBrandAsset("brilliant-labs")?.logo.sourceUrl ?? null,
    brandMarkType: "wordmark",
    brandMarkText: "Brilliant Labs",
    brandTone: "frame",
    featuredProducts: ["brilliant-labs-frame"],
  },
  {
    key: "even-realities",
    slug: "even-realities",
    name: "Even Realities",
    displayName: "Even Realities",
    shortIntro: "强调低干扰信息显示与日常佩戴。",
    positioning: "提示式智能眼镜。",
    websiteUrl: "https://www.evenrealities.com/en-FI/g1",
    brandLogo: buildBrandLogo("even-realities", "Even Realities", "Even Realities logo"),
    logoAssetStatus: getBrandAsset("even-realities")?.logo.assetStatus,
    logoSourceUrl: getBrandAsset("even-realities")?.logo.sourceUrl ?? null,
    brandMarkType: "wordmark",
    brandMarkText: "Even Realities",
    brandTone: "g1",
    featuredProducts: ["even-realities-g1"],
  },
  {
    key: "apple",
    slug: "apple",
    name: "Apple Vision",
    displayName: "Apple Vision",
    shortIntro: "代表高端独立空间计算路线。",
    positioning: "独立空间计算头显。",
    websiteUrl: "https://www.apple.com/apple-vision-pro/",
    brandLogo: buildBrandLogo("apple", "Apple Vision", "Apple Vision wordmark"),
    logoAssetStatus: getBrandAsset("apple")?.logo.assetStatus,
    logoSourceUrl: getBrandAsset("apple")?.logo.sourceUrl ?? null,
    brandMarkType: "wordmark",
    brandMarkText: "Apple Vision",
    brandTone: "vision",
    featuredProducts: ["apple-vision-pro"],
  },
] as const satisfies readonly BrandDefinition[];

const deviceCatalog = {
  "xreal-one": {
    slug: "xreal-one",
    brandKey: "xreal",
    brandName: "XREAL",
    name: "XREAL One",
    shortDescription: "XREAL One 是一款连接手机、电脑和游戏设备使用的显示眼镜，重点是便携大屏和空间显示。它不是独立计算平台，需要外部设备提供内容。",
    longDescription: "XREAL One 更适合作为高阶显示眼镜来理解，它依然围绕外接设备工作，但比传统观影眼镜更强调空间显示稳定性和眼镜本体参与度。",
    typeLabel: "显示眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: true, placeholderType: "glasses" },
    imageAlt: "XREAL One 产品视觉",
    buyUrl: "https://us.shop.xreal.com/products/xreal-one",
    sourceUrl: "https://us.shop.xreal.com/products/xreal-one",
    sourceName: "XREAL official",
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "更适合观影、游戏、移动第二屏和显示链路研究。",
    bestFor: ["观影与掌机大屏", "便携第二屏", "关注空间显示增强"],
    notIdealFor: ["期待完整独立系统", "想直接装普通应用"],
    keySpecs: { refresh_rate: "120Hz", brightness: "600 nits", field_of_view: "50°", price: "USD 399" },
    fullSpecs: {
      display: { refresh_rate: "120Hz", brightness: "600 nits", field_of_view: "50°" },
      market: { price: "USD 399", availability: "在售" },
    },
    pendingFields: ["分辨率", "重量", "兼容设备"],
    manualCompleteness: 0.52,
  },
  "xreal-one-pro": {
    slug: "xreal-one-pro",
    brandKey: "xreal",
    brandName: "XREAL",
    name: "XREAL One Pro",
    shortDescription: "XREAL One Pro 仍是外接式显示眼镜，重点在更大的视场角和显示体验升级。它同样依赖外部设备，不是独立 XR 系统。",
    longDescription: "XREAL One Pro 仍然属于显示型路线，但更偏向给已经理解这类产品的人做升级选择，核心看点是更开阔的视场和更完整的显示体验。",
    typeLabel: "显示眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "XREAL One Pro 产品视觉",
    officialProductUrl: "https://www.xreal.com/us/one-pro",
    sourceUrl: "https://www.xreal.com/us/one-pro",
    sourceName: "XREAL official",
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "以显示体验升级为主，而不是独立系统替代。",
    bestFor: ["想升级视场角", "继续走显示眼镜路线", "对空间显示更敏感"],
    notIdealFor: ["期待本机应用生态", "需要明确开发接口"],
    keySpecs: { refresh_rate: "120Hz", field_of_view: "57°" },
    fullSpecs: {
      display: { refresh_rate: "120Hz", field_of_view: "57°" },
    },
    pendingFields: ["分辨率", "亮度", "重量", "价格"],
    manualCompleteness: 0.34,
  },
  "xreal-air-2-pro": {
    slug: "xreal-air-2-pro",
    brandKey: "xreal",
    brandName: "XREAL",
    name: "XREAL Air 2 Pro",
    shortDescription: "XREAL Air 2 Pro 是一款外接式显示眼镜，重点是轻量观影、游戏和第二屏使用。它不提供独立应用平台，主要依赖连接设备。",
    longDescription: "XREAL Air 2 Pro 更适合当作成熟显示眼镜的参考样本，核心看连接便利性、日常佩戴和显示效果是否满足便携娱乐需求。",
    typeLabel: "显示眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: true, placeholderType: "glasses" },
    imageAlt: "XREAL Air 2 Pro 产品视觉",
    buyUrl: "https://us.shop.xreal.com/products/xreal-air-2-pro",
    sourceUrl: "https://us.shop.xreal.com/products/xreal-air-2-pro",
    sourceName: "XREAL official",
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "偏日常便携观影和轻办公外接。",
    bestFor: ["观影与游戏", "轻办公第二屏", "对比主流显示眼镜"],
    notIdealFor: ["期待独立 AR 系统", "依赖机身摄像与感知能力"],
    keySpecs: { resolution: "1920 × 1080 / eye", refresh_rate: "120Hz", brightness: "500 nits", field_of_view: "46°", price: "USD 249" },
    fullSpecs: {
      display: { display_type: "Micro‑OLED", resolution: "1920 × 1080 / eye", refresh_rate: "120Hz", brightness: "500 nits", field_of_view: "46°" },
      optics: { dimming: "电致变色调光" },
      market: { price: "USD 249", availability: "在售" },
    },
    pendingFields: ["重量", "兼容设备细项", "音频参数"],
    manualCompleteness: 0.62,
  },
  "xreal-air-2-ultra": {
    slug: "xreal-air-2-ultra",
    brandKey: "xreal",
    brandName: "XREAL",
    name: "XREAL Air 2 Ultra",
    shortDescription: "XREAL Air 2 Ultra 更接近开发和空间计算实验设备，用于手势、定位和 6DoF 相关能力验证。它不是面向普通观影场景的主流消费产品。",
    longDescription: "Air 2 Ultra 的价值更偏向开发和空间交互实验，适合研究 SDK、感知边界和空间计算体验，而不是把它视作普通显示眼镜升级款。",
    typeLabel: "开发设备",
    statusLabel: "开发设备",
    media: { imageBackground: "dark", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "XREAL Air 2 Ultra 产品视觉",
    buyUrl: "https://us.shop.xreal.com/products/xreal-air-2-ultra/",
    sourceUrl: "https://us.shop.xreal.com/products/xreal-air-2-ultra/",
    sourceName: "XREAL official",
    category: "developer_device",
    routeLabel: "开发设备",
    routeDescription: "重在开发与实验，不是纯消费级显示设备。",
    bestFor: ["空间计算实验", "开发验证", "研究传感与输入"],
    notIdealFor: ["只想观影", "期待低门槛开箱即用"],
    keySpecs: { refresh_rate: "120Hz", field_of_view: "52°" },
    fullSpecs: {
      display: { refresh_rate: "120Hz", field_of_view: "52°" },
    },
    pendingFields: ["分辨率", "亮度", "重量", "价格"],
    manualCompleteness: 0.38,
  },
  "rayneo-x2": {
    slug: "rayneo-x2",
    brandKey: "rayneo",
    brandName: "RayNeo",
    name: "RayNeo X2",
    shortDescription: "RayNeo X2 是一款带独立计算能力的 XR 眼镜，重点是翻译、导航、拍摄和提示式信息叠加。它不是传统外接大屏显示眼镜。",
    longDescription: "RayNeo X2 是更接近完整独立 XR 路线的样本，核心不在大屏观影，而在系统级交互、轻导航和信息叠加的实际可用性。",
    typeLabel: "独立 XR",
    media: { imageBackground: "dark", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "RayNeo X2 产品视觉",
    officialProductUrl: "https://www.rayneo.com/en-ca/products/tcl-rayneo-x2",
    sourceUrl: "https://www.rayneo.com/en-ca/products/tcl-rayneo-x2",
    sourceName: "RayNeo official",
    category: "standalone_xr",
    routeLabel: "独立 XR",
    routeDescription: "强调系统级体验，而不是外接大屏。",
    bestFor: ["观察独立 XR 交互", "导航与翻译场景", "系统级样本研究"],
    notIdealFor: ["只想看大屏", "期望低成本娱乐设备"],
    keySpecs: { chipset: "Snapdragon XR2", memory: "6GB", storage: "128GB", camera: "16MP" },
    fullSpecs: {
      hardware: { chipset: "Snapdragon XR2", camera: "16MP", memory: "6GB", storage: "128GB" },
      battery: { battery_capacity: "590mAh" },
      compatibility: { connectivity: "Wi‑Fi 5 / Bluetooth 5.2" },
    },
    pendingFields: ["分辨率", "亮度", "视场角", "重量"],
    manualCompleteness: 0.48,
  },
  "rokid-max": {
    slug: "rokid-max",
    brandKey: "rokid",
    brandName: "Rokid",
    name: "Rokid Max",
    shortDescription: "Rokid Max 是一款外接式显示眼镜，重点是观影、游戏和大屏外接使用。它不提供独立系统，主要作为连接设备的显示终端。",
    longDescription: "Rokid Max 适合当作主流显示眼镜的代表样本，重点看清晰度、声音、连接便利性和长时间佩戴舒适度。",
    typeLabel: "显示眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: true, placeholderType: "glasses" },
    imageAlt: "Rokid Max 产品视觉",
    officialProductUrl: "https://global.rokid.com/products/rokid-max",
    sourceUrl: "https://global.rokid.com/products/rokid-max",
    sourceName: "Rokid official",
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "观影、大屏和游戏外接路线。",
    bestFor: ["便携观影", "掌机/主机外接", "对比显示眼镜体验"],
    notIdealFor: ["需要独立系统", "想用眼镜端运行应用"],
    keySpecs: { resolution: "1920 × 1080 / eye", refresh_rate: "120Hz", field_of_view: "50°" },
    fullSpecs: {
      display: { resolution: "1920 × 1080 / eye", refresh_rate: "120Hz", field_of_view: "50°" },
    },
    pendingFields: ["亮度", "重量", "价格"],
    manualCompleteness: 0.46,
  },
  "rokid-glasses": {
    slug: "rokid-glasses",
    brandKey: "rokid",
    brandName: "Rokid",
    name: "Rokid Glasses",
    shortDescription: "Rokid Glasses 更偏 AI 眼镜路线，重点是拍摄、语音和轻量信息入口。它不是以大屏显示为核心的观影设备。",
    longDescription: "Rokid Glasses 与显示型路线不同，核心不是大屏，而是日常佩戴下的语音、提示与轻量摄像入口。",
    typeLabel: "AI 眼镜",
    media: { imageBackground: "dark", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "Rokid Glasses 产品视觉",
    officialProductUrl: "https://global.rokid.com/products/rokid-glasses",
    sourceUrl: "https://global.rokid.com/products/rokid-glasses",
    sourceName: "Rokid official",
    category: "ai_glasses",
    routeLabel: "AI 眼镜",
    routeDescription: "更偏无感佩戴和信息入口。",
    bestFor: ["语音入口", "轻量拍摄", "研究 AI 穿戴入口"],
    notIdealFor: ["期待大屏显示", "想做空间界面开发"],
    keySpecs: { camera: "12MP", chipset: "Snapdragon AR1 Gen 1", memory: "2GB", weight: "49g" },
    fullSpecs: {
      hardware: { chipset: "Snapdragon AR1 Gen 1", camera: "12MP", memory: "2GB", storage: "32GB" },
      battery: { battery_capacity: "210mAh" },
      physical: { weight: "49g" },
    },
    pendingFields: ["显示参数", "续航", "兼容设备"],
    manualCompleteness: 0.54,
  },
  "viture-pro": {
    slug: "viture-pro",
    brandKey: "viture",
    brandName: "VITURE",
    name: "VITURE Pro",
    shortDescription: "VITURE Pro 是一款外接式显示眼镜，重点是便携观影、游戏和第二屏。它不是独立计算设备，内容和交互仍由连接设备提供。",
    longDescription: "VITURE Pro 仍属于显示型眼镜路线，重点是画面、连接生态和便携娱乐体验是否稳定成熟。",
    typeLabel: "显示眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: true, placeholderType: "glasses" },
    imageAlt: "VITURE Pro 产品视觉",
    officialProductUrl: "https://www.viture.com/product/viture-luma-pro-xr-glasses",
    sourceUrl: "https://www.viture.com/product/viture-luma-pro-xr-glasses",
    sourceName: "VITURE official",
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "偏便携娱乐和外接显示生态。",
    bestFor: ["便携观影", "对比显示路线", "外接娱乐设备"],
    notIdealFor: ["期待独立 AI/AR 系统", "优先开发开放平台"],
    keySpecs: { refresh_rate: "120Hz", brightness: "1000 nits", field_of_view: "52°", price: "以官网区域价格为准" },
    fullSpecs: {
      display: { refresh_rate: "120Hz", brightness: "1000 nits", field_of_view: "52°" },
      optics: { diopter_support: "支持近视调节" },
      hardware: { speakers: "内置空间音频" },
    },
    pendingFields: ["分辨率", "重量", "芯片"],
    manualCompleteness: 0.5,
  },
  "inmo-air-2": {
    slug: "inmo-air-2",
    brandKey: "inmo",
    brandName: "INMO",
    name: "INMO Air 2",
    shortDescription: "INMO Air 2 更偏轻量 AR 和提示式信息体验，定位不是外接观影大屏。当前公开资料较少，许多硬件细节仍待确认。",
    longDescription: "INMO Air 2 更适合被看作轻量 AR 和日常提示路线的样本，重点在佩戴形态、输入边界和低干扰信息呈现。",
    typeLabel: "独立 XR",
    statusLabel: "资料待补充",
    media: { imageBackground: "dark", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "INMO Air 2 产品视觉",
    officialProductUrl: "https://www.inmoxr.com/pages/inmo-air2",
    sourceUrl: "https://www.inmoxr.com/pages/inmo-air2",
    sourceName: "INMO official",
    category: "standalone_xr",
    routeLabel: "独立 XR",
    routeDescription: "强调轻量 AR 而不是纯显示大屏。",
    bestFor: ["研究提示式 AR", "日常佩戴尝试", "观察轻量系统边界"],
    notIdealFor: ["追求沉浸大屏", "把它当成熟消费平台"],
    keySpecs: { connectivity: "Bluetooth 5.0" },
    fullSpecs: {
      compatibility: { connectivity: "Bluetooth 5.0" },
    },
    pendingFields: ["显示参数", "重量", "续航", "芯片", "价格"],
    manualCompleteness: 0.22,
  },
  "ray-ban-meta": {
    slug: "ray-ban-meta",
    brandKey: "meta",
    brandName: "META × RAY-BAN",
    name: "Ray-Ban Meta",
    shortDescription: "Ray-Ban Meta 是一款无显示 AI 眼镜，重点是拍摄、音频和语音助理，而不是画面显示。它更接近日常穿戴设备，不是 XR 大屏产品。",
    longDescription: "Ray-Ban Meta 的研究价值在于它说明智能眼镜并不一定从显示开始，而是先从拍摄、音频和 AI 助手切入高频日常使用。",
    typeLabel: "AI 眼镜",
    media: { imageBackground: "dark", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "Ray-Ban Meta 产品视觉",
    officialProductUrl: "https://www.ray-ban.com/usa/ray-ban-meta-ai-glasses",
    sourceUrl: "https://www.ray-ban.com/usa/ray-ban-meta-ai-glasses",
    sourceName: "Ray-Ban official",
    category: "ai_glasses",
    routeLabel: "AI 眼镜",
    routeDescription: "无显示、重拍摄和语音入口。",
    bestFor: ["第一视角拍摄", "音频交互", "轻量 AI 穿戴研究"],
    notIdealFor: ["期待显示大屏", "想做波导或空间界面开发"],
    keySpecs: { camera: "12MP", storage: "32GB", battery_life: "最长约 4 小时", microphone: "5 麦克风" },
    fullSpecs: {
      hardware: { camera: "12MP", storage: "32GB", microphone: "5 麦克风", speakers: "开放式扬声器" },
      battery: { battery_life: "最长约 4 小时" },
    },
    pendingFields: ["重量", "芯片", "价格"],
    manualCompleteness: 0.58,
  },
  "brilliant-labs-frame": {
    slug: "brilliant-labs-frame",
    brandKey: "brilliant-labs",
    brandName: "Brilliant Labs",
    name: "Brilliant Labs Frame",
    shortDescription: "Brilliant Labs Frame 是一款偏实验和开发的 AI 眼镜，用于快速原型、接口实验和轻量穿戴交互。它不是面向大众娱乐消费的完整 XR 平台。",
    longDescription: "Frame 更像一个开放实验设备，而不是成熟消费眼镜。它的价值在于让你观察 AI 穿戴的开放边界，而不是直接提供完整消费体验。",
    typeLabel: "开发设备",
    statusLabel: "开发设备",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: true, placeholderType: "frame" },
    imageAlt: "Brilliant Labs Frame 产品视觉",
    officialProductUrl: "https://brilliant.xyz/products/frame",
    sourceUrl: "https://docs.brilliant.xyz/frame/hardware/",
    sourceName: "Brilliant Labs docs",
    category: "developer_device",
    routeLabel: "开发设备",
    routeDescription: "强调开放实验，而不是消费级完成度。",
    bestFor: ["开发探索", "原型验证", "研究开放硬件方向"],
    notIdealFor: ["直接消费使用", "期待成熟娱乐体验"],
    keySpecs: { connectivity: "Bluetooth 5.3", battery_life: "最长约 14 小时", sdk_availability: "官方文档可用" },
    fullSpecs: {
      hardware: { sdk_availability: "官方文档可用" },
      battery: { battery_life: "最长约 14 小时" },
      compatibility: { connectivity: "Bluetooth 5.3" },
    },
    pendingFields: ["分辨率", "重量", "价格"],
    manualCompleteness: 0.43,
  },
  "even-realities-g1": {
    slug: "even-realities-g1",
    brandKey: "even-realities",
    brandName: "Even Realities",
    name: "Even Realities G1",
    shortDescription: "Even Realities G1 是一款偏低干扰信息提示的智能眼镜，核心是轻量通知和简短信息显示，而不是沉浸式 AR 大屏。",
    longDescription: "G1 更适合被看作低干扰信息提示路线的产品，它不是沉浸式 AR 大屏，而是更接近日常佩戴和轻量信息增强。",
    typeLabel: "AI 眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: true, placeholderType: "glasses" },
    imageAlt: "Even Realities G1 产品视觉",
    officialProductUrl: "https://www.evenrealities.com/en-FI/g1",
    sourceUrl: "https://www.evenrealities.com/en-FI/g1",
    sourceName: "Even Realities official",
    category: "ai_glasses",
    routeLabel: "AI 眼镜",
    routeDescription: "更偏提示型智能眼镜，不走大屏路线。",
    bestFor: ["通知与轻量信息", "低干扰佩戴", "提示式眼镜观察"],
    notIdealFor: ["期待沉浸式显示", "需要开放 XR 平台"],
    keySpecs: { brightness: "1000 nits", field_of_view: "25°", refresh_rate: "20Hz" },
    fullSpecs: {
      display: { brightness: "1000 nits", field_of_view: "25°", refresh_rate: "20Hz" },
    },
    pendingFields: ["分辨率", "重量", "价格", "兼容设备"],
    manualCompleteness: 0.36,
  },
  "apple-vision-pro": {
    slug: "apple-vision-pro",
    brandKey: "apple",
    brandName: "Apple Vision",
    name: "Apple Vision Pro",
    shortDescription: "高端独立空间计算头显，适合研究完整系统级体验。",
    longDescription: "Apple Vision Pro 更接近完整的独立空间计算系统。它不属于轻量眼镜路线，适合观察系统级交互、内容形态与高端硬件集成方式。",
    typeLabel: "空间计算",
    media: {
      imageUrl: "https://www.apple.com/v/apple-vision-pro/k/images/meta/apple-vision-pro-us__f28gp8ey4vam_og.png?202606041907",
      imageBackground: "light",
      imageFit: "contain",
      hasConfirmedImage: true,
      placeholderType: "headset",
    },
    imageAlt: "Apple Vision Pro 产品视觉",
    officialProductUrl: "https://www.apple.com/apple-vision-pro/",
    sourceUrl: "https://support.apple.com/en-us/125436",
    sourceName: "Apple official",
    category: "standalone_xr",
    routeLabel: "独立 XR",
    routeDescription: "完整独立系统和高端空间计算路线。",
    bestFor: ["系统级空间计算研究", "高端 XR 体验", "观察完整交互范式"],
    notIdealFor: ["轻量佩戴", "便携显示替代", "低预算试水"],
    keySpecs: { display_type: "Micro‑OLED", resolution: "23 million pixels", refresh_rate: "90/96/100/120Hz", chipset: "Apple M2 + R1" },
    fullSpecs: {
      display: { display_type: "Micro‑OLED", resolution: "23 million pixels", refresh_rate: "90/96/100/120Hz", color_gamut: "92% DCI‑P3" },
      hardware: { chipset: "Apple M2 + R1", camera: "6.5 stereo MP", sensors: "12 cameras + LiDAR + IMUs", storage: "256GB / 512GB / 1TB" },
    },
    manualCompleteness: 0.62,
  },
} satisfies Record<string, DeviceDefinition>;

export type DeviceKey = keyof typeof deviceCatalog;
export type DeviceCatalogEntry = (typeof deviceCatalog)[DeviceKey];
export type BrandKey = (typeof brandCatalog)[number]["key"];

const specGroupOrder = [
  { key: "display", label: manualSpecGroups.display, fields: ["display_type", "resolution", "refresh_rate", "brightness", "field_of_view", "ppd", "color_gamut"] as DeviceSpecField[] },
  { key: "optics", label: manualSpecGroups.optics, fields: ["waveguide_type", "lens_type", "diopter_support", "myopia_adjustment", "transparency", "dimming"] as DeviceSpecField[] },
  { key: "hardware", label: manualSpecGroups.hardware, fields: ["chipset", "memory", "storage", "sensors", "camera", "microphone", "speakers", "sdk_availability"] as DeviceSpecField[] },
  { key: "battery", label: manualSpecGroups.battery, fields: ["battery_life", "battery_capacity", "charging", "power_source"] as DeviceSpecField[] },
  { key: "physical", label: manualSpecGroups.physical, fields: ["weight", "dimensions", "frame_style", "ip_rating"] as DeviceSpecField[] },
  { key: "compatibility", label: manualSpecGroups.compatibility, fields: ["connectivity", "ports", "supported_devices", "os_compatibility"] as DeviceSpecField[] },
  { key: "market", label: manualSpecGroups.market, fields: ["price", "region", "availability", "release_year"] as DeviceSpecField[] },
] as const;

function normalizeValue(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown" || trimmed.toLowerCase() === "mentioned") return null;
  if (/^0+$/.test(trimmed)) return null;
  if (trimmed.includes("choose your lens options")) return null;
  if (trimmed === "Wifi 6G | Wifi 8G") return null;
  if (trimmed === "5g") return null;
  if (trimmed === "8g") return null;
  if (trimmed.length > 90) return null;
  return trimmed;
}

function sanitizeSpecValue(field: DeviceSpecField, value: string | null) {
  if (!value) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (/^0+$/.test(trimmed)) return null;
  if (field === "brightness" && /^0+\s*(nits)?$/i.test(trimmed)) return null;
  if (/selling countries|need help|share on facebook|share on x|pin on pinterest/i.test(trimmed)) return null;
  if (field === "weight" && /^([0-9]+)\s*g$/i.test(trimmed)) {
    const grams = Number(trimmed.replace(/[^\d.]/g, ""));
    if (Number.isFinite(grams) && grams > 0 && grams < 12) return null;
  }
  if (field === "connectivity" && /wifi 6g \| wifi 8g/i.test(trimmed)) return null;
  if (field === "resolution" && /^[0-9]+\*[0-9]+$/i.test(trimmed)) return trimmed.replace("*", " × ");
  if (field === "refresh_rate" && /^\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}Hz`;
  if (field === "brightness" && /^\d+(\.\d+)?$/.test(trimmed)) return `${trimmed} nits`;
  if (field === "field_of_view" && /^\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}°`;
  if (field === "battery_capacity" && /^\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}mAh`;
  if (field === "battery_life" && /^\d+(\.\d+)?$/.test(trimmed)) return `${trimmed} 小时`;
  if (field === "memory" && /^\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}GB`;
  if (field === "storage" && /^\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}GB`;
  if (field === "camera" && /^\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}MP`;
  if (field === "weight" && /^\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}g`;
  if (field === "release_year" && /^20\d{2}$/.test(trimmed)) return trimmed;
  if (field === "availability" && /^instock$/i.test(trimmed)) return "在售";
  if (field === "availability" && /^out of stock$/i.test(trimmed)) return "缺货";
  if (field === "connectivity") {
    if (/^bluetooth\s*5(\.\d+)?$/i.test(trimmed)) return trimmed.replace(/bluetooth/i, "Bluetooth");
    if (/^wi-?fi\s*5(\.0)?\s*\/\s*bluetooth\s*5\.2$/i.test(trimmed)) return "Wi‑Fi 5 / Bluetooth 5.2";
    if (/^wi-?fi\s*6\s*\/\s*bluetooth\s*5\.2$/i.test(trimmed)) return "Wi‑Fi 6 / Bluetooth 5.2";
    if (/^wi-?fi\s*6\s*b$/i.test(trimmed)) return "Wi‑Fi 6 / Bluetooth";
  }
  if (field === "speakers" && /aac 0920/i.test(trimmed)) return null;
  if (field === "chipset" && /snapdragonprocessor/i.test(trimmed)) return null;
  return trimmed;
}

function mergeSpecs(primary?: DeviceSpecs, fallback?: DeviceSpecs) {
  const merged: DeviceSpecs = {};
  for (const field of Object.keys(deviceSpecLabels) as DeviceSpecField[]) {
    const manualValue = normalizeValue(primary?.[field]);
    const fallbackValue = normalizeValue(fallback?.[field]);
    const resolvedManual = sanitizeSpecValue(field, manualValue);
    const resolvedFallback = sanitizeSpecValue(field, fallbackValue);
    if (resolvedManual) merged[field] = resolvedManual;
    else if (resolvedFallback) merged[field] = resolvedFallback;
  }
  return merged;
}

function pickSpecs(specs: DeviceSpecs, fields: DeviceSpecField[]) {
  const items = fields
    .map((field) => {
      const value = normalizeValue(specs[field]);
      return value ? { field, label: deviceSpecLabels[field], value } : null;
    })
    .filter(Boolean) as Array<{ field: DeviceSpecField; label: string; value: string }>;
  return items;
}

function pickSpecSubset(specs: DeviceSpecs | undefined, fields: readonly DeviceSpecField[]) {
  const subset: DeviceSpecs = {};
  for (const field of fields) {
    if (specs?.[field]) subset[field] = specs[field];
  }
  return subset;
}

export function formatSnapshotDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

function formatCompleteness(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "资料待补充";
  if (value >= 0.7) return "资料完整";
  if (value >= 0.35) return "部分待确认";
  return "资料待补充";
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return `${Math.round(value * 100)}%`;
}

function normalizeUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${pathname}${url.search}`;
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

function buildExternalLinks({
  officialProductUrl,
  buyUrl,
  supportUrl,
  sourceUrl,
}: {
  officialProductUrl?: string | null;
  buyUrl?: string | null;
  supportUrl?: string | null;
  sourceUrl?: string | null;
}) {
  const seen = new Set<string>();
  const links = [
    { label: "官网产品页", url: officialProductUrl ?? null },
    { label: "购买页面", url: buyUrl ?? null },
    { label: "支持 / 规格", url: supportUrl ?? null },
    { label: "参数来源", url: sourceUrl ?? null },
  ]
    .map((item) => {
      const normalized = normalizeUrl(item.url);
      if (!normalized || seen.has(normalized)) return null;
      seen.add(normalized);
      return { ...item, url: item.url as string };
    })
    .filter(Boolean) as Array<{ label: string; url: string }>;

  return links;
}

function buildQuickSpecs(items: Array<{ field: DeviceSpecField; label: string; value: string }>, limit: number) {
  return items
    .filter((item, index, array) => array.findIndex((entry) => entry.field === item.field) === index)
    .slice(0, limit);
}

function buildInfoState({
  category,
  previewSpecs,
  missingFields,
  explicitStatus,
}: {
  category: DeviceCategory;
  previewSpecs: Array<{ field: DeviceSpecField; label: string; value: string }>;
  missingFields: string[];
  explicitStatus?: string;
}) {
  if (explicitStatus) return explicitStatus;
  if (category === "developer_device") return "开发设备";
  if (previewSpecs.length === 0) return "资料待补充";
  if (missingFields.length > 0) return "参数待确认";
  return "参数完整";
}

export function getDeviceSnapshot(slug: string) {
  return snapshotMap.get(slug) ?? null;
}

export function getBrandByKey(brandKey: string | null | undefined) {
  if (!brandKey) return null;
  return brandCatalog.find((brand) => brand.key === brandKey) ?? null;
}

export function getBrandCount(brandKey: string) {
  return Object.values(deviceCatalog).filter((device) => device.brandKey === brandKey).length;
}

export function getBrandProducts(brandKey: string) {
  return Object.values(deviceCatalog)
    .filter((device) => device.brandKey === brandKey)
    .map((device) => getDeviceBySlug(device.slug))
    .filter(Boolean);
}

export function getDevicesByBrand(brandKey: string) {
  return getBrandProducts(brandKey);
}

export function getAllDevices() {
  return Object.values(deviceCatalog)
    .map((device) => getDeviceBySlug(device.slug))
    .filter(Boolean);
}

export function getBrandSummaries() {
  return brandCatalog.map((brand) => {
    const products = getBrandProducts(brand.key);
    return {
      ...brand,
      brandLogo: brand.brandLogo,
      logoAssetStatus: brand.logoAssetStatus,
      logoSourceUrl: brand.logoSourceUrl,
      productCount: products.length,
      featuredProducts: products.filter((device) => brand.featuredProducts.includes(device.slug)).slice(0, 3),
      representativeNames: products
        .filter((device) => brand.featuredProducts.includes(device.slug))
        .map((device) => device.name)
        .slice(0, 3),
    };
  });
}

export function getDeviceBySlug(slug: string) {
  if (!slug || !(slug in deviceCatalog)) return null;
  const base = deviceCatalog[slug as DeviceKey];
  const brand = getBrandByKey(base.brandKey);
  const productAsset = getProductAsset(slug);
  const productData = getProductDataEntry(slug);
  const snapshot = getDeviceSnapshot(slug);
  const mergedSpecs = mergeSpecs(base.keySpecs, snapshot?.specs);
  const groupedSpecs = specGroupOrder
    .map((group) => {
      const manualGroup = base.fullSpecs?.[group.key as keyof NonNullable<typeof base.fullSpecs>] ?? {};
      const snapshotGroup = pickSpecSubset(snapshot?.specs, group.fields);
      const groupSpecs = mergeSpecs(manualGroup, snapshotGroup);
      const items = pickSpecs(groupSpecs, group.fields);
      return items.length ? { key: group.key, label: group.label, items } : null;
    })
    .filter(Boolean) as Array<{ key: string; label: string; items: Array<{ field: DeviceSpecField; label: string; value: string }> }>;

  const completeness =
    typeof base.manualCompleteness === "number"
      ? base.manualCompleteness
      : typeof snapshot?.confidence === "number"
        ? snapshot.confidence
        : groupedSpecs.length > 0
          ? Math.min(0.68, groupedSpecs.reduce((sum, group) => sum + group.items.length, 0) / 24)
          : 0.2;

  const missingFields = Array.from(
    new Set([
      ...(base.pendingFields ?? []),
      ...((snapshot?.missing_fields ?? [])
        .map((field) => deviceSpecLabels[field as DeviceSpecField] ?? null)
        .filter(Boolean) as string[]),
    ]),
  );

  const assetQaStatus = productAsset?.assetQaStatus ?? "needs-review";
  const resolvedImageUrl = null;
  const media: ProductMedia = {
    imageUrl: resolvedImageUrl,
    imageAlt: base.media?.imageAlt ?? base.imageAlt,
    imageBackground: base.media?.imageBackground ?? "dark",
    imageFit: base.media?.imageFit ?? "contain",
    hasConfirmedImage: false,
    placeholderType: base.media?.placeholderType ?? "wordmark",
  };
  const previewSpecFields = base.keySpecs ? (Object.keys(base.keySpecs) as DeviceSpecField[]) : [];
  const previewSpecs = previewSpecFields.length > 0 ? pickSpecs(mergeSpecs(base.keySpecs, snapshot?.specs), previewSpecFields).slice(0, 5) : [];
  const flattenedSpecs = groupedSpecs.flatMap((group) => group.items);
  const quickSpecs = buildQuickSpecs(flattenedSpecs, 6);
  const cardSpecs = buildQuickSpecs(previewSpecs.length > 0 ? previewSpecs : flattenedSpecs, 4);
  const cardMedia: ProductMedia = { ...media, imageUrl: null, imageBackground: "dark", imageFit: "contain" };
  const detailMedia: ProductMedia = { ...media, imageUrl: null, imageBackground: "dark", imageFit: "contain" };
  const officialProductUrl = productAsset ? (productAsset.officialProductUrl ?? null) : base.officialProductUrl ?? base.productUrl ?? null;
  const buyUrl = productAsset ? (productAsset.buyUrl ?? null) : base.buyUrl ?? null;
  const supportUrl = base.supportUrl ?? null;
  const sourceUrl = productAsset ? (productAsset.sourceUrl ?? null) : base.sourceUrl ?? null;
  const externalLinks = buildExternalLinks({ officialProductUrl, buyUrl, supportUrl, sourceUrl });
  const typeLabel = base.typeLabel ?? base.routeLabel;
  const infoStatusLabel = buildInfoState({
    category: base.category,
    previewSpecs,
    missingFields,
    explicitStatus: base.statusLabel,
  });
  const positioning = base.positioning ?? base.routeDescription;
  const detailSummary = [base.shortDescription, base.longDescription].filter(Boolean);
  const keyLimitations = base.keyLimitations ?? base.notIdealFor;
  const sourceNotes = productData?.notes ?? [];
  const needsReviewFields = Array.from(new Set([...(base.needsReviewFields ?? []), ...(productData?.needsReviewFields ?? [])]));

  return {
    ...base,
    title: base.name,
    brandLabel: base.brandName,
    brandTone: brand?.brandTone ?? "xreal",
    brandMarkText: brand?.brandMarkText ?? base.brandName,
    brandLogo: brand?.brandLogo ?? { type: "wordmark", text: base.brandName, alt: `${base.brandName} wordmark` },
    brandWebsiteUrl: brand?.websiteUrl ?? null,
    typeLabel,
    infoStatusLabel,
    snapshot,
    media,
    cardMedia,
    detailMedia,
    productImageUrl: resolvedImageUrl,
    officialImageUrl: resolvedImageUrl,
    imageAssetStatus: productAsset?.image?.assetStatus ?? "placeholder",
    assetQaStatus,
    imageSourceUrl: productAsset?.image?.sourceUrl ?? null,
    officialProductUrl,
    buyUrl,
    supportUrl,
    sourceUrl,
    externalLinks,
    quickSpecs,
    cardSpecs,
    previewSpecs,
    specGroups: groupedSpecs,
    keySpecs: previewSpecs,
    knownSpecCount: groupedSpecs.reduce((sum, group) => sum + group.items.length, 0),
    lastCheckedLabel: formatSnapshotDate(base.lastCheckedAt ?? snapshot?.last_checked_at),
    completeness,
    completenessLabel: formatCompleteness(completeness),
    completenessPercent: formatPercent(completeness),
    missingFields,
    needsReviewFields,
    sourceNotes,
    sourceLedgerEntry: productData,
    positioning,
    detailSummary,
    keyLimitations,
    dataStatusLabel: missingFields.length > 0 ? "部分待确认" : "资料完整",
    pendingSpecLabels: missingFields.slice(0, 8),
  };
}
