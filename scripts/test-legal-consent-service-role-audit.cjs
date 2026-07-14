const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { legalConsentServiceRoleFinding } = require("./profile-service-role-audit.cjs");

const root = path.join(__dirname, "..");
const relativePath = "src/lib/server/legal-consent-repository.server.ts";
const repositorySource = fs.readFileSync(path.join(root, relativePath), "utf8");
const routeSource = fs.readFileSync(path.join(root, "src/pages/api/legal/consent.ts"), "utf8");
const apiSource = fs.readFileSync(path.join(root, "src/lib/server/legal-consent-api.server.ts"), "utf8");

function finding(overrides = {}) {
  return legalConsentServiceRoleFinding({ relativePath, repositorySource, routeSource, apiSource, ...overrides });
}

assert.equal(finding(), null, "the current legal-consent writer must be the exact safe exception");
assert.notEqual(finding({ apiSource: apiSource.replace(
  "const auth = await dependencies.authenticate(request);",
  "const unsafeWriter = dependencies.createWriteRepository(\"request-controlled\");\n  const auth = await dependencies.authenticate(request);",
) }), null, "pre-auth or pre-validation privileged construction must fail");
assert.notEqual(finding({ routeSource: routeSource.replace("(verifiedUserId)", "(requestUserId)") }), null, "request-controlled actor scope must fail");
assert.notEqual(finding({ repositorySource: `${repositorySource}\nclient.from(\"profiles\");` }), null, "arbitrary table access must fail");
assert.notEqual(finding({ repositorySource: repositorySource.replace(
  '"record_current_legal_policy_acceptance"',
  "actionName",
) }), null, "an arbitrary RPC must fail");
assert.notEqual(finding({ repositorySource: `${repositorySource}\nconsole.log(requireEnv(env, \"SUPABASE_SERVICE_ROLE_KEY\"));` }), null, "service-key exposure must fail");
assert.notEqual(finding({ relativePath: "src/lib/server/unrelated-service-role.server.ts" }), null, "unrelated service-role use must fail");

console.log("LEGAL_CONSENT_SERVICE_ROLE_AUDIT_OK safe=1 unsafe-patterns=6 offline-only");
