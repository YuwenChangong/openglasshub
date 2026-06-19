#!/usr/bin/env node

const args = process.argv.slice(2);

function readFlag(name) {
  return args.includes(name);
}

function readOption(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

const baseUrl = (readOption("--url", "https://openglasshub.pages.dev") || "https://openglasshub.pages.dev").replace(/\/+$/, "");
const strict = readFlag("--strict");
const verbose = readFlag("--verbose");

const pageChecks = [
  { path: "/", expected: [200], label: "homepage" },
  { path: "/feed/", expected: [200], label: "feed" },
  { path: "/login/", expected: [200], label: "login" },
  { path: "/products/", expected: [200], label: "products" },
  { path: "/devices/xreal-one/", expected: [200], label: "device detail" },
  { path: "/admin/moderation/", expected: [200], label: "admin shell unauth" },
];

const apiChecks = [
  { path: "/api/admin/moderation/queue", expected: [401, 403], label: "admin queue unauth" },
  { path: "/api/users/me/notifications", expected: [401, 403], label: "notifications unauth" },
];

const privacyKeywords = [
  "sourceUrl",
  "vr52",
  "参数来源",
  "资料来源",
  "最后核对",
  "SUPABASE_SERVICE_ROLE_KEY",
  "sensitive-terms",
  "blocklist",
];

const feedLeakKeywords = ["私聊我", "完整资料", "入口"];
const adminLeakKeywords = ["pending_review", "\"items\":["];

const failures = [];

function logLine(message) {
  console.log(message);
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL: ${message}`);
}

async function fetchText(path) {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, { redirect: "follow" });
  const text = await response.text();
  if (verbose) {
    logLine(`CHECK ${path} -> ${response.status}`);
  }
  return { url, response, text };
}

for (const check of pageChecks) {
  const { response, text } = await fetchText(check.path);
  if (!check.expected.includes(response.status)) {
    fail(`${check.label} expected ${check.expected.join("/")} but got ${response.status}`);
    continue;
  }

  for (const keyword of privacyKeywords) {
    if (text.includes(keyword)) {
      fail(`${check.path} leaked keyword "${keyword}"`);
    }
  }

  if (check.path === "/feed/") {
    for (const keyword of feedLeakKeywords) {
      if (text.includes(keyword)) {
        fail(`/feed/ still contains old test phrase "${keyword}"`);
      }
    }
  }

  if (check.path === "/admin/moderation/") {
    for (const keyword of adminLeakKeywords) {
      if (text.includes(keyword)) {
        fail(`/admin/moderation/ leaked admin queue content marker "${keyword}"`);
      }
    }
  }
}

for (const check of apiChecks) {
  const { response, text } = await fetchText(check.path);
  if (!check.expected.includes(response.status)) {
    fail(`${check.label} expected ${check.expected.join("/")} but got ${response.status}`);
    if (verbose) {
      logLine(`BODY ${check.path}: ${text.slice(0, 300)}`);
    }
    continue;
  }

  for (const keyword of privacyKeywords) {
    if (text.includes(keyword)) {
      fail(`${check.path} leaked keyword "${keyword}"`);
    }
  }
}

if (failures.length === 0) {
  logLine(`PASS: post-launch public checks succeeded for ${baseUrl}`);
  process.exit(0);
}

if (strict) {
  console.error(`\n${failures.length} failure(s) detected.`);
  process.exit(1);
}

logLine(`WARN: ${failures.length} failure(s) detected, but strict mode is off.`);
