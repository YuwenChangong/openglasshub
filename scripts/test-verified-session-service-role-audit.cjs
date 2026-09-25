const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { verifiedSessionServiceRoleFinding } = require("./profile-service-role-audit.cjs");

const root = path.join(__dirname, "..");
const cases = [
  ["src/lib/server/login-challenge.server.ts", "const client = serviceClient(env);", 'const elevated = client; elevated.from("profiles");', true],
  ["src/pages/api/auth/logout.ts", "const result = await client.rpc", 'const elevated = client; elevated["from"]("profiles");', false],
  ["src/pages/api/auth/signup-confirm.ts", "const acceptance = await service.rpc", 'const elevated = service; elevated.from("profiles");', false],
];

for (const [relativePath, marker, mutation, after] of cases) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  assert.equal(verifiedSessionServiceRoleFinding(relativePath, source), null, `${relativePath} baseline`);
  assert.ok(source.includes(marker), `${relativePath} mutation target`);
  const mutated = source.replace(marker, after ? `${marker}\n    ${mutation}` : `${mutation}\n    ${marker}`);
  assert.match(verifiedSessionServiceRoleFinding(relativePath, mutated), /service-role caller/, `${relativePath} alias mutation rejected`);
}

console.log("PASS verified-session service-role audit rejects renamed and computed broad client calls");
