#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const verbose = args.has("--verbose");
const cwd = process.cwd();

const requiredFiles = [
  "src/styles/community.css",
  "src/components/site/SiteHeader.astro",
  "src/components/products/ProductVisual.astro",
  "src/components/community/PostCard.astro",
  "src/pages/devices/[slug].astro",
  "docs/mobile-responsive-polish-notes.md",
];

const checks = [];

function read(file) {
  return fs.readFileSync(path.join(cwd, file), "utf8");
}

function ok(name, details = "") {
  checks.push({ name, pass: true, details });
}

function fail(name, details = "") {
  checks.push({ name, pass: false, details });
}

for (const file of requiredFiles) {
  if (fs.existsSync(path.join(cwd, file))) {
    ok(`exists:${file}`);
  } else {
    fail(`exists:${file}`, "missing required mobile polish file");
  }
}

const communityCss = fs.existsSync(path.join(cwd, "src/styles/community.css"))
  ? read("src/styles/community.css")
  : "";
const headerAstro = fs.existsSync(path.join(cwd, "src/components/site/SiteHeader.astro"))
  ? read("src/components/site/SiteHeader.astro")
  : "";
const productVisual = fs.existsSync(path.join(cwd, "src/components/products/ProductVisual.astro"))
  ? read("src/components/products/ProductVisual.astro")
  : "";
const postCard = fs.existsSync(path.join(cwd, "src/components/community/PostCard.astro"))
  ? read("src/components/community/PostCard.astro")
  : "";
const devicePage = fs.existsSync(path.join(cwd, "src/pages/devices/[slug].astro"))
  ? read("src/pages/devices/[slug].astro")
  : "";

const contentChecks = [
  {
    name: "community.css has core mobile breakpoints",
    pass:
      communityCss.includes("@media (max-width: 860px)") &&
      communityCss.includes("@media (max-width: 720px)") &&
      communityCss.includes("@media (max-width: 520px)") &&
      communityCss.includes("@media (max-width: 420px)"),
    details: "expected 860/720/520/420 breakpoint coverage",
  },
  {
    name: "header keeps compact search row on mobile",
    pass:
      headerAstro.includes(".og-header__search :global(.global-search-box__form)") &&
      headerAstro.includes("flex-direction: row"),
    details: "header search should stay usable without stacking button under input",
  },
  {
    name: "product visual has mobile-specific rules",
    pass: productVisual.includes("@media (max-width: 720px)"),
    details: "name-card should have dedicated mobile treatment",
  },
  {
    name: "post card markup keeps dedicated action row",
    pass: postCard.includes('class="community-post-actions"'),
    details: "mobile wrap rules depend on the post action row class",
  },
  {
    name: "device detail has mobile layout rule",
    pass: devicePage.includes("@media (max-width: 720px)"),
    details: "device detail page should collapse safely on mobile",
  },
  {
    name: "long text wrapping guard exists",
    pass: communityCss.includes("overflow-wrap: anywhere"),
    details: "critical cards/spec values should wrap instead of overflowing",
  },
];

for (const check of contentChecks) {
  (check.pass ? ok : fail)(check.name, check.details);
}

const riskyPatterns = [
  {
    name: "no broad 100vw main container usage",
    regex: /(?:community-shell|community-grid|home-grid|products-device-grid)[\s\S]{0,220}width:\s*100vw/i,
  },
  {
    name: "no oversized mobile min-width card declarations",
    regex: /min-width:\s*(?:6\d\d|[7-9]\d\d|\d{4,})px/i,
  },
];

for (const pattern of riskyPatterns) {
  const pass = !pattern.regex.test(communityCss);
  (pass ? ok : fail)(pattern.name, pattern.regex.toString());
}

if (verbose) {
  for (const check of checks) {
    const label = check.pass ? "PASS" : "FAIL";
    process.stdout.write(`${label} ${check.name}${check.details ? ` — ${check.details}` : ""}\n`);
  }
}

const failures = checks.filter((check) => !check.pass);
if (failures.length > 0) {
  process.stderr.write(`Mobile layout audit failed with ${failures.length} issue(s).\n`);
  if (strict) {
    process.exit(1);
  }
}

if (!verbose) {
  process.stdout.write(`Mobile layout audit ${failures.length === 0 ? "passed" : "completed with warnings"}.\n`);
}
