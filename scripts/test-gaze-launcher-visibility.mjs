import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import ts from "typescript";
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
const updatesAst = ts.createSourceFile("LatestUpdates.ts", latestUpdates.split("---")[1], ts.ScriptTarget.Latest, true);
const updatesDeclaration = updatesAst.statements
  .filter(ts.isVariableStatement)
  .flatMap((statement) => [...statement.declarationList.declarations])
  .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "updates");
assert.ok(updatesDeclaration && ts.isArrayLiteralExpression(updatesDeclaration.initializer), "Latest Updates records must exist");
const updatesArray = updatesDeclaration.initializer;
function linkOf(record) {
  if (!ts.isObjectLiteralExpression(record)) return null;
  const link = record.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(updatesAst) === "link");
  return link && ts.isStringLiteral(link.initializer) ? link.initializer.text : null;
}
function unwrap(expression) {
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  return expression;
}
const gates = updatesArray.elements.filter(ts.isSpreadElement).map((spread) => unwrap(spread.expression))
  .filter((expression) => ts.isConditionalExpression(expression)
    && ts.isCallExpression(expression.condition)
    && ts.isIdentifier(expression.condition.expression)
    && expression.condition.expression.text === "isGazeLauncherPublicEnabled"
    && expression.condition.arguments.length === 0);
assert.equal(gates.length, 1, "Latest Updates must use the canonical visibility branch");
const gate = gates[0];
assert.ok(ts.isArrayLiteralExpression(gate.whenTrue) && ts.isArrayLiteralExpression(gate.whenFalse));
assert.equal(gate.whenFalse.elements.length, 0, "disabled branch must emit no Gaze update");
const gazeRecords = gate.whenTrue.elements.filter((record) => /^\/gaze-launcher\/?$/.test(linkOf(record) ?? ""));
assert.equal(gazeRecords.length, 1, "stable Gaze route must occur in the enabled branch");
assert.ok(gazeRecords[0].getStart(updatesAst) > gate.whenTrue.getStart(updatesAst));
assert.ok(gazeRecords[0].end < gate.whenTrue.end, "Gaze record must be structurally inside the enabled branch");
const allLinks = [];
function collectLinks(node) {
  const link = linkOf(node);
  if (link !== null) allLinks.push(link);
  ts.forEachChild(node, collectLinks);
}
collectLinks(updatesArray);
assert.equal(allLinks.filter((link) => /^\/gaze-launcher\/?$/.test(link)).length, 1, "no ungated duplicate Gaze update");
assert.equal(updatesArray.elements.filter((record) => linkOf(record) === "/devices").length, 1,
  "the unrelated OpenGlass Hub update retains its stable route outside the Gaze-only branch");

const buildRoot = existsSync("dist/client") ? "dist/client" : "dist";
const generatedSitemapFiles = (await readdir(buildRoot))
  .filter((file) => /^sitemap(?:-\d+|-index)?\.xml$/.test(file));
assert.ok(generatedSitemapFiles.length > 0, "the production build must emit sitemap XML files");

for (const file of generatedSitemapFiles) {
  const xml = await readFile(`${buildRoot}/${file}`, "utf8");
  assert.ok(!/<loc>[^<]*\/gaze-launcher\/?<\/loc>/.test(xml), `disabled Gaze Launcher must be absent from generated ${file}`);
}

const renderedDocumentationFiles = (await readdir(`${buildRoot}/reference`, { recursive: true }))
  .filter((file) => typeof file === "string" && file.endsWith(".html"))
  .map((file) => file.replaceAll("\\", "/"));
let activeDocumentationGazeLinks = 0;
for (const file of renderedDocumentationFiles) {
  const html = await readFile(`${buildRoot}/reference/${file}`, "utf8");
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
