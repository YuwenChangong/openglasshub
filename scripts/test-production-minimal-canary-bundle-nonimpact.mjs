import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("src");
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  }))).flat();
}

const applicationFiles = await files(root);
const forbidden = /production-minimal-canary|deployment-attestation|QA_EXPECTED_RUNNER_COMMIT|QA_DEPLOYMENT_ATTESTATION/i;
for (const file of applicationFiles) {
  const source = await readFile(file, "utf8");
  assert.equal(forbidden.test(source), false, `QA-only canary contract reached application source: ${file}`);
}
console.log("PRODUCTION_MINIMAL_CANARY_BUNDLE_NONIMPACT_OK QA-only contract is absent from application source");
