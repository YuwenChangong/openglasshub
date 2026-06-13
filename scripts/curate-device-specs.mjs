import fs from "node:fs/promises";
import path from "node:path";

const USER_AGENT = "OpenGlassHubDeviceSpecBot/0.1 (+https://openglasshub.pages.dev)";
const DEFAULT_INPUT = "docs/device-sources.json";
const DEFAULT_COMMIT_OUTPUT = "src/data/device-spec-candidates.json";
const DEFAULT_DELAY_MS = 1200;
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_RETRIES = 2;

const CORE_FIELDS = [
  "brand",
  "model_name",
  "product_url",
  "source_url",
  "source_name",
  "last_checked_at",
];

const SPEC_FIELDS = [
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
  "chipset",
  "memory",
  "storage",
  "sensors",
  "camera",
  "microphone",
  "speakers",
  "connectivity",
  "ports",
  "battery_life",
  "battery_capacity",
  "charging",
  "power_source",
  "weight",
  "dimensions",
  "frame_style",
  "ip_rating",
  "supported_devices",
  "os_compatibility",
  "sdk_availability",
  "price",
  "region",
  "availability",
  "release_year",
];

const LABEL_TO_FIELD = [
  [/display type|screen type|panel/i, "display_type"],
  [/resolution|pixels?/i, "resolution"],
  [/refresh rate|hz\b/i, "refresh_rate"],
  [/brightness|nits?/i, "brightness"],
  [/field of view|\bfov\b/i, "field_of_view"],
  [/\bppd\b|pixels per degree/i, "ppd"],
  [/color gamut|srgb|dci-p3|ntsc/i, "color_gamut"],
  [/waveguide/i, "waveguide_type"],
  [/lens type|optical lens/i, "lens_type"],
  [/diopter|prescription/i, "diopter_support"],
  [/myopia/i, "myopia_adjustment"],
  [/transparency/i, "transparency"],
  [/dimming|electrochromic/i, "dimming"],
  [/soc|processor|chipset|platform/i, "chipset"],
  [/\bram\b|memory/i, "memory"],
  [/\brom\b|storage/i, "storage"],
  [/sensor/i, "sensors"],
  [/camera/i, "camera"],
  [/microphone|mic\b/i, "microphone"],
  [/speaker|audio/i, "speakers"],
  [/connectivity|wifi|bluetooth|wireless/i, "connectivity"],
  [/port|usb-c|hdmi/i, "ports"],
  [/battery life|usage time|standby/i, "battery_life"],
  [/battery\b|mah/i, "battery_capacity"],
  [/charging|charge/i, "charging"],
  [/power source|powered by/i, "power_source"],
  [/weight/i, "weight"],
  [/dimensions?|size|hinge to hinge|temple length|lens width|bridge width/i, "dimensions"],
  [/frame style|frame/i, "frame_style"],
  [/ip rating|water resistance|dust resistance/i, "ip_rating"],
  [/compatible devices|compatibility|supported devices/i, "supported_devices"],
  [/android|ios|windows|mac|app compatibility|os compatibility/i, "os_compatibility"],
  [/sdk|developer/i, "sdk_availability"],
  [/price|regular price|sale price|msrp/i, "price"],
  [/region|market/i, "region"],
  [/availability|in stock|sold out|pre-order|buy now/i, "availability"],
  [/release year|launch year|released/i, "release_year"],
];

