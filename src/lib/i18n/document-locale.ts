import type { ResolvedLocale } from "./locale.ts";

export function resolveDocumentLocale(value: string | null, uiLocale: ResolvedLocale): ResolvedLocale {
  return value === "zh-CN" || value === "en" ? value : uiLocale;
}
