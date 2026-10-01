import type { MiddlewareHandler } from "astro";
import { getTrustedCountry } from "./lib/i18n/country.server";
import { resolveLocale } from "./lib/i18n/locale";
import { parsePreferenceCookie, PREFERENCE_COOKIE_NAME } from "./lib/i18n/preference-cookie";
import { isLocaleHtmlRoute } from "./lib/i18n/html-route-policy";

export const onRequest: MiddlewareHandler = async ({ request, locals, url, cookies }, next) => {
  const saved = parsePreferenceCookie(cookies.get(PREFERENCE_COOKIE_NAME)?.value);
  locals.localeContext = resolveLocale({ saved, trustedCountry: getTrustedCountry(request), acceptLanguage: request.headers.get("accept-language") ?? undefined });
  const response = await next();
  if (/^\/api(?:\/|$)/.test(url.pathname)) return response;
  if (!isLocaleHtmlRoute(url.pathname) && response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/html") return response;
  const headers = new Headers(response.headers);
  const directives = (headers.get("cache-control") ?? "").split(",").map(value => value.trim()).filter(value => value && value.toLowerCase() !== "public");
  if (!directives.some(value => value.toLowerCase() === "private")) directives.push("private");
  if (!directives.some(value => value.toLowerCase() === "no-store")) directives.push("no-store");
  headers.set("cache-control", directives.join(", "));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
