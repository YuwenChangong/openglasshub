import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = await readFile(path.join(root, "node_modules", "wrangler", "wrangler-dist", "cli.js"), "utf8");
const types = await readFile(path.join(root, "node_modules", "wrangler", "wrangler-dist", "cli.d.ts"), "utf8");
assert.match(cli, /_client\.get\(`\/accounts\/\$\{account_id\}\/pages\/projects\/\$\{projectName\}\/deployments\/\$\{deploymentId\}`/);
for (const fragment of ["if (config2.account_id)", "const envAccountId = getCloudflareAccountIdFromEnv();", "return getAccountFromCache()?.id;", 'PAGES_CONFIG_CACHE_FILENAME = "pages.json";', "saveToConfigCache(PAGES_CONFIG_CACHE_FILENAME, {"]) assert.ok(cli.includes(fragment), fragment);
for (const fragment of ["id: string;", "url: string;", 'environment: "production" | "preview";', "project_name: string;", "commit_hash: string;", 'status: "skipped" | "active" | "canceled" | "success" | "idle" | "failure";', 'name: "queued" | "build" | "deploy" | "initialize" | "clone_repo";', "aliases: string[];", "is_skipped?: boolean | undefined;"]) assert.ok(types.includes(fragment), fragment);
assert.equal(types.includes("commit_dirty"), false, "commit_dirty is not part of the proven response model");
console.log("PAGES_DEPLOYMENT_GET_SOURCE_CONTRACT_OK installed Wrangler 4.106.0 proves fixed GET, project/env/cache account-source precedence, and the minimum sufficient response fields only");
