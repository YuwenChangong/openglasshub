import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const review = await readFile("docs/ops/reconciliation/operational-guardrails-current-catalog-refresh-review.md", "utf8");
const architecture = await readFile("docs/ops/reconciliation/operational-guardrails-rate-limit-rpc-architecture.md", "utf8");
const rateLimit = await readFile("src/lib/server/rate-limit.ts", "utf8");

assert.match(review, /INDEX_STAGES_CLOSED_CURRENT_CATALOG_VERIFIED_R4_IMPLEMENTED_PREVIEW_HOLD/);
assert.match(review, /W6_INDEX_STAGE_A[\s\S]*CLOSED_ALREADY_SATISFIED/);
assert.match(review, /W6_INDEX_STAGE_B[\s\S]*CLOSED_ALREADY_SATISFIED/);
assert.match(review, /EXACT_INDEX_PRESENT/);
assert.match(review, /RLS_REDUNDANT_PRIVILEGE_HOLD/);
assert.match(review, /BLOCKED_RUNTIME_MIGRATION_REQUIRED/);
assert.match(review, /No policy-removal SQL is authored/);
assert.match(architecture, /server-only, atomic, fail-closed/i);
assert.match(rateLimit, /consumeForumRateLimit/);
assert.doesNotMatch(rateLimit, /backendAvailable|\.from\(|(?:from|insert)\(["']forum_upload_attempts["']/);
console.log("operational-guardrails current catalog refresh review: PASS");
