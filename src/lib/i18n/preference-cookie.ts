import type { BrowserPreferenceRecord } from "./locale.ts";

export const PREFERENCE_COOKIE_NAME = "ogh_preferences_v1";
const keys = ["generation", "preference", "provenance", "version"];

export function isBrowserPreferenceRecord(value: unknown): value is BrowserPreferenceRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join("\0") === keys.join("\0") && record.version === 1 &&
    (record.preference === "auto" || record.preference === "zh-CN" || record.preference === "en") &&
    typeof record.generation === "number" && Number.isSafeInteger(record.generation) && record.generation >= 0 &&
    (record.provenance === "device_explicit" || record.provenance === "account_adopted");
}

export function parsePreferenceCookie(value: string | undefined): BrowserPreferenceRecord | undefined {
  if (!value || new TextEncoder().encode(value).length > 512) return undefined;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    return isBrowserPreferenceRecord(parsed) ? parsed : undefined;
  } catch { return undefined; }
}

export function serializePreferenceCookie(record: BrowserPreferenceRecord): string {
  if (!isBrowserPreferenceRecord(record)) throw new Error("Invalid preference record");
  const value = encodeURIComponent(JSON.stringify(record));
  if (new TextEncoder().encode(value).length > 512) throw new Error("Invalid preference record size");
  return `${PREFERENCE_COOKIE_NAME}=${value}; Path=/; Secure; SameSite=Lax; Max-Age=15552000`;
}

export function readBrowserPreference(): BrowserPreferenceRecord | undefined {
  if (typeof document === "undefined") return undefined;
  try {
    const entry = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${PREFERENCE_COOKIE_NAME}=`));
    return parsePreferenceCookie(entry?.slice(PREFERENCE_COOKIE_NAME.length + 1));
  } catch { return undefined; }
}

export function writeBrowserPreference(record: BrowserPreferenceRecord): boolean {
  if (typeof document === "undefined") return false;
  try {
    document.cookie = serializePreferenceCookie(record);
    const saved = readBrowserPreference();
    return saved !== undefined && keys.every((key) => saved[key as keyof BrowserPreferenceRecord] === record[key as keyof BrowserPreferenceRecord]);
  } catch { return false; }
}
