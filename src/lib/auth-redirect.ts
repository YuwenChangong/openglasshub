const FALLBACK_PATH = "/";
const SAFE_ORIGIN_HOSTS = new Set(["openglasshub.pages.dev", "localhost", "127.0.0.1"]);

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

export function buildAuthCallbackRedirect(origin: string | undefined, next: string): string | undefined {
  if (!origin) return undefined;

  try {
    const originUrl = new URL(origin);
    const isSafeHost =
      SAFE_ORIGIN_HOSTS.has(originUrl.hostname) || originUrl.hostname.endsWith(".openglasshub.pages.dev");

    if (!["http:", "https:"].includes(originUrl.protocol) || !isSafeHost) {
      return undefined;
    }

    const callbackUrl = new URL("/auth/callback/", originUrl);
    callbackUrl.searchParams.set("next", getSafeNext(next));
    return callbackUrl.toString();
  } catch {
    return undefined;
  }
}
