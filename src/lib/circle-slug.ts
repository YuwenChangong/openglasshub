import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_CIRCLE_SLUG_LENGTH = 64;
const MIN_FALLBACK_HASH_LENGTH = 8;

function trimSlugEdge(value: string) {
  return value.replace(/^-+|-+$/g, "");
}

function shortenSlugBase(value: string, maxLength: number) {
  return trimSlugEdge(value.slice(0, Math.max(1, maxLength)));
}

export function hashSlugSeed(value: string): string {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, MIN_FALLBACK_HASH_LENGTH).padStart(MIN_FALLBACK_HASH_LENGTH, "0");
}

export function slugifyCircleName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-");

  const base = shortenSlugBase(trimSlugEdge(normalized), MAX_CIRCLE_SLUG_LENGTH);
  if (base.length >= 2) return base;
  return `circle-${hashSlugSeed(name || "circle")}`;
}

async function slugExists(client: SupabaseClient, slug: string) {
  const { data, error } = await client.from("circles").select("id").eq("slug", slug).limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function buildUniqueCircleSlug(client: SupabaseClient, name: string): Promise<string> {
  const baseSlug = slugifyCircleName(name);
  if (!(await slugExists(client, baseSlug))) {
    return baseSlug;
  }

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${shortenSlugBase(baseSlug, MAX_CIRCLE_SLUG_LENGTH - suffixText.length)}${suffixText}`;
    if (!(await slugExists(client, candidate))) {
      return candidate;
    }
  }

  throw new Error("CIRCLE_SLUG_GENERATION_FAILED");
}