function parseArgs(argv) {
  const options = {
    dryRun: true,
    commit: false,
    input: DEFAULT_INPUT,
    output: null,
    draftDir: null,
    source: null,
    limit: null,
    verbose: false,
    useSourceImage: false,
    delayMs: DEFAULT_DELAY_MS,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--dry-run":
        options.dryRun = true;
        options.commit = false;
        break;
      case "--commit":
        options.commit = true;
        options.dryRun = false;
        break;
      case "--input":
        options.input = argv[++index] ?? options.input;
        break;
      case "--output":
        options.output = argv[++index] ?? null;
        break;
      case "--draft-dir":
        options.draftDir = argv[++index] ?? null;
        break;
      case "--source":
        options.source = argv[++index] ?? null;
        break;
      case "--limit":
        options.limit = Number.parseInt(argv[++index] ?? "", 10);
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--use-source-image":
        options.useSourceImage = true;
        break;
      case "--delay-ms":
        options.delayMs = Number.parseInt(argv[++index] ?? "", 10) || DEFAULT_DELAY_MS;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.commit && !options.output) {
    options.output = DEFAULT_COMMIT_OUTPUT;
  }

  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
    options.delayMs = DEFAULT_DELAY_MS;
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/curate-device-specs.mjs --dry-run
  node scripts/curate-device-specs.mjs --dry-run --source xreal --limit 5
  node scripts/curate-device-specs.mjs --dry-run --input docs/device-sources.json --output device-candidates.json
  node scripts/curate-device-specs.mjs --commit --input docs/device-sources.json

Options:
  --dry-run          Default mode. Scan sources and print candidates only.
  --commit           Write structured candidate JSON. Does not publish anything.
  --input <path>     Source config JSON path. Default: ${DEFAULT_INPUT}
  --output <path>    Output JSON path. Default for --commit: ${DEFAULT_COMMIT_OUTPUT}
  --draft-dir <dir>  Write MDX draft files for manual review.
  --source <value>   Filter by brand / name / slug substring.
  --limit <n>        Limit number of source URLs to scan.
  --verbose          Print per-source diagnostics.
  --use-source-image Include a reference flag for the official image candidate only.
  --delay-ms <n>     Delay between requests. Default: ${DEFAULT_DELAY_MS}
`);
}

function logVerbose(options, ...parts) {
  if (options.verbose) {
    console.log("[device-specs]", ...parts);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&ldquo;/gi, "“")
    .replace(/&rdquo;/gi, "”")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&rsquo;/gi, "’")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&hellip;/gi, "…")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(value) {
  return normalizeWhitespace(
    decodeHtmlEntities(
      String(value ?? "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|tr|section|h\d)>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function cleanupHtmlForExtraction(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function slugify(input) {
  return normalizeWhitespace(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "device";
}

function toAbsoluteUrl(input, baseUrl) {
  const value = normalizeWhitespace(input);
  if (!value) return null;
  try {
    if (value.startsWith("//")) return `https:${value}`;
    const url = new URL(value, baseUrl);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.toString();
  } catch {
    return value;
  }
}

async function loadSourceConfig(filePath) {
  const fullPath = path.resolve(filePath);
  const raw = await fs.readFile(fullPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("device source config must be an array");
  }
  return parsed.map((item, index) => {
    if (!item?.url || !item?.brand || !item?.name) {
      throw new Error(`invalid source entry at index ${index}`);
    }
    return {
      brand: String(item.brand),
      name: String(item.name),
      slug: String(item.slug ?? slugify(`${item.brand}-${item.name}`)),
      source: String(item.source ?? "official"),
      url: String(item.url),
    };
  });
}

function filterSources(sources, options) {
  let items = sources;
  if (options.source) {
    const needle = options.source.toLowerCase();
    items = items.filter((item) => {
      const haystack = `${item.brand} ${item.name} ${item.slug}`.toLowerCase();
      return haystack.includes(needle);
    });
  }
  if (Number.isFinite(options.limit) && options.limit > 0) {
    items = items.slice(0, options.limit);
  }
  return items;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, options) {
  let lastError = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          },
          redirect: "follow",
        },
        DEFAULT_TIMEOUT_MS,
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES - 1) {
        await sleep(options.delayMs);
      }
    }
  }
  throw lastError ?? new Error("fetch failed");
}

const robotsCache = new Map();

function pathAllowedByRules(pathname, rules) {
  let matched = null;
  for (const rule of rules) {
    if (!pathname.startsWith(rule.path)) continue;
    if (!matched || rule.path.length > matched.path.length) {
      matched = rule;
    }
  }
  if (!matched) return true;
  return matched.type !== "disallow";
}

function parseRobots(robotsText) {
  const lines = String(robotsText ?? "").split(/\r?\n/g);
  const groups = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (!current) continue;
    if ((key === "allow" || key === "disallow") && value) {
      current.rules.push({ type: key, path: value });
    }
  }

  return groups;
}

async function loadRobotsForUrl(targetUrl, options) {
  const url = new URL(targetUrl);
  const origin = `${url.protocol}//${url.host}`;
  if (robotsCache.has(origin)) return robotsCache.get(origin);

  const robotsUrl = `${origin}/robots.txt`;
  let robotsText = "";
  try {
    const response = await fetchWithTimeout(
      robotsUrl,
      {
        headers: { "user-agent": USER_AGENT, accept: "text/plain,*/*;q=0.8" },
        redirect: "follow",
      },
      DEFAULT_TIMEOUT_MS,
    );
    if (response.ok) {
      robotsText = await response.text();
    }
  } catch (error) {
    logVerbose(options, "robots fetch failed, defaulting to allow", robotsUrl, error instanceof Error ? error.message : String(error));
  }

  const parsed = parseRobots(robotsText);
  robotsCache.set(origin, parsed);
  return parsed;
}

