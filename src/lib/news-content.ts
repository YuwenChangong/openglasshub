import type { SupabaseClient } from "@supabase/supabase-js";
import { isHttpUrl, isNewsStoragePath, resolveNewsMediaUrl } from "./news-media";

export type NewsInlineSegment =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string };

export type NewsContentBlock =
  | { type: "heading"; level: 1 | 2 | 3; segments: NewsInlineSegment[] }
  | { type: "paragraph"; segments: NewsInlineSegment[] }
  | { type: "list"; items: NewsInlineSegment[][] }
  | { type: "image"; alt: string; src: string; rawSrc: string };

const IMAGE_LINE_PATTERN = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;

function isSafeHref(value: string) {
  const text = value.trim();
  return text.startsWith("/") || /^https?:\/\//i.test(text);
}

function parseInlineSegments(input: string): NewsInlineSegment[] {
  const segments: NewsInlineSegment[] = [];
  let lastIndex = 0;

  for (const match of input.matchAll(LINK_PATTERN)) {
    const href = String(match[2] ?? "").trim();
    const text = String(match[1] ?? "").trim();
    const start = match.index ?? 0;
    const fullMatch = match[0] ?? "";

    if (start > lastIndex) {
      segments.push({ type: "text", text: input.slice(lastIndex, start) });
    }

    if (text && isSafeHref(href)) {
      segments.push({ type: "link", text, href });
    } else if (fullMatch) {
      segments.push({ type: "text", text: fullMatch });
    }

    lastIndex = start + fullMatch.length;
  }

  if (lastIndex < input.length) {
    segments.push({ type: "text", text: input.slice(lastIndex) });
  }

  if (segments.length === 0) {
    return [{ type: "text", text: input }];
  }

  return segments;
}

function normalizeComparableUrl(value: string) {
  const text = value.trim();
  if (!text) return "";

  if (!/^https?:\/\//i.test(text)) {
    return text;
  }

  try {
    const url = new URL(text);
    url.hash = "";
    return url.toString();
  } catch {
    return text;
  }
}

export function isSameNewsImageSource(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeComparableUrl(String(left ?? ""));
  const normalizedRight = normalizeComparableUrl(String(right ?? ""));
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight;
}

export function filterDuplicateCoverImageBlocks(
  blocks: NewsContentBlock[],
  coverImageSource: string | null | undefined,
) {
  return blocks.filter((block) => {
    if (block.type !== "image") return true;
    return !isSameNewsImageSource(block.rawSrc, coverImageSource);
  });
}

export function parseNewsContent(content: string | null | undefined): NewsContentBlock[] {
  const lines = String(content ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: NewsContentBlock[] = [];
  let paragraphLines: string[] = [];
  let listLines: string[] = [];

  function flushParagraph() {
    if (!paragraphLines.length) return;
    const text = paragraphLines.join(" ").trim();
    if (text) {
      blocks.push({ type: "paragraph", segments: parseInlineSegments(text) });
    }
    paragraphLines = [];
  }

  function flushList() {
    if (!listLines.length) return;
    blocks.push({
      type: "list",
      items: listLines.map((line) => parseInlineSegments(line)),
    });
    listLines = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const imageMatch = line.match(IMAGE_LINE_PATTERN);
    if (imageMatch) {
      flushParagraph();
      flushList();
      const alt = imageMatch[1]?.trim() || "图片";
      const src = imageMatch[2]?.trim() || "";
      if (src) {
        blocks.push({ type: "image", alt, src, rawSrc: src });
        continue;
      }
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(headingMatch[1].length, 3) as 1 | 2 | 3;
      blocks.push({
        type: "heading",
        level,
        segments: parseInlineSegments(headingMatch[2].trim()),
      });
      continue;
    }

    const listMatch = line.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      listLines.push(listMatch[1].trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}

export async function resolveNewsContentBlocks(
  client: SupabaseClient,
  blocks: NewsContentBlock[],
) {
  return Promise.all(
    blocks.map(async (block) => {
      if (block.type !== "image") return block;
      const src = block.src.trim();
      if (!src) return null;
      if (isHttpUrl(src)) return block;
      if (!isNewsStoragePath(src)) return null;
      const resolved = await resolveNewsMediaUrl(client, src);
      if (!resolved) return null;
      return { ...block, src: resolved };
    }),
  ).then((items) => items.filter(Boolean) as NewsContentBlock[]);
}
