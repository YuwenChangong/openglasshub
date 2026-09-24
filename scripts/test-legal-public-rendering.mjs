import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const contactModule = await import("../src/lib/public-legal-contacts.ts");
const contactKeys = Object.keys(contactModule.PUBLIC_LEGAL_CONTACT_ENV);

function productionVars(source) {
  const match = source.match(/\[env\.production\.vars\]\r?\n([\s\S]*?)(?:\r?\n\[|$)/);
  assert.ok(match, "wrangler.toml must contain env.production.vars");
  return Object.fromEntries([...match[1].matchAll(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"\s*$/gm)].map(([, key, value]) => [key, value]));
}

const wrangler = await readFile(path.join(root, "wrangler.toml"), "utf8");
const production = productionVars(wrangler);
const preview = wrangler.match(/\[env\.preview\.vars\]\r?\n([\s\S]*?)(?:\r?\n\[|$)/)?.[1] ?? "";

for (const key of contactKeys) {
  const envName = contactModule.PUBLIC_LEGAL_CONTACT_ENV[key];
  assert.equal(production[envName], contactModule.PUBLIC_LEGAL_CONTACTS[key], `${envName} must match the checked-in legal source`);
  assert.ok(!preview.includes(`${envName} =`), `${envName} must not change Preview`);
}

contactModule.validatePublicLegalContacts(contactModule.PUBLIC_LEGAL_CONTACTS);
for (const [key, value] of [
  ["support", ""],
  ["support", "  "],
  ["support", "todo@example.invalid"],
  ["support", "not-an-email"],
  ["operator", "<script>"],
]) {
  assert.throws(() => contactModule.validatePublicLegalContacts({ ...contactModule.PUBLIC_LEGAL_CONTACTS, [key]: value }), /Invalid public legal/);
}

for (const route of ["src/pages/terms/index.astro", "src/pages/privacy/index.astro", "src/pages/community-guidelines/index.astro", "src/pages/contact/index.astro"]) {
  const source = await readFile(path.join(root, route), "utf8");
  assert.match(source, /showPublicContacts=\{true\}/, `${route} must render the shared public contacts`);
}

const legalPage = await readFile(path.join(root, "src/components/legal/LegalPage.astro"), "utf8");
assert.match(legalPage, /PUBLIC_LEGAL_CONTACTS/);
assert.doesNotMatch(legalPage, /set:html=\{PUBLIC_LEGAL_CONTACTS/);
assert.doesNotMatch(await readFile(path.join(root, "src/lib/legal-policy.ts"), "utf8"), /import\.meta\.env/);

const portServer = net.createServer();
await new Promise((resolve, reject) => { portServer.once("error", reject); portServer.listen(0, "127.0.0.1", resolve); });
const port = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const server = spawn(process.execPath, [path.join(root, "node_modules", "astro", "bin", "astro.mjs"), "dev", "--ignore-lock", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: root, env: { ...process.env, ASTRO_DEV_BACKGROUND: "1" }, stdio: "ignore", windowsHide: true,
});
try {
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`local Astro server exited ${server.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/terms/`);
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for local server startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, "local Astro legal pages become available");
  for (const route of ["terms", "privacy", "community-guidelines"]) {
    const response = await fetch(`http://127.0.0.1:${port}/${route}/`);
    assert.equal(response.status, 200, `${route} renders publicly`);
    const html = await response.text();
    for (const value of Object.values(contactModule.PUBLIC_LEGAL_CONTACTS)) assert.ok(html.includes(value), `${route} must contain every public legal value`);
    assert.doesNotMatch(html, /pending configuration|待配置|TODO|TBD|example\.com/i, `${route} must not contain legal fallback text`);
    assert.doesNotMatch(html, /SUPABASE_SERVICE_ROLE_KEY|PUBLIC_[A-Z0-9_]*SERVICE_ROLE/i, `${route} must not expose a service-role binding`);
  }
} finally {
  if (server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
}

console.log(JSON.stringify({ status: "PASS", mechanism: "checked-in-static-public-legal-config", productionValueCount: contactKeys.length, previewLegalValues: 0, renderedRoutes: 3 }));
