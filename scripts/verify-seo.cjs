const fs = require('fs');
const path = require('path');
const { resolveSiteOrigin } = require('../src/lib/site-origin.ts');

const args = process.argv.slice(2);
function readOption(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

const rootDir = path.join(__dirname, '..');
const distDir = path.resolve(rootDir, readOption('--dist', 'dist'));
const buildDir = fs.existsSync(path.join(distDir, 'client'))
  ? path.join(distDir, 'client')
  : distDir;
const expectedSiteOrigin = resolveSiteOrigin(process.env.SITE_ORIGIN);
const redirects = fs.existsSync(path.join(buildDir, '_redirects'))
  ? fs.readFileSync(path.join(buildDir, '_redirects'), 'utf8')
  : '';

function walk(dir) {
  const out = [];
  try {
    fs.readdirSync(dir).forEach(f => {
      const fp = path.join(dir, f);
      if (fs.statSync(fp).isDirectory()) out.push(...walk(fp));
      else if (fp.endsWith('.html')) out.push(fp);
    });
  } catch (e) {}
  return out;
}

const files = walk(buildDir);
let pass = 0, fail = 0;

function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, detail ? '(' + detail + ')' : ''); }
}

// Combine all HTML
const allHtml = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const indexFile = path.join(buildDir, 'index.html');
const indexHtml = fs.existsSync(indexFile)
  ? fs.readFileSync(indexFile, 'utf8')
  : allHtml;

console.log('\n=== 1. SITE URL ===');
check('HTML uses the configured site origin', allHtml.includes(expectedSiteOrigin));
check('no openglass.gaze.dev references', !allHtml.includes('openglass.gaze.dev'));

