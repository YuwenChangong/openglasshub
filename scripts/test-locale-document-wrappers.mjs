import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import { transform } from "@astrojs/compiler";
import { getUiMessages } from "../src/lib/i18n/catalog.ts";

const base = "318a252d8b8e6489044b322c3e9eefd72e9d6e08";
const pages = ["guides/index", "guides/[slug]", "developers/index", "gaze-launcher/index"];
function normalizeLineEndings(value) {
  return String(value).replace(/\r\n?/g, "\n");
}
function arrays(source) {
  const script = source.split("---")[1];
  const ast = ts.createSourceFile("page.ts", script, ts.ScriptTarget.Latest, true);
  const result = {};
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer || !ts.isIdentifier(declaration.name)) continue;
      const value = declaration.initializer;
      const unwrapped = ts.isAsExpression(value) ? value.expression : value;
      if (!ts.isArrayLiteralExpression(unwrapped)) continue;
      const code = ts.transpileModule(`(${value.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      result[declaration.name.text] = JSON.parse(JSON.stringify(vm.runInNewContext(code)));
    }
  }
  return result;
}
for (const locale of ["zh-CN", "en"]) {
  const text = getUiMessages(locale).documents;
  assert.ok(text, `${locale} document wrapper messages must exist`);
  for (const key of ["continueBrowsing", "backToGuides", "viewProducts", "forum", "originalChinese", "missing", "unavailable", "loading", "error"]) {
    assert.equal(typeof text[key], "string", `${locale}/${key}`);
    assert.ok(text[key].trim());
  }
  assert.equal(text.backToGuides, locale === "en" ? "Back to buying guides" : "返回选购指南");
}
for (const page of pages) {
  const file = `src/pages/${page}.astro`;
  const source = await readFile(file, "utf8");
  const original = execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" });
  assert.match(source, /getUiMessages\(Astro\.locals\.localeContext\.locale\)\.documents/, `${page} uses request locale`);
  assert.deepEqual(arrays(source), arrays(original), `${page} authored editorial arrays unchanged`);
  assert.match(source, /text\.originalChinese/, `${page} labels original-language content`);
  assert.doesNotMatch(source, /(?:href|canonical)=["']\/(?:en|zh(?:-CN)?)\//);
  assert.equal(normalizeLineEndings(source.split("<style>")[1]), normalizeLineEndings(original.split("<style>")[1]), `${page} styles unchanged`);
  const compiled = await transform(source, { filename: file });
  assert.equal(compiled.diagnostics.filter((item) => item.severity === 1).length, 0, `${page} compiles`);
}
const guide = await readFile("src/pages/guides/[slug].astro", "utf8");
assert.match(guide, /if \(!loadEntry\)\s*\{\s*return Astro\.redirect\("\/guides\/"\);/);
assert.match(guide, /<Content\s*\/>/);
assert.match(guide, /<h1>\{entry\.frontmatter\.title\}<\/h1>/);
assert.match(guide, /lang="zh-CN"/);
const launcher = await readFile("src/pages/gaze-launcher/index.astro", "utf8");
assert.match(launcher, /const gazeLauncherPublicEnabled = isGazeLauncherPublicEnabled\(\);/);
assert.match(launcher, /if \(!gazeLauncherPublicEnabled\)\s*\{\s*Astro\.response\.status = 404;/);
assert.match(launcher, /X-Robots-Tag", "noindex"/);
assert.match(launcher, /gazeLauncherPublicEnabled \? <CommunityLayout/);
assert.match(launcher, /title=\{text\.missing\}/);
assert.match(launcher, /<p>\{text\.unavailable\}<\/p>/);
const developers = await readFile("src/pages/developers/index.astro", "utf8");
assert.match(developers, /gazeLauncherPublicEnabled \? <a/);
console.log("LOCALE_DOCUMENT_WRAPPERS=PASS AUTHORED_ARRAYS_UNCHANGED=PASS MISSING_REDIRECT_AND_VISIBILITY=PASS");
