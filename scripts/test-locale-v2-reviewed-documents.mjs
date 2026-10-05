import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import ts from 'typescript';

const base = 'cedb0c24f127d4977a5e5b8a15ae5cd0e89c33e0';
const old = execFileSync('git', ['show', `${base}:scripts/test-global-locale-v2-acceptance-local.mjs`], { encoding: 'utf8', windowsHide: true });
const ast = ts.createSourceFile('old.mjs', old, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let assertion;
const visit = node => {
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.arguments.some(arg => ts.isStringLiteral(arg) && arg.text === 'REVIEWED_ENGLISH_DOCUMENT')) assertion = node;
  ts.forEachChild(node, visit);
}; visit(ast); assert.ok(assertion);
const previous = assertion.parent.statements[assertion.parent.statements.indexOf(assertion) - 1];
const oldAssertion = new (Object.getPrototypeOf(async function() {}).constructor)('navigate', 'page', 'fixture', 'observe', `${previous.getText(ast)};${assertion.getText(ast)}`);
let documents;
try { documents = await import('./lib/locale-v2-reviewed-documents.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

async function fixture(run, { shell = 'zh-CN', wrongBody = false, rawWrongLanguage = false, renderedWrongLanguage = false } = {}) {
  const paths = [];
  const server = createServer((req, res) => {
    paths.push(req.url); const url = new URL(req.url, 'http://127.0.0.1');
    const english = url.searchParams.get('lang') === 'en';
    let title = '选购指南', language = shell, article = '', body = '';
    if (url.pathname === '/guides/index/') {
      title = english ? 'Buying guides' : '选购指南'; language = english ? 'en' : 'zh-CN';
      body = english ? 'Begin with the task. Browse the device library' : '信息说明。阅读文章';
      article = `<article class="detail-main" lang="${rawWrongLanguage ? 'zh-CN' : language}">${wrongBody ? 'Unreviewed replacement' : body}</article>`;
    } else if (url.pathname === '/guides/ar-ai-xr-glasses-difference/') {
      title = 'AR 眼镜、AI 眼镜、XR 眼镜有什么区别？'; language = 'zh-CN';
      article = '<article class="detail-main" lang="zh-CN">快速结论</article>';
    }
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'private, no-store' });
    res.end(`<html lang="${shell}"><body><h1>${title}</h1>${article}</body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let dom, href;
  const page = { url: () => href,
    locator: () => ({ first: () => ({ textContent: async () => dom.window.document.querySelector('h1').textContent }) }),
    evaluate: async (fn, args) => dom.window.eval(`(${fn.toString()})`)(args) };
  const navigate = async (_page, route, locale) => {
    assert.equal(locale, shell); href = origin + route;
    const response = await fetch(href, { redirect: 'manual' }), html = await response.text();
    dom?.window.close(); dom = new JSDOM(html, { runScripts: 'outside-only' });
    if (renderedWrongLanguage) dom.window.document.querySelector('article')?.setAttribute('lang', 'zh-CN');
    return { status: () => response.status, text: async () => html, request: () => ({ url: () => href }) };
  };
  try { await run({ page, navigate, paths, origin }); }
  finally { dom?.window.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

if (process.argv.includes('--old-red')) {
  test('actual frozen old assertion fails because it requests the navigation index, not the reviewed edition', async () => {
    await fixture(async ({ page, navigate }) => oldAssertion(navigate, page, { locale: 'zh-CN' }, assert.ok));
  });
} else {
  test('frozen old RED remains evidence of wrong reviewed-document input', async () => {
    await fixture(async ({ page, navigate, paths }) => {
      await assert.rejects(oldAssertion(navigate, page, { locale: 'zh-CN' }, assert.ok), /REVIEWED_ENGLISH_DOCUMENT/);
      assert.deepEqual(paths, ['/guides/?lang=en']);
    });
  });
  test('reviewed document family has one shared observer', () => {
    assert.equal(typeof documents?.verifyEditorialDocumentFamily, 'function', 'SHARED_REVIEWED_DOCUMENT_OBSERVER_REQUIRED');
  });
  test('formal runner executes the shared document observer and retains supported-edition policy', () => {
    const current = readFileSync(new URL('./test-global-locale-v2-acceptance-local.mjs', import.meta.url), 'utf8');
    const source = ts.createSourceFile('current.mjs', current, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const calls = [];
    const walk = node => { if (ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node, walk); }; walk(source);
    assert.equal(calls.filter(node => node.expression.getText(source) === 'verifyEditorialDocumentFamily').length, 1);
    assert.ok(calls.some(node => node.arguments.some(arg => ts.isStringLiteral(arg) && arg.text === 'EDITORIAL_SUPPORTED_POLICY')));
    assert.ok(!calls.some(node => node.expression.getText(source) === 'navigate' && node.arguments.some(arg => ts.isStringLiteral(arg) && arg.text.startsWith('/guides/?lang='))));
  });
  test('Context 1 collector records independent document failures through all siblings', { skip: !documents }, async () => {
    await fixture(async ({ page, navigate, paths }) => {
      const failures = [], records = [];
      await documents.verifyEditorialDocumentFamily({ page, navigate, locale: 'zh-CN',
        readAccountIdentity: async () => true,
        readPreference: async () => ({ preference: 'zh-CN' }), readAccountPreference: async () => ({ locale_preference: 'en', revision: 1 }),
        observe: (value, name) => { if (!value) failures.push(name); }, assertUnchanged: assert.deepEqual,
        record: record => records.push(record) });
      assert.deepEqual(failures, ['REVIEWED_ENGLISH_DOCUMENT', 'REVIEWED_CHINESE_DOCUMENT']);
      assert.equal(paths.length, 3); assert.equal(records.length, 3);
    }, { wrongBody: true });
  });
  for (const shell of ['zh-CN', 'en']) test(`all editorial siblings preserve ${shell} shell, cookie and real account row projection`, { skip: !documents }, async () => {
    await fixture(async ({ page, navigate, paths }) => {
      const passed = [], records = [];
      await documents.verifyEditorialDocumentFamily({ page, navigate, locale: shell,
        readAccountIdentity: async () => true,
        readPreference: async () => ({ preference: shell, generation: 37, provenance: 'device_explicit' }),
        readAccountPreference: async () => ({ locale_preference: 'en', revision: 1 }),
        observe: (value, name) => { assert.ok(value, name); passed.push(name); },
        assertUnchanged: (actual, expected, name) => { assert.deepEqual(actual, expected, name); passed.push(name); },
        record: record => records.push(record) });
      assert.deepEqual(paths, ['/guides/index/?lang=en', '/guides/index/?lang=zh-CN', '/guides/ar-ai-xr-glasses-difference/?lang=en']);
      assert.deepEqual(records.map(record => record.documentRenderedLanguage), ['en', 'zh-CN', 'zh-CN']);
      assert.ok(passed.includes('REVIEWED_ENGLISH_DOCUMENT')); assert.ok(passed.includes('REVIEWED_CHINESE_DOCUMENT'));
      assert.ok(passed.includes('ORIGINAL_DOCUMENT_FALLBACK_ALLOWED'));
      assert.ok(passed.includes('DOCUMENT_LANG_DOES_NOT_MUTATE_ACCOUNT_PREFERENCE'));
      assert.ok(records.every(record => record.globalLocaleBefore === shell && record.globalLocaleAfter === shell));
    }, { shell });
  });
  for (const variant of ['wrongBody', 'rawWrongLanguage', 'renderedWrongLanguage']) test(`observer rejects ${variant} rather than passing on a matching h1`, { skip: !documents }, async () => {
    await fixture(async ({ page, navigate }) => {
      await assert.rejects(documents.verifyEditorialDocumentFamily({ page, navigate, locale: 'zh-CN',
        readAccountIdentity: async () => true,
        readPreference: async () => ({ preference: 'zh-CN' }), readAccountPreference: async () => ({ locale_preference: 'en', revision: 1 }),
        observe: assert.ok, assertUnchanged: assert.deepEqual }), /REVIEWED_ENGLISH_DOCUMENT/);
    }, { [variant]: true });
  });
  for (const target of ['cookie', 'account']) test(`document ${target} mutation fails before a sibling request`, { skip: !documents }, async () => {
    await fixture(async ({ page, navigate, paths }) => {
      let cookieReads = 0, accountReads = 0;
      await assert.rejects(documents.verifyEditorialDocumentFamily({ page, navigate, locale: 'zh-CN',
        readAccountIdentity: async () => true,
        readPreference: async () => ({ preference: target === 'cookie' && ++cookieReads > 1 ? 'en' : 'zh-CN' }),
        readAccountPreference: async () => ({ locale_preference: 'en', revision: target === 'account' && ++accountReads > 1 ? 2 : 1 }),
        observe: assert.ok, assertUnchanged: assert.deepEqual }), /DOCUMENT_LANG_DOES_NOT_MUTATE/);
      assert.equal(paths.length, 1);
    });
  });
  for (const defect of ['absentRow', 'wrongActor']) test(`document account baseline rejects ${defect} before navigation`, { skip: !documents }, async () => {
    await fixture(async ({ page, navigate, paths }) => {
      await assert.rejects(documents.verifyEditorialDocumentFamily({ page, navigate, locale: 'zh-CN',
        readAccountIdentity: async () => defect !== 'wrongActor',
        readPreference: async () => ({ preference: 'zh-CN' }),
        readAccountPreference: async () => defect === 'absentRow' ? null : ({ locale_preference: 'en', revision: 1 }),
        observe: assert.ok, assertUnchanged: assert.deepEqual }), /DOCUMENT_ACCOUNT_(IDENTITY|BASELINE)/);
      assert.equal(paths.length, 0);
    });
  });
  test('fatal document identity goes through the formal assertion ledger before navigation', { skip: !documents }, async () => {
    await fixture(async ({ page, navigate, paths }) => {
      const ledger={total:0,passed:0,failures:[]};
      await assert.rejects(documents.verifyEditorialDocumentFamily({page,navigate,locale:'zh-CN',
        readAccountIdentity:async()=>false,readPreference:async()=>({preference:'zh-CN'}),
        readAccountPreference:async()=>({locale_preference:'en',revision:1}),observe:assert.ok,assertUnchanged:assert.deepEqual,
        assertIdentity:(value,name)=>{ledger.total++;if(!value)ledger.failures.push(name);assert.ok(value,name);ledger.passed++;}
      }),/DOCUMENT_ACCOUNT_IDENTITY/);
      assert.deepEqual(ledger,{total:1,passed:0,failures:['DOCUMENT_ACCOUNT_IDENTITY']});
      assert.equal(paths.length,0);
    });
  });
}
