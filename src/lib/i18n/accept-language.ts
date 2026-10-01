import type { ResolvedLocale } from "./locale.ts";
export function resolveAcceptLanguage(header: string | undefined): ResolvedLocale | undefined {
  if (!header || new TextEncoder().encode(header).length > 2048) return undefined;
  const entries = header.split(",");
  if (entries.length > 20) return undefined;
  const candidates: { tag: string; weight: number; index: number }[] = [];
  for (const [index, entry] of entries.entries()) {
    const match = /^\s*(\*|[a-z]{2,8}(?:-[a-z0-9]{1,8})*)\s*(?:;\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/i.exec(entry);
    if (!match) return undefined;
    candidates.push({ tag: match[1].toLowerCase(), weight: match[2] === undefined ? 1 : Number(match[2]), index });
  }
  candidates.sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { tag, weight } of candidates) {
    if (weight === 0) continue;
    if (tag === "en" || tag.startsWith("en-")) return "en";
    if (tag.split("-").includes("hant")) continue;
    if (tag === "zh" || /^(zh-cn|zh-hans)(-|$)/.test(tag)) return "zh-CN";
  }
  return undefined;
}
