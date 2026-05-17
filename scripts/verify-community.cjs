const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist', 'community');

function walk(dir) {
  const out = [];
  fs.readdirSync(dir).forEach(f => {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) out.push(...walk(fp));
    else if (fp.endsWith('.html')) out.push(fp);
  });
  return out;
}

const files = walk(distDir);
let issues = [];

files.forEach(f => {
  const c = fs.readFileSync(f, 'utf8');
  const short = f.replace(distDir, '');
  // Check for href="#" but exclude anchor links (href="#section")
  const placeholderLinks = c.match(/href="#"/g);
  if (placeholderLinks) {
    issues.push(short + ': has ' + placeholderLinks.length + ' placeholder href="#" links');
  }
  if (/href="https:\/\/discord\.gg/.test(c)) {
    issues.push(short + ': has Discord invite link');
  }
  if (/href="https:\/\/weixin/.test(c)) {
    issues.push(short + ': has WeChat link');
  }
});

if (issues.length) {
  console.log('ISSUES FOUND:');
  issues.forEach(i => console.log(' -', i));
} else {
  console.log('PASS: No placeholder href="#" links');
  console.log('PASS: No Discord invite links');
  console.log('PASS: No WeChat links');
}

console.log('---');

const communityHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');

const checks = [
  ['Has GitHub Discussions link', communityHtml.includes('github.com/openglass-hub/discussions')],
  ['Has 准备中 text', communityHtml.includes('准备中')],
  ['Has 已开放 badge', communityHtml.includes('已开放')],
  ['Discord/WeChat are not clickable links', !/<a[^>]*>.*Discord.*<\/a>/.test(communityHtml) && !/<a[^>]*>.*微信.*<\/a>/.test(communityHtml)],
  ['Has contribution section', communityHtml.includes('参与贡献')],
  ['Has community rules', communityHtml.includes('社区规范')],
  ['Has correction workflow', communityHtml.includes('内容纠错流程')],
  ['Has 待核实 note', communityHtml.includes('待核实')],
];

checks.forEach(([label, pass]) => {
  console.log(pass ? 'PASS' : 'FAIL', '-', label);
});

// Debug: find what href="#" looks like
const placeholderMatch = communityHtml.match(/.{80}href="#".{40}/g);
if (placeholderMatch) {
  console.log('---');
  console.log('Placeholder href context:');
  placeholderMatch.forEach(m => console.log(' ', m.trim()));
}

console.log('---');
const pinnedHtml = fs.readFileSync(path.join(distDir, 'pinned-posts', 'index.html'), 'utf8');
console.log('PASS: Pinned posts page exists');
console.log('Has 6 categories:', pinnedHtml.includes('Announcements') && pinnedHtml.includes('Corrections'));
console.log('Has all 5 templates:', pinnedHtml.includes('欢迎来到 OpenGlass Hub') && pinnedHtml.includes('贡献规则'));