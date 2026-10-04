import assert from 'node:assert/strict';
import { randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import { createServer, request as httpRequest } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadLocaleV2AppLogic } from './lib/locale-v2-app-logic.mjs';
import { loadLocaleOwnership, fingerprintLocaleSource } from './qa/lib/global-locale-owned-source-v2.mjs';
import { proveQuickSearchBrowser } from './lib/catalog-quick-search-browser.mjs';
import { findBrowserClientFactory } from './lib/locale-v2-logout-observer.mjs';
import { acceptLocaleLogout } from './lib/locale-v2-logout-settlement.mjs';
import { withOwnedLocaleContext, checkLocalAuthHeaders, disposeLocaleResources } from './lib/locale-v2-request-lifecycle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const localeContexts = Object.freeze([{engine:'chromium',width:1280,locale:'zh-CN'},{engine:'chromium',width:1280,locale:'en'},{engine:'chromium',width:390,locale:'zh-CN'},{engine:'chromium',width:390,locale:'en'},{engine:'firefox',width:1280,locale:'en'}]);
export async function readFrozenLocaleSource() {
  const identity = await fingerprintLocaleSource(loadLocaleOwnership(root), {root});
  assert.equal(identity.fileHashes.length, 218, 'FROZEN_218_OWNERS');
  assert.equal(identity.ownershipVersion, 2, 'FROZEN_OWNERSHIP_VERSION');
  assert.equal(identity.algorithmVersion, 'locale-owned-content-sha256-v1', 'FROZEN_ALGORITHM');
  assert.equal(identity.contractSha256, 'b1197a474d948815ae34a3f66bfaba175b68d786e3f7b249d1ea4e4928442be5', 'FROZEN_CONTRACT');
  assert.equal(identity.fingerprint, 'fe20282f90c1e2615fbe9878b5e4e22f78897332fdb2e9047926619b061cf2d8', 'FROZEN_SOURCE');
  return identity;
}

