import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildWorkersReleaseGuard } from "./workers-builds-release-guard.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const SOURCE_FIELDS = ["remoteMainSha", "candidateSha", "providerSourceSha", "activeSourceSha"];

assert.deepEqual(
  buildWorkersReleaseGuard({
    remoteMainSha: SHA.slice(0, 12),
    candidateSha: SHA,
    providerSourceSha: SHA,
    activeSourceSha: SHA,
  }),
  {
    status: "BLOCKED",
    reason: "SOURCE_SHA_INVALID",
    invalidFields: ["remoteMainSha"],
  },
  "a shortened remote-main SHA must fail closed",
);

for (const field of SOURCE_FIELDS) {
  const receipt = Object.fromEntries(SOURCE_FIELDS.map((name) => [name, SHA]));
  delete receipt[field];
  assert.deepEqual(
    buildWorkersReleaseGuard(receipt),
    { status: "BLOCKED", reason: "SOURCE_SHA_INVALID", invalidFields: [field] },
    `a missing ${field} must fail closed`,
  );
}

for (const field of SOURCE_FIELDS) {
  const receipt = Object.fromEntries(SOURCE_FIELDS.map((name) => [name, SHA]));
  receipt[field] = SHA.slice(0, 39);
  assert.deepEqual(
    buildWorkersReleaseGuard(receipt),
    { status: "BLOCKED", reason: "SOURCE_SHA_INVALID", invalidFields: [field] },
    `a non-full ${field} must fail closed`,
  );
}

assert.deepEqual(
  buildWorkersReleaseGuard({
    remoteMainSha: SHA,
    candidateSha: SHA,
    providerSourceSha: OTHER_SHA,
    activeSourceSha: SHA,
  }),
  {
    status: "BLOCKED",
    reason: "SOURCE_SHA_MISMATCH",
    mismatchedFields: ["providerSourceSha"],
  },
  "a provider source SHA that differs from the reviewed source must fail closed",
);

for (const field of SOURCE_FIELDS) {
  const receipt = Object.fromEntries(SOURCE_FIELDS.map((name) => [name, SHA]));
  receipt[field] = OTHER_SHA;
  assert.equal(buildWorkersReleaseGuard(receipt).status, "BLOCKED", `a mismatched ${field} must fail closed`);
  assert.equal(buildWorkersReleaseGuard(receipt).reason, "SOURCE_SHA_MISMATCH");
}

assert.deepEqual(
  buildWorkersReleaseGuard({
    remoteMainSha: SHA,
    candidateSha: SHA,
    providerSourceSha: SHA,
    activeSourceSha: SHA,
  }),
  {
    status: "PASS",
    sourceSha: SHA,
  },
  "matching full source identities must produce a local PASS receipt",
);

const source = await readFile(fileURLToPath(new URL("./workers-builds-release-guard.mjs", import.meta.url)), "utf8");
assert.doesNotMatch(source, /\bfetch\s*\(|https?:\/\/|wrangler\b/i, "the source guard must never contact a provider");

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const packageJson = JSON.parse(await readFile(`${repositoryRoot}/package.json`, "utf8"));
assert.equal(
  packageJson.scripts?.["test:workers-release-guard"],
  "node scripts/qa/test-workers-builds-release-guard.mjs",
  "package.json must expose the focused Workers Builds release guard",
);
const packet = await readFile(`${repositoryRoot}/docs/release/cloudflare-workers-provider-mutation-packet.md`, "utf8");
for (const stage of ["W2", "W3", "W4", "W5", "W6", "W7", "W8"]) {
  assert.match(packet, new RegExp(`\\b${stage}\\b`), `the mutation packet must retain the ${stage} controlled stage`);
}
for (const field of ["REMOTE_MAIN_SHA", "CANDIDATE_SHA", "PROVIDER_SOURCE_SHA", "ACTIVE_SOURCE_SHA", "WORKER_NAME", "WORKERS_DEV_ENDPOINT"]) {
  assert.match(packet, new RegExp(`\\b${field}\\b`), `the mutation packet must name ${field} without asserting a value`);
}
assert.match(packet, /NO_MUTATION_AUTHORIZATION=true/, "the packet must not authorize a provider mutation itself");
assert.match(packet, /WORKERS_DEV_ENDPOINT_AVAILABILITY=UNKNOWN_REQUIRES_REVIEW/, "unproven Worker URL availability must remain explicit");
assert.doesNotMatch(packet, /https:\/\/[^\s)]+\.workers\.dev/i, "the packet must not speculate about a production Worker URL");
assert.doesNotMatch(packet, /\b(?:TODO|TBD|FIXME|REPLACE_ME|CHANGEME)\b|\{\{[^}]+\}\}|<[^>]+>/i, "the packet must contain no unresolved placeholder marker");
assert.doesNotMatch(packet, /postgres(?:ql)?:\/\/|(?:^|[^A-Za-z0-9_-])(eyJ|sk_|sbp_)[A-Za-z0-9_-]{12,}/im, "the packet must contain no credential value");
assert.match(
  packet,
  /No credential value, token, environment value, or secret material is recorded\s+here\.[\s\S]*Verified non-secret resource identifiers may be recorded only when\s+needed for scope or impact review;/,
  "the packet must distinguish secret values from the verified non-secret identifiers it records",
);

console.log("workers-builds-release-guard: PASS");
