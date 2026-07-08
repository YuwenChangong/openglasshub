import productPublicData from "../data/product-public-data.json";

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
  platform: "平台 / 系统",
  connectivity: "连接方式",
  ports: "接口",
  required_host: "主机依赖",
  input_controls: "输入方式",
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
type DeviceCategory = "display_glasses" | "ai_glasses" | "ar_glasses" | "smart_glasses" | "developer_device";
type SpecGroupKey =
  | "display"
  | "hardware"
  | "cameraSensors"
  | "audio"
  | "connectivity"
  | "batteryBody"
  | "market"
  | "optics"
  | "battery"
  | "physical"
  | "compatibility";
type BrandMarkType = "wordmark" | "monogram";
type BrandTone = "xreal" | "rayneo" | "rokid" | "viture" | "inmo" | "meta" | "frame" | "g1";
type BrandLogo = {
  type: "image" | "wordmark";
  src?: string;
  text: string;
  alt: string;
  licenseNote?: string;
};
type ProductPlaceholderType = "glasses" | "headset" | "frame" | "wordmark";
type ProductMedia = {
  imageUrl?: string | null;
  imageAlt: string;
  imageBackground: "light" | "dark" | "transparent";
  imageFit: "contain" | "cover";
  hasConfirmedImage: boolean;
  placeholderType: ProductPlaceholderType;
};
type ProductPublicDataManifest = {
  generated_at: string;
  products: Array<{
    slug: string;
    name: string;
    publicData?: {
      shortSummary?: string | null;
      longSummary?: string | null;
      positioning?: string | null;
      keyLimitations?: string[];
      bestFor?: string[];
      notIdealFor?: string[];
      releaseYear?: string | null;
      availability?: string | null;
      keySpecs?: DeviceSpecs;
      fullSpecs?: Partial<Record<SpecGroupKey, DeviceSpecs>>;
    };
  }>;
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
  brandMarkType: BrandMarkType;
  brandMarkText: string;
  brandTone: BrandTone;
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
  releaseYear?: string | null;
  availability?: string | null;
  typeLabel?: string;
  statusLabel?: string;
  media?: Partial<ProductMedia>;
  productImageUrl?: string | null;
  officialImageUrl?: string | null;
  imageAlt: string;
  productUrl?: string | null;
  officialProductUrl?: string | null;
  buyUrl?: string | null;
  category: DeviceCategory;
  routeLabel: string;
  routeDescription: string;
  bestFor: string[];
  notIdealFor: string[];
  keyLimitations?: string[];
  keySpecs?: DeviceSpecs;
  fullSpecs?: Partial<Record<SpecGroupKey, DeviceSpecs>>;
};
const productPublicManifest = productPublicData as ProductPublicDataManifest;
const productPublicMap = new Map(productPublicManifest.products.map((product) => [product.slug, product]));

const manualSpecGroups = {
  display: "显示",
  hardware: "硬件",
  cameraSensors: "相机与传感器",
  audio: "音频与麦克风",
  connectivity: "连接与兼容",
  batteryBody: "电池与机身",
  market: "发售与市场",
} as const;

function buildBrandLogo(brandSlug: string, text: string, alt: string): BrandLogo {
  return {
    type: "wordmark",
    text,
    alt,
    licenseNote: "Typographic fallback, not official logo asset.",
  };
}

