const FALLBACK_PATH = "/";

export function getSafeNext(input: string | null | undefined, fallback = FALLBACK_PATH): string {
  if (!input) return fallback;

  const candidate = input.trim();
  if (!candidate) return fallback;

  if (candidate.startsWith("//")) return fallback;

  if (candidate.startsWith("/")) {
    return candidate;
  }

  try {
    const url = new URL(candidate, "https://openglasshub.pages.dev");
    if (url.origin !== "https://openglasshub.pages.dev") {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}` || fallback;
  } catch {
    return fallback;
  }
}

export function buildLoginHref(next: string): string {
  const safeNext = getSafeNext(next);
  return `/login/?next=${encodeURIComponent(safeNext)}`;
}
