import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  isGazeLauncherPublicEnabled,
  isGazeLauncherSitemapEntryIncluded,
  GAZE_LAUNCHER_PUBLIC_ENABLED,
} from "../src/lib/gaze-launcher-visibility.ts";
import {
  applyGazeLauncherDocumentationLinkVisibility,
  isGazeLauncherDocumentationEntryPublic,
} from "../src/plugins/remark-gaze-launcher-visibility.ts";

const files = [
  "src/lib/site-navigation.ts",
  "src/pages/index.astro",
  "src/pages/developers/index.astro",
  "src/components/LatestUpdates.astro",
  "src/pages/sitemap.xml.ts",
  "astro.config.mjs",
];

assert.equal(GAZE_LAUNCHER_PUBLIC_ENABLED, false, "the public default must be disabled");
assert.equal(isGazeLauncherPublicEnabled(), false, "default visibility is disabled");
assert.equal(isGazeLauncherPublicEnabled(true), true, "the same feature can be restored by a controlled build-time input");
assert.equal(isGazeLauncherPublicEnabled(false), false);
assert.equal(
  isGazeLauncherSitemapEntryIncluded("https://openglasshub.pages.dev/gaze-launcher/", true),
  true,
  "the canonical enabled state makes the Gaze route eligible for generated sitemap inclusion",
);
assert.equal(
  isGazeLauncherSitemapEntryIncluded("https://openglasshub.pages.dev/gaze-launcher/"),
  false,
  "the canonical disabled state excludes the Gaze route from generated sitemaps",
);

const enabledDocumentationLinkTree = {
  type: "root",
  children: [{ type: "link", url: "/gaze-launcher/", children: [{ type: "text", value: "Gaze Launcher" }] }],
};
applyGazeLauncherDocumentationLinkVisibility(enabledDocumentationLinkTree, true);
assert.equal(enabledDocumentationLinkTree.children[0].type, "link", "enabled visibility preserves the existing documentation link");

const disabledDocumentationLinkTree = {
  type: "root",
  children: [{ type: "link", url: "/gaze-launcher/", children: [{ type: "text", value: "Gaze Launcher" }] }],
};
applyGazeLauncherDocumentationLinkVisibility(disabledDocumentationLinkTree);
assert.deepEqual(
  disabledDocumentationLinkTree.children,
  [{ type: "text", value: "Gaze Launcher" }],
  "disabled visibility preserves documentation text while removing the active route link",
);
assert.equal(
  isGazeLauncherDocumentationEntryPublic("reference/gaze-launcher-docs", true),
  true,
  "enabled visibility restores the dedicated documentation entry",
);
assert.equal(
  isGazeLauncherDocumentationEntryPublic("reference/gaze-launcher-docs"),
  false,
  "disabled visibility excludes the dedicated documentation entry",
);

for (const file of files) {
  const source = await readFile(file, "utf8");
  assert.match(source, /isGazeLauncherPublicEnabled|GAZE_LAUNCHER_PUBLIC_ENABLED/, `${file} must use the canonical visibility source`);
}

const route = await readFile("src/pages/gaze-launcher/index.astro", "utf8");
assert.match(route, /Astro\.response\.status\s*=\s*404/, "disabled route must produce an actual 404 response");
assert.match(route, /X-Robots-Tag.*noindex/i, "disabled route must be noindex");
assert.match(route, /isGazeLauncherPublicEnabled/, "route must use the canonical visibility source");

const latestUpdates = await readFile("src/components/LatestUpdates.astro", "utf8");
const latestUpdatesGateIndex = latestUpdates.indexOf("isGazeLauncherPublicEnabled() ? [");
const gazeLatestUpdatesTitleIndex = latestUpdates.indexOf("title: 'Gaze Launcher 启动'");
const latestUpdatesEnabledBranchEnd = latestUpdates.indexOf("}] : []", latestUpdatesGateIndex);
assert.ok(latestUpdatesGateIndex >= 0, "Latest Updates must use the canonical visibility branch");
assert.ok(gazeLatestUpdatesTitleIndex > latestUpdatesGateIndex, "the Gaze Latest Updates card must follow the canonical branch");
assert.ok(
  latestUpdatesEnabledBranchEnd > gazeLatestUpdatesTitleIndex,
  "the Gaze Latest Updates card must be emitted only by the canonical enabled branch",
);
assert.match(
  latestUpdates,
  /title:\s*'OpenGlass Hub 正式上线'/,
  "the unrelated OpenGlass Hub update must remain present",
);

const generatedSitemapFiles = (await readdir("dist"))
  .filter((file) => /^sitemap(?:-\d+|-index)?\.xml$/.test(file));
assert.ok(generatedSitemapFiles.length > 0, "the production build must emit sitemap XML files");

for (const file of generatedSitemapFiles) {
  const xml = await readFile(`dist/${file}`, "utf8");
  assert.ok(!/<loc>[^<]*\/gaze-launcher\/?<\/loc>/.test(xml), `disabled Gaze Launcher must be absent from generated ${file}`);
}

const renderedDocumentationFiles = (await readdir("dist/reference", { recursive: true }))
  .filter((file) => typeof file === "string" && file.endsWith(".html"))
  .map((file) => file.replaceAll("\\", "/"));
let activeDocumentationGazeLinks = 0;
for (const file of renderedDocumentationFiles) {
  const html = await readFile(`dist/reference/${file}`, "utf8");
  activeDocumentationGazeLinks += (html.match(/href="\/gaze-launcher\/?"/g) ?? []).length;
}
assert.equal(
  activeDocumentationGazeLinks,
  0,
  "DISABLED_GAZE_ACTIVE_DOC_LINK_PRESENT: disabled Gaze Launcher must not have active rendered documentation links",
);
assert.equal(
  renderedDocumentationFiles.includes("gaze-launcher-docs/index.html"),
  false,
  "DISABLED_GAZE_DEDICATED_DOC_PRESENT: disabled Gaze Launcher must not have a rendered dedicated documentation page",
);
console.log("P2_GAZE_VISIBILITY_MATRIX=PASS");
