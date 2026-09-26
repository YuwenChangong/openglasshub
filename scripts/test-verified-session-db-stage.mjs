import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogDigest, classifyVerifiedSessionDbStage } from "./lib/verified-session-db-stage.mjs";
import { REVIEWED_LOCAL_STAGE_DIGESTS } from "./lib/verified-session-stage-digests.mjs";
export { REVIEWED_LOCAL_STAGE_DIGESTS } from "./lib/verified-session-stage-digests.mjs";

const families = ["schemas", "objects", "tables", "columns", "constraints", "indexes", "functions", "policies", "rls", "readAcl", "publication"];
const baseline = Object.fromEntries(families.map((family) => [family, []]));
baseline.schemas = [{ name: "private", browserUsage: false, unrelatedAcl: "owner-only" }];
baseline.publication = [{ table: "forum_notifications", enabled: true }];
const foundation = structuredClone(baseline);
foundation.tables = [{ name: "ogh_verified_sessions", owner: "postgres", columns: "reviewed" }];
foundation.objects = [{ kind: "relation", schema: "private", name: "ogh_verified_sessions" }];
foundation.functions = [{ name: "ogh_is_verified_session", body: "reviewed", owner: "postgres", searchPath: "", volatility: "stable", grants: ["authenticated"] }];
const enforcement = structuredClone(foundation);
enforcement.policies = [{ table: "devices", name: "ogh_verified_insert", command: "INSERT", qual: "verified" }];

const expected = {
  PRE_V1: "bf445d7f5228ffe9204381efe8a5028d900a1b195e397e43443689a6f06ecb01",
  FOUNDATION: "d474f384da3503a4958c2eb12528b84817903a7f9bbf3f02cccc2479cdd5ed11",
  ENFORCEMENT: "5899d7ddd677b0ee9582dc07ddccca9095b89aa509796be3eb8e5ade43c42e27",
};
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
assert.equal(catalogDigest(baseline), expected.PRE_V1);
assert.equal(catalogDigest(foundation), expected.FOUNDATION);
assert.equal(catalogDigest(enforcement), expected.ENFORCEMENT);
assert.equal(classifyVerifiedSessionDbStage(baseline, expected), "PRE_V1");
assert.equal(classifyVerifiedSessionDbStage(foundation, expected), "FOUNDATION");
assert.equal(classifyVerifiedSessionDbStage(enforcement, expected), "ENFORCEMENT");

for (const [stage, snapshot] of Object.entries({ PRE_V1: baseline, FOUNDATION: foundation, ENFORCEMENT: enforcement })) {
  for (const family of families) {
    const missing = structuredClone(snapshot);
    delete missing[family];
    assert.equal(classifyVerifiedSessionDbStage(missing, expected), "UNKNOWN", `${stage}: missing ${family}`);
    const changed = structuredClone(snapshot);
    changed[family].push({ unexpected: `${stage}-${family}` });
    assert.equal(classifyVerifiedSessionDbStage(changed, expected), "UNKNOWN", `${stage}: changed ${family}`);
  }
}
for (const [label, mutate] of [
  ["function body", (value) => { value.functions[0].body = "return true"; }],
  ["function owner", (value) => { value.functions[0].owner = "anon"; }],
  ["function search path", (value) => { value.functions[0].searchPath = "public"; }],
  ["function grant", (value) => { value.functions[0].grants.push("anon"); }],
  ["function volatility", (value) => { value.functions[0].volatility = "immutable"; }],
  ["schema ACL", (value) => { value.schemas[0].unrelatedAcl = "changed"; }],
  ["mixed resend ACL", (value) => { value.functions.push({ name: "resend", grants: ["anon", "service_role"] }); }],
  ["duplicate policy", (value) => { value.policies.push(structuredClone(value.policies[0])); }],
]) {
  const changed = structuredClone(enforcement);
  mutate(changed);
  assert.equal(classifyVerifiedSessionDbStage(changed, expected), "UNKNOWN", label);
}
assert.equal(classifyVerifiedSessionDbStage(enforcement, {}), "UNKNOWN");
assert.equal(classifyVerifiedSessionDbStage(null, expected), "UNKNOWN");
assert.equal(classifyVerifiedSessionDbStage(enforcement, REVIEWED_LOCAL_STAGE_DIGESTS), "UNKNOWN");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp|comspec|pathext|appdata|localappdata|userprofile)$/i.test(key)));
execFileSync(process.execPath, [path.join(root, "scripts/test-verified-session-sql.mjs"), "--stage-classifier-only"], {
  cwd: root, env: safeEnv, stdio: "inherit", windowsHide: true,
});
console.log("PASS verified session DB stage classifier: exact A/B/D and drift refusal");
}
