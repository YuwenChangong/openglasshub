import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import ts from 'typescript';
import { editorialDocumentCases } from './lib/locale-v2-reviewed-documents.mjs';
import { privateNoStoreCases } from './lib/locale-v2-private-no-store-family.mjs';
import { observeNotFound, notFoundContracts } from './lib/locale-v2-404-copy.mjs';
let middleware, browser;
before(async () => {
  const compiled = await build({ entryPoints:['src/middleware.ts'], bundle:true, write:false, platform:'node', format:'esm', logLevel:'silent' });
  middleware = (await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)).onRequest;
  browser = await chromium.launch({ headless:true, args:['--disable-background-networking'] });
});
after(async () => { await browser?.close(); });
for (const locale of ['zh-CN','en']) for (const contract of privateNoStoreCases) test(`shared middleware preserves ${locale} ${contract.path} status, body and private/no-store`, async () => {
  const url = new URL(contract.path, 'https://127.0.0.1:54321');
  const request = new Request(url, { headers:{ 'accept-language':locale } });
  const locals = {}, body = `<html lang="${locale}"><h1>${contract.kind}</h1></html>`;
  const result = await middleware({ request, url, locals, cookies:{ get:()=>undefined } }, async () => new Response(body, { status:contract.status,
    headers:{ 'content-type':'text/html', 'cache-control':'public, max-age=60', vary:'Accept-Language' } }));
  assert.equal(result.status, contract.status);
  assert.equal(await result.text(), body);
  assert.equal(result.headers.get('location'), null);
  assert.ok(/private/.test(result.headers.get('cache-control')) && /no-store/.test(result.headers.get('cache-control')));
  assert.ok(!result.headers.get('cache-control').split(',').some(v=>v.trim()==='public'));
  assert.equal(result.headers.get('vary'),'Accept-Language');
  assert.equal(locals.localeContext.locale,locale);
});
for (const locale of ['zh-CN','en']) test(`successful PRIVATE_NO_STORE cannot be blamed for the subsequent ${locale} browser observer`, async () => {
  const context = await browser.newContext({ serviceWorkers:'block' });
  try {
    await context.route('**/*', route=>route.abort());
    const page = await context.newPage(), copy = notFoundContracts[locale];
    await page.setContent(`<html lang="${locale}"><title>${copy.heading} | OpenGlass Hub</title><section class="not-found-page"><h1>${copy.heading}</h1></section></html>`);
    const cacheControl='private, no-store';
    assert.ok(/private/.test(cacheControl)&&/no-store/.test(cacheControl),'PRIVATE_NO_STORE_/__owned-locale-v2-missing-page__/');
    const actual = await page.evaluate(observeNotFound);
    assert.equal(actual.locale,locale);assert.equal(actual.heading,copy.heading);
  } finally { await context.close(); }
});
test('family is only the current navigate assertions, not preference API or asset caching', async () => {
  const source = await readFile(new URL('./test-global-locale-v2-acceptance-local.mjs',import.meta.url),'utf8');
  assert.equal(privateNoStoreCases.length,12);
  assert.equal(privateNoStoreCases.filter(c=>c.status===404).length,1);
  assert.equal(privateNoStoreCases.filter(c=>c.status===200).length,11);
  for (const contract of privateNoStoreCases) assert.ok(!/^\/(api|_astro)\//.test(contract.path));
  assert.match(source,/PRIVATE_NO_STORE_\$\{route\}/);
  assert.match(source,/PREFERENCE_API_NO_STORE/);
});
test('cache-only preflight cannot combine partial modes or become full acceptance', async () => {
  const { runLocaleV2Acceptance } = await import('./test-global-locale-v2-acceptance-local.mjs');
  await assert.rejects(runLocaleV2Acceptance({privateNoStoreOnly:'yes'}),/INVALID_PRIVATE_NO_STORE_MODE/);
  for(const mode of ['targetOnly','context1Only']) await assert.rejects(runLocaleV2Acceptance({privateNoStoreOnly:true,[mode]:true}),/EXCLUSIVE_PARTIAL_MODES_REQUIRED/);
  const source=await readFile(new URL('./test-global-locale-v2-acceptance-local.mjs',import.meta.url),'utf8');
  assert.match(source,/receipt\.status='PASS_PRIVATE_NO_STORE_ONLY'/);
  assert.match(source,/receipt\.privateNoStoreFamily\?\.length===24/);
  assert.match(source,/if\(privateNoStoreOnly\)break/);
});
test('family inventory matches every current navigate route and editorial sibling', async () => {
  const source=await readFile(new URL('./test-global-locale-v2-acceptance-local.mjs',import.meta.url),'utf8');
  const ast=ts.createSourceFile('runner.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS), paths=new Set();
  const visit=node=>{
    if(ts.isCallExpression(node)&&node.expression.getText(ast)==='navigate'&&ts.isStringLiteral(node.arguments[1])) paths.add(node.arguments[1].text);
    if(ts.isForOfStatement(node)&&ts.isArrayLiteralExpression(node.expression)&&node.initializer.getText(ast)==='const route')
      for(const entry of node.expression.elements) if(ts.isStringLiteral(entry))paths.add(entry.text);
    if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='route'&&ts.isStringLiteral(node.initializer))paths.add(node.initializer.text);
    ts.forEachChild(node,visit);
  };visit(ast);
  for(const contract of editorialDocumentCases) paths.add(`${contract.path}?${new URLSearchParams({lang:contract.requestedLanguage})}`);
  assert.deepEqual(privateNoStoreCases.map(c=>c.path).sort(),[...paths].sort());
});
