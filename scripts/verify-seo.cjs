const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const buildDir = fs.existsSync(path.join(distDir, 'client'))
  ? path.join(distDir, 'client')
  : distDir;
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
check('site uses openglasshub.pages.dev', allHtml.includes('openglasshub.pages.dev'));
check('no openglass.gaze.dev references', !allHtml.includes('openglass.gaze.dev'));

console.log('\n=== 2. CANONICAL URLs ===');
const canonicals = allHtml.match(/rel="canonical"[^>]*href="([^"]+)"/g) || [];
check('canonical tags exist', canonicals.length > 0, canonicals.length + ' found');
const badCanonicals = canonicals.filter(c => c.includes('openglass.gaze.dev'));
check('no old domain in canonicals', badCanonicals.length === 0, badCanonicals.length + ' bad');

console.log('\n=== 3. SITEMAP ===');
const sitemapExists = fs.existsSync(path.join(buildDir, 'sitemap-index.xml'));
check('sitemap-index.xml exists', sitemapExists);
const robotsTxt = fs.readFileSync(path.join(__dirname, '..', 'public', 'robots.txt'), 'utf8');
check('robots.txt points to correct sitemap', robotsTxt.includes('openglasshub.pages.dev/sitemap-index.xml'));

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
const ogUrl = allHtml.match(/property="og:url"/g) || [];
check('og:title tags', ogTitle.length > 0, ogTitle.length);
check('og:description tags', ogDesc.length > 0, ogDesc.length);
check('og:url tags', ogUrl.length > 0, ogUrl.length);

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
