export const LEGACY_PAGES_ORIGIN = "https://openglasshub.pages.dev";

export function resolveSiteOrigin(value?: unknown): string {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return LEGACY_PAGES_ORIGIN;
  }

  if (typeof value !== "string") {
    throw new TypeError("Site origin must be an absolute HTTPS origin");
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new TypeError("Site origin must be an absolute HTTPS origin");
  }

  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== ""
  ) {
    throw new TypeError("Site origin must be an absolute HTTPS origin");
  }

  return parsed.origin;
}
