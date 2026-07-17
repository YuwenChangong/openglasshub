import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
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

execFileSync(process.execPath, [path.join(root, "node_modules", "astro", "astro.js"), "build"], { cwd: root, stdio: "pipe", env: { ...process.env } });
for (const route of ["terms/index.html", "privacy/index.html", "community-guidelines/index.html"]) {
  const html = await readFile(path.join(root, "dist", route), "utf8");
  for (const value of Object.values(contactModule.PUBLIC_LEGAL_CONTACTS)) assert.ok(html.includes(value), `${route} must contain every public legal value`);
  assert.doesNotMatch(html, /pending configuration|待配置|TODO|TBD|example\.com/i, `${route} must not contain legal fallback text`);
  assert.doesNotMatch(html, /SUPABASE_SERVICE_ROLE_KEY|PUBLIC_[A-Z0-9_]*SERVICE_ROLE/i, `${route} must not expose a service-role binding`);
}

console.log(JSON.stringify({ status: "PASS", mechanism: "checked-in-static-public-legal-config", productionValueCount: contactKeys.length, previewLegalValues: 0, renderedRoutes: 3 }));