export async function runLocaleV2Acceptance() {
const { preparePreferenceRunEnvironment } = await import('./test-user-preferences-rls-local.mjs');
const { prepareCanonicalCatalogImport } = await import('./lib/catalog-canonical-import.mjs');
const { assertLocalReplayTarget, runCommand, runLocalDisposableReplay, withCanonicalBaselineDirectory } = await import('./qa/local-disposable-supabase-replay.mjs');
const runId = randomUUID(), directory = path.join(root, 'artifacts/qa/global-locale-settings-v2-acceptance', runId);
const receipt = { schemaVersion: 2, runId, timestamp: new Date().toISOString(), status: 'BLOCKED',
  candidateCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  assertions: [], assertionProvenance: [], behaviors: {}, behaviorProvenance: {}, browserContexts: [], productionRequests: 0, externalRequests: 0,
  maxRetries: 0, reusedEvidence: [], reuseDecision: 'B_EXISTING_V1_MODEL_CANNOT_COMPOSE_PARTIAL_EVIDENCE',
  localAccounts: { genuineAuth: false, genuineRls: false }, cleanup: 'NOT_RUN', stage: 'SOURCE_FREEZE' };
let boundary = 'SOURCE_FREEZE';
let appLogic;
const check = (condition, name) => { boundary = name; assert.ok(condition, name); receipt.assertions.push(name); receipt.assertionProvenance.push({name, origin: 'FRESH_THIS_RUN', runId, contextId:receipt.browserContexts.at(-1)?.contextId ?? null}); };
const pass = name => { receipt.behaviors[name] = 'PASS'; receipt.behaviorProvenance[name] = {origin: 'FRESH_THIS_RUN',runId}; };
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const allowed = ['PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','HOME','COMSPEC'];
const environment = preparePreferenceRunEnvironment(Object.fromEntries(allowed.filter(k => process.env[k]).map(k => [k, process.env[k]])));
for (const key of ['SystemDrive', 'ProgramData']) if (process.env[key]) environment[key] = process.env[key];
Object.assign(environment, { WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false', ASTRO_TELEMETRY_DISABLED: '1', ASTRO_DISABLE_UPDATE_CHECK: 'true' });
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, environment);

async function runtime({ target, anonKey, accounts, request }) {
  const { buildDetailParameterGroups, detailSpecColumns, catalogLabel } = appLogic;
  const { chromium, firefox, request: apiRequest } = await import('playwright');
  const { unstable_startWorker } = await import('wrangler');
  let worker, gateway, reserved, ownedRoot, timer, upstream, fault = null;
  const browsers = [], contexts = new Set();
  const cookieName = 'ogh_preferences_v1';
  try {
    ownedRoot = await mkdtemp(path.join(tmpdir(), 'ogh-locale-v2-'));
    reserved = createServer();
    await new Promise(resolve => reserved.listen(0, '127.0.0.1', resolve));
    const origin = `https://127.0.0.1:${reserved.address().port}`;
    const key = path.join(ownedRoot, 'key.pem'), cert = path.join(ownedRoot, 'cert.pem');
    execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','1','-keyout',key,'-out',cert,'-subj','/CN=Owned Locale V2 Test','-addext','subjectAltName=IP:127.0.0.1'], { env: environment, stdio: 'pipe', windowsHide: true });
    const certificate = await readFile(cert); check(new X509Certificate(certificate).checkIP('127.0.0.1') === '127.0.0.1', 'OWNED_TLS_CERTIFICATE');
    const vars = { SITE_ORIGIN: origin, SUPABASE_URL: origin, PUBLIC_SUPABASE_URL: origin, SUPABASE_ANON_KEY: anonKey, PUBLIC_SUPABASE_ANON_KEY: anonKey, AUTH_CAPTCHA_MODE: 'off' };
    const config = path.join(ownedRoot, 'local-worker-config.json');
    await writeFile(config, JSON.stringify({ name: 'openglasshub', compatibility_date: '2026-05-17', compatibility_flags: ['nodejs_compat'], vars }));
    receipt.stage = boundary = 'LOCAL_WORKER_BUILD';
    const built = spawnSync(process.execPath, ['scripts/build-workers.mjs','--local-config',config], { cwd: root, env: environment, encoding: 'utf8', windowsHide: true, maxBuffer: 16777216, timeout: 120000 });
    check(built.status === 0, 'LOCAL_WORKER_BUILD');
    worker = await unstable_startWorker({ config: path.join(root,'dist/server/wrangler.json'), envFiles: [], build: { bundle: false },
      bindings: Object.fromEntries(Object.entries(vars).map(([name,value]) => [name,{type:'plain_text',value}])),
      dev: { remote: false, watch: false, liveReload: false, registry: undefined, persist: false, inspector: false, logLevel: 'none',
        server: { hostname: '127.0.0.1', port: 0, secure: true, httpsKeyPath: key, httpsCertPath: cert },
        async outboundService(req) {
          const url = new URL(req.url);
          if (url.origin !== origin || !/^\/(auth|rest)\/v1\//.test(url.pathname)) { receipt.externalRequests++; return new Response('LOCAL_OUTBOUND_DENIED',{status:599}); }
          if (fault && url.pathname === '/rest/v1/user_preferences' && (fault === 'read' && req.method === 'GET' || fault === 'write' && req.method !== 'GET')) return new Response('{"message":"Owned outage"}', { status: 503, headers: { 'content-type': 'application/json' } });
          const local = new URL(url.pathname + url.search, target); assertLocalReplayTarget(local.href);
          return fetch(local, { method: req.method, headers: req.headers, redirect: 'error', signal: AbortSignal.timeout(10000), ...(['GET','HEAD'].includes(req.method) ? {} : { body: await req.arrayBuffer() }) });
        } } });
    await Promise.race([Promise.all([worker.ready,new Promise((resolve,reject) => { worker.raw.once('reloadComplete',resolve);worker.raw.once('error',() => reject(new Error('LOCAL_WORKER_STARTUP')));worker.raw.once('runtimeError',() => reject(new Error('LOCAL_WORKER_RUNTIME'))); })]),new Promise((_,reject) => { timer=setTimeout(() => reject(new Error('LOCAL_WORKER_READY_TIMEOUT')),30000); })]);
    clearTimeout(timer); upstream = (await worker.url).origin;
    gateway = createHttpsServer({ key: await readFile(key), cert: certificate }, (incoming,outgoing) => {
      const url = new URL(incoming.url, origin), provider = /^\/(auth|rest)\/v1\//.test(url.pathname);
      const destination = new URL(url.pathname + url.search, provider ? target : upstream);
      assertLocalReplayTarget(destination.href);
      const headers = { ...incoming.headers, host: provider ? destination.host : new URL(origin).host };
      const transportEvent = (event, detail = {}) => { if(url.pathname==='/auth/v1/logout') (receipt.logoutTransport??=[]).push({event,timestamp:new Date().toISOString(),...detail}); };
      transportEvent('FRONT_DOOR_LOGOUT_STARTED');
      outgoing.once('finish',()=>transportEvent('FRONT_DOOR_RESPONSE_FINISHED',{status:outgoing.statusCode}));
      const proxy = (provider ? httpRequest : httpsRequest)(destination, { method: incoming.method, headers, ...(provider ? {} : {ca:certificate,rejectUnauthorized:true}) }, response => {
        transportEvent('AUTH_UPSTREAM_RESPONSE',{status:response.statusCode});
        response.once('end',()=>transportEvent('AUTH_UPSTREAM_RESPONSE_FINISHED',{status:response.statusCode}));
        const responseHeaders = Object.fromEntries(Object.entries(response.headers).filter(([name]) => !['connection','transfer-encoding','keep-alive'].includes(name)));
        outgoing.writeHead(response.statusCode, responseHeaders); response.pipe(outgoing);
      });
      proxy.on('error', () => { if(!outgoing.headersSent)outgoing.writeHead(599);outgoing.end(); });
      proxy.setTimeout(15000, () => proxy.destroy()); incoming.once('aborted',() => proxy.destroy());incoming.pipe(proxy);
    });
    await new Promise(resolve => reserved.close(resolve)); reserved = null;
    await new Promise(resolve => gateway.listen(Number(new URL(origin).port),'127.0.0.1',resolve));
    const logout = async (page, actor) => {
      boundary=receipt.stage='LOGOUT_FINAL_DOCUMENT_SETTLEMENT';
      const record = {};
      const transportStart = receipt.logoutTransport?.length ?? 0;
      (receipt.logouts??=[]).push(record);
      await acceptLocaleLogout({page,context:page.context(),factory:await findBrowserClientFactory(root),expectedActor:actor.id,authKey:'sb-127-auth-token',record,transport:()=>receipt.logoutTransport?.slice(transportStart) ?? []});
    };
    const engines = {};
    for (const [name, engine] of Object.entries({ chromium, firefox })) { engines[name] = await engine.launch({headless:true}); browsers.push(engines[name]); }
    const preference = async context => { const cookie=(await context.cookies()).find(c=>c.name===cookieName);return cookie ? JSON.parse(decodeURIComponent(cookie.value)) : null; };
    const setCookie = async(context,locale) => context.addCookies([{name:cookieName,value:encodeURIComponent(JSON.stringify({version:1,preference:locale,generation:1,provenance:'device_explicit'})),url:origin,secure:true,sameSite:'Lax'}]);
    const settled = async page => { await page.waitForFunction(() => [...document.querySelectorAll('astro-island')].every(i=>!i.hasAttribute('ssr'))); };
    const navigate = async(page,route,locale) => {
      boundary = receipt.stage = `SSR_${route}`;
      const response=await page.goto(origin+route,{waitUntil:'load'});await settled(page);
      const html=await response.text();
      check(await page.evaluate(markup=>new DOMParser().parseFromString(markup,'text/html').documentElement.lang,html)===locale,`SSR_HTML_LOCALE_${route}_${locale}`);
      check(await page.locator('html').getAttribute('lang')===locale,`HTML_LOCALE_${route}_${locale}`);
      check(/private/.test(response.headers()['cache-control'])&&/no-store/.test(response.headers()['cache-control']),`PRIVATE_NO_STORE_${route}`);
      (receipt.routes??=[]).push({contextId:receipt.browserContexts.at(-1).contextId,route,locale,status:response.status(),cacheControl:response.headers()['cache-control']});
      return response;
    };
    const api = async(context,account,method='GET',body) => context.request.fetch(origin+'/api/users/me/preferences',{method,headers:{...(account?{authorization:`Bearer ${account.token}`} : {}),origin,'content-type':'application/json'},...(body?{data:body}:{})});
    const authKey='sb-127-auth-token';
    const adopt = async(page,context,actor) => {
      boundary=receipt.stage=actor===accounts.a?'ACCOUNT_A_ADOPTION':'ACCOUNT_B_ADOPTION';
      const login=await request('/auth/v1/token?grant_type=password',null,'POST',{email:actor.email,password:actor.password});
      check(login.status===200,'FRESH_GENUINE_LOCAL_RELOGIN');actor.session=await login.json();actor.token=actor.session.access_token;
      const identity=await request('/auth/v1/user',actor.token);check(identity.status===200&&(await identity.json()).id===actor.id,'FRESH_RELOGIN_ACTOR_IDENTITY');
      await page.goto(origin+'/robots.txt',{waitUntil:'load'});
      await context.clearCookies();
      await page.evaluate(({key,session})=>{localStorage.clear();localStorage.setItem(key,JSON.stringify(session));},{key:authKey,session:actor.session});
      let documents=0;
      const accountReload=page.waitForEvent('framenavigated',{predicate:frame=>frame===page.mainFrame()&&new URL(frame.url()).pathname==='/settings/'&&++documents===2});
      await page.goto(origin+'/settings/',{waitUntil:'load'});
      await accountReload;await page.waitForLoadState('load');await settled(page);
      await page.locator('.locale-settings a[href="/me/"]').waitFor();
      boundary=receipt.stage=actor===accounts.a?'ACCOUNT_A_ADOPTION_COOKIE':'ACCOUNT_B_ADOPTION_COOKIE';
      check((await preference(context))?.provenance==='account_adopted','ACCOUNT_ADOPTION_COOKIE_SETTLED');
    };
    const select = async(page,locale,signedIn=false) => {
      const saved = signedIn ? page.waitForResponse(r=>new URL(r.url()).pathname==='/api/users/me/preferences'&&r.request().method()==='PATCH') : null;
      await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('.locale-settings select').selectOption(locale)]);
      if(saved)check((await saved).status()===200,`ACTUAL_ACCOUNT_SAVE_${locale}`);
      await page.waitForFunction(want=>document.documentElement.lang===want,locale);await settled(page);
    };
    const factual = new Map();
    for(const [index,fixture] of localeContexts.entries()) {
      receipt.stage=boundary=`CONTEXT_${index+1}`;console.log(`LOCALE_V2_CONTEXT=${index+1}_OF_5`);
      const ledger = {number:index+1,contextId: randomUUID(),...fixture,status:'RUNNING',startedAt:new Date().toISOString()};receipt.browserContexts.push(ledger);
      const context=await engines[fixture.engine].newContext({viewport:{width:fixture.width,height:900},locale:fixture.locale,serviceWorkers:'block',ignoreHTTPSErrors:true});
      await withOwnedLocaleContext({ context, activeContexts: contexts, acceptance: async () => {
      await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();receipt.externalRequests++;return route.abort();});
      await context.routeWebSocket('**/*',socket=>{const url=new URL(socket.url());if(url.hostname==='127.0.0.1'&&url.port===new URL(origin).port)receipt.blockedOwnedRealtime=(receipt.blockedOwnedRealtime??0)+1;else receipt.externalRequests++;socket.close();});
      const page=await context.newPage();page.setDefaultTimeout(12000);
      page.on('response',response=>{if(new URL(response.url()).pathname==='/api/users/me/preferences'){
        (receipt.preferenceResponses??=[]).push({stage:receipt.stage,method:response.request().method(),status:response.status()});
      }});
      page.on('requestfailed',req=>{if(new URL(req.url()).pathname==='/api/users/me/preferences'){
        (receipt.preferenceFailures??=[]).push({stage:receipt.stage,method:req.method(),category:'REQUEST_FAILED'});
      }});
      if(index===0) {
        await navigate(page,'/settings/',fixture.locale);await select(page,'en');
        await select(page,'zh-CN');await navigate(page,'/products/','zh-CN');await page.reload();await settled(page);
        check((await preference(context)).preference==='zh-CN','ANON_ZH_COOKIE_RELOAD');
        await navigate(page,'/settings/','zh-CN');await select(page,'en');await page.reload();await settled(page);
        check((await preference(context)).preference==='en','ANON_EN_COOKIE_RELOAD');
        check(await page.evaluate(()=>localStorage.length===0),'NO_LOCAL_STORAGE_LOCALE_MIRROR');pass('ANON_COOKIE_PERSISTENCE');
        await adopt(page,context,accounts.a);await select(page,'zh-CN',true);await page.reload();await settled(page);
        check(await page.locator('.locale-settings select').inputValue()==='zh-CN','ACCOUNT_A_RELOAD');pass('ACCOUNT_A_PERSISTENCE');
        await logout(page,accounts.a);check((await preference(context)).preference==='zh-CN','DEVICE_EXPLICIT_LOGOUT_PRESERVED');
        await adopt(page,context,accounts.b);
        check(await page.locator('.locale-settings select').inputValue()==='en','B_NO_A_PRIVATE_PREFERENCE');
        await select(page,'en',true);await page.reload();await settled(page);check(await page.locator('.locale-settings select').inputValue()==='en','ACCOUNT_B_RELOAD');pass('ACCOUNT_B_PERSISTENCE');pass('CROSS_USER_ISOLATION');
        await logout(page,accounts.b);
        await adopt(page,context,accounts.a);check(await page.locator('.locale-settings select').inputValue()==='zh-CN','A_RELOGIN_OWN_ROW');pass('LOGOUT_RELOGIN');
        const before=(await (await api(context,accounts.a)).json()).preference;
        const conflict=await api(context,accounts.a,'PATCH',{locale_preference:'en',expected_revision:before.revision-1});check(conflict.status()===409,'REAL_REVISION_CONFLICT');
        check((await (await api(context,accounts.a)).json()).preference.locale_preference==='zh-CN','CONFLICT_ROW_NOT_CORRUPTED');pass('PREFERENCE_CONFLICT_HANDLING');
        for(const failure of ['read','write']) { fault=failure; const bad=await api(context,accounts.a,failure==='read'?'GET':'PATCH',failure==='write'?{locale_preference:'en',expected_revision:before.revision}:undefined);fault=null;check(bad.status()===503,`REAL_${failure.toUpperCase()}_OUTAGE_SAFE`);check(bad.headers()['cache-control']==='no-store','PREFERENCE_API_NO_STORE');pass(failure==='read'?'PREFERENCE_READ_FAILURE':'PREFERENCE_WRITE_FAILURE'); }
        check((await api(context,null,'PATCH',{locale_preference:'en',expected_revision:0})).status()===401,'ANON_API_WRITE_DENIED');pass('ANON_ACCOUNT_WRITE_DENY');
        const denied=await request(`/rest/v1/user_preferences?user_id=eq.${accounts.b.id}`,accounts.a.token,'PATCH',{locale_preference:'zh-CN'});check(denied.status===200&&(await denied.json()).length===0,'REAL_A_TO_B_RLS_DENIED');
        const bRow=await request(`/rest/v1/user_preferences?select=locale_preference&user_id=eq.${accounts.b.id}`,accounts.b.token);check((await bRow.json())[0].locale_preference==='en','B_ROW_UNCORRUPTED');receipt.localAccounts.genuineRls=true;pass('CROSS_ACCOUNT_WRITE_DENY');
        await logout(page,accounts.a);
      }
      await setCookie(context,fixture.locale);
      for(const route of ['/','/products/','/products/xreal/','/search/','/settings/']) await navigate(page,route,fixture.locale);
      await navigate(page,'/products/xreal/',fixture.locale);
      await page.locator('[data-product-slug="xreal-air"] a[href="/products/xreal/xreal-air/"]').first().click();await page.waitForURL('**/products/xreal/xreal-air/');await settled(page);
      for(const device of [{route:'/products/xreal/xreal-air/',name:'XREAL Air'},{route:'/products/meta/ray-ban-meta/',name:'Ray-Ban Meta'}]) {
        await navigate(page,device.route,fixture.locale);
        check((await page.locator('[data-product-detail] h1').textContent()).includes(device.name),'CATALOG_IDENTITY');
        const labels=await page.locator('[data-parameter-key] dt').allTextContents(),groups=await page.locator('[data-spec-group] h3').allTextContents();
        check(labels.length>0&&labels.every(x=>!/_|^[a-z]+\./.test(x)),'NO_RAW_PARAMETER_LABELS');check(groups.length>0&&groups.every(x=>!/_|^[a-z]+\./.test(x)),'NO_RAW_GROUP_LABELS');
        const slug=new URL(device.route,origin).pathname.split('/').filter(Boolean).at(-1);
        const projection=await request(`/rest/v1/public_device_detail_specs?select=${detailSpecColumns}&device_slug=eq.${slug}`);
        check(projection.status===200,'REAL_CATALOG_PRESENTATION_PROJECTION');const specs=await projection.json();
        const expectedGroups=buildDetailParameterGroups({normalizedCatalog:true,specGroups:[]},specs,fixture.locale);
        const expectedRows=expectedGroups.flatMap(group=>group.items);
        assert.deepEqual(labels,expectedRows.map(row=>row.label),'ALL_PARAMETER_LABELS_LOCALIZED');
        assert.deepEqual(groups,expectedGroups.map(group=>group.label),'ALL_GROUP_TITLES_LOCALIZED');
        check(specs.filter(row=>row.presentation?.publicDisplay!==false).every(row=>!catalogLabel(row.key,fixture.locale,row.presentation).missing),'NO_UNREVIEWED_UI_LABEL_FALLBACK');
        assert.deepEqual(await page.locator('[data-parameter-key] dd').allTextContents(),expectedRows.map(row=>row.displayValue),'LOCALIZED_VALUES_AND_UNITS');
        const fallbackCount=await page.locator('[data-translation-missing="true"]').count();
        check(fallbackCount===expectedRows.filter(row=>row.translationMissing).length,'DECLARED_ORIGINAL_PROSE_FALLBACK');
        receipt.translationFallbackCount=(receipt.translationFallbackCount??0)+fallbackCount;
        receipt.rawParameterKeyVisibleCount=0;receipt.rawGroupKeyVisibleCount=0;
        check(await page.locator('[data-spec-preview]').count()===1,'KEY_SPECS_PRESENT');
        const values=await page.locator('dd[data-factual-value]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-factual-value')));
        if(factual.has(device.route))assert.deepEqual(values,factual.get(device.route));else factual.set(device.route,values);
        check(values.length>0,'FACTS_UNCHANGED_BETWEEN_LOCALES');
        if(device.name==='XREAL Air')check(await page.locator('[data-parameter-key="basic.weight_g"] dd').textContent()==='79 g','WEIGHT_UNIT_AND_VALUE');
        await page.screenshot({path:path.join(directory,`${fixture.engine}-${fixture.width}-${fixture.locale}-${device.name==='XREAL Air'?'xreal':'meta'}.png`)});
      }
      const wrong=await context.request.get(origin+'/products/meta/xreal-air/',{maxRedirects:0});check(wrong.status()===301&&wrong.headers().location==='/products/xreal/xreal-air/','CANONICAL_301');
      const beforeLegacy=await preference(context);
      const legacy=await navigate(page,'/devices/xreal-air',fixture.locale);check(legacy.status()===200&&new URL(page.url()).pathname==='/products/xreal/xreal-air/','LEGACY_LOCALE_REDIRECT');
      assert.deepEqual(await preference(context),beforeLegacy,'LEGACY_REDIRECT_COOKIE_CONTINUITY');
      await navigate(page,'/settings/',fixture.locale);check(await page.locator('.locale-settings select').inputValue()===fixture.locale,'SETTINGS_CANONICAL_STATE');
      await navigate(page,'/search/',fixture.locale);
      const search=page.locator('.og-header__search .global-search-box');await search.locator('input[type="search"]').fill('xreal');
      await search.locator('[data-quick-group="devices"] a[href="/products/xreal/xreal-air/"]').first().waitFor();
      check(await search.locator('input[type="search"]').inputValue()==='xreal','SEARCH_QUERY_IDENTITY');
      check((await search.locator('[data-quick-group="devices"]').textContent()).includes(fixture.locale==='en'?'Devices':'设备'),'SEARCH_LOCALIZED_DEVICE_GROUP');
      if(index===1)receipt.assertions.push(...await proveQuickSearchBrowser(page,{}));
      const settingsEntry=page.locator('.og-header a[href="/settings/"]');
      check(await settingsEntry.count()===1&&await settingsEntry.getAttribute('aria-label')===(fixture.locale==='en'?'Settings':'设置'),'HEADER_SETTINGS_ENTRY');
      if(fixture.width===390){const toggle=page.locator('.og-header__menu-toggle');await toggle.click();check(await toggle.getAttribute('aria-expanded')==='true','MOBILE_HEADER_OPEN');await page.keyboard.press('Escape');check(await toggle.getAttribute('aria-expanded')==='false','MOBILE_HEADER_ESCAPE');}
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'LOCALE_NO_OVERFLOW');
      if(index<2) {
        const zh=fixture.locale==='zh-CN';
        const original=await request('/rest/v1/device_specs?select=id,value_number,value_boolean,value_text,value_json,presentation&order=id',accounts.admin.token);const facts=await original.json();
        await page.evaluate(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:authKey,session:accounts.admin.session});
        await navigate(page,'/admin/devices/',fixture.locale);
        await page.locator('.admin-news-card').filter({hasText:'XREAL Air'}).filter({hasNotText:'Air 2'}).first().click();
        const editor=page.locator('[data-catalog-spec-editor]');await editor.locator('[data-catalog-spec-id]').first().waitFor();
        check(await editor.locator('h3').textContent()===(zh?'产品参数':'Product specifications'),'ADMIN_SPEC_LOCALE');
        for(const label of zh?['中文名称','英文名称','中文分组名称','英文分组名称']:['Chinese label','English label','Chinese group title','English group title'])check(await editor.getByLabel(label,{exact:true}).count()===1,'ADMIN_BILINGUAL_LABEL_CONTROL');
        await editor.locator('[data-catalog-spec-id]').first().click();
        check((await editor.getByLabel(zh?'中文名称':'Chinese label',{exact:true}).inputValue()).length>0,'ADMIN_EXISTING_CHINESE_LABEL');
        check((await editor.getByLabel(zh?'英文名称':'English label',{exact:true}).inputValue()).length>0,'ADMIN_EXISTING_ENGLISH_LABEL');
        const media=page.locator('[data-catalog-media-editor]');check(await media.locator('h3').textContent()===(zh?'产品图片':'Product images'),'ADMIN_MEDIA_LOCALE');
        if(await media.locator('fieldset').count()===0)await media.getByRole('button',{name:zh?'选择图片':'Select image',exact:true}).click();
        check(await media.getByLabel(zh?'中文替代文本':'Chinese alt text',{exact:true}).count()>0&&await media.getByLabel(zh?'英文替代文本':'English alt text',{exact:true}).count()>0,'ADMIN_BILINGUAL_ALT_CONTROLS');
        const after=await request('/rest/v1/device_specs?select=id,value_number,value_boolean,value_text,value_json,presentation&order=id',accounts.admin.token);assert.deepEqual(await after.json(),facts);check(true,'ADMIN_LOCALE_NO_FACT_WRITES');
        pass(zh?'ADMIN_CATALOG_ZH_CN':'ADMIN_CATALOG_EN');pass('ADMIN_CATALOG_FACT_PARITY');
        receipt.adminIndependentLocaleState=false;
        await page.evaluate(()=>localStorage.clear());
        const beforeCookie=await preference(context);
        await navigate(page,'/guides/?lang=en',fixture.locale);check((await page.locator('h1').first().textContent()).includes('Guide'),'REVIEWED_ENGLISH_DOCUMENT');
        await navigate(page,'/guides/?lang=zh-CN',fixture.locale);assert.deepEqual(await preference(context),beforeCookie);check(true,'DOCUMENT_LANG_DOES_NOT_MUTATE_GLOBAL_COOKIE');
        await navigate(page,'/guides/ar-ai-xr-glasses-difference/?lang=en',fixture.locale);
        check(/\p{Script=Han}/u.test(await page.locator('h1').first().textContent()),'ORIGINAL_DOCUMENT_FALLBACK_ALLOWED');
        assert.deepEqual(await preference(context),beforeCookie,'ORIGINAL_FALLBACK_NO_GLOBAL_COOKIE_MUTATION');
        pass('DOCUMENT_LANG_SCOPE');pass('EDITORIAL_VARIANT_SELECTION');pass('GLOBAL_PREFERENCE_UNCHANGED_BY_DOCUMENT_LANG');
      }
      const missing=await navigate(page,'/404/',fixture.locale);check(missing.status()===404||missing.status()===200,'404_ROUTE_AVAILABLE');
      check(await page.locator('.not-found-page h1').textContent()===(fixture.locale==='en'?'Page not found':'页面未找到'),'404_BILINGUAL_COPY');
      ledger.status='PASS';ledger.finishedAt=new Date().toISOString();
      } });
    }
    boundary=receipt.stage='AUTH_REFERRER_POLICY_UNCHANGED';
    receipt.authHeaderChecks=await checkLocalAuthHeaders({ origin, createRequestContext: options => apiRequest.newContext(options) });
    for (const result of receipt.authHeaderChecks) check(result.referrerPolicy==='no-referrer','AUTH_REFERRER_POLICY_UNCHANGED');
    check(receipt.externalRequests===0,'ZERO_EXTERNAL_REQUESTS');
    for(const name of ['SSR_LOCALE_PROPAGATION','LEGACY_DEVICE_LOCALE_CONTINUITY','REDIRECT_LOCALE_CONTINUITY','LOCALE_404_BEHAVIOR','LOCALE_CACHE_POLICY','LOCALE_PRIVATE_RESPONSE_POLICY','CATALOG_ZH_CN','CATALOG_EN','CATALOG_FACT_PARITY','TRANSLATION_FALLBACK_POLICY','SEARCH_LOCALE','SEARCH_CANONICAL_DEVICE_LINKS','HEADER_LOCALE','SETTINGS_LOCALE','SEARCH_STALE_RESPONSE_GUARD'])pass(name);
  } catch(error) { receipt.firstFailure=boundary;const current=receipt.browserContexts.at(-1);if(current?.status==='RUNNING'){current.status='FAIL';current.firstFailure=boundary;}throw error; } finally {
    clearTimeout(timer);
    await disposeLocaleResources([
      ...[...contexts].map(context => async () => { contexts.delete(context); await context.close(); }),
      ...browsers.map(browser => () => browser.close()),
      async () => { if(gateway)await new Promise(resolve=>gateway.close(resolve)); },
      async () => { if(reserved)await new Promise(resolve=>reserved.close(resolve)); },
      async () => { if(worker)await worker.dispose(); },
      async () => { if(ownedRoot){assert.ok(path.dirname(ownedRoot)===tmpdir()&&path.basename(ownedRoot).startsWith('ogh-locale-v2-'),'OWNED_TLS_ROOT_CLEANUP');await rm(ownedRoot,{recursive:true,force:true});} },
    ]);
  }
}

