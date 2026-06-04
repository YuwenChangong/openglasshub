import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_CIRCLE_SLUG_LENGTH = 64;

function trimSlugEdge(value: string) {
  return value.replace(/^-+|-+$/g, "");
}

function shortenSlugBase(value: string, maxLength: number) {
  return trimSlugEdge(value.slice(0, Math.max(1, maxLength)));
}

export function slugifyCircleName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/-+/g, "-");

  const base = trimSlugEdge(normalized);
  if (!base) return "circle";
  return shortenSlugBase(base, MAX_CIRCLE_SLUG_LENGTH) || "circle";
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
