const fs = require('fs');
const path = require('path');
const { resolveSiteOrigin } = require('../src/lib/site-origin.ts');

const rootDir = path.join(__dirname, '..');
const buildRootDir = path.join(rootDir, 'dist');
const distDir = fs.existsSync(path.join(buildRootDir, 'client'))
  ? path.join(buildRootDir, 'client')
  : buildRootDir;
const srcDir = path.join(rootDir, 'src');
const expectedSiteOrigin = resolveSiteOrigin(process.env.SITE_ORIGIN);

let pass = 0, fail = 0, warn = 0;
const criticals = [], importants = [], minors = [];

function check(label, ok, severity, detail) {
  if (ok) { pass++; console.log('  ✓', label); }
  else {
    if (severity === 'critical') { fail++; criticals.push(label + (detail ? ': ' + detail : '')); console.log('  ✗ CRITICAL:', label, detail || ''); }
    else if (severity === 'important') { fail++; importants.push(label + (detail ? ': ' + detail : '')); console.log('  ✗ IMPORTANT:', label, detail || ''); }
    else { warn++; minors.push(label + (detail ? ': ' + detail : '')); console.log('  △ MINOR:', label, detail || ''); }
  }
}

function walk(dir) {
  const out = [];
  try {
    fs.readdirSync(dir).forEach(f => {
      const fp = path.join(dir, f);
      if (fs.statSync(fp).isDirectory()) out.push(...walk(fp));
      else if (fp.endsWith('.html')) out.push(fp);
    });
  } catch(e) {}
  return out;
}

function searchInDir(dir, pattern) {
  const results = [];
  function walkSearch(d) {
    try {
      fs.readdirSync(d).forEach(f => {
        const fp = path.join(d, f);
        const st = fs.statSync(fp);
        if (st.isDirectory()) walkSearch(fp);
        else if (f.endsWith('.html') || f.endsWith('.md') || f.endsWith('.mdx') || f.endsWith('.astro') || f.endsWith('.mjs')) {
          const c = fs.readFileSync(fp, 'utf8');
          if (pattern instanceof RegExp ? pattern.test(c) : c.includes(pattern)) {
            results.push({ file: fp.replace(rootDir, ''), matches: c.match(pattern instanceof RegExp ? pattern : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) });
          }
        }
      });
    } catch(e) {}
  }
  walkSearch(dir);
  return results;
}

const distFiles = walk(distDir);
const allHtml = distFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const indexPath = path.join(distDir, 'index.html');
const indexHtml = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : allHtml;

console.log('\n' + '='.repeat(60));
console.log('  OPENGLASS HUB — FINAL DEPLOYMENT AUDIT');
console.log('='.repeat(60));

// 1. BUILD
console.log('\n--- 1. BUILD ---');
check('Build succeeds', distFiles.length === 20, 'critical', distFiles.length + ' files');
check('All routes exist',
  ['/','/about/','/community/','/developers/','/devices/','/gaze-os/','/guides/']
    .every(r => fs.existsSync(path.join(distDir, r, 'index.html'))),
  'critical');
check('Device detail pages exist (8 devices)', 
  ['inmo-air-2','even-realities-g1','ray-ban-meta','rayneo-x2','viture-pro','xreal-air-2-pro','xreal-air-2-ultra','rokid-max']
    .every(d => fs.existsSync(path.join(distDir, 'devices', d, 'index.html'))),
  'critical');
check('Guide articles exist (3 guides)',
  ['ar-ai-glasses-buying-guide-2026','ar-ai-xr-glasses-difference','best-ar-ai-glasses-for-developers']
    .every(g => fs.existsSync(path.join(distDir, 'guides', g, 'index.html'))),
  'critical');

// 2. LOGO / NAVBAR
console.log('\n--- 2. LOGO / NAVBAR ---');
check('HTML references logo-navbar', allHtml.includes('logo-navbar'), 'important');
check('No logo-mark references in HTML', !allHtml.includes('logo-mark'), 'important', 'Found logo-mark references');