try {
  ({ logic: appLogic } = await loadLocaleV2AppLogic());
  const { resolveLocale, selectEditorialVariant } = appLogic;
  await mkdir(directory,{recursive:true});
  receipt.source=await readFrozenLocaleSource();check(receipt.source.fileHashes.length===218,'FROZEN_218_OWNERS');
  const saved=p=>({version:1,preference:p,generation:1,provenance:'device_explicit'});
  for(const [input,locale,name] of [[{current:'en',saved:saved('zh-CN'),trustedCountry:'CN'},'en','CURRENT_WINS'],[{saved:saved('en'),trustedCountry:'CN'},'en','SAVED_WINS'],[{trustedCountry:'CN',acceptLanguage:'en'},'zh-CN','CN_MAPPING'],[{trustedCountry:'US',acceptLanguage:'zh'},'en','NON_CN_MAPPING'],[{acceptLanguage:'zh-CN'},'zh-CN','LANGUAGE_FALLBACK'],[{},'en','ENGLISH_FALLBACK'],[{current:'unsupported'},'en','INVALID_FALLBACK']])check(resolveLocale(input).locale===locale,name);
  check(!Object.keys(resolveLocale({trustedCountry:'CN'})).some(k=>/country|ip/i.test(k)),'NO_COUNTRY_IP_PERSISTED');
  for(const n of ['LOCALE_PRECEDENCE','COUNTRY_MAPPING','ACCEPT_LANGUAGE_FALLBACK','INVALID_LOCALE_FALLBACK','COUNTRY_IP_NOT_PERSISTED'])pass(n);
  check(selectEditorialVariant('guides/index','en').kind==='reviewed'&&selectEditorialVariant('not-reviewed','en').kind==='original','EDITORIAL_SUPPORTED_POLICY');
  const publication=JSON.parse(await readFile(path.join(root,'artifacts/qa/product-publication-cohort-v1/publication-contract.json'),'utf8'));
  const prepared=await prepareCanonicalCatalogImport({root,publication});let anonKey;
  const execute=async(command,args,options)=>{const result=await runCommand(command,args,options);if(args.includes('status')&&args.includes('json')){const status=JSON.parse(result.stdout);assertLocalReplayTarget(status.API_URL);anonKey=status.ANON_KEY??status.PUBLISHABLE_KEY;}return result;};
  receipt.stage=boundary='OWNED_DISPOSABLE_SUPABASE';
  await withCanonicalBaselineDirectory({root,environment},canonicalBaselineDirectory=>runLocalDisposableReplay({root,environment,execute,migrationLimit:50,canonicalBaselineDirectory,
    afterMigrationLedgerValidated:async({target,executeSql})=>{
      assertLocalReplayTarget(target);
      const request=async(route,token,method='GET',body)=>{const url=new URL(route,target);assertLocalReplayTarget(url.href);assert.equal(url.origin,new URL(target).origin);return fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{apikey:anonKey,authorization:`Bearer ${token??anonKey}`,'content-type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)})});};
      for(const name of ['20261004003349_public_device_detail_v1.sql','20261004014637_catalog_editor_presentation_v1.sql','20261001075335_user_preferences.sql'])await executeSql(await readFile(path.join(root,'supabase/migrations',name),'utf8'));
      await executeSql(prepared.sql);await executeSql(prepared.activationSql);await executeSql(prepared.hardeningSql);await executeSql("NOTIFY pgrst,'reload schema';");
      const actor=async(label)=>{const email=`local-locale-${label}-${randomBytes(6).toString('hex')}@example.invalid`,password=randomBytes(24).toString('base64url');const signup=await request('/auth/v1/signup',null,'POST',{email,password});check(signup.status===200,'LOCAL_SIGNUP');const row=await signup.json(),id=row.user?.id??row.id;assert.match(id,/^[a-f0-9-]{36}$/);await executeSql(`UPDATE auth.users SET email_confirmed_at=now() WHERE id=${q(id)}::uuid;`);const login=await request('/auth/v1/token?grant_type=password',null,'POST',{email,password});check(login.status===200,'LOCAL_PASSWORD_LOGIN');const session=await login.json();const user=await request('/auth/v1/user',session.access_token);check(user.status===200&&(await user.json()).id===id,'GENUINE_LOCAL_AUTH');return{id,token:session.access_token,session,email,password};};
      const accounts={a:await actor('a'),b:await actor('b'),admin:await actor('admin')};receipt.localAccounts.genuineAuth=true;
      await executeSql(`UPDATE public.profiles SET role='admin' WHERE id=${q(accounts.admin.id)}::uuid;INSERT INTO public.user_preferences(user_id,locale_preference) VALUES (${q(accounts.a.id)}::uuid,'en'),(${q(accounts.b.id)}::uuid,'en');`);
      await runtime({target,anonKey,accounts,request});return{status:'PASS'};
    }}));
  receipt.cleanup='PASS';
  const finalSource=await readFrozenLocaleSource();check(finalSource.fingerprint===receipt.source.fingerprint,'SOURCE_UNCHANGED_DURING_ACCEPTANCE');
  // Partial coverage must never become an accepted artifact.
  const required=['ADMIN_CATALOG_ZH_CN','ADMIN_CATALOG_EN','DOCUMENT_LANG_SCOPE','EDITORIAL_VARIANT_SELECTION','GLOBAL_PREFERENCE_UNCHANGED_BY_DOCUMENT_LANG'];
  check(required.every(name=>receipt.behaviors[name]==='PASS'),'REMAINING_BEHAVIOR_COVERAGE_REQUIRED');
  check(receipt.browserContexts.length===5&&receipt.browserContexts.every(context=>context.status==='PASS'),'FIVE_DISTINCT_CONTEXTS_REQUIRED');
  check(receipt.localAccounts.genuineAuth&&receipt.localAccounts.genuineRls,'GENUINE_AUTH_AND_RLS_REQUIRED');
  receipt.status='PASS';
} catch(error) {
  receipt.firstFailure??=boundary;receipt.errorClass=error?.constructor?.name??'Error';process.exitCode=1;
} finally {
  receipt.finishedAt=new Date().toISOString();
  await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'attempt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(`LOCALE_V2_LOCAL=${receipt.status}\nFIRST_FAIL=${receipt.firstFailure??'NONE'}\nRECEIPT=${path.join(directory,'attempt.json')}`);
}
return receipt;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length,2,'INVALID_INVOCATION');
  await runLocaleV2Acceptance();
}
