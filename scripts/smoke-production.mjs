#!/usr/bin/env node

import { resolveSiteOrigin } from "../src/lib/site-origin.ts";

const args = process.argv.slice(2);

function readOption(name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

const baseUrl = resolveSiteOrigin(readOption("--url", process.env.BASE_URL));
const adminBearer = String(process.env.ADMIN_BEARER || "").trim();

const requiredChecks = [
  { path: "/", expected: 200, label: "homepage" },
  { path: "/feed/", expected: 200, label: "feed" },
  { path: "/circles/", expected: 200, label: "circles" },
  { path: "/api/forum/reports", expected: 405, label: "forum reports GET method guard" },
  { path: "/api/admin/reports", expected: 401, label: "admin reports unauth" },
  { path: "/api/admin/moderation/lexicon-health", expected: 401, label: "lexicon health unauth" },
];

const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`FAIL: ${message}`);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function skip(message) {
  console.log(`SKIP: ${message}`);
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "follow",
    ...options,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { response, text, json };
}

for (const check of requiredChecks) {
  const { response } = await fetchJson(check.path);
  if (response.status !== check.expected) {
    fail(`${check.label}: expected ${check.expected}, got ${response.status}`);
  } else {
    pass(`${check.label}: ${response.status}`);
  }
}

if (adminBearer) {
  const { response, text, json } = await fetchJson("/api/admin/moderation/lexicon-health", {
    headers: {
      authorization: `Bearer ${adminBearer}`,
    },
  });

  if (response.status !== 200) {
    fail(`lexicon health admin auth: expected 200, got ${response.status}`);
  } else {
    pass("lexicon health admin auth: 200");
  }

  const lexicon = json?.lexicon ?? null;
  if (!lexicon || typeof lexicon !== "object") {
    fail("lexicon health payload missing lexicon object");
  } else {
    if (lexicon.bindingPresent !== true) fail("lexicon health bindingPresent must be true");
    else pass("lexicon health bindingPresent=true");

    if (lexicon.source !== "r2") fail(`lexicon health source must be r2, got ${String(lexicon.source)}`);
    else pass("lexicon health source=r2");

    if (lexicon.fallbackUsed !== false) fail(`lexicon health fallbackUsed must be false, got ${String(lexicon.fallbackUsed)}`);
    else pass("lexicon health fallbackUsed=false");
  }

  if (/\"terms\"\s*:/.test(text) || /人口贩卖|嫖娼|卖淫/.test(text)) {
    fail("lexicon health exposed raw lexicon terms");
  } else {
    pass("lexicon health does not expose raw lexicon terms");
  }
} else {
  skip("admin-auth lexicon health checks skipped because ADMIN_BEARER is not set");
}

if (failures.length > 0) {
  console.error(`\n${failures.length} smoke check(s) failed for ${baseUrl}`);
  process.exit(1);
}

console.log(`PASS: smoke-production completed for ${baseUrl}`);