async function isRobotsAllowed(targetUrl, options) {
  const robots = await loadRobotsForUrl(targetUrl, options);
  if (!robots.length) return true;
  const pathname = new URL(targetUrl).pathname;
  const preferredAgents = [USER_AGENT.toLowerCase(), "openglasshubdevicespecbot/0.1", "*"];

  for (const agent of preferredAgents) {
    const groups = robots.filter((group) => group.agents.includes(agent));
    if (!groups.length) continue;
    const rules = groups.flatMap((group) => group.rules);
    return pathAllowedByRules(pathname, rules);
  }

  return true;
}

function extractMeta(html, name, attr = "name") {
  const pattern = new RegExp(
    `<meta[^>]+${attr}=["']${name}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${name}["']`,
    "i",
  );
  const match = html.match(pattern);
  return normalizeWhitespace(decodeHtmlEntities(match?.[1] ?? match?.[2] ?? ""));
}

function extractTitle(html) {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  return normalizeWhitespace(decodeHtmlEntities(match?.[1] ?? ""));
}

function extractJsonLdBlocks(html) {
  const blocks = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const text = match[1]?.trim();
    if (!text) continue;
    try {
      blocks.push(JSON.parse(text));
    } catch {
      try {
        const cleaned = text.replace(/^[\uFEFF\s]+/, "").replace(/[\u0000-\u001F]+/g, " ");
        blocks.push(JSON.parse(cleaned));
      } catch {
        continue;
      }
    }
  }
  return blocks.flatMap((block) => flattenJsonLd(block));
}

function flattenJsonLd(input) {
  if (Array.isArray(input)) {
    return input.flatMap((item) => flattenJsonLd(item));
  }
  if (!input || typeof input !== "object") {
    return [];
  }
  const current = [input];
  if (Array.isArray(input["@graph"])) {
    return current.concat(input["@graph"].flatMap((item) => flattenJsonLd(item)));
  }
  return current;
}

