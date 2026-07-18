import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const cli = path.resolve("node_modules/wrangler/wrangler-dist/cli.js");
const source = await readFile(cli, "utf8");
const start = source.indexOf('description: "List deployments in your Cloudflare Pages project"');
assert.notEqual(start, -1, "Wrangler Pages deployment list command source missing");
const end = source.indexOf("pagesDeploymentDeleteCommand", start);
const command = source.slice(start, end);
for (const required of [
  'Source: shortSha(deployment.deployment_trigger.metadata.commit_hash)',
  'Environment: titleCase(deployment.environment)',
  'Status: getStatus(deployment)',
  'Deployment: deployment.url',
  'logger2.log(JSON.stringify(data, null, 2))',
]) assert.equal(command.includes(required), true, `missing source contract: ${required}`);
assert.equal(command.includes("aliases"), false, "4.106.0 list projection unexpectedly exposes aliases");
assert.equal(command.includes("commit_hash,"), false, "4.106.0 list projection unexpectedly exposes a full commit field");
console.log("WRANGLER_PAGES_DEPLOYMENTS_SOURCE_CONTRACT_OK 4.106.0 emits a table-projection array with short Source, display Status, and no aliases");
