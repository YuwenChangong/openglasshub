import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  implementationStages,
  rateLimitRouteInventory,
  rateLimitRpcContract,
  trustedIdentity,
} from "../tests/fixtures/operational-guardrails-rate-limit-rpc-design.mjs";

const files = {
  identity: "docs/ops/reconciliation/operational-guardrails-rate-limit-rpc-trusted-identity.md",
  contract: "docs/ops/reconciliation/operational-guardrails-rate-limit-rpc-contract.md",
  concurrency: "docs/ops/reconciliation/operational-guardrails-rate-limit-rpc-concurrency.md",
  runtime: "docs/ops/reconciliation/operational-guardrails-rate-limit-rpc-runtime-plan.md",
  readiness: "docs/ops/reconciliation/operational-guardrails-rate-limit-rpc-readiness.md",
  architecture: "docs/ops/reconciliation/operational-guardrails-rate-limit-rpc-architecture.md",
  rateLimit: "src/lib/server/rate-limit.ts",
  wrangler: "wrangler.toml",
  envExample: ".env.example",
  envChecklist: "docs/ops/environment-and-secrets-checklist.md",
};
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readFile(file, "utf8")])));

assert.equal(trustedIdentity.classification, "SERVICE_ROLE_CONFIGURATION_PARTIALLY_READY");
assert.equal(trustedIdentity.previewBindingStatus, "PREVIEW_SERVICE_ROLE_BINDING_READY");
assert.equal(trustedIdentity.productionBindingStatus, "BINDING_ABSENT_PRODUCTION_BLOCKED");
assert.equal(trustedIdentity.proofEvidence, "operator-held-metadata-only-outside-git");
assert.equal(trustedIdentity.activeRateLimitServiceRoleCaller, null);
assert.match(source.identity, /SERVICE_ROLE_CONFIGURATION_PARTIALLY_READY/);
assert.match(source.identity, /PREVIEW_SERVICE_ROLE_BINDING_READY/);
assert.match(source.identity, /BINDING_ABSENT_PRODUCTION_BLOCKED/);
assert.match(source.identity, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(source.wrangler, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(source.envExample, /^SUPABASE_SERVICE_ROLE_KEY=/m);
assert.doesNotMatch(source.envChecklist, /^- `SUPABASE_SERVICE_ROLE_KEY`$/m);

assert.equal(rateLimitRpcContract.schema, "public");
assert.equal(rateLimitRpcContract.functionName, "consume_forum_rate_limit");
assert.deepEqual(rateLimitRpcContract.signature, [["p_user_id", "uuid"], ["p_ip_hash", "text"], ["p_purpose", "text"], ["p_bytes", "bigint"]]);
assert.deepEqual(rateLimitRpcContract.resultPairs, [[true, "ALLOWED"], [false, "RATE_LIMITED"]]);
assert.deepEqual(Object.keys(rateLimitRpcContract.purposes), ["post_create", "comment_create", "circle_create", "post_media_upload", "external_video_upload"]);
assert(rateLimitRpcContract.rejected.includes("verification_email_resend"));
assert.equal(rateLimitRpcContract.security.publicExecute, false);
assert.equal(rateLimitRpcContract.security.anonExecute, false);
assert.equal(rateLimitRpcContract.security.authenticatedExecute, false);
assert.match(source.contract, /no count, limit,[\s\S]*remaining quota, reset timestamp/i);
assert.match(source.contract, /150 MiB/);
assert.match(source.contract, /pending an approved upper cap/i);

assert.equal(rateLimitRouteInventory.length, 5);
assert(rateLimitRouteInventory.every((entry) => entry.failure.includes("fails_open") && entry.denyStatus === 429 && entry.errorStatus === 503));
assert.match(source.rateLimit, /allowed: true,[\s\S]*backendAvailable: false/);
assert.match(source.runtime, /malformed data[\s\S]*fixed `503`/);
assert.match(source.runtime, /external-video[\s\S]*daily-byte replacement/i);

assert.equal(rateLimitRpcContract.concurrency, "transaction_scoped_advisory_lock_per_fixed_scope");
assert.match(source.concurrency, /Transaction-scoped advisory lock/);
assert.match(source.concurrency, /no multi-lock ordering[\s\S]*or deadlock cycle/i);
assert.match(source.concurrency, /R3 must prove exact-threshold races/i);

assert.deepEqual(implementationStages, ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"]);
for (const stage of implementationStages) assert.match(source.runtime, new RegExp(`\\| ${stage} \\|`));
assert.match(source.runtime, /policy-removal approval/);
assert.match(source.readiness, /no policy removal[\s\S]*before R7\/R8/i);
assert.match(source.architecture, /server-only, atomic, fail-closed/i);

const designText = [source.identity, source.contract, source.concurrency, source.runtime, source.readiness].join("\n");
assert.doesNotMatch(designText, /create\s+(or\s+replace\s+)?function|grant\s+execute|revoke\s+all\s+on\s+function|alter\s+table/i);
console.log("operational-guardrails rate-limit rpc design: PASS");
