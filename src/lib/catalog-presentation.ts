export type CatalogLocale = "zh-CN" | "en";
export type CatalogPresentation = {
  labelZh?: string; labelEn?: string; valueZh?: string; valueEn?: string;
  groupKey?: string; groupZh?: string; groupEn?: string; groupOrder?: number;
  order?: number; keySpec?: boolean; keySpecOrder?: number; publicDisplay?: boolean;
  format?: "text" | "number" | "boolean" | "dimensions" | "range" | "date";
  displayUnit?: string; precision?: number;
};

const groups: Record<string, readonly [string, string]> = {
  basic: ["基础信息", "Basics"], display: ["显示", "Display"], audio: ["音频", "Audio"],
  tracking: ["追踪与传感器", "Tracking & Sensors"], connectivity: ["连接与兼容性", "Connectivity & Compatibility"],
  power: ["电源与续航", "Power & Battery"], battery: ["电池与充电", "Battery & Charging"],
  camera: ["相机", "Camera"], compute: ["计算与系统", "Compute & System"],
  ai_features: ["智能功能", "AI Features"], developer: ["开发支持", "Developer Support"],
  privacy: ["隐私", "Privacy"], market: ["销售信息", "Market"],
};
// Explicit presentation vocabulary, not inferred title casing. Database
// overrides take precedence; this dictionary is only the import-era fallback.
const labels: Record<string, readonly [string, string]> = {
  weight_g: ["重量", "Weight"], dimensions_mm: ["尺寸", "Dimensions"], material: ["材质", "Material"], prescription_support: ["近视配镜支持", "Prescription support"],
  display_present: ["配备显示屏", "Display present"], display_technology: ["显示技术", "Display technology"], resolution_per_eye: ["单眼分辨率", "Resolution per eye"], binocular_resolution: ["双眼分辨率", "Binocular resolution"],
  color: ["颜色显示", "Color display"], color_accuracy: ["色彩准确度", "Color accuracy"], color_gamut: ["色域", "Color gamut"], contrast_ratio: ["对比度", "Contrast ratio"],
  refresh_rate_hz: ["刷新率", "Refresh rate"], fov_deg: ["视场角", "Field of view"], eye_brightness: ["入眼亮度", "Eye brightness"], panel_or_projector_brightness: ["面板或投影亮度", "Panel or projector brightness"],
  ppd: ["每度像素数", "Pixels per degree"], ipd_mm: ["瞳距", "Interpupillary distance"], eye_box_mm: ["眼动范围", "Eye box"], myopia_adjustment_d: ["屈光度调节", "Diopter adjustment"],
  optical_system: ["光学系统", "Optical system"], ocular_mode: ["眼部显示模式", "Ocular mode"], optical_transmittance: ["光学透过率", "Optical transmittance"], electrochromic_dimming: ["电致变色调光", "Electrochromic dimming"],
  speakers: ["扬声器", "Speakers"], microphones: ["麦克风", "Microphones"], audio_notes: ["音频说明", "Audio notes"],
  native_3dof: ["原生三自由度追踪", "Native 3DoF"], native_6dof: ["原生六自由度追踪", "Native 6DoF"], accessory_3dof: ["配件三自由度追踪", "Accessory 3DoF"], accessory_6dof: ["配件六自由度追踪", "Accessory 6DoF"],
  sensors: ["传感器", "Sensors"], environment_sensors: ["环境传感器", "Environment sensors"], eye_tracking: ["眼动追踪", "Eye tracking"], hand_tracking: ["手部追踪", "Hand tracking"], slam: ["同步定位与建图", "SLAM"],
  android: ["Android 兼容性", "Android compatibility"], ios: ["iOS 兼容性", "iOS compatibility"], macos: ["macOS 兼容性", "macOS compatibility"], windows: ["Windows 兼容性", "Windows compatibility"],
  pc_compatibility: ["电脑兼容性", "PC compatibility"], nintendo_switch: ["Nintendo Switch 兼容性", "Nintendo Switch compatibility"], playstation: ["PlayStation 兼容性", "PlayStation compatibility"], xbox: ["Xbox 兼容性", "Xbox compatibility"],
  bluetooth: ["蓝牙", "Bluetooth"], wifi: ["无线网络", "Wi-Fi"], gps: ["卫星定位", "GPS"], hdmi: ["HDMI 连接", "HDMI"], usb: ["USB 连接", "USB"], usb_c_dp: ["USB-C 视频输入", "USB-C DisplayPort"],
  battery_capacity_mah: ["电池容量", "Battery capacity"], built_in_battery: ["内置电池", "Built-in battery"], charging: ["充电", "Charging"], typical_runtime: ["典型续航", "Typical runtime"],
  charging_case: ["充电盒", "Charging case"], charging_time: ["充电时间", "Charging time"], official_typical_runtime: ["官方典型续航", "Official typical runtime"], mode_specific_runtime: ["特定模式续航", "Mode-specific runtime"],
  camera_present: ["配备相机", "Camera present"], camera_sensor: ["相机传感器", "Camera sensor"], camera_mp: ["相机像素", "Camera resolution"], camera_fov_deg: ["相机视场角", "Camera field of view"],
  photo_resolution: ["照片分辨率", "Photo resolution"], video_resolution_fps: ["视频分辨率与帧率", "Video resolution & frame rate"], stabilization: ["防抖", "Stabilization"], secondary_spatial_camera: ["辅助空间相机", "Secondary spatial camera"],
  soc: ["芯片平台", "SoC"], cpu: ["处理器", "CPU"], ram: ["内存", "RAM"], storage: ["存储", "Storage"], os: ["操作系统", "Operating system"],
  sdk: ["开发套件", "SDK"], openxr: ["OpenXR 支持", "OpenXR"], unity: ["Unity 支持", "Unity"], ar_foundation: ["AR Foundation 支持", "AR Foundation"],
  camera_api: ["相机接口", "Camera API"], spatial_api: ["空间接口", "Spatial API"], sideload: ["应用侧载", "Sideloading"], firmware_openness: ["固件开放性", "Firmware openness"],
  ai_assistant: ["智能助手", "AI assistant"], navigation: ["导航", "Navigation"], notifications: ["通知", "Notifications"], teleprompter: ["提词器", "Teleprompter"],
  transcription: ["语音转写", "Transcription"], translation: ["翻译", "Translation"], vision_ai: ["视觉智能", "Vision AI"], other_features: ["其他功能", "Other features"],
  camera_indicator: ["相机指示灯", "Camera indicator"], camera_indicator_occlusion_detection: ["指示灯遮挡检测", "Indicator occlusion detection"], physical_camera_cover: ["实体相机盖", "Physical camera cover"], privacy_notes: ["隐私说明", "Privacy notes"],
  resolution: ["分辨率", "Resolution"], refresh_rate: ["刷新率", "Refresh rate"], brightness: ["亮度", "Brightness"], field_of_view: ["视场角", "Field of view"], chipset: ["芯片平台", "Chipset"], price: ["价格", "Price"], availability: ["销售状态", "Availability"],
};
const units: Record<string, string> = { "basic.weight_g": "g", "basic.dimensions_mm": "mm", "display.refresh_rate_hz": "Hz", "display.fov_deg": "°", "camera.camera_fov_deg": "°", "display.ipd_mm": "mm", "display.eye_box_mm": "mm", "battery.battery_capacity_mah": "mAh" };
const unitFamilies:readonly (readonly string[])[]=[["g","kg"],["mm","cm"],["Hz","kHz"],["°"],["mAh"],["h","min"],["W"],["Wh"],["MP"],["GB"],["%"],["nits"]];
const unitScales:Record<string,number>={g:1,kg:1000,mm:1,cm:10,Hz:1,kHz:1000,h:60,min:1};
export const catalogUnits=unitFamilies.flat();
export function catalogCanonicalUnit(key:string,unit?:string|null){return unit||units[key]||null;}
export function catalogUnitOptions(key:string,unit?:string|null){const base=catalogCanonicalUnit(key,unit);return unitFamilies.find(family=>family.includes(base??""))??(base?[base]:[]);}
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

