import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const files = [];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (/\.(astro|ts)$/.test(entry.name)) files.push(target);
  }
}

collect(sourceRoot);
const legacyUsers = files.filter((file) => /runtime\s*\?\.\s*env|runtime\.env/.test(fs.readFileSync(file, "utf8")));
if (legacyUsers.length > 0) throw new Error(`ASTRO7_LEGACY_RUNTIME_ENV: ${legacyUsers.map((file) => path.relative(root, file)).join(", ")}`);

const cloudflareEnvUsers = files.filter((file) => fs.readFileSync(file, "utf8").includes('from "cloudflare:workers"'));
if (cloudflareEnvUsers.length < 15) throw new Error(`ASTRO7_CLOUDFLARE_ENV_IMPORTS: expected at least 15, received ${cloudflareEnvUsers.length}`);

console.log("ASTRO7_CLOUDFLARE_RUNTIME_OK");
