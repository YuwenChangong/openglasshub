import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import { parse, transform } from "@astrojs/compiler";
import { getUiMessages } from "../src/lib/i18n/catalog.ts";
import { resolveDocumentLocale } from "../src/lib/i18n/document-locale.ts";
import { selectEditorialVariant } from "../src/lib/i18n/editorial-variants.ts";

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
async function assertDocumentLanguageFlow(source) {
  const { ast } = await parse(source);
  const articles = [];
  function walk(node) {
    if (node.name === "article") articles.push(node);
    for (const child of node.children ?? []) walk(child);
  }
  walk(ast);
  const article = articles.find(node => node.attributes.some(attr => attr.name === "class" && attr.value.split(/\s+/).includes("detail-main")));
  assert.ok(article, "Authored document surface exists");
  const lang = article.attributes.find(attr => attr.name === "lang");
  assert.equal(lang?.kind, "expression", "Body language must be a dynamic expression");
  const expression = ts.createSourceFile("lang.ts", lang.value, ts.ScriptTarget.Latest, true).statements[0]?.expression;
  assert.ok(expression && ts.isPropertyAccessExpression(expression) && expression.name.text === "locale" && ts.isIdentifier(expression.expression), "Body language belongs to the selected editorial variant");
  const script = ts.createSourceFile("guide.ts", source.split("---")[1], ts.ScriptTarget.Latest, true);
  const declarations = new Map();
  const imports = new Map();
  for (const statement of script.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      for (const binding of statement.importClause?.namedBindings?.elements ?? []) {
        imports.set(binding.name.text, { name: binding.propertyName?.text ?? binding.name.text, path: statement.moduleSpecifier.text });
      }
    }
    if (ts.isVariableStatement(statement)) {
      for (const item of statement.declarationList.declarations) if (ts.isIdentifier(item.name)) declarations.set(item.name.text, item.initializer);
    }
  }
  function importedCall(node, name, path) {
    assert.ok(node && ts.isCallExpression(node) && ts.isIdentifier(node.expression));
    assert.deepEqual(imports.get(node.expression.text), { name, path });
    return node.arguments;
  }
  const variantArgs = importedCall(declarations.get(expression.expression.text), "selectEditorialVariant", "../../lib/i18n/editorial-variants");
  assert.equal(variantArgs.length, 2);
  assert.ok(ts.isIdentifier(variantArgs[1]));
  const documentArgs = importedCall(declarations.get(variantArgs[1].text), "resolveDocumentLocale", "../../lib/i18n/document-locale");
  assert.equal(documentArgs.length, 2);
  assert.equal(documentArgs[0].getText(script), 'Astro.url.searchParams.get("lang")');
  assert.equal(documentArgs[1].getText(script), "Astro.locals.localeContext.locale", "Global UI locale is only the document resolver fallback");
}
await assertDocumentLanguageFlow(guide);
for (const replacement of ['lang="zh-CN"', 'lang="en"', "", 'lang={Astro.url.searchParams.get("lang")}', 'lang={"fr"}', "lang={documentLocale}"]) {
  await assert.rejects(() => assertDocumentLanguageFlow(guide.replace("lang={selection.locale}", replacement)), "Reject missing, fixed, unchecked or requested-only body language");
}
await assert.rejects(() => assertDocumentLanguageFlow(guide.replace('resolveDocumentLocale(Astro.url.searchParams.get("lang"), Astro.locals.localeContext.locale)', 'Astro.url.searchParams.get("lang")')));
for (const uiLocale of ["zh-CN", "en"]) {
  for (const query of ["en", "zh-CN", "fr", "", null]) {
    const requested = resolveDocumentLocale(query, uiLocale);
    assert.ok(["zh-CN", "en"].includes(requested));
    const reviewed = selectEditorialVariant("guides/index", requested);
    assert.equal(reviewed.locale, requested);
    const original = selectEditorialVariant("guides/unregistered", requested);
    assert.equal(original.locale, "zh-CN", "Chinese original must not inherit requested English");
  }
}
const originalGuide = "src/content/docs/guides/index.mdx";
assert.equal(normalizeLineEndings(await readFile(originalGuide, "utf8")), normalizeLineEndings(execFileSync("git", ["show", `${base}:${originalGuide}`], { encoding: "utf8" })), "Original Chinese document cannot be overwritten by a reviewed edition");
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
