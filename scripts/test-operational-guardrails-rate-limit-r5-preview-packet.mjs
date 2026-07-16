import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = await Promise.all([
  "docs/ops/reconciliation/operational-guardrails-rate-limit-r5-preview-preflight.sql",
  "docs/ops/reconciliation/operational-guardrails-rate-limit-r5-preview-postflight.sql",
  "docs/ops/reconciliation/operational-guardrails-rate-limit-r5-preview-execution-proposal.md",
  "docs/ops/reconciliation/operational-guardrails-rate-limit-r5-preview-checklist.md",
  "docs/ops/reconciliation/operational-guardrails-rate-limit-r5-preview-deployment-checklist.md",
  "docs/ops/reconciliation/operational-guardrails-rate-limit-r5-preview-behavioral-verification-checklist.md",
  "docs/ops/reconciliation/operational-guardrails-rate-limit-r5-preview-rollback-residue-checklist.md",
].map((file) => readFile(file, "utf8")));
const [preflight, postflight, proposal, checklist, deployment, behavior, rollback] = files;
for (const source of [preflight, postflight]) {
  assert.match(source, /UNEXECUTED PREVIEW-ONLY/);
  assert.match(source, /SELECT/i);
  assert.doesNotMatch(source, /\b(?:insert|update|delete|alter|create|drop|grant|revoke)\b/i);
}
assert.match(preflight, /one-row|ONE RESULT SET/i);
assert.match(proposal, /10a1848e33097a9bb79e5cb1f1107a86bac6c724b352a13948665b90559011bb/);
assert.match(checklist, /R5-A[\s\S]*R5-G/s);
assert.doesNotMatch(checklist, /`(?:wrangler deploy|supabase db push)/i);
assert.match(deployment, /branch Preview deployment target/i);
assert.match(behavior, /RATE_LIMITED[\s\S]*429/s);
assert.match(rollback, /Preview back to the recorded prior/i);
console.log("operational-guardrails R5 preview packet: PASS static-only");
