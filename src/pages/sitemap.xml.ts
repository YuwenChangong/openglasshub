import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { brandCatalog, getDeviceBySlug } from "../lib/device-catalog";
import { createSSRClient, type CloudflareEnv } from "../lib/supabase-server";
import { isPublicVisibleCircle } from "../lib/site-navigation";
import { isGazeLauncherPublicEnabled } from "../lib/gaze-launcher-visibility";

const SITE_URL = "https://openglasshub.pages.dev";

type SitemapEntry = {
  loc: string;
  lastmod?: string;
  changefreq?: "daily" | "weekly" | "monthly";
  priority?: string;
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function absoluteUrl(pathname: string) {
  return new URL(pathname, SITE_URL).toString();
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function serializeSitemap(entries: SitemapEntry[]) {
  const body = entries
    .map((entry) => {
      const fields = [
        `<loc>${escapeXml(entry.loc)}</loc>`,
        entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : "",
        entry.changefreq ? `<changefreq>${entry.changefreq}</changefreq>` : "",
        entry.priority ? `<priority>${entry.priority}</priority>` : "",
      ].filter(Boolean);

      return `<url>${fields.join("")}</url>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const docs = await getCollection("docs");
  const env = (locals as { runtime?: { env?: CloudflareEnv } }).runtime?.env;
  const supabase = env?.SUPABASE_URL && env?.SUPABASE_ANON_KEY ? createSSRClient(env) : null;

  const entries: SitemapEntry[] = [
    { loc: absoluteUrl("/"), changefreq: "daily", priority: "1.0" },
    { loc: absoluteUrl("/feed/"), changefreq: "daily", priority: "0.9" },
    { loc: absoluteUrl("/circles/"), changefreq: "daily", priority: "0.85" },
    { loc: absoluteUrl("/news/"), changefreq: "daily", priority: "0.85" },
    { loc: absoluteUrl("/products/"), changefreq: "weekly", priority: "0.8" },
    { loc: absoluteUrl("/guides/"), changefreq: "weekly", priority: "0.8" },
    { loc: absoluteUrl("/developers/"), changefreq: "weekly", priority: "0.75" },
    ...(isGazeLauncherPublicEnabled() ? [{ loc: absoluteUrl("/gaze-launcher/"), changefreq: "weekly" as const, priority: "0.75" }] : []),
  ];

  for (const brand of brandCatalog) {
    entries.push({
      loc: absoluteUrl(`/products/${brand.key}/`),
      changefreq: "weekly",
      priority: "0.72",
    });
  }

  for (const entry of docs) {
    const docSlug = String((entry as { slug?: string | null }).slug ?? "");
    if (!docSlug) continue;

    if (docSlug.startsWith("reference/devices/")) {
      const slug = docSlug.replace("reference/devices/", "");
      const product = getDeviceBySlug(slug);
      if (!product) continue;
      entries.push({
        loc: absoluteUrl(`/products/${product.brandKey}/`),
        lastmod: normalizeDate(entry.data.lastUpdated?.toISOString?.() ?? undefined),
        changefreq: "monthly",
        priority: "0.7",
      });
      continue;
    }
    if (docSlug.startsWith("reference/guides/")) {
      const slug = docSlug.replace("reference/guides/", "");
      entries.push({
        loc: absoluteUrl(`/guides/${slug}/`),
        lastmod: normalizeDate(entry.data.lastUpdated?.toISOString?.() ?? undefined),
        changefreq: "monthly",
        priority: "0.7",
      });
    }
  }

  if (supabase) {
    const [{ data: circles, error: circlesError }, { data: newsArticles, error: newsError }] = await Promise.all([
      supabase
        .from("circles")
        .select("slug, status, updated_at, created_at, name")
        .limit(200)
        .order("updated_at", { ascending: false }),
      supabase
        .from("news_articles")
        .select("slug, published_at, updated_at")
        .eq("status", "published")
        .limit(200)
        .order("published_at", { ascending: false, nullsFirst: false }),
    ]);

    if (circlesError) {
      console.warn("[sitemap] failed to load circles", circlesError.message);
    } else {
      for (const circle of (circles ?? []).filter((item) => item.slug && isPublicVisibleCircle(item))) {
        entries.push({
          loc: absoluteUrl(`/circles/${circle.slug}/`),
          lastmod: normalizeDate(circle.updated_at ?? circle.created_at),
          changefreq: "weekly",
          priority: "0.65",
        });
      }
    }

    if (newsError) {
      console.warn("[sitemap] failed to load news", newsError.message);
    } else {
      for (const article of newsArticles ?? []) {
        if (!article.slug) continue;
        entries.push({
          loc: absoluteUrl(`/news/${article.slug}/`),
          lastmod: normalizeDate(article.updated_at ?? article.published_at),
          changefreq: "weekly",
          priority: "0.72",
        });
      }
    }
  }

  const uniqueEntries = Array.from(new Map(entries.map((entry) => [entry.loc, entry])).values());
  const xml = serializeSitemap(uniqueEntries);

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