console.log('\n=== 2. CANONICAL URLs ===');
const canonicalHrefs = [...allHtml.matchAll(/<link\b[^>]*\brel=["']canonical["'][^>]*>/gi)]
  .map(match => match[0].match(/\bhref=["']([^"']+)["']/i)?.[1])
  .filter(Boolean);
const canonicalOrigins = canonicalHrefs.map((href) => {
  try { return new URL(href).origin; } catch { return 'INVALID'; }
});
check('canonical tags exist', canonicalHrefs.length > 0, canonicalHrefs.length + ' found');
check(
  'canonical URLs use one configured site origin',
  canonicalOrigins.length > 0 && canonicalOrigins.every(origin => origin === expectedSiteOrigin),
  [...new Set(canonicalOrigins)].join(', '),
);

console.log('\n=== 3. SITEMAP ===');
const sitemapExists = fs.existsSync(path.join(buildDir, 'sitemap-index.xml'));
check('sitemap-index.xml exists', sitemapExists);
const robotsPath = path.join(buildDir, 'robots.txt');
const robotsTxt = fs.existsSync(robotsPath) ? fs.readFileSync(robotsPath, 'utf8') : '';
const robotsOrigins = [...robotsTxt.matchAll(/^Sitemap:\s+(\S+)$/gmi)].map((match) => {
  try { return new URL(match[1]).origin; } catch { return 'INVALID'; }
});
check(
  'robots.txt Sitemap URLs use one configured site origin',
  robotsOrigins.length > 0 && robotsOrigins.every(origin => origin === expectedSiteOrigin),
  [...new Set(robotsOrigins)].join(', '),
);
const sitemapFiles = [];
(function collectSitemaps(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectSitemaps(entryPath);
    else if (/^sitemap.*\.xml$/i.test(entry.name)) sitemapFiles.push(entryPath);
  }
})(buildDir);
const sitemapOrigins = sitemapFiles.flatMap((file) => (
  [...fs.readFileSync(file, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => {
    try { return new URL(match[1]).origin; } catch { return 'INVALID'; }
  })
));
check(
  'sitemap XML locations use one configured site origin',
  sitemapOrigins.length > 0 && sitemapOrigins.every(origin => origin === expectedSiteOrigin),
  [...new Set(sitemapOrigins)].join(', '),
);

console.log('\n=== 4. FAVICON ===');
check('no /favicon.svg in HTML', !allHtml.includes('/favicon.svg'));
check('gaze-icon-v6.ico referenced', allHtml.includes('gaze-icon-v6.ico'));
check('gaze-icon-v6.svg referenced', allHtml.includes('gaze-icon-v6.svg'));
check('apple-touch-icon-v6 referenced', allHtml.includes('apple-touch-icon-v6'));

console.log('\n=== 5. LANGUAGE ===');
const langMatch = indexHtml.match(/lang="([^"]+)"/);
check('html lang attribute exists', !!langMatch, langMatch ? langMatch[1] : 'none');
check('lang is zh-CN', langMatch && langMatch[1] === 'zh-CN', langMatch ? langMatch[1] : '');

console.log('\n=== 6. METADATA ===');
const titles = allHtml.match(/<title>[^<]+<\/title>/g) || [];
check('title tags present', titles.length > 0, titles.length + ' pages');
const descs = allHtml.match(/name="description"/g) || [];
check('meta description present', descs.length > 0, descs.length + ' pages');

console.log('\n=== 7. OPEN GRAPH ===');
const ogTitle = allHtml.match(/property="og:title"/g) || [];
const ogDesc = allHtml.match(/property="og:description"/g) || [];
const ogUrlHrefs = [...allHtml.matchAll(/<meta\b[^>]*\bproperty=["']og:url["'][^>]*>/gi)]
  .map(match => match[0].match(/\bcontent=["']([^"']+)["']/i)?.[1])
  .filter(Boolean);
const ogUrlOrigins = ogUrlHrefs.map((href) => {
  try { return new URL(href).origin; } catch { return 'INVALID'; }
});
check('og:title tags', ogTitle.length > 0, ogTitle.length);
check('og:description tags', ogDesc.length > 0, ogDesc.length);
check('og:url tags', ogUrlHrefs.length > 0, ogUrlHrefs.length);
check(
  'Open Graph URLs use one configured site origin',
  ogUrlOrigins.length > 0 && ogUrlOrigins.every(origin => origin === expectedSiteOrigin),
  [...new Set(ogUrlOrigins)].join(', '),
);

console.log('\n=== 8. ROUTES ===');
const routes = [
  { route: '/devices/', source: 'devices/index.astro' },
  { route: '/guides/', source: 'guides/index.astro' },
  { route: '/developers/', source: 'developers/index.astro' },
  { route: '/gaze-os/', redirect: '/gaze-launcher/' },
  { route: '/community/', redirect: '/feed/' },
  { route: '/about/', source: 'about/index.astro' },
];
routes.forEach(({ route, source, redirect }) => {
  const staticExists = fs.existsSync(path.join(buildDir, route, 'index.html'));
  const sourceExists = source && fs.existsSync(path.join(__dirname, '..', 'src', 'pages', source));
  const redirectExists = redirect && redirects.split(/\r?\n/).some(line => {
    const [from, to] = line.trim().split(/\s+/);
    return from === route && to === redirect;
  });
  check('route ' + route + ' exists', staticExists || sourceExists || redirectExists);
});

console.log('\n=== 9. SEARCH (Pagefind) ===');
const pagefindDir = path.join(buildDir, 'pagefind');
const pagefindExists = fs.existsSync(pagefindDir);
check('Pagefind index generated', pagefindExists);
if (pagefindExists) {
  const pfFiles = fs.readdirSync(pagefindDir);
  check('Pagefind has index files', pfFiles.length > 0, pfFiles.length + ' files');
}

console.log('\n=== 10. BROKEN LINKS ===');
const placeholderHrefs = allHtml.match(/href="#"/g) || [];
check('no href="#" placeholders', placeholderHrefs.length === 0, placeholderHrefs.length + ' found');

// Check for fake discord/wechat links
const fakeDiscord = allHtml.match(/href="https:\/\/discord\.gg/g) || [];
check('no fake Discord invite links', fakeDiscord.length === 0);
const fakeWechat = allHtml.match(/href="https:\/\/weixin/g) || [];
check('no fake WeChat links', fakeWechat.length === 0);

console.log('\n=== 11. STRUCTURED DATA ===');
const ldJson = allHtml.match(/application\/ld\+json/g) || [];
const dynamicLdJson = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'posts', '[id].astro'), 'utf8')
  .includes('application/ld+json');
check('structured data (LD+JSON) present', ldJson.length > 0 || dynamicLdJson, ldJson.length + ' static blocks');

console.log('\n=== 12. 404 PAGE ===');
const has404 = fs.existsSync(path.join(buildDir, '404.html'));
check('404.html exists', has404);

console.log('\n' + '='.repeat(50));
console.log('TOTAL: ' + pass + ' PASS, ' + fail + ' FAIL, ' + files.length + ' HTML pages');
if (fail === 0) console.log('ALL CHECKS PASSED ✓');
else process.exitCode = 1;