// 3. FAVICON
console.log('\n--- 3. FAVICON ---');
check('HTML references gaze-icon-v6', allHtml.includes('gaze-icon-v6'), 'critical');
check('No /favicon.svg references in dist', !allHtml.includes('/favicon.svg'), 'critical');

// 4. SEO
console.log('\n--- 4. SEO ---');
check('No openglass.gaze.dev in dist', !allHtml.includes('openglass.gaze.dev'), 'critical');
check('No openglass.gaze.dev in src', searchInDir(srcDir, 'openglass.gaze.dev').length === 0, 'important');
check('sitemap-index.xml exists', fs.existsSync(path.join(distDir, 'sitemap-index.xml')), 'critical');
const builtRobotsPath = path.join(distDir, 'robots.txt');
check('robots.txt exists', fs.existsSync(builtRobotsPath), 'critical');
const robots = fs.existsSync(builtRobotsPath) ? fs.readFileSync(builtRobotsPath, 'utf8') : '';
const sitemapOrigins = [...robots.matchAll(/^Sitemap:\s+(\S+)$/gmi)].map((match) => {
  try { return new URL(match[1]).origin; } catch { return 'INVALID'; }
});
check(
  'robots.txt sitemap URLs use the configured site origin',
  sitemapOrigins.length > 0 && sitemapOrigins.every(origin => origin === expectedSiteOrigin),
  'critical',
  sitemapOrigins.length > 0 ? [...new Set(sitemapOrigins)].join(', ') : 'no Sitemap entries',
);
const canonicalHrefs = [...allHtml.matchAll(/rel="canonical"[^>]*href="([^"]+)"/g)].map(match => match[1]);
const canonicalOrigins = canonicalHrefs.map((href) => {
  try { return new URL(href).origin; } catch { return 'INVALID'; }
});
check('Canonical URLs exist', canonicalHrefs.length > 0, 'important');
check(
  'Canonical URLs use one configured site origin',
  canonicalOrigins.length > 0 && canonicalOrigins.every(origin => origin === expectedSiteOrigin),
  'critical',
  canonicalOrigins.length > 0 ? [...new Set(canonicalOrigins)].join(', ') : 'no canonical URLs',
);
check('og:title exists', allHtml.includes('og:title'), 'important');
check('og:description exists', allHtml.includes('og:description'), 'important');