export function catalogLabel(key: string, locale: CatalogLocale, presentation: CatalogPresentation = {}) {
  const fallback = labels[key.split(".").at(-1)!];
  const override = text(locale === "zh-CN" ? presentation.labelZh : presentation.labelEn);
  const other = text(locale === "zh-CN" ? presentation.labelEn : presentation.labelZh);
  return { label: override ?? fallback?.[locale === "zh-CN" ? 0 : 1] ?? other ?? (locale === "zh-CN" ? "参数" : "Specification"), missing: !override && !fallback };
}
export function catalogGroup(key: string, locale: CatalogLocale, presentation: CatalogPresentation = {}) {
  return text(locale === "zh-CN" ? presentation.groupZh : presentation.groupEn)
    ?? groups[key]?.[locale === "zh-CN" ? 0 : 1]
    ?? text(locale === "zh-CN" ? presentation.groupEn : presentation.groupZh)
    ?? (locale === "zh-CN" ? "其他参数" : "Other specifications");
}
export function catalogTranslationMissing(key:string,groupKey:string,value:unknown,locale:CatalogLocale,presentation:CatalogPresentation={}){
  const label=catalogLabel(key,locale,presentation);
  const groupMissing=!text(locale==="zh-CN"?presentation.groupZh:presentation.groupEn)&&!groups[groupKey];
  // Neutral facts and technical tokens need no duplicate translation record.
  const prose=typeof value==="string"&&(/\p{Script=Han}/u.test(value)||/[A-Za-z]{3}\s+[A-Za-z]{3}/.test(value));
  const valueMissing=prose&&!text(locale==="zh-CN"?presentation.valueZh:presentation.valueEn)
    &&(locale==="zh-CN"?/^[\x00-\x7f]+$/.test(value as string):/\p{Script=Han}/u.test(value as string));
  return label.missing||groupMissing||valueMissing;
}
export function catalogDisplayValue(key: string, value: unknown, state: string, locale: CatalogLocale, presentation: CatalogPresentation = {}, canonicalUnit?: string | null) {
  const zh = locale === "zh-CN";
  if (state === "NOT_DISCLOSED") return zh ? "官方未公布" : "Not disclosed";
  if (state === "NOT_APPLICABLE") return zh ? "不适用" : "Not applicable";
  if (value === null || value === undefined) return zh ? "未知" : "Unknown";
  if (typeof value === "boolean") return value ? (zh ? "是" : "Yes") : (zh ? "否" : "No");
  if (typeof value === "string" && ["Yes","No","Supported","Unsupported","Not supported"].includes(value)) {
    const options:Record<string,readonly[string,string]>={Yes:["是","Yes"],No:["否","No"],Supported:["支持","Supported"],Unsupported:["不支持","Not supported"],"Not supported":["不支持","Not supported"]};
    return options[value][zh?0:1];
  }
  const translated = text(zh ? presentation.valueZh : presentation.valueEn);
  const alternate = text(zh ? presentation.valueEn : presentation.valueZh);
  let result = typeof value === "string" ? translated ?? alternate ?? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  const baseUnit=catalogCanonicalUnit(key,canonicalUnit);
  let unit=baseUnit&&catalogUnitOptions(key,canonicalUnit).includes(presentation.displayUnit??"")?presentation.displayUnit:baseUnit;
  const scale=baseUnit&&unit?(unitScales[baseUnit]??1)/(unitScales[unit]??1):1;
  if (typeof value === "number") result = presentation.precision !== undefined ? (value*scale).toFixed(presentation.precision) : String(Number((value*scale).toPrecision(12)));
  if (Array.isArray(value) && presentation.format === "dimensions") result = value.map(String).join(" × ");
  if (Array.isArray(value) && presentation.format === "range") result = value.map(String).join(" – ");
  if(Array.isArray(value)&&value.every(item=>typeof item==="number")&&scale!==1){const separator=presentation.format==="range"?" – ":" × ";result=value.map(item=>String(Number((item*scale).toPrecision(12)))).join(separator);}
  if(typeof value==='string'&&scale!==1){
    const range=result.trim().match(/^(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)$/);
    const dimensions=/^-?\d+(?:\.\d+)?(?:\s*[×,]\s*-?\d+(?:\.\d+)?)*$/.test(result.trim());
    const components=range?range.slice(1):dimensions?result.trim().split(/\s*[×,]\s*/):null;
    if(components)result=components.map(item=>String(Number((Number(item)*scale).toPrecision(12)))).join(range?' – ':' × ');
    else unit=baseUnit;
  }
  if (!unit || typeof value === "boolean" || !/^-?\d+(?:\.\d+)?(?:[\s×–,-]+-?\d+(?:\.\d+)?)*$/.test(result.trim())) return result;
  return unit === "°" ? `${result}°` : `${result} ${unit}`;
}
