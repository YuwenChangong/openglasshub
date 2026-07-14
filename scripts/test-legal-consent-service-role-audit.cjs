const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { legalConsentServiceRoleFinding, moderationNotificationServiceRoleFinding } = require("./profile-service-role-audit.cjs");

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
  "const payload = await parseLegalConsentPostPayload(request);",
  "const unsafeWriter = dependencies.createWriteRepository(\"request-controlled\");\n  const payload = await parseLegalConsentPostPayload(request);",
) }), null, "pre-auth or pre-validation privileged construction must fail");
assert.notEqual(finding({ routeSource: routeSource.replace("(verifiedUserId)", "(requestUserId)") }), null, "request-controlled actor scope must fail");
assert.notEqual(finding({ repositorySource: `${repositorySource}\nclient.from(\"profiles\");` }), null, "arbitrary table access must fail");
assert.notEqual(finding({ repositorySource: repositorySource.replace(
  '"record_current_legal_policy_acceptance"',
  "actionName",
) }), null, "an arbitrary RPC must fail");
assert.notEqual(finding({ repositorySource: `${repositorySource}\nconsole.log(requireEnv(env, \"SUPABASE_SERVICE_ROLE_KEY\"));` }), null, "service-key exposure must fail");
assert.notEqual(finding({ relativePath: "src/lib/server/unrelated-service-role.server.ts" }), null, "unrelated service-role use must fail");

const moderationRelativePath = "src/lib/server/moderation-notifications.server.ts";
const moderationSource = fs.readFileSync(path.join(root, moderationRelativePath), "utf8");
const moderationRoutes = [
  "src/pages/api/admin/users/[id]/ban.ts",
  "src/pages/api/admin/users/[id]/clear-warning.ts",
  "src/pages/api/admin/users/[id]/suspend.ts",
  "src/pages/api/admin/users/[id]/unban.ts",
  "src/pages/api/admin/users/[id]/warn.ts",
  "src/pages/api/admin/reports/[id]/action.ts",
];
const moderationRouteSources = Object.fromEntries(moderationRoutes.map((relativePath) => [relativePath, fs.readFileSync(path.join(root, relativePath), "utf8")]));
const moderationFinding = (overrides = {}) => moderationNotificationServiceRoleFinding({
  relativePath: moderationRelativePath,
  repositorySource: moderationSource,
  routeSources: moderationRouteSources,
  ...overrides,
});

assert.equal(moderationFinding(), null, "the moderation notification writer must be the exact safe exception");
assert.notEqual(moderationFinding({ repositorySource: moderationSource.replace('"insert_forum_notification"', "rpcName") }), null, "an arbitrary notification RPC must fail");
assert.notEqual(moderationFinding({ repositorySource: `${moderationSource}\nclient.from("forum_notifications");` }), null, "unscoped privileged table access must fail");
assert.notEqual(moderationFinding({ repositorySource: moderationSource.replace("const client = createServiceClient(env);", "const client = createServiceClient(env);\nconsole.log(requireEnv(env, \"SUPABASE_SERVICE_ROLE_KEY\"));") }), null, "service-key exposure must fail");
assert.notEqual(moderationFinding({ routeSources: { ...moderationRouteSources, [moderationRoutes[0]]: "const notificationWriter = createModerationNotificationWriter(env, requestActorId);\nconst auth = await requireModerator(request, env);\nconst consent = await requireAuthenticatedLegalConsent({});\nnotificationWriter," } }), null, "pre-auth writer construction must fail");

console.log("LEGAL_CONSENT_SERVICE_ROLE_AUDIT_OK safe=2 unsafe-patterns=10 offline-only");