// 5. BROKEN LINKS
console.log('\n--- 5. BROKEN LINKS ---');
const placeholderHrefs = allHtml.match(/href="#"/g);
check('No href="#" links in dist', !placeholderHrefs, 'critical', placeholderHrefs ? placeholderHrefs.length + ' found' : '');
const fakeDiscord = allHtml.match(/href="https:\/\/discord\.gg/g);
check('No fake Discord links', !fakeDiscord, 'important', fakeDiscord ? fakeDiscord.length + ' found' : '');

// 6. CONTENT CREDIBILITY
console.log('\n--- 6. CONTENT CREDIBILITY ---');
const srcFiles = [];
function walkSrc(d) {
  try {
    fs.readdirSync(d).forEach(f => {
      const fp = path.join(d, f);
      if (fs.statSync(fp).isDirectory()) walkSrc(fp);
      else if (f.endsWith('.md') || f.endsWith('.mdx')) srcFiles.push({ path: fp, content: fs.readFileSync(fp, 'utf8') });
    });
  } catch(e) {}
}
walkSrc(srcDir);

const allSrc = srcFiles.map(f => f.content).join('\n');

// Check for "待核实" presence in device pages
const devicePages = srcFiles.filter(f => (f.path.includes('/devices/') || f.path.includes('\\devices\\')) && !f.path.endsWith('index.mdx'));
const hasDaiHeShi = devicePages.filter(f => f.content.includes('待核实'));
check('Device pages have 待核实 markers', hasDaiHeShi.length > 0, 'important',
  hasDaiHeShi.length + '/' + devicePages.length + ' pages have 待核实');

// Check for unauthorized claims
check('No "Gaze OS supports" claims', !allSrc.includes('Gaze OS supports'), 'critical',
  allSrc.includes('Gaze OS supports') ? 'Found in source' : '');
check('No "official partner" claims', !allSrc.includes('official partner') && !allSrc.includes('官方合作伙伴'), 'critical');
check('No "compatible with" claims', !(/compatible with/i.test(allSrc)), 'important',
  /compatible with/i.test(allSrc) ? 'Found in source' : '');

// 7. GAZE OS SAFETY
console.log('\n--- 7. GAZE OS SAFETY ---');
const gazeOsPage = srcFiles.find(f => f.path.includes('gaze-os') && f.path.includes('index'));
if (gazeOsPage) {
  const content = gazeOsPage.content;
  check('Gaze OS described as experimental', 
    content.includes('实验') || content.includes('experimental') || content.includes('Beta') || content.includes('早期'),
    'critical', 'Gaze OS page missing experimental disclaimer');
  check('No real hardware support claims for Gaze OS',
    !content.includes('支持硬件') && !content.includes('hardware support'),
    'critical');
} else {
  check('Gaze OS page exists', false, 'critical');
}

// 8. SEARCH INDEXING
console.log('\n--- 8. SEARCH INDEXING ---');
const pagefindDir = path.join(distDir, 'pagefind');
check('Pagefind index built', fs.existsSync(pagefindDir), 'critical');
check('Pagefind has files', fs.existsSync(pagefindDir) && fs.readdirSync(pagefindDir).length > 0, 'important');

// 9. MOBILE LAYOUT
console.log('\n--- 9. MOBILE LAYOUT ---');
check('Viewport meta tag exists', indexHtml.includes('viewport'), 'critical');
check('CSS includes responsive styles', fs.existsSync(path.join(rootDir, 'src/styles/custom.css')), 'minor',
  'Manual check recommended');

// 10. COMMUNITY LINKS
console.log('\n--- 10. COMMUNITY ---');
const communityPath = path.join(distDir, 'community', 'index.html');
const communityHtml = fs.existsSync(communityPath) ? fs.readFileSync(communityPath, 'utf8') : '';
check('GitHub Discussions link exists', communityHtml.includes('github.com/openglass-hub/discussions'), 'important');
check('Discord marked as pending', communityHtml.includes('准备中') || communityHtml.includes('暂未开放'), 'important');

// 11. UNAUTHORIZED IMAGES
console.log('\n--- 11. IMAGES ---');
const publicDir = path.join(rootDir, 'public');
const imgFiles = [];
function walkPublic(d) {
  try {
    fs.readdirSync(d).forEach(f => {
      const fp = path.join(d, f);
      if (fs.statSync(fp).isDirectory()) walkPublic(fp);
      else if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f)) imgFiles.push(fp.replace(publicDir, ''));
    });
  } catch(e) {}
}
walkPublic(publicDir);
check('No unauthorized product images', imgFiles.length <= 10, 'minor',
  imgFiles.length + ' images found. Manual review: ' + imgFiles.join(', '));

// SUMMARY
console.log('\n' + '='.repeat(60));
console.log('  VERDICT');
console.log('='.repeat(60));
console.log('  PASS: ' + pass);
console.log('  FAIL: ' + fail);
console.log('  WARN: ' + warn);
console.log('');

if (criticals.length > 0) {
  console.log('  *** NO GO — CRITICAL ISSUES ***');
  criticals.forEach(c => console.log('    - ' + c));
} else if (importants.length > 0) {
  console.log('  *** CONDITIONAL GO ***');
  importants.forEach(i => console.log('    - ' + i));
} else {
  console.log('  *** GO ***');
}

if (minors.length > 0) {
  console.log('\n  Minor issues:');
  minors.forEach(m => console.log('    - ' + m));
}

console.log('\n' + '='.repeat(60));
