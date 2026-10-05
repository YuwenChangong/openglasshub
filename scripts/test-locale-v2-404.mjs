import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { observeNotFound, verifyNotFound } from './lib/locale-v2-404-copy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let worker, owned, externalRequests = 0;
const allow = ['PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','HOME','COMSPEC','SystemDrive','ProgramData','NODE_TEST_CONTEXT'];
const environment = Object.fromEntries(allow.filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(environment, { WRANGLER_SEND_METRICS:'false', WRANGLER_WRITE_LOGS:'false', CLOUDFLARE_CF_FETCH_ENABLED:'false', ASTRO_TELEMETRY_DISABLED:'1', ASTRO_DISABLE_UPDATE_CHECK:'true' });
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, environment);

async function modulesIn(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes:true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await modulesIn(file));
    else if (/\.(mjs|js)$/.test(file)) files.push(file);
  }
  return files;
}

before(async () => {
  owned = await mkdtemp(path.join(tmpdir(), 'ogh-404-proof-'));
  const vars = { SITE_ORIGIN:'https://127.0.0.1:54321', SUPABASE_URL:'http://127.0.0.1:54321', PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321', SUPABASE_ANON_KEY:'owned-404-placeholder', PUBLIC_SUPABASE_ANON_KEY:'owned-404-placeholder', AUTH_CAPTCHA_MODE:'off' };
  const configPath = path.join(owned, 'config.json');
  await writeFile(configPath, JSON.stringify({ name:'openglasshub', compatibility_date:'2026-05-17', compatibility_flags:['nodejs_compat'], vars }));
  const built = spawnSync(process.execPath, ['scripts/build-workers.mjs','--local-config',configPath], { cwd:root, env:environment, encoding:'utf8', windowsHide:true, timeout:120000, maxBuffer:16777216 });
  assert.equal(built.status, 0, 'LOCAL_404_BUILD');
  const { unstable_readConfig, unstable_getMiniflareWorkerOptions } = await import('wrangler');
  const { Miniflare, convertV4MiniflareOptions, MiniflareOptionsSchema } = await import('miniflare');
  const serverRoot = path.join(root, 'dist/server');
  const config = unstable_readConfig({ config:path.join(serverRoot,'wrangler.json') }, { hideWarnings:true });
  config.vars = vars;
  const options = unstable_getMiniflareWorkerOptions(config, undefined, { envFiles:[], overrides:{ enableContainers:false } });
  assert.equal(options.externalWorkers.length, 0, 'NO_EXTERNAL_WORKERS');
  const entry = path.resolve(serverRoot, config.main);
  const relative = path.relative(serverRoot, entry);
  assert.ok(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'OWNED_WORKER_ENTRY');
  const modules = (await modulesIn(serverRoot)).sort((a,b) => a===entry?-1:b===entry?1:a.localeCompare(b)).map(file => ({ type:'ESModule', path:file }));
  const localOptions = { ...options.workerOptions };
  delete localOptions.modulesRules;
  const converted = convertV4MiniflareOptions({ host:'127.0.0.1', port:0, cf:{}, workers:[{ ...localOptions, modules, modulesRoot:serverRoot,
    outboundService() { externalRequests++; return new Response('OWNED_404_OUTBOUND_DENIED', { status:599 }); },
  }] });
  MiniflareOptionsSchema.parse(converted);
  worker = new Miniflare(converted);
  const address = await worker.ready;
  assert.equal(address.hostname, '127.0.0.1', 'LOOPBACK_WORKER_ONLY');
}, { timeout:150000 });

after(async () => {
  await worker?.dispose();
  if (owned) {
    assert.equal(path.dirname(owned), tmpdir());
    assert.ok(path.basename(owned).startsWith('ogh-404-proof-'));
    await rm(owned, { recursive:true, force:true });
  }
});

for (const locale of ['zh-CN', 'en']) test(`404_${locale}_COPY_STATUS_AND_NO_REDIRECT`, { timeout:20000 }, async () => {
  const address = await worker.ready;
  const requestPath = '/__owned-locale-v2-missing-page__/';
  const response = await fetch(new URL(requestPath, address), { headers:{ 'accept-language':locale }, redirect:'manual', signal:AbortSignal.timeout(15000) });
  const dom = new JSDOM(await response.text());
  try {
    const actual = { status:response.status, location:response.headers.get('location'), ...observeNotFound(dom.window.document) };
    console.log(JSON.stringify({ requestPath, requestLocale:locale, observed:actual }));
    verifyNotFound(actual, locale, (condition,name) => assert.ok(condition,name));
    assert.equal(externalRequests, 0, 'ZERO_OUTBOUND_REQUESTS');
  } finally { dom.window.close(); }
});
