import type { ResolvedLocale } from "./locale.ts";

const originals: Readonly<Record<string, string>> = {
  "guides/index": "/src/content/docs/guides/index.mdx",
  "developers/index": "/src/content/docs/developers/index.mdx",
  "about/index": "/src/content/docs/about/index.mdx",
};

// Only these independently authored editions have passed human editorial review.
const reviewedEnglish: Readonly<Record<string, string>> = {
  "guides/index": "/src/content/editorial-translations/en/guides/index.mdx",
  "developers/index": "/src/content/editorial-translations/en/developers/index.mdx",
  "about/index": "/src/content/editorial-translations/en/about/index.mdx",
};

export function selectEditorialVariant(documentKey: string, documentLocale: ResolvedLocale): {
  kind: "reviewed" | "original";
  locale: ResolvedLocale;
  moduleKey: string;
} {
  const reviewed = Object.hasOwn(reviewedEnglish, documentKey) ? reviewedEnglish[documentKey] : undefined;
  if (documentLocale === "en" && reviewed) return { kind: "reviewed", locale: "en", moduleKey: reviewed };
  return { kind: "original", locale: "zh-CN", moduleKey: Object.hasOwn(originals, documentKey) ? originals[documentKey] : "" };
}
