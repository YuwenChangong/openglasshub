import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { resolveLocale } from "../../../src/lib/i18n/locale";
import { parsePreferenceCookie, PREFERENCE_COOKIE_NAME } from "../../../src/lib/i18n/preference-cookie";

export default defineConfig({ plugins: [react(), {
  name: "locale-request-ssr-fixture",
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (!request.url || new URL(request.url, "http://127.0.0.1").pathname !== "/") return next();
      try {
        const url = new URL(request.url, "http://127.0.0.1");
        const entry = request.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith(`${PREFERENCE_COOKIE_NAME}=`));
        const initial = resolveLocale({ saved: parsePreferenceCookie(entry?.slice(PREFERENCE_COOKIE_NAME.length + 1)), acceptLanguage: url.searchParams.get("initial") === "zh-CN" ? "zh-CN" : "en" });
        const { LocaleFixture } = await server.ssrLoadModule("/main.tsx");
        const markup = renderToString(createElement(LocaleFixture, { initial }));
        const template = await readFile(new URL("./index.html", import.meta.url), "utf8");
        const html = template.replace("__LOCALE__", initial.locale).replace("__FIRST__", markup).replace("__SECOND__", markup).replace("__SNAPSHOT__", JSON.stringify(initial));
        response.setHeader("content-type", "text/html");
        response.setHeader("cache-control", "private, no-store");
        response.end(await server.transformIndexHtml(request.url, html));
      } catch (error) { next(error); }
    });
  },
}], server: { host: "127.0.0.1", hmr: { host: "127.0.0.1" }, fs: { allow: ["../../.."] } } });
