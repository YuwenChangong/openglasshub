export type LegalConsentAccessMode = "exempt" | "public-signed-out-consent-if-authenticated" | "authenticated-and-consented";

const EXEMPT_PREFIXES = ["/api/", "/auth/", "/login/", "/register/", "/legal-consent/", "/terms/", "/privacy/", "/community-guidelines/", "/contact/", "/account-deletion/", "/products/", "/devices/", "/guides/", "/developers/", "/gaze-launcher/", "/news/", "/safety/", "/search/", "/"];
const PUBLIC_COMMUNITY_PREFIXES = ["/feed/", "/forum/", "/posts/", "/circles/", "/u/", "/users/"];
const AUTHENTICATED_PREFIXES = ["/notifications/", "/me/", "/admin/"];

function normalized(pathname: string): string {
  if (!pathname.startsWith("/")) return "/";
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

export function classifyLegalConsentRoute(pathname: string): LegalConsentAccessMode {
  const path = normalized(pathname);
  if (AUTHENTICATED_PREFIXES.some((prefix) => path.startsWith(prefix)) || path === "/posts/new/" || path === "/circles/new/" || /\/circles\/[^/]+\/manage\/$/.test(path)) return "authenticated-and-consented";
  if (PUBLIC_COMMUNITY_PREFIXES.some((prefix) => path.startsWith(prefix))) return "public-signed-out-consent-if-authenticated";
  if (EXEMPT_PREFIXES.some((prefix) => prefix === "/" ? path === "/" : path.startsWith(prefix))) return "exempt";
  return "authenticated-and-consented";
}

export function isLegalConsentRedirectTarget(pathname: string): boolean {
  return classifyLegalConsentRoute(pathname) !== "exempt" && !normalized(pathname).startsWith("/legal-consent/");
}