export const routeCatalog = [
  { key: "display_glasses", label: "显示眼镜", description: "强调大屏观影、游戏和第二屏体验。" },
  { key: "ai_glasses", label: "AI 眼镜", description: "强调语音、拍摄、提示与轻量交互入口。" },
  { key: "ar_glasses", label: "AR 眼镜", description: "强调导航、翻译、信息叠加与轻量交互。" },
  { key: "smart_glasses", label: "智能眼镜", description: "强调轻量佩戴、日常信息入口与随身能力。" },
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
    brandMarkType: "wordmark",
    brandMarkText: "XREAL",
    brandTone: "xreal",
    featuredProducts: ["xreal-air-2", "xreal-one", "xreal-air-2-pro"],
  },
  {
    key: "rayneo",
    slug: "rayneo",
    name: "RayNeo",
    displayName: "RayNeo",
    shortIntro: "覆盖显示眼镜与轻量 AR 路线。",
    positioning: "显示与轻量 AR。",
    websiteUrl: "https://www.rayneo.com/",
    brandLogo: buildBrandLogo("rayneo", "RayNeo", "RayNeo logo"),
    brandMarkType: "wordmark",
    brandMarkText: "RayNeo",
    brandTone: "rayneo",
    featuredProducts: ["rayneo-air-4-pro", "rayneo-air-3s", "rayneo-x3-pro"],
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
    brandMarkType: "wordmark",
    brandMarkText: "Rokid",
    brandTone: "rokid",
    featuredProducts: ["rokid-max", "rokid-ar-lite", "rokid-glasses"],
  },
  {
    key: "viture",
    slug: "viture",
    name: "VITURE",
    displayName: "VITURE",
    shortIntro: "主打便携显示眼镜。",
    positioning: "便携显示。",
    websiteUrl: "https://www.viture.com/",
    brandLogo: buildBrandLogo("viture", "VITURE", "VITURE logo"),
    brandMarkType: "wordmark",
    brandMarkText: "VITURE",
    brandTone: "viture",
    featuredProducts: ["viture-pro", "viture-one", "viture-one-lite"],
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
    brandMarkType: "wordmark",
    brandMarkText: "INMO",
    brandTone: "inmo",
    featuredProducts: ["inmo-go3", "inmo-air-2"],
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
    brandMarkType: "wordmark",
    brandMarkText: "Even Realities",
    brandTone: "g1",
    featuredProducts: ["even-realities-g1"],
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
  },
  "xreal-one-pro": {
    slug: "xreal-one-pro",
    brandKey: "xreal",
    brandName: "XREAL",
    name: "XREAL One Pro",
    shortDescription: "XREAL One Pro 仍是外接式显示眼镜，重点在更大的视场角和显示体验升级。它同样依赖外部设备，不是独立系统。",
    longDescription: "XREAL One Pro 仍然属于显示型路线，但更偏向给已经理解这类产品的人做升级选择，核心看点是更开阔的视场和更完整的显示体验。",
    typeLabel: "显示眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "XREAL One Pro 产品视觉",
    officialProductUrl: "https://www.xreal.com/us/one-pro",
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "以显示体验升级为主，而不是独立系统替代。",
    bestFor: ["想升级视场角", "继续走显示眼镜路线", "对空间显示更敏感"],
    notIdealFor: ["期待本机应用生态", "需要明确开发接口"],
    keySpecs: { refresh_rate: "120Hz", field_of_view: "57°" },
    fullSpecs: {
      display: { refresh_rate: "120Hz", field_of_view: "57°" },
    },
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
    category: "developer_device",
    routeLabel: "开发设备",
    routeDescription: "重在开发与实验，不是纯消费级显示设备。",
    bestFor: ["空间计算实验", "开发验证", "研究传感与输入"],
    notIdealFor: ["只想观影", "期待低门槛开箱即用"],
    keySpecs: { refresh_rate: "120Hz", field_of_view: "52°" },
    fullSpecs: {
      display: { refresh_rate: "120Hz", field_of_view: "52°" },
    },
  },
  "xreal-air": {
    slug: "xreal-air",
    brandKey: "xreal",
    brandName: "XREAL",
    name: "XREAL Air",
    shortDescription: "XREAL Air 是 XREAL 早期主流显示眼镜，定位是连接手机、掌机和电脑使用的便携大屏。它不提供独立系统，重点是轻量观影、游戏和第二屏。",
    longDescription: "这代产品奠定了后续 XREAL 显示眼镜路线：外接设备供内容与算力，眼镜负责把屏幕体验做得更贴近日常佩戴。对比新型号，它更适合拿来理解消费级显示眼镜的起点。",
    typeLabel: "显示眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "XREAL Air 产品视觉",
    officialProductUrl: "https://www.xreal.com/about",
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "XREAL 早期消费级显示眼镜。",
    bestFor: ["轻量观影", "掌机与电脑第二屏", "了解显示眼镜起点"],
    notIdealFor: ["期待独立系统", "依赖本机感知与拍摄", "需要最新舒适度设计"],
    keyLimitations: ["需要支持视频输出的外部设备。", "属于早期产品，当前不是品牌主推型号。"],
    keySpecs: { resolution: "1920 × 1080 / eye", refresh_rate: "60Hz", field_of_view: "46°", release_year: "2022" },
    fullSpecs: {
      display: { display_type: "Micro‑OLED", resolution: "1920 × 1080 / eye", refresh_rate: "60Hz", field_of_view: "46°" },
      connectivity: { ports: "USB‑C", required_host: "需要支持视频输出的手机、掌机或电脑", supported_devices: "Android、PC、掌机" },
      market: { availability: "旧款", release_year: "2022" },
    },
  },
  "xreal-air-2": {
    slug: "xreal-air-2",
    brandKey: "xreal",
    brandName: "XREAL",
    name: "XREAL Air 2",
    shortDescription: "XREAL Air 2 是更成熟的一代显示眼镜，继续围绕手机、掌机和电脑外接使用，重点是减重、画质和日常佩戴体验。",
    longDescription: "它延续 XREAL 的显示型路线，不尝试变成独立系统。相比早期型号，Air 2 更适合把它当作长期携带的大屏外设，而不是一次性尝鲜设备。",
    typeLabel: "显示眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "XREAL Air 2 产品视觉",
    officialProductUrl: "https://us.shop.xreal.com/products/xreal-air-2",
    buyUrl: "https://us.shop.xreal.com/products/xreal-air-2",
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "日常便携观影与第二屏显示眼镜。",
    bestFor: ["便携观影", "掌机/电脑第二屏", "想要轻量显示眼镜"],
    notIdealFor: ["期待独立应用生态", "需要摄像头和空间感知", "希望完全无线"],
    keyLimitations: ["内容与算力仍依赖外部设备。", "不提供独立相机或本机应用生态。"],
    keySpecs: { resolution: "1920 × 1080 / eye", refresh_rate: "120Hz", brightness: "500 nits", field_of_view: "46°" },
    fullSpecs: {
      display: { display_type: "Sony 0.55\" Micro‑OLED", resolution: "1920 × 1080 / eye", refresh_rate: "120Hz", brightness: "500 nits", field_of_view: "46°" },
      audio: { speakers: "2 内置立体声扬声器" },
      connectivity: { ports: "USB‑C DisplayPort Alt Mode", required_host: "需要支持视频输出的外部设备" },
      market: { price: "USD 199", availability: "在售", release_year: "2023" },
    },
  },
  "rayneo-x2": {
    slug: "rayneo-x2",
    brandKey: "rayneo",
    brandName: "RayNeo",
    name: "RayNeo X2",
    shortDescription: "RayNeo X2 是一款带独立计算能力的 AR 眼镜，重点是翻译、导航、拍摄和提示式信息叠加。它不是传统外接大屏显示眼镜。",
    longDescription: "RayNeo X2 更接近轻量 AR 路线，核心不在大屏观影，而在导航、提示和信息叠加的实际可用性。",
    typeLabel: "AR 眼镜",
    media: { imageBackground: "dark", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "RayNeo X2 产品视觉",
    officialProductUrl: "https://www.rayneo.com/en-ca/products/tcl-rayneo-x2",
    category: "ar_glasses",
    routeLabel: "AR 眼镜",
    routeDescription: "强调系统级提示与信息叠加，而不是外接大屏。",
    bestFor: ["观察轻量 AR 交互", "导航与翻译场景", "系统级样本研究"],
    notIdealFor: ["只想看大屏", "期望低成本娱乐设备"],
    keySpecs: { chipset: "Snapdragon XR2", memory: "6GB", storage: "128GB", camera: "16MP" },
    fullSpecs: {
      hardware: { chipset: "Snapdragon XR2", camera: "16MP", memory: "6GB", storage: "128GB" },
      battery: { battery_capacity: "590mAh" },
      compatibility: { connectivity: "Wi‑Fi 5 / Bluetooth 5.2" },
    },
  },
  "rayneo-air-2": {
    slug: "rayneo-air-2",
    brandKey: "rayneo",
    brandName: "RayNeo",
    name: "RayNeo Air 2",
    shortDescription: "RayNeo Air 2 是一款外接显示眼镜，主打 1080p Micro‑OLED 屏幕、120Hz 刷新率和广泛的设备兼容性。它更像私人大屏，而不是独立 AR 系统。",
    longDescription: "这款产品强调连接 iPhone、掌机、MacBook 与游戏主机的即插即用体验。它适合看视频、玩游戏和做轻办公，但核心仍是显示终端。",
    typeLabel: "显示眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "RayNeo Air 2 产品视觉",
    officialProductUrl: "https://www.rayneo.com/products/rayneo-air-2-xr-glasses",
    buyUrl: "https://www.rayneo.com/products/rayneo-air-2-xr-glasses",
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "RayNeo 入门到主流段的显示眼镜。",
    bestFor: ["掌机与主机游戏", "便携观影", "跨设备第二屏"],
    notIdealFor: ["期待独立系统", "需要原生空间感知", "只想用无线投屏"],
    keyLimitations: ["需要 DP 输出或转接器。", "不提供独立应用平台。"],
    keySpecs: { resolution: "1080P", refresh_rate: "120Hz", brightness: "600 nits", display_type: "Micro‑OLED" },
    fullSpecs: {
      display: { display_type: "Micro‑OLED", resolution: "1080P", refresh_rate: "120Hz", brightness: "600 nits" },
      connectivity: { supported_devices: "iPhone、Switch、Steam Deck、PS5、Xbox、MacBook", required_host: "USB‑C DP 输出或 HDMI 转接", ports: "USB‑C" },
      market: { price: "USD 149", availability: "在售", release_year: "2024" },
    },
  },
  "rayneo-air-2s": {
    slug: "rayneo-air-2s",
    brandKey: "rayneo",
    brandName: "RayNeo",
    name: "RayNeo Air 2s",
    shortDescription: "RayNeo Air 2s 延续显示眼镜路线，重点是 120Hz 刷新率、600 nits 亮度和更均衡的声音与佩戴调节。",
    longDescription: "相比 Air 2，它更强调长时间使用时的舒适度与音频表现，依然主要服务于手机、掌机和主机的大屏输出场景。",
    typeLabel: "显示眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "RayNeo Air 2s 产品视觉",
    officialProductUrl: "https://eu.rayneo.com/products/rayneo-air_2s",
    buyUrl: "https://eu.rayneo.com/products/rayneo-air_2s",
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "强调佩戴与音频升级的显示眼镜。",
    bestFor: ["观影与游戏", "想要更稳妥的佩戴调节", "跨设备显示"],
    notIdealFor: ["需要独立计算平台", "需要本机相机", "只接受无线方案"],
    keyLimitations: ["依赖外部设备供内容与算力。", "核心升级仍在显示与音频层。"],
    keySpecs: { resolution: "1080P", refresh_rate: "120Hz", brightness: "600 nits", weight: "76g" },
    fullSpecs: {
      display: { resolution: "1080P", refresh_rate: "120Hz", brightness: "600 nits" },
      audio: { speakers: "3D Surround" },
      connectivity: { supported_devices: "iPhone、Android、PC、Switch、PS5", ports: "USB‑C / HDMI 转接", required_host: "支持 DP 输出或适配器" },
      batteryBody: { weight: "76g" },
      market: { price: "€199.99", availability: "在售", release_year: "2024" },
    },
  },
  "rayneo-air-3s": {
    slug: "rayneo-air-3s",
    brandKey: "rayneo",
    brandName: "RayNeo",
    name: "RayNeo Air 3s",
    shortDescription: "RayNeo Air 3s 是更偏影音体验的一代显示眼镜，重点在 HueView Micro‑OLED、120Hz、650 nits 和更成熟的眼部舒适设计。",
    longDescription: "它仍是外接显示路线，但在色彩、亮度、音频和护眼能力上更完整，适合作为私人影院或掌机大屏来理解。",
    typeLabel: "显示眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "RayNeo Air 3s 产品视觉",
    officialProductUrl: "https://eu.rayneo.com/products/rayneo-air-3s-xr-glasses",
    buyUrl: "https://eu.rayneo.com/products/rayneo-air-3s-xr-glasses",
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "高色域、高舒适度的显示眼镜。",
    bestFor: ["电影与串流", "掌机大屏", "更在意色彩与舒适度"],
    notIdealFor: ["需要独立系统", "需要拍摄和传感", "想极简低价试水"],
    keyLimitations: ["依赖外部设备输出内容。", "主要优势在影音体验，不是开放开发平台。"],
    keySpecs: { resolution: "1080P", refresh_rate: "120Hz", brightness: "650 nits", weight: "76g" },
    fullSpecs: {
      display: { display_type: "HueView Micro‑OLED", resolution: "1080P", refresh_rate: "120Hz", brightness: "650 nits", field_of_view: "46°", color_gamut: "98% DCI‑P3" },
      audio: { speakers: "四扬声器 / 3D Surround" },
      connectivity: { supported_devices: "iPhone、Android、PC、Switch、PS5", ports: "USB‑C / HDMI 转接", required_host: "支持 DP 输出或适配器" },
      batteryBody: { weight: "76g" },
      market: { price: "€299.00", availability: "在售", release_year: "2025" },
    },
  },
  "rayneo-air-4-pro": {
    slug: "rayneo-air-4-pro",
    brandKey: "rayneo",
    brandName: "RayNeo",
    name: "RayNeo Air 4 Pro",
    shortDescription: "RayNeo Air 4 Pro 是当前更高阶的显示眼镜，主打 HDR10、1200 nits 峰值亮度、120Hz 和 B&O 调音的四扬声器。",
    longDescription: "它继续服务于观影、游戏和移动大屏，但画质、色彩和声音都明显拉高，更像是显示眼镜路线里的旗舰方案。",
    typeLabel: "显示眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "RayNeo Air 4 Pro 产品视觉",
    officialProductUrl: "https://www.rayneo.com/products/rayneo-air-4-pro-ar-glasses",
    buyUrl: "https://www.rayneo.com/products/rayneo-air-4-pro-ar-glasses",
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "RayNeo 当前高阶显示眼镜。",
    bestFor: ["HDR 观影", "高规格掌机与主机体验", "想要旗舰显示效果"],
    notIdealFor: ["想低成本试水", "需要独立系统", "需要真实世界拍摄能力"],
    keyLimitations: ["仍然需要外部设备输出。", "提升主要集中在显示与音频，不是空间计算平台。"],
    keySpecs: { brightness: "1200 nits", refresh_rate: "120Hz", display_type: "0.6\" SeeYa Micro‑OLED", weight: "76g" },
    fullSpecs: {
      display: { display_type: "0.6\" SeeYa Micro‑OLED", brightness: "1200 nits", refresh_rate: "120Hz", color_gamut: "98% DCI‑P3" },
      audio: { speakers: "四扬声器 / Bang & Olufsen 调音" },
      connectivity: { supported_devices: "手机、Mac、掌机、Switch 2、PS5", required_host: "USB‑C DP 输出", ports: "USB‑C" },
      batteryBody: { weight: "76g" },
      market: { price: "USD 299", availability: "在售", release_year: "2026" },
    },
  },
  "rayneo-x3-pro": {
    slug: "rayneo-x3-pro",
    brandKey: "rayneo",
    brandName: "RayNeo",
    name: "RayNeo X3 Pro",
    shortDescription: "RayNeo X3 Pro 是更偏独立计算和 AI 助手路线的双目 AR 眼镜，重点不再是私人大屏，而是常显信息、空间定位和本机计算。",
    longDescription: "它采用双目全彩 MicroLED、Snapdragon AR1 和 6DoF + SLAM，方向更接近下一代 AR / AI 眼镜。和 Air 系列相比，它更强调信息入口与本机交互。",
    typeLabel: "AR 眼镜",
    media: { imageBackground: "dark", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "RayNeo X3 Pro 产品视觉",
    officialProductUrl: "https://eu.rayneo.com/products/x3-pro-ai-display-glasses",
    buyUrl: "https://eu.rayneo.com/products/x3-pro-ai-display-glasses",
    category: "ar_glasses",
    routeLabel: "AR 眼镜",
    routeDescription: "RayNeo 面向 AR / AI 的独立眼镜路线。",
    bestFor: ["关注 AI+AR 形态", "想研究独立交互", "需要更轻量的常显信息"],
    notIdealFor: ["只想看大屏电影", "想要低价显示外设", "接受度对早期平台较低"],
    keyLimitations: ["平台仍属早期形态。", "相比纯显示眼镜，内容生态与成本门槛更高。"],
    keySpecs: { display_type: "Full-color MicroLED", chipset: "Snapdragon AR1 Gen 1", weight: "76g", sensors: "6DoF + SLAM" },
    fullSpecs: {
      display: { display_type: "双目全彩 MicroLED", brightness: "43-inch transparent display" },
      hardware: { chipset: "Snapdragon AR1 Gen 1", platform: "AI + AR OS" },
      cameraSensors: { sensors: "6DoF + SLAM" },
      connectivity: { input_controls: "语音、触控、空间交互" },
      batteryBody: { weight: "76g" },
      market: { price: "USD 1099", availability: "在售", release_year: "2025" },
    },
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
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "观影、大屏和游戏外接路线。",
    bestFor: ["便携观影", "掌机/主机外接", "对比显示眼镜体验"],
    notIdealFor: ["需要独立系统", "想用眼镜端运行应用"],
    keySpecs: { resolution: "1920 × 1080 / eye", refresh_rate: "120Hz", field_of_view: "50°" },
    fullSpecs: {
      display: { resolution: "1920 × 1080 / eye", refresh_rate: "120Hz", field_of_view: "50°" },
    },
  },
  "rokid-air": {
    slug: "rokid-air",
    brandKey: "rokid",
    brandName: "Rokid",
    name: "Rokid Air",
    shortDescription: "Rokid Air 是 Rokid 早期面向消费市场的显示眼镜，重点在手机外接观影和轻量信息查看，不是独立系统设备。",
    longDescription: "它是 Rokid 后续 Max 系列之前的重要起点，帮助理解品牌从早期 AR 眼镜向更成熟显示眼镜演进的路径。",
    typeLabel: "显示眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "Rokid Air 产品视觉",
    officialProductUrl: "https://air.rokid.com/",
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "Rokid 早期消费级显示眼镜。",
    bestFor: ["了解 Rokid 早期产品路线", "轻量观影", "对比新旧显示眼镜差异"],
    notIdealFor: ["期待最新画质", "需要独立应用生态", "想要更强舒适度"],
    keyLimitations: ["属于较早期型号。", "显示与佩戴规格已落后于新款。"],
    keySpecs: { resolution: "1920 × 1080 / eye", refresh_rate: "60Hz", field_of_view: "43°", release_year: "2021" },
    fullSpecs: {
      display: { resolution: "1920 × 1080 / eye", refresh_rate: "60Hz", field_of_view: "43°" },
      connectivity: { ports: "USB‑C", required_host: "需要连接手机或电脑" },
      market: { price: "USD 499", availability: "旧款", release_year: "2021" },
    },
  },
  "rokid-ar-lite": {
    slug: "rokid-ar-lite",
    brandKey: "rokid",
    brandName: "Rokid",
    name: "Rokid AR Lite",
    shortDescription: "Rokid AR Lite 不是单独一副眼镜，而是 Max 2 + Station 2 组成的 AR 套装，目标是把大屏显示推进到多窗口和信息叠加。",
    longDescription: "它比普通显示眼镜更接近多窗口 AR 套装体验，但核心依旧建立在眼镜与主机协同上，而不是把全部计算放进眼镜本体。",
    typeLabel: "AR 眼镜",
    media: { imageBackground: "dark", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "Rokid AR Lite 产品视觉",
    officialProductUrl: "https://arlite.rokid.com/",
    buyUrl: "https://arlite.rokid.com/",
    category: "ar_glasses",
    routeLabel: "AR 眼镜",
    routeDescription: "Rokid 面向多窗口 AR 的组合式套装。",
    bestFor: ["多窗口空间显示", "想研究眼镜+主机协同", "关注空间视频与空间浏览"],
    notIdealFor: ["只想买一副简单显示眼镜", "只想要轻量佩戴", "期待纯眼镜端完整系统"],
    keyLimitations: ["它是套装，不是单一眼镜。", "Station 2 是体验成立的关键部分。"],
    keySpecs: { chipset: "Snapdragon 6 Gen 1", memory: "8GB", storage: "128GB", battery_capacity: "5000mAh" },
    fullSpecs: {
      hardware: { chipset: "Snapdragon 6 Gen 1", memory: "8GB", storage: "128GB" },
      cameraSensors: { sensors: "9-axis IMU" },
      connectivity: { connectivity: "Wi‑Fi 6 / Bluetooth 5.2", input_controls: "触控板、主页键、菜单键、音量键" },
      batteryBody: { battery_capacity: "5000mAh", charging: "18W 快充" },
      market: { availability: "在售", release_year: "2024" },
    },
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
  },
  "viture-one": {
    slug: "viture-one",
    brandKey: "viture",
    brandName: "VITURE",
    name: "VITURE One",
    shortDescription: "VITURE One 是 VITURE 早期显示眼镜，核心是把手机、掌机和电脑的画面变成随身私人屏幕。它仍然是外接显示路线。",
    longDescription: "这代产品已经体现出 VITURE 的连接和交互思路，比如磁吸连接与 3DoF 支持。相比后续型号，它更适合被看作品牌路线的起点。",
    typeLabel: "显示眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "VITURE One 产品视觉",
    officialProductUrl: "https://www.viture.com/",
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "VITURE 早期显示眼镜。",
    bestFor: ["了解 VITURE 生态起点", "便携观影", "外接掌机大屏"],
    notIdealFor: ["期待最新亮度与刷新率", "需要独立系统", "只接受极简 USB-C 直连"],
    keyLimitations: ["属于较早期一代。", "显示与连接设计已被后续型号更新。"],
    keySpecs: { resolution: "1920 × 1080 / eye", refresh_rate: "60Hz", field_of_view: "43°", release_year: "2022" },
    fullSpecs: {
      display: { resolution: "1920 × 1080 / eye", refresh_rate: "60Hz", field_of_view: "43°" },
      connectivity: { ports: "磁吸连接", required_host: "手机、掌机或电脑" },
      market: { price: "USD 479", availability: "旧款", release_year: "2022" },
    },
  },
  "viture-one-lite": {
    slug: "viture-one-lite",
    brandKey: "viture",
    brandName: "VITURE",
    name: "VITURE One Lite",
    shortDescription: "VITURE One Lite 是更低门槛的显示眼镜版本，保留大多数 One 系列核心体验，但把连接改成标准 USB‑C，并取消电致变色镜片。",
    longDescription: "它更适合把 VITURE 生态当作入门方案来理解：保留大屏体验和 120Hz Full HD 虚拟屏，但减少了一些更精致的硬件特性。",
    typeLabel: "显示眼镜",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "VITURE One Lite 产品视觉",
    officialProductUrl: "https://www.viture.com/blog/2024-in-review-vitures-greatest-year-yet",
    category: "display_glasses",
    routeLabel: "显示眼镜",
    routeDescription: "VITURE 面向入门用户的显示眼镜。",
    bestFor: ["预算更敏感", "想体验 VITURE 生态", "需要标准 USB‑C 连接"],
    notIdealFor: ["想要完整 One 系列特性", "需要电致变色镜片", "需要更高端影音体验"],
    keyLimitations: ["部分高级硬件特性被精简。", "仍然是外接显示眼镜，不是独立系统。"],
    keySpecs: { resolution: "Full HD virtual display", refresh_rate: "120Hz", ports: "USB‑C", release_year: "2024" },
    fullSpecs: {
      display: { resolution: "Full HD virtual display", refresh_rate: "120Hz" },
      connectivity: { ports: "USB‑C", required_host: "兼容 USB‑C 视频输出设备" },
      market: { availability: "在售", release_year: "2024" },
    },
  },
  "inmo-air-2": {
    slug: "inmo-air-2",
    brandKey: "inmo",
    brandName: "INMO",
    name: "INMO Air 2",
    shortDescription: "INMO Air 2 更偏轻量 AR 和提示式信息体验，定位不是外接观影大屏。当前公开资料较少，许多硬件细节仍待确认。",
    longDescription: "INMO Air 2 更适合被看作轻量 AR 和日常提示路线的样本，重点在佩戴形态、输入边界和低干扰信息呈现。",
    typeLabel: "AR 眼镜",
    statusLabel: "资料待补充",
    media: { imageBackground: "dark", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "INMO Air 2 产品视觉",
    officialProductUrl: "https://www.inmoxr.com/pages/inmo-air2",
    category: "ar_glasses",
    routeLabel: "AR 眼镜",
    routeDescription: "强调轻量 AR，而不是纯显示大屏。",
    bestFor: ["研究提示式 AR", "日常佩戴尝试", "观察轻量系统边界"],
    notIdealFor: ["追求沉浸大屏", "把它当成熟消费平台"],
    keySpecs: { connectivity: "Bluetooth 5.0" },
    fullSpecs: {
      compatibility: { connectivity: "Bluetooth 5.0" },
    },
  },
  "inmo-go3": {
    slug: "inmo-go3",
    brandKey: "inmo",
    brandName: "INMO",
    name: "INMO GO3",
    shortDescription: "INMO GO3 更偏实时字幕、翻译和全天佩戴的 AI 眼镜路线，采用轻量双目 Micro‑LED + 波导显示，而不是大屏观影。",
    longDescription: "它把重点放在低干扰提示、语言沟通和随身助理场景，系统和交互也更像轻量终端，而不是娱乐大屏。",
    typeLabel: "AI 眼镜",
    media: { imageBackground: "dark", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "INMO GO3 产品视觉",
    officialProductUrl: "https://www.inmoxr.com/pages/inmo-go3-ai-glasses",
    buyUrl: "https://www.inmoxr.com/pages/inmo-go3-ai-glasses",
    category: "ai_glasses",
    routeLabel: "AI 眼镜",
    routeDescription: "翻译和随身提示导向的 AI 眼镜。",
    bestFor: ["实时字幕与翻译", "低干扰提示", "全天候轻量佩戴"],
    notIdealFor: ["期待沉浸大屏", "主要看电影打游戏", "需要开放开发平台"],
    keyLimitations: ["不是影院型显示眼镜。", "主要价值在提示和翻译，不在大屏娱乐。"],
    keySpecs: { resolution: "640 × 480", brightness: "1500 nits", field_of_view: "30°", weight: "≈58g" },
    fullSpecs: {
      display: { display_type: "双目 Green Micro LED + 衍射光波导", resolution: "640 × 480", brightness: "1500 nits", field_of_view: "30°" },
      hardware: { chipset: "Dual-core CPU", storage: "256MB + 64GB", platform: "RTOS" },
      audio: { microphone: "4 麦克风", speakers: "2 扬声器" },
      connectivity: { input_controls: "触控、实体按键、Ring Control、App Control" },
      batteryBody: { battery_capacity: "270mAh", weight: "≈58g" },
      market: { availability: "在售", release_year: "2025" },
    },
  },
  "ray-ban-meta": {
    slug: "ray-ban-meta",
    brandKey: "meta",
    brandName: "META × RAY-BAN",
    name: "Ray-Ban Meta",
    shortDescription: "Ray-Ban Meta 是一款无显示 AI 眼镜，重点是拍摄、音频和语音助理，而不是画面显示。它更接近日常穿戴设备，不是大屏产品。",
    longDescription: "Ray-Ban Meta 的研究价值在于它说明智能眼镜并不一定从显示开始，而是先从拍摄、音频和 AI 助手切入高频日常使用。",
    typeLabel: "AI 眼镜",
    media: { imageBackground: "dark", imageFit: "contain", hasConfirmedImage: false, placeholderType: "glasses" },
    imageAlt: "Ray-Ban Meta 产品视觉",
    officialProductUrl: "https://www.ray-ban.com/usa/ray-ban-meta-ai-glasses",
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
  },
  "brilliant-labs-frame": {
    slug: "brilliant-labs-frame",
    brandKey: "brilliant-labs",
    brandName: "Brilliant Labs",
    name: "Brilliant Labs Frame",
    shortDescription: "Brilliant Labs Frame 是一款偏实验和开发的 AI 眼镜，用于快速原型、接口实验和轻量穿戴交互。它不是面向大众娱乐消费的完整平台。",
    longDescription: "Frame 更像一个开放实验设备，而不是成熟消费眼镜。它的价值在于让你观察 AI 穿戴的开放边界，而不是直接提供完整消费体验。",
    typeLabel: "开发设备",
    statusLabel: "开发设备",
    media: { imageBackground: "light", imageFit: "contain", hasConfirmedImage: true, placeholderType: "frame" },
    imageAlt: "Brilliant Labs Frame 产品视觉",
    officialProductUrl: "https://brilliant.xyz/products/frame",
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
    category: "ai_glasses",
    routeLabel: "AI 眼镜",
    routeDescription: "更偏提示型智能眼镜，不走大屏路线。",
    bestFor: ["通知与轻量信息", "低干扰佩戴", "提示式眼镜观察"],
    notIdealFor: ["期待沉浸式显示", "需要开放平台"],
    keySpecs: { brightness: "1000 nits", field_of_view: "25°", refresh_rate: "20Hz" },
    fullSpecs: {
      display: { brightness: "1000 nits", field_of_view: "25°", refresh_rate: "20Hz" },
    },
  },
} satisfies Record<string, DeviceDefinition>;

export type DeviceKey = keyof typeof deviceCatalog;
export type DeviceCatalogEntry = (typeof deviceCatalog)[DeviceKey];
export type BrandKey = (typeof brandCatalog)[number]["key"];

const specGroupOrder = [
  {
    key: "display",
    label: manualSpecGroups.display,
    fields: ["display_type", "resolution", "refresh_rate", "brightness", "field_of_view", "ppd", "color_gamut", "dimming", "diopter_support", "myopia_adjustment"] as DeviceSpecField[],
  },
  { key: "hardware", label: manualSpecGroups.hardware, fields: ["chipset", "memory", "storage", "platform", "sdk_availability"] as DeviceSpecField[] },
  { key: "cameraSensors", label: manualSpecGroups.cameraSensors, fields: ["camera", "sensors"] as DeviceSpecField[] },
  { key: "audio", label: manualSpecGroups.audio, fields: ["speakers", "microphone"] as DeviceSpecField[] },
  { key: "connectivity", label: manualSpecGroups.connectivity, fields: ["connectivity", "ports", "supported_devices", "os_compatibility", "required_host", "input_controls"] as DeviceSpecField[] },
  { key: "batteryBody", label: manualSpecGroups.batteryBody, fields: ["battery_life", "battery_capacity", "charging", "power_source", "weight", "dimensions", "frame_style", "ip_rating"] as DeviceSpecField[] },
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
  officialWebsiteUrl,
  officialProductUrl,
  buyUrl,
}: {
  officialWebsiteUrl?: string | null;
  officialProductUrl?: string | null;
  buyUrl?: string | null;
}) {
  const seen = new Set<string>();
  return [
    { label: "官网", url: officialWebsiteUrl ?? null },
    { label: "官方产品页", url: officialProductUrl ?? null },
    { label: "购买", url: buyUrl ?? null },
  ]
    .map((item) => {
      const normalized = normalizeUrl(item.url);
      if (!normalized || seen.has(normalized)) return null;
      seen.add(normalized);
      return { ...item, url: item.url as string };
    })
    .filter(Boolean) as Array<{ label: string; url: string }>;
}

function buildQuickSpecs(items: Array<{ field: DeviceSpecField; label: string; value: string }>, limit: number) {
  return items
    .filter((item, index, array) => array.findIndex((entry) => entry.field === item.field) === index)
    .slice(0, limit);
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
  const publicData = productPublicMap.get(slug)?.publicData;
  const mergedPreviewSpecSource = mergeSpecs(publicData?.keySpecs, base.keySpecs);
  const groupedSpecs = specGroupOrder
    .map((group) => {
      const baseGroup = base.fullSpecs?.[group.key as keyof NonNullable<typeof base.fullSpecs>] ?? {};
      const publicGroup = publicData?.fullSpecs?.[group.key] ?? {};
      const groupSpecs = mergeSpecs(publicGroup, baseGroup);
      const items = pickSpecs(groupSpecs, group.fields);
      return items.length ? { key: group.key, label: group.label, items } : null;
    })
    .filter(Boolean) as Array<{ key: string; label: string; items: Array<{ field: DeviceSpecField; label: string; value: string }> }>;

  const media: ProductMedia = {
    imageUrl: null,
    imageAlt: base.media?.imageAlt ?? base.imageAlt,
    imageBackground: base.media?.imageBackground ?? "dark",
    imageFit: base.media?.imageFit ?? "contain",
    hasConfirmedImage: false,
    placeholderType: base.media?.placeholderType ?? "wordmark",
  };

  const previewSpecFields = mergedPreviewSpecSource ? (Object.keys(mergedPreviewSpecSource) as DeviceSpecField[]) : [];
  const previewSpecs = previewSpecFields.length > 0 ? pickSpecs(mergedPreviewSpecSource, previewSpecFields).slice(0, 5) : [];
  const flattenedSpecs = groupedSpecs.flatMap((group) => group.items);
  const quickSpecs = buildQuickSpecs(flattenedSpecs, 6);
  const cardSpecs = buildQuickSpecs(previewSpecs.length > 0 ? previewSpecs : flattenedSpecs, 4);
  const cardMedia: ProductMedia = { ...media, imageUrl: null, imageBackground: "dark", imageFit: "contain" };
  const detailMedia: ProductMedia = { ...media, imageUrl: null, imageBackground: "dark", imageFit: "contain" };
  const officialProductUrl = base.officialProductUrl ?? base.productUrl ?? null;
  const buyUrl = base.buyUrl ?? null;
  const officialWebsiteUrl = brand?.websiteUrl ?? null;
  const externalLinks = buildExternalLinks({ officialWebsiteUrl, officialProductUrl, buyUrl });
  const typeLabel = base.typeLabel ?? base.routeLabel;
  const positioning = publicData?.positioning ?? base.positioning ?? base.routeDescription;
  const detailSummary = [publicData?.shortSummary ?? base.shortDescription, publicData?.longSummary ?? base.longDescription].filter(Boolean);
  const keyLimitations = publicData?.keyLimitations ?? base.keyLimitations ?? base.notIdealFor;

  return {
    ...base,
    shortDescription: publicData?.shortSummary ?? base.shortDescription,
    longDescription: publicData?.longSummary ?? base.longDescription,
    title: base.name,
    brandLabel: base.brandName,
    brandTone: brand?.brandTone ?? "xreal",
    brandMarkText: brand?.brandMarkText ?? base.brandName,
    brandLogo: brand?.brandLogo ?? { type: "wordmark", text: base.brandName, alt: `${base.brandName} wordmark` },
    brandWebsiteUrl: officialWebsiteUrl,
    typeLabel,
    infoStatusLabel: null,
    media,
    cardMedia,
    detailMedia,
    productImageUrl: null,
    officialImageUrl: null,
    officialProductUrl,
    buyUrl,
    externalLinks,
    quickSpecs,
    cardSpecs,
    previewSpecs,
    specGroups: groupedSpecs,
    keySpecs: previewSpecs,
    knownSpecCount: groupedSpecs.reduce((sum, group) => sum + group.items.length, 0),
    positioning,
    detailSummary,
    keyLimitations,
    releaseYear: publicData?.releaseYear ?? base.releaseYear ?? null,
    availability: publicData?.availability ?? base.availability ?? null,
    bestFor: publicData?.bestFor ?? base.bestFor,
    notIdealFor: publicData?.notIdealFor ?? base.notIdealFor,
  };
}
