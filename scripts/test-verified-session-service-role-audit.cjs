const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { verifiedSessionServiceRoleFinding, resendLimitServiceRoleFinding } = require("./profile-service-role-audit.cjs");

const root = path.join(__dirname, "..");
const cases = [
  ["src/lib/server/login-challenge.server.ts", "const client = serviceClient(env);", 'const elevated = client; elevated.from("profiles");', true],
  ["src/pages/api/auth/logout.ts", "const result = await client.rpc", 'const elevated = client; elevated["from"]("profiles");', false],
  ["src/pages/api/auth/signup-confirm.ts", "const acceptance = await service.rpc", 'const elevated = service; elevated.from("profiles");', false],
  ["src/lib/server/login-challenge.server.ts", "const client = serviceClient(env);", 'const { from: broadRead } = client; broadRead("profiles");', true],
  ["src/pages/api/auth/logout.ts", "const result = await client.rpc", 'const { rpc: runRpc } = client; runRpc("unreviewed_rpc", {});', false],
  ["src/pages/api/auth/signup-confirm.ts", "const acceptance = await service.rpc", 'const { storage: storageApi } = service; storageApi.getBucket("private");', false],
];

for (const [relativePath, marker, mutation, after] of cases) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  assert.equal(verifiedSessionServiceRoleFinding(relativePath, source), null, `${relativePath} baseline`);
  assert.ok(source.includes(marker), `${relativePath} mutation target`);
  const mutated = source.replace(marker, after ? `${marker}\n    ${mutation}` : `${mutation}\n    ${marker}`);
  assert.match(verifiedSessionServiceRoleFinding(relativePath, mutated), /service-role caller/, `${relativePath} alias mutation rejected`);
}

const resendPath = "src/lib/server/consume-verification-email-resend-limit.server.ts";
const resendSource = fs.readFileSync(path.join(root, resendPath), "utf8");
assert.equal(resendLimitServiceRoleFinding(resendPath, resendSource), null, "resend limiter is a fixed, fail-closed RPC consumer");
for (const mutation of [
  resendSource.replace('"consume_verification_email_resend_limit"', "requestRpcName"),
  `${resendSource}\nclient.from(tableName);`,
  `${resendSource}\nconsole.log(env.SUPABASE_SERVICE_ROLE_KEY);`,
]) {
  assert.notEqual(resendLimitServiceRoleFinding(resendPath, mutation), null, "resend limiter broadening is rejected");
}

console.log("PASS verified-session service-role audit rejects renamed, computed, and destructured broad client calls");
