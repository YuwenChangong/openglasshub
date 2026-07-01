export type LocalLexiconCategory =
  | "off_platform_contact"
  | "spam_or_promotion"
  | "scam_or_resource_lure"
  | "suspicious_external_link"
  | "fake_download_or_private_access"
  | "sexual_content"
  | "violence_or_threat"
  | "hate_or_harassment"
  | "illegal_goods_or_services"
  | "personal_data_or_doxxing"
  | "political_sensitive"
  | "vulgar_abuse"
  | "low_quality_spam"
  | "platform_policy_custom";

export type LocalLexiconSeverity = "allow" | "soft_review" | "review" | "reject";
export type LocalLexiconMatchMode = "exact" | "contains" | "phrase" | "regex";

export type SensitiveLexiconTerm = {
  term: string | null;
  normalized: string | null;
  condensed: string | null;
  category: LocalLexiconCategory;
  severity: LocalLexiconSeverity;
  source: string;
  match: LocalLexiconMatchMode;
  pattern?: string | null;
};

export type SensitiveLexiconData = {
  version: string;
  generatedAt?: string | null;
  sources?: Array<{
    id: string;
    repoUrl?: string;
    commit?: string;
    license?: string;
  }>;
  terms: SensitiveLexiconTerm[];
};

type R2ObjectBodyLike = {
  text(): Promise<string>;
};

type R2BucketLike = {
  get(key: string): Promise<R2ObjectBodyLike | null>;
};

export type SensitiveLexiconRuntimeEnv = Record<string, unknown> & {
  MODERATION_ASSETS?: R2BucketLike;
  SENSITIVE_LEXICON_DISABLE_NODE_LOCAL?: boolean | string;
};

export type SensitiveLexiconSource = "r2" | "local_file" | "emergency";

export type SensitiveLexiconHealth = {
  bindingPresent: boolean;
  source: SensitiveLexiconSource | null;
  objectKeyUsed: string;
  entryCount: number;
  categoryCount: number;
  lexiconHashPrefix: string | null;
  parseOk: boolean;
  lastErrorCode: string | null;
  fallbackUsed: boolean;
};

const LEXICON_OBJECT_KEY = "moderation/local-sensitive-lexicon.zh.json";

const emergencyLexicon: SensitiveLexiconData = {
  version: "emergency-lexicon-2026-06-27",
  generatedAt: null,
  sources: [
    {
      id: "openglass_emergency_lexicon",
      license: "internal",
    },
  ],
  terms: [
    {
      term: "人口贩卖",
      normalized: "人口贩卖",
      condensed: "人口贩卖",
      category: "illegal_goods_or_services",
      severity: "reject",
      source: "openglass_emergency",
      match: "contains",
    },
    {
      term: "嫖娼",
      normalized: "嫖娼",
      condensed: "嫖娼",
      category: "sexual_content",
      severity: "review",
      source: "openglass_emergency",
      match: "contains",
    },
    {
      term: "卖淫",
      normalized: "卖淫",
      condensed: "卖淫",
      category: "sexual_content",
      severity: "review",
      source: "openglass_emergency",
      match: "contains",
    },
    {
      term: "telegram",
      normalized: "telegram",
      condensed: "telegram",
      category: "off_platform_contact",
      severity: "review",
      source: "openglass_emergency",
      match: "contains",
    },
    {
      term: "whatsapp",
      normalized: "whatsapp",
      condensed: "whatsapp",
      category: "off_platform_contact",
      severity: "review",
      source: "openglass_emergency",
      match: "contains",
    },
    {
      term: "二维码",
      normalized: "二维码",
      condensed: "二维码",
      category: "off_platform_contact",
      severity: "review",
      source: "openglass_emergency",
      match: "contains",
    },
    {
      term: "完整资料入口",
      normalized: "完整资料入口",
      condensed: "完整资料入口",
      category: "scam_or_resource_lure",
      severity: "review",
      source: "openglass_emergency",
      match: "contains",
    },
    {
      term: "资料入口",
      normalized: "资料入口",
      condensed: "资料入口",
      category: "scam_or_resource_lure",
      severity: "review",
      source: "openglass_emergency",
      match: "contains",
    },
    {
      term: "下载入口",
      normalized: "下载入口",
      condensed: "下载入口",
      category: "fake_download_or_private_access",
      severity: "review",
      source: "openglass_emergency",
      match: "contains",
    },
    {
      term: "加微信",
      normalized: "加微信",
      condensed: "加微信",
      category: "off_platform_contact",
      severity: "review",
      source: "openglass_emergency",
      match: "contains",
    },
    {
      term: "私聊",
      normalized: "私聊",
      condensed: "私聊",
      category: "off_platform_contact",
      severity: "review",
      source: "openglass_emergency",
      match: "contains",
    },
  ],
};

let cachedLexicon: SensitiveLexiconData | null = null;
let cachedLexiconSource: SensitiveLexiconSource | null = null;
let pendingLexiconLoad: Promise<SensitiveLexiconData> | null = null;
let lastErrorCode: string | null = null;

function shouldDisableNodeLocal(env?: SensitiveLexiconRuntimeEnv) {
  const value = env?.SENSITIVE_LEXICON_DISABLE_NODE_LOCAL;
  return value === true || String(value ?? "").trim().toLowerCase() === "true";
}

function classifyLexiconErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/No such object|object missing/i.test(message)) return "object_missing";
  if (/Unexpected token|JSON/i.test(message)) return "invalid_json";
  if (/network|fetch|timeout/i.test(message)) return "r2_fetch_failed";
  return "runtime_error";
}

function isSensitiveLexiconData(value: unknown): value is SensitiveLexiconData {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as SensitiveLexiconData).version === "string" &&
      Array.isArray((value as SensitiveLexiconData).terms),
  );
}

function logLexiconLoadWarning(message: string, details?: string | null) {
  if (details) {
    console.warn("[moderation] sensitive lexicon loader warning", { message, details });
    return;
  }
  console.warn("[moderation] sensitive lexicon loader warning", { message });
}

async function loadFromR2(env?: SensitiveLexiconRuntimeEnv): Promise<SensitiveLexiconData | null> {
  const bucket = env?.MODERATION_ASSETS;
  if (!bucket || typeof bucket.get !== "function") {
    lastErrorCode = "binding_missing";
    return null;
  }

  try {
    const object = await bucket.get(LEXICON_OBJECT_KEY);
    if (!object) {
      lastErrorCode = "object_missing";
      logLexiconLoadWarning("R2 lexicon object missing", LEXICON_OBJECT_KEY);
      return null;
    }

    const parsed = JSON.parse(await object.text()) as unknown;
    if (!isSensitiveLexiconData(parsed)) {
      lastErrorCode = "invalid_payload";
      logLexiconLoadWarning("R2 lexicon payload invalid", LEXICON_OBJECT_KEY);
      return null;
    }

    cachedLexiconSource = "r2";
    lastErrorCode = null;
    return parsed;
  } catch (error) {
    lastErrorCode = classifyLexiconErrorCode(error);
    logLexiconLoadWarning(
      "Failed to load sensitive lexicon from R2",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

async function loadFromLocalFile(env?: SensitiveLexiconRuntimeEnv): Promise<SensitiveLexiconData | null> {
  if (shouldDisableNodeLocal(env)) return null;
  if (typeof process === "undefined" || !process.versions?.node) return null;

  try {
    const fs = await import("node:fs/promises");
    const fileUrl = new URL("../../data/moderation/sensitive-lexicon.generated.json", import.meta.url);
    const parsed = JSON.parse(await fs.readFile(fileUrl, "utf8")) as unknown;
    if (!isSensitiveLexiconData(parsed)) {
      lastErrorCode = "local_invalid_payload";
      logLexiconLoadWarning("Local lexicon payload invalid", String(fileUrl));
      return null;
    }

    cachedLexiconSource = "local_file";
    lastErrorCode = null;
    return parsed;
  } catch (error) {
    lastErrorCode = "local_file_failed";
    logLexiconLoadWarning(
      "Failed to load sensitive lexicon from local file",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

export async function loadSensitiveLexicon(env?: SensitiveLexiconRuntimeEnv): Promise<SensitiveLexiconData> {
  if (cachedLexicon && cachedLexiconSource && cachedLexiconSource !== "emergency") return cachedLexicon;
  if (pendingLexiconLoad) return pendingLexiconLoad;

  pendingLexiconLoad = (async () => {
    const lexicon = (await loadFromR2(env)) ?? (await loadFromLocalFile(env)) ?? emergencyLexicon;
    if (lexicon === emergencyLexicon) {
      cachedLexiconSource = "emergency";
      lastErrorCode = lastErrorCode ?? "emergency_fallback";
      logLexiconLoadWarning("Using emergency fallback lexicon", LEXICON_OBJECT_KEY);
      return lexicon;
    }
    cachedLexicon = lexicon;
    return lexicon;
  })();

  try {
    return await pendingLexiconLoad;
  } finally {
    pendingLexiconLoad = null;
  }
}

export function getSensitiveLexiconObjectKey(): string {
  return LEXICON_OBJECT_KEY;
}

export function getSensitiveLexiconSource(): SensitiveLexiconSource | null {
  return cachedLexiconSource;
}

export function getEmergencySensitiveLexicon(): SensitiveLexiconData {
  return emergencyLexicon;
}

async function buildLexiconHashPrefix(lexicon: SensitiveLexiconData): Promise<string | null> {
  const payload = JSON.stringify({
    version: lexicon.version,
    count: lexicon.terms.length,
    sources: lexicon.sources?.map((item) => item.id) ?? [],
  });

  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    return Array.from(new Uint8Array(digest))
      .slice(0, 6)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export async function getSensitiveLexiconHealth(env?: SensitiveLexiconRuntimeEnv): Promise<SensitiveLexiconHealth> {
  const lexicon = await loadSensitiveLexicon(env);
  const categories = new Set(lexicon.terms.map((term) => term.category));
  const source = getSensitiveLexiconSource();
  return {
    bindingPresent: Boolean(env?.MODERATION_ASSETS && typeof env.MODERATION_ASSETS.get === "function"),
    source,
    objectKeyUsed: LEXICON_OBJECT_KEY,
    entryCount: lexicon.terms.length,
    categoryCount: categories.size,
    lexiconHashPrefix: await buildLexiconHashPrefix(lexicon),
    parseOk: Array.isArray(lexicon.terms),
    lastErrorCode,
    fallbackUsed: source === "emergency",
  };
}

export function resetSensitiveLexiconRuntimeCache() {
  cachedLexicon = null;
  cachedLexiconSource = null;
  pendingLexiconLoad = null;
  lastErrorCode = null;
}
