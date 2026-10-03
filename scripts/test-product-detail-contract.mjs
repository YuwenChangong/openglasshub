import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { transform } from "@astrojs/compiler-rs";
import { resolvePath } from "@astrojs/internal-helpers/mdx";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { getPublishedDeviceBySlug } from "../src/lib/public-device-data.ts";
import { resolveLocale } from "../src/lib/i18n/locale.ts";
import { getUiMessages } from "../src/lib/i18n/catalog.ts";

const routePath = "src/pages/products/[brand]/[slug].astro";
const source = await readFile(routePath, "utf8").catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
assert.ok(source, "KNOWN_DEVICE_CANONICAL_DETAIL_ROUTE_MISSING: brand anchor cannot serve as detail");
assert.match(source, /export const prerender = false/);
assert.match(source, /getPublishedDeviceBySlug\(createSSRClient/);
assert.doesNotMatch(source, /listPublishedDevices|#product-|service.role|device_specs|\.rpc\(/i);
const root = path.resolve(import.meta.dirname, "..");
const artifactPath = path.join(root, "artifacts/qa/product-detail-task-2");
await mkdir(artifactPath, { recursive: true });
// One existing Task 1 reader-compatible row, not a new projection or a database/RLS oracle.
const fixture = JSON.parse(await readFile(path.join(root, "scripts/fixtures/product-detail-public-row.json"), "utf8"));
assert.ok(fixture?.slug && fixture.brand_key);
const privateRow = { ...fixture, slug: "task2-private", name: "TASK2_PRIVATE_IDENTITY_SENTINEL", publication_status: "draft" };
let activeRows = [fixture, privateRow], failRead = false;
const queries = [];
function client() {
  return { from(table) {
    const call = { table, filters: [], columns: null };
    queries.push(call);
    const query = {
      select(columns) { call.columns = columns; return query; },
      eq(key, value) { call.filters.push([key, value]); return query; },
      maybeSingle() {
        const rows = activeRows.filter((row) => call.filters.every(([key, value]) => row[key] === value));
        return Promise.resolve(failRead ? { data: null, error: { message: "TASK2_RAW_BACKEND_ERROR_SENTINEL" } } : { data: rows[0] ?? null, error: null });
      },
    };
    return query;
  } };
}

const previousFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("TASK2_NETWORK_FORBIDDEN"); };
globalThis.__task2ClientFactory = client;
try {
  const styles = new Set();
  const rendererOutput = path.join(artifactPath, "react-renderer.mjs");
  await build({ entryPoints: [fileURLToPath(import.meta.resolve("@astrojs/react/server.js"))], outfile: rendererOutput,
    bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent",
    plugins: [{ name: "task2-react-options", setup(builder) {
      builder.onResolve({ filter: /^astro:react:opts$/ }, () => ({ path: "options", namespace: "task2" }));
      builder.onLoad({ filter: /.*/, namespace: "task2" }, () => ({ contents: "export default {};" }));
    } }] });
  const { default: reactRenderer } = await import(pathToFileURL(rendererOutput).href);
  const output = path.join(artifactPath, "route.mjs");
  await build({ entryPoints: [path.join(root, routePath)], outfile: output, bundle: true, platform: "node", format: "esm",
    packages: "external", jsx: "automatic", define: { "import.meta.env": "{}" }, logLevel: "silent",
    plugins: [{ name: "task2-offline-astro-ssr", setup(builder) {
      builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "runtime", namespace: "task2" }));
      builder.onResolve({ filter: /(?:^|\/)supabase-server(?:\.ts)?$/ }, () => ({ path: "server", namespace: "task2" }));
      builder.onResolve({ filter: /(?:^|\/)supabase-browser(?:\.ts)?$/ }, () => ({ path: "browser", namespace: "task2" }));
      builder.onResolve({ filter: /\.css(?:\?.*)?$/ }, async (args) => {
        if (!args.path.includes("?")) styles.add(await readFile(path.resolve(args.resolveDir, args.path), "utf8"));
        return { path: "style", namespace: "task2" };
      });
      builder.onLoad({ filter: /.*/, namespace: "task2" }, ({ path: name }) => ({ contents:
        name === "runtime" ? "export const env = {};" : name === "server" ? "export const createSSRClient=()=>globalThis.__task2ClientFactory();"
          : name === "browser" ? "export const createBrowserSupabaseClient=()=>null; export const syncBrowserRealtimeAuth=async()=>null; export const consumeBrowserRecoveryEvent=()=>false; export const invalidateBrowserRecoveryEvent=()=>{};" : "export {};" }));
      builder.onLoad({ filter: /\.astro$/ }, async ({ path: filename }) => {
        const compiled = transform(await readFile(filename, "utf8"), { filename, internalURL: "astro/compiler-runtime",
          resultScopedSlot: true, resolvePath: (specifier) => resolvePath(specifier, filename) });
        assert.equal(compiled.diagnostics.filter((item) => item.severity === "error").length, 0, "Actual Astro source must compile");
        for (const css of compiled.css) styles.add(css);
        return { contents: compiled.code, loader: "ts", resolveDir: path.dirname(filename) };
      });
    } }] });
  const { default: Route } = await import(pathToFileURL(output).href);
  const container = await AstroContainer.create({ astroConfig: { site: "https://127.0.0.1" } });
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: "@astrojs/react", entrypoint: "@astrojs/react/client.js" });
  const cases = [];
  async function request(brand, slug, locale = "en") {
    const url = new URL(`/products/${encodeURIComponent(brand)}/${encodeURIComponent(slug)}/`, "https://127.0.0.1");
    const response = await container.renderToResponse(Route, { partial: false, params: { brand, slug }, request: new Request(url),
      locals: { localeContext: resolveLocale({ saved: { version: 1, preference: locale, generation: 1, provenance: "device_explicit" } }) } });
    return { response, html: await response.text() };
  }
  function markupEntries(html, marker) {
    return [...html.matchAll(new RegExp(`<div[^>]*${marker}="([^"]*)"[^>]*>\\s*<dt[^>]*>([\\s\\S]*?)<\\/dt>\\s*<dd[^>]*>([\\s\\S]*?)<\\/dd>\\s*<\\/div>`, "g"))]
      .map(([, field, label, value]) => ({ field, label, value }));
  }
  function escape(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&#34;").replaceAll("'", "&#39;");
  }
  const mapped = await getPublishedDeviceBySlug(client(), fixture.slug);
  const expected = mapped.specGroups.flatMap((group) => group.items).map((item) => ({ field: escape(item.field), label: escape(item.label), value: escape(item.value) }));
  const expectedPreview = mapped.previewSpecs.map((item) => ({ field: escape(item.field), label: escape(item.label), value: escape(item.value) }));
  let renderedFullParameterCount = 0, renderedPreviewParameterCount = 0;
  for (const locale of ["en", "zh-CN"]) {
    const known = await request(fixture.brand_key, fixture.slug, locale);
    assert.equal(known.response.status, 200);
    assert.equal(known.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1], escape(mapped.name));
    assert.ok(known.html.includes(`data-product-slug="${fixture.slug}"`));
    assert.ok(known.html.includes(`data-product-brand="${fixture.brand_key}"`));
    assert.ok(known.html.includes(getUiMessages(locale).catalog.productParameters));
    assert.ok(known.html.includes(`https://127.0.0.1/products/${fixture.brand_key}/${fixture.slug}/`));
    assert.deepEqual(markupEntries(known.html, "data-spec-field"), expected, "All mapped full-spec labels/values, not a capped preview, must render unchanged");
    assert.deepEqual(markupEntries(known.html, "data-preview-field"), expectedPreview, "Every existing preview value must also remain visible");
    renderedFullParameterCount = markupEntries(known.html, "data-spec-field").length;
    renderedPreviewParameterCount = markupEntries(known.html, "data-preview-field").length;
    assert.equal((known.html.match(/data-spec-group=/g) ?? []).length, mapped.specGroups.length);
    for (const group of mapped.specGroups) {
      assert.ok(known.html.includes(`data-spec-group="${escape(group.key)}"`));
      assert.ok(known.html.includes(escape(group.label)));
    }
    for (const link of mapped.externalLinks) assert.ok(known.html.includes(escape(link.url)));
    assert.doesNotMatch(known.html, /\/legal-consent\//);
    await writeFile(path.join(artifactPath, `known-${locale}.html`), known.html);
    cases.push(`KNOWN_200_IDENTITY_ALL_MAPPED_PARAMETERS_${locale}`);
  }
  for (const [brand, slug] of [[fixture.brand_key, "task2-unknown"], [fixture.brand_key, privateRow.slug], ["task2-unknown-brand", fixture.slug], [fixture.brand_key, "bad/slug"]]) {
    const missing = await request(brand, slug);
    assert.equal(missing.response.status, 404);
    assert.match(missing.response.headers.get("x-robots-tag"), /noindex/);
    assert.doesNotMatch(missing.html, /TASK2_PRIVATE_IDENTITY_SENTINEL|data-product-detail/);
    cases.push(`NOT_FOUND_404_${slug}`);
  }
  const recognizedWrongBrand = "rokid";
  assert.notEqual(recognizedWrongBrand, fixture.brand_key);
  const wrong = await request(recognizedWrongBrand, fixture.slug);
  assert.equal(wrong.response.status, 301);
  assert.equal(wrong.response.headers.get("location"), `/products/${fixture.brand_key}/${fixture.slug}/`);
  cases.push("WRONG_RECOGNIZED_BRAND_CANONICAL_301");
  failRead = true;
  const failed = await request(fixture.brand_key, fixture.slug);
  assert.equal(failed.response.status, 503);
  assert.match(failed.response.headers.get("x-robots-tag"), /noindex/);
  assert.doesNotMatch(failed.html, /TASK2_RAW_BACKEND_ERROR_SENTINEL|data-product-detail/);
  failRead = false;
  cases.push("READ_ERROR_SAFE_503");
  activeRows = [{ ...fixture, full_specs: {}, key_specs: [] }];
  const empty = await request(fixture.brand_key, fixture.slug);
  assert.equal(empty.response.status, 200);
  assert.ok(empty.html.includes(getUiMessages("en").catalog.productParametersEmpty));
  assert.equal(markupEntries(empty.html, "data-spec-field").length, 0);
  cases.push("METADATA_ONLY_HONEST_EMPTY_200");
  activeRows = [{ ...fixture, full_specs: {}, key_specs: [{ field: "preview_only", label: "Preview <label>", value: "A & B <value>" }] }];
  const previewOnly = await request(fixture.brand_key, fixture.slug);
  assert.deepEqual(markupEntries(previewOnly.html, "data-preview-field"), [{ field: "preview_only", label: "Preview &lt;label&gt;", value: "A &amp; B &lt;value&gt;" }]);
  cases.push("PREVIEW_ONLY_VALUES_ESCAPED_NOT_DROPPED");
  activeRows = [{ ...fixture, brand_key: "../unsafe" }];
  const unsafeIdentity = await request(fixture.brand_key, fixture.slug);
  assert.equal(unsafeIdentity.response.status, 503);
  assert.equal(unsafeIdentity.response.headers.get("location"), null);
  assert.doesNotMatch(unsafeIdentity.html, /data-product-detail/);
  cases.push("UNTRUSTED_RETURNED_IDENTITY_SAFE_503");
  for (const query of queries) {
    assert.equal(query.table, "devices");
    assert.deepEqual(query.filters[0], ["publication_status", "published"]);
    assert.equal(query.filters[1][0], "slug");
  }
  const receipt = {
    format: "slice-c-task-2-focused-route-v1", evidenceClass: "ACTUAL_ASTRO_CONTAINER_SSR_WITH_OFFLINE_QUERY_DOUBLE_NOT_DB_RLS_OR_PRODUCTION",
    fixtureSlug: fixture.slug, knownStatus: 200, unknownStatus: 404, wrongBrandStatus: 301, readFailureStatus: 503,
    expectedFullParameterCount: expected.length, renderedFullParameterCount,
    expectedPreviewParameterCount: expectedPreview.length, renderedPreviewParameterCount,
    knownMappedParameterDroppedCount: 0, cases, externalRequests: 0,
  };
  await writeFile(path.join(artifactPath, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  await writeFile(path.join(artifactPath, "focused-styles.css"), [...styles].join("\n"));
  console.log(JSON.stringify({ PRODUCT_DETAIL_CONTRACT: "PASS", ...receipt }));
} finally {
  globalThis.fetch = previousFetch;
  delete globalThis.__task2ClientFactory;
}
