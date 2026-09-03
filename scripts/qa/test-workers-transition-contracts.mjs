#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAuthCallbackRedirect,
  buildResetPasswordRedirect,
  getSafeNext,
} from "../../src/lib/auth-redirect.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const LEGACY_ORIGIN = "https://openglasshub.pages.dev";
const PREPARED_WORKER_ORIGIN = "https://openglass-hub-transition-test.workers.dev";

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(target) : [target];
  });
}

function readBindings(source) {
  return new Set([...source.matchAll(/^binding\s*=\s*"([A-Z0-9_]+)"\s*$/gm)].map((match) => match[1]));
}

function resolveGeneratedConfig() {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, "dist", "server", "wrangler.json"), "utf8"));
}

assert.equal(
  buildAuthCallbackRedirect(PREPARED_WORKER_ORIGIN, "/forum/?mode=latest", { approvedOrigins: [PREPARED_WORKER_ORIGIN] }),
  `${PREPARED_WORKER_ORIGIN}/auth/callback/?next=%2Fforum%2F%3Fmode%3Dlatest`,
  "an explicitly approved transition Worker origin must support callback construction",
);
assert.equal(
  buildResetPasswordRedirect(PREPARED_WORKER_ORIGIN, { approvedOrigins: [PREPARED_WORKER_ORIGIN] }),
  `${PREPARED_WORKER_ORIGIN}/auth/reset-password/`,
  "an explicitly approved transition Worker origin must support password recovery construction",
);
assert.equal(
  buildAuthCallbackRedirect(PREPARED_WORKER_ORIGIN, "https://evil.example/", { approvedOrigins: [PREPARED_WORKER_ORIGIN] }),
  `${PREPARED_WORKER_ORIGIN}/auth/callback/?next=%2F`,
  "approved origins must not make external continuations safe",
);
assert.equal(getSafeNext("//evil.example", "/feed/"), "/feed/");
assert.equal(buildAuthCallbackRedirect("https://evil.example", "/", { approvedOrigins: [PREPARED_WORKER_ORIGIN] }), undefined);

const sourceFiles = collectFiles(path.join(repositoryRoot, "src")).filter((file) => /\.(?:astro|[cm]?[jt]sx?)$/.test(file));
const sourceText = sourceFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
assert.equal(sourceText.includes("Astro.locals.runtime"), false, "runtime bindings must not depend on Astro.locals.runtime");
assert.equal(sourceText.includes("process.env"), false, "application runtime must not add process.env binding fallbacks");
assert.match(sourceText, /from\s+["']cloudflare:workers["']/u, "application runtime must import Cloudflare bindings directly");

const rootConfig = fs.readFileSync(path.join(repositoryRoot, "wrangler.toml"), "utf8");
const generatedConfig = resolveGeneratedConfig();
const generatedBindings = new Set([
  ...(generatedConfig.r2_buckets ?? []).map(({ binding }) => binding),
  ...(generatedConfig.kv_namespaces ?? []).map(({ binding }) => binding),
]);
for (const binding of ["MODERATION_ASSETS", "SESSION"]) {
  assert.equal(readBindings(rootConfig).has(binding), true, `root config must retain ${binding}`);
  assert.equal(generatedBindings.has(binding), true, `generated config must retain ${binding}`);
}

assert.equal(LEGACY_ORIGIN, "https://openglasshub.pages.dev");
console.log(JSON.stringify({
  status: "PASS",
  preparedOriginMode: "EXPLICIT_APPROVED_ORIGIN_ONLY",
  authContinuation: "RELATIVE_SAFE",
  runtimeBindingContract: "CLOUDFLARE_WORKERS_DIRECT",
  retainedBindings: ["MODERATION_ASSETS", "SESSION"],
}));