function extractTables(html) {
  const tables = [];
  for (const tableMatch of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [];
    for (const rowMatch of tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [];
      for (const cellMatch of rowMatch[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
        cells.push(stripTags(cellMatch[2]));
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

function extractKeyValueLines(html) {
  const candidates = [];
  const text = decodeHtmlEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|div|section|h\d|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
  for (const rawLine of text.split(/\r?\n/g)) {
    const line = normalizeWhitespace(rawLine);
    if (!line || line.length < 4 || line.length > 240) continue;
    if (/[:：]/.test(line)) {
      const [label, ...rest] = line.split(/[:：]/);
      const value = normalizeWhitespace(rest.join(":"));
      if (normalizeWhitespace(label) && value) {
        candidates.push([normalizeWhitespace(label), value]);
      }
    }
  }
  return candidates;
}

function pickField(label) {
  for (const [pattern, field] of LABEL_TO_FIELD) {
    if (pattern.test(label)) return field;
  }
  return null;
}

function isSuspiciousSpecValue(value) {
  const normalized = String(value ?? "");
  return (
    !normalized ||
    normalized.length > 220 ||
    /https?:\/\//i.test(normalized) ||
    /\bfunction\b|\breturn\b|\bvar\b|\bconst\b|\blet\b/i.test(normalized) ||
    /[{[\]}]/.test(normalized) ||
    /!important|calc\(|var\(--|nth-child|cdn\.shopify|google_osp|analyticsAllowed|marketingAllowed/i.test(normalized)
  );
}

function mergeFact(map, field, value) {
  const normalized = normalizeWhitespace(value);
  if (!normalized || isSuspiciousSpecValue(normalized)) return;
  if (!map[field]) {
    map[field] = normalized;
    return;
  }
  if (map[field].includes(normalized)) return;
  map[field] = `${map[field]} | ${normalized}`;
}

function extractFactsFromTables(tables) {
  const facts = {};
  for (const table of tables) {
    for (const row of table) {
      if (row.length < 2) continue;
      const label = row[0];
      const value = row.slice(1).join(" | ");
      const field = pickField(label);
      if (field) {
        mergeFact(facts, field, value);
      }
    }
  }
  return facts;
}

function extractFactsFromLines(lines) {
  const facts = {};
  for (const [label, value] of lines) {
    const field = pickField(label);
    if (field) {
      mergeFact(facts, field, value);
    }
  }
  return facts;
}

function extractFactsFromText(text) {
  const facts = {};
  const rules = [
    ["weight", /\bweight\b[^.\n:：]*[:：]?\s*(?:only\s*)?(\d+(?:\.\d+)?\s?(?:g|kg))/i],
    ["battery_capacity", /\b(\d+(?:\.\d+)?)\s?mAh\b/i],
    ["battery_life", /\b(\d+(?:\.\d+)?)\s?(?:hours?|hrs?)\b/i],
    ["refresh_rate", /\b(\d{2,3})\s?Hz\b/i],
    ["brightness", /\b(\d{2,5})\s?nits?\b/i],
    ["field_of_view", /\b(\d+(?:\.\d+)?)\s?°\s?(?:fov|field of view)?/i],
    ["memory", /\b(\d+(?:\.\d+)?)\s?GB\s?RAM\b/i],
    ["storage", /\b(\d+(?:\.\d+)?)\s?GB\s?(?:ROM|storage)\b/i],
    ["camera", /\b(\d+(?:\.\d+)?)\s?MP\b/i],
    ["connectivity", /\b(Wi-?Fi\s?\d(?:\.\d)?(?:\s?[a-z])?|Bluetooth\s?\d(?:\.\d)?)/ig],
    ["chipset", /\b(Snapdragon[^.,;\n]+|Qualcomm[^.,;\n]+|XR2[^.,;\n]+|AR1[^.,;\n]+)/i],
  ];

  for (const [field, pattern] of rules) {
    if (pattern.global) {
      const matches = [...text.matchAll(pattern)].map((match) => normalizeWhitespace(match[1] ?? match[0]));
      if (matches.length) {
        facts[field] = [...new Set(matches)].join(" | ");
      }
      continue;
    }
    const match = text.match(pattern);
    if (match) {
      facts[field] = normalizeWhitespace(match[1] ?? match[0]);
    }
  }

  return facts;
}

function normalizeModelName(raw, fallback) {
  const value = normalizeWhitespace(raw || fallback);
  return value
    .replace(/\s*\|\s*RayNeo.*$/i, "")
    .replace(/\s*-\s*RayNeo.*$/i, "")
    .replace(/\s*-\s*XREAL.*$/i, "")
    .replace(/\s*-\s*Rokid.*$/i, "")
    .trim();
}

function pickModelName(source, ...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeModelName(candidate, source.name);
    if (!normalized) continue;
    if (/building augmented reality for everyone|shop$/i.test(normalized)) continue;
    if (normalized.length < 3) continue;
    return normalized;
  }
  return source.name;
}

function buildShortDescription(item) {
  const { brand, model_name: modelName, specs } = item;
  const fullName = modelName.toLowerCase().startsWith(String(brand).toLowerCase())
    ? modelName
    : `${brand} ${modelName}`;
  const parts = [];
  const lower = `${specs.display_type ?? ""} ${specs.field_of_view ?? ""} ${specs.camera ?? ""} ${specs.chipset ?? ""}`.toLowerCase();

  if (lower.includes("waveguide") || lower.includes("microled")) {
    parts.push("这是一款更偏真正 AR 叠加与日常佩戴平衡的设备");
  } else if (lower.includes("micro-oled") || lower.includes("oled")) {
    parts.push("这款设备更偏随身显示与轻量空间屏幕");
  } else if (specs.camera !== "unknown" || lower.includes("camera")) {
    parts.push("这款设备更偏拍摄、语音与轻量 AI 助手入口");
  } else {
    parts.push("这是一款面向 AR / AI 眼镜方向的公开官方设备");
  }

  if (specs.weight !== "unknown") {
    parts.push(`官方页面公开了重量信息（${specs.weight}）`);
  }
  if (specs.supported_devices !== "unknown") {
    parts.push("适合进一步核对兼容设备与使用边界");
  } else if (specs.os_compatibility !== "unknown") {
    parts.push("适合进一步核对平台兼容性与连接方式");
  }

  const sentence = `${fullName} ${parts.join("，")}。`;
  return sentence.replace(/\s+/g, " ").trim();
}

function buildMissingFields(specs) {
  return SPEC_FIELDS.filter((field) => !specs[field] || specs[field] === "unknown");
}

function scoreConfidence(specs, jsonLdProduct, tables) {
  const populated = SPEC_FIELDS.filter((field) => specs[field] && specs[field] !== "unknown").length;
  const rawScore =
    Math.min(populated / SPEC_FIELDS.length, 1) * 0.6 +
    (jsonLdProduct ? 0.2 : 0) +
    (tables.length ? 0.2 : 0);
  return Number(rawScore.toFixed(2));
}

function buildEmptySpecs() {
  return Object.fromEntries(SPEC_FIELDS.map((field) => [field, "unknown"]));
}

function productFromJsonLd(jsonLdBlocks) {
  return jsonLdBlocks.find((item) => {
    const type = item?.["@type"];
    if (Array.isArray(type)) return type.some((value) => String(value).toLowerCase() === "product");
    return String(type ?? "").toLowerCase() === "product";
  }) ?? null;
}

function parseSpecsFromJsonLd(product) {
  const facts = {};
  if (!product || typeof product !== "object") return facts;

  const additionalProperty = Array.isArray(product.additionalProperty)
    ? product.additionalProperty
    : Array.isArray(product.additionalProperty?.propertyID)
      ? product.additionalProperty
      : [];

  for (const item of additionalProperty) {
    const label = normalizeWhitespace(item?.name ?? item?.propertyID ?? "");
    const value = normalizeWhitespace(item?.value ?? item?.valueReference?.name ?? "");
    const field = pickField(label);
    if (field && value) {
      mergeFact(facts, field, value);
    }
  }

  if (product.weight) mergeFact(facts, "weight", String(product.weight));
  if (product.brand?.name) mergeFact(facts, "brand", String(product.brand.name));
  if (product.image) mergeFact(facts, "official_image_url", Array.isArray(product.image) ? product.image[0] : product.image);
  if (product.offers?.price) mergeFact(facts, "price", `${product.offers.priceCurrency ?? ""} ${product.offers.price}`.trim());
  if (product.offers?.availability) mergeFact(facts, "availability", String(product.offers.availability).split("/").pop());
  return facts;
}

function deriveSdkAvailability(html, source) {
  const text = `${html} ${source.brand} ${source.name}`.toLowerCase();
  if (text.includes("developer") || text.includes("sdk")) {
    return "mentioned";
  }
  return "unknown";
}

function collectRawSourceNotes(specs) {
  const notes = [];
  for (const field of ["price", "availability", "os_compatibility", "supported_devices", "sdk_availability"]) {
    if (specs[field] && specs[field] !== "unknown") {
      notes.push(`${field}: ${specs[field]}`);
    }
  }
  return notes.slice(0, 6);
}

async function parseSource(source, options) {
  const allowed = await isRobotsAllowed(source.url, options);
  if (!allowed) {
    return { skipped: { source_url: source.url, reason: "robots_disallow" } };
  }

  const html = await fetchText(source.url, options);
  const title = extractTitle(html);
  const metaDescription = extractMeta(html, "description") || extractMeta(html, "Description");
  const ogImage = extractMeta(html, "og:image", "property");
  const ogTitle = extractMeta(html, "og:title", "property");
  const metaPriceAmount = extractMeta(html, "product:price:amount", "property");
  const metaPriceCurrency = extractMeta(html, "product:price:currency", "property");
  const jsonLdBlocks = extractJsonLdBlocks(html);
  const jsonLdProduct = productFromJsonLd(jsonLdBlocks);
  const cleanHtml = cleanupHtmlForExtraction(html);
  const jsonLdFacts = parseSpecsFromJsonLd(jsonLdProduct);
  const tables = extractTables(cleanHtml);
  const tableFacts = extractFactsFromTables(tables);
  const lineFacts = extractFactsFromLines(extractKeyValueLines(cleanHtml));
  const textFacts = extractFactsFromText(stripTags(cleanHtml));

  const specs = buildEmptySpecs();
  const mergedFacts = [jsonLdFacts, tableFacts, lineFacts, textFacts];
  for (const factBlock of mergedFacts) {
    for (const [field, value] of Object.entries(factBlock)) {
      if (field === "brand") continue;
      if (field === "official_image_url") continue;
      if (!SPEC_FIELDS.includes(field)) continue;
      if (value) specs[field] = normalizeWhitespace(value);
    }
  }

  specs.sdk_availability = specs.sdk_availability !== "unknown" ? specs.sdk_availability : deriveSdkAvailability(html, source);
  if (specs.price === "unknown" && metaPriceAmount) {
    specs.price = normalizeWhitespace(`${metaPriceCurrency} ${metaPriceAmount}`.trim());
  }

  const officialImageUrl = normalizeWhitespace(
    jsonLdFacts.official_image_url ||
      (Array.isArray(jsonLdProduct?.image) ? jsonLdProduct.image[0] : jsonLdProduct?.image) ||
      ogImage,
  );

  const candidate = {
    brand: source.brand,
    model_name: pickModelName(source, jsonLdProduct?.name, ogTitle, title, source.name),
    product_url: source.url,
    source_url: source.url,
    source_name: `${source.brand} official`,
    last_checked_at: new Date().toISOString(),
    specs,
    short_description: "",
    official_image_url: toAbsoluteUrl(officialImageUrl, source.url),
    use_source_image: options.useSourceImage === true,
    confidence: 0,
    missing_fields: [],
    extracted_fields_count: 0,
    raw_source_notes: [],
  };

  candidate.short_description = buildShortDescription(candidate);
  candidate.missing_fields = buildMissingFields(specs);
  candidate.extracted_fields_count = SPEC_FIELDS.length - candidate.missing_fields.length;
  candidate.confidence = scoreConfidence(specs, jsonLdProduct, tables);
  candidate.raw_source_notes = collectRawSourceNotes(specs);

  return { item: candidate };
}

function buildOutput(items, skipped, errors) {
  return {
    generated_at: new Date().toISOString(),
    items,
    skipped,
    errors,
  };
}

function yamlEscape(value) {
  return String(value ?? "").replace(/"/g, '\\"');
}

function formatSpecValue(value) {
  return value && value !== "unknown" ? value : "待核实";
}

function buildDeviceDraftMdx(item) {
  const specLines = [
    ["显示类型", item.specs.display_type],
    ["分辨率", item.specs.resolution],
    ["刷新率", item.specs.refresh_rate],
    ["亮度", item.specs.brightness],
    ["视场角", item.specs.field_of_view],
    ["芯片 / 平台", item.specs.chipset],
    ["内存", item.specs.memory],
    ["存储", item.specs.storage],
    ["相机", item.specs.camera],
    ["连接", item.specs.connectivity],
    ["电池续航", item.specs.battery_life],
    ["重量", item.specs.weight],
    ["价格", item.specs.price],
    ["上市 / 可得性", item.specs.availability],
  ]
    .filter(([, value]) => value && value !== "unknown")
    .map(([label, value]) => `- ${label}: ${value}`);

  const missing = item.missing_fields.length ? item.missing_fields.join(", ") : "无";
  const imageNote = item.official_image_url
    ? `- 官方候选图片链接（未下载、未搬运）: ${item.official_image_url}`
    : "- 官方候选图片链接: 待核实";

  return `---
title: ${yamlEscape(item.model_name)}
description: ${yamlEscape(item.short_description)}
sidebar:
  label: ${yamlEscape(item.model_name)}
slug: reference/devices/${item.slug}
---

## 快速结论

${item.short_description}

## 设备定位

这是一份基于官方公开页面自动整理的设备草稿。重点是帮助 OpenGlass Hub 先建立事实参数框架，再由编辑补充最终判断与对比结论。

## 已抓取参数

${specLines.length ? specLines.join("\n") : "- 目前只抓到有限公开参数，仍需人工补充。"}

## 仍待核实

- confidence: ${item.confidence}
- missing_fields: ${missing}

## 官方链接

- 官方产品页: ${item.source_url}
${imageNote}

## 核实状态

本页为自动生成草稿，不直接复制官方营销文案，也不搬运官方图片。正式发布前请人工核对参数、可用地区、价格、兼容性与设备定位。
`;
}

async function writeDraftFiles(dirPath, items) {
  const fullDir = path.resolve(dirPath);
  await fs.mkdir(fullDir, { recursive: true });
  const written = [];
  for (const item of items) {
    const filePath = path.join(fullDir, `${item.slug}.mdx`);
    await fs.writeFile(filePath, `${buildDeviceDraftMdx(item)}\n`, "utf8");
    written.push(filePath);
  }
  return written;
}

async function writeOutputFile(filePath, payload) {
  const fullPath = path.resolve(filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return fullPath;
}

function printSummary({ scannedCount, skippedCount, parsedCount, failedCount, items }) {
  console.log("");
  console.log("Device spec crawler summary");
  console.log(`- scanned count: ${scannedCount}`);
  console.log(`- skipped robots count: ${skippedCount}`);
  console.log(`- parsed count: ${parsedCount}`);
  console.log(`- failed count: ${failedCount}`);
  if (!items.length) return;
  console.log("");
  for (const item of items) {
    console.log(`- ${item.brand} / ${item.model_name}`);
    console.log(`  source_url: ${item.source_url}`);
    console.log(`  confidence: ${item.confidence}`);
    console.log(`  extracted_fields_count: ${item.extracted_fields_count}`);
    console.log(`  missing_fields: ${item.missing_fields.join(", ") || "(none)"}`);
    console.log(`  official_image_url: ${item.official_image_url ?? "(none)"}`);
    console.log(`  short_description: ${item.short_description}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const sources = await loadSourceConfig(options.input);
  const filtered = filterSources(sources, options);

  if (!filtered.length) {
    console.log("device source config empty or no source matched the filter");
    return;
  }

  const items = [];
  const skipped = [];
  const errors = [];

  for (let index = 0; index < filtered.length; index += 1) {
    const source = filtered[index];
    logVerbose(options, `scanning ${source.brand} ${source.name}`, source.url);
    try {
      const result = await parseSource(source, options);
      if (result.skipped) {
        skipped.push(result.skipped);
      } else if (result.item) {
        result.item.slug = source.slug;
        items.push(result.item);
      }
    } catch (error) {
      errors.push({
        source_url: source.url,
        brand: source.brand,
        model_name: source.name,
        message: error instanceof Error ? error.message : String(error),
      });
      logVerbose(options, "parse failed", source.url, error instanceof Error ? error.message : String(error));
    }

    if (index < filtered.length - 1) {
      await sleep(options.delayMs);
    }
  }

  const payload = buildOutput(items, skipped, errors);
  printSummary({
    scannedCount: filtered.length,
    skippedCount: skipped.length,
    parsedCount: items.length,
    failedCount: errors.length,
    items,
  });

  if (options.output) {
    const written = await writeOutputFile(options.output, payload);
    console.log("");
    console.log(`Output JSON: ${written}`);
  } else if (options.commit) {
    const written = await writeOutputFile(DEFAULT_COMMIT_OUTPUT, payload);
    console.log("");
    console.log(`Output JSON: ${written}`);
  }

  if (options.draftDir) {
    const writtenDrafts = await writeDraftFiles(options.draftDir, items);
    console.log("");
    console.log(`Draft MDX files: ${writtenDrafts.length}`);
    for (const file of writtenDrafts) {
      console.log(`- ${file}`);
    }
  }
}

main().catch((error) => {
  console.error("[device-specs] failed", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
