import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  return {
    strict: argv.includes("--strict"),
    verbose: argv.includes("--verbose"),
  };
}

async function exists(filePath) {
  try {
    await fs.access(path.resolve(process.cwd(), filePath));
    return true;
  } catch {
    return false;
  }
}

async function read(filePath) {
  return fs.readFile(path.resolve(process.cwd(), filePath), "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const errors = [];

  const requiredFiles = [
    "third_party/sensitive-lexicons/source-manifest.json",
    "third_party/sensitive-lexicons/konsheng-sensitive-lexicon/LICENSE",
    "third_party/sensitive-lexicons/houbb-sensitive-word/LICENSE.txt",
    "src/data/moderation/custom-allowlist.json",
    "src/data/moderation/custom-reviewlist.json",
    "src/data/moderation/custom-denylist.json",
    "src/data/moderation/sensitive-lexicon.generated.json",
    "src/data/moderation/sensitive-lexicon.generated.ts",
    "src/data/moderation/sensitive-lexicon-manifest.generated.json",
    "src/lib/moderation/local-sensitive-lexicon.server.ts",
    "src/lib/moderation/sensitive-lexicon-loader.server.ts",
    "src/pages/api/admin/moderation/lexicon-health.ts",
    "scripts/moderation/import-sensitive-lexicons.mjs",
  ];

  for (const file of requiredFiles) {
    if (!(await exists(file))) errors.push(`missing required file: ${file}`);
  }

  const manifest = JSON.parse(await read("third_party/sensitive-lexicons/source-manifest.json"));
  const generated = JSON.parse(await read("src/data/moderation/sensitive-lexicon.generated.json"));
  const generatedManifest = JSON.parse(await read("src/data/moderation/sensitive-lexicon-manifest.generated.json"));
  const matcherSource = await read("src/lib/moderation/local-sensitive-lexicon.server.ts");
  const loaderSource = await read("src/lib/moderation/sensitive-lexicon-loader.server.ts");
  const healthApiSource = await read("src/pages/api/admin/moderation/lexicon-health.ts");
  const importScript = await read("scripts/moderation/import-sensitive-lexicons.mjs");

  if (!Array.isArray(manifest.sources) || manifest.sources.length < 2) {
    errors.push("source manifest must contain both upstream sources");
  }
  if (!Array.isArray(generated.terms) || generated.terms.length < 100) {
    errors.push("generated lexicon looks unexpectedly small");
  }
  if (!Array.isArray(generated.sources) || generated.sources.length < 2) {
    errors.push("generated lexicon missing source summary");
  }
  if (!Array.isArray(generatedManifest.importedFiles) || generatedManifest.importedFiles.length < 4) {
    errors.push("generated manifest missing imported file records");
  }
  if (!/loadSensitiveLexicon/.test(matcherSource)) {
    errors.push("local matcher is not using runtime sensitive lexicon loader");
  }
  if (!/getSensitiveLexiconHealth/.test(healthApiSource) || !/requireModerator/.test(healthApiSource)) {
    errors.push("admin lexicon health endpoint is missing safe runtime diagnostics");
  }
  if (!/MODERATION_ASSETS|sensitive-lexicon\.generated\.json/.test(loaderSource)) {
    errors.push("runtime lexicon loader does not appear to support private runtime loading");
  }
  if (!/cachedLexiconSource !== \"emergency\"|compiledLexiconSource === \"emergency\"/.test(`${loaderSource}\n${matcherSource}`)) {
    errors.push("runtime lexicon cache may still lock emergency fallback permanently");
  }
  if (!/module-level|compileLexicon|compiledLexicon/i.test(matcherSource)) {
    errors.push("local matcher does not appear to cache compiled lexicon terms");
  }
  if (/github\.com/i.test(matcherSource)) {
    errors.push("local matcher should not fetch GitHub at runtime");
  }
  if (/fetch\(/i.test(importScript) && /github\.com/i.test(importScript)) {
    errors.push("import script should not fetch from GitHub during runtime audits");
  }

  console.log(`required files: ${requiredFiles.length}`);
  console.log(`generated terms: ${generated.terms?.length ?? 0}`);
  console.log(`errors: ${errors.length}`);

  if (args.verbose) {
    for (const source of manifest.sources ?? []) {
      console.log(`- source: ${source.id} @ ${source.commit} (${source.license})`);
    }
  }

  if (errors.length > 0) {
    console.error("\nSENSITIVE LEXICON AUDIT FAILED");
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log("\nSENSITIVE LEXICON AUDIT PASSED");
}

main().catch((error) => {
  console.error("audit-sensitive-lexicon failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
