import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ORDERED_MIGRATION_FILENAMES } from "./build-local-supabase-replay-mirror.mjs";
import { buildFingerprint, loadPacketSql, migrationSourceIndex, parseCsv } from "./production-schema-fingerprint-core.mjs";

function localDatabaseContainer() {
  const output = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" });
  const matches = output.split(/\r?\n/).filter((name) => name.startsWith("supabase_db_local-supabase-normalized-replay-"));
  if (matches.length !== 1) throw new Error("LOCAL_DOCKER_ONLY requires exactly one verified disposable Supabase database container");
  return matches[0];
}

export async function generateLocalFingerprint({ root = process.cwd(), outputPath }) {
  const sql = await loadPacketSql(root);
  const container = localDatabaseContainer();
  const csv = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "--csv"], { input: sql, encoding: "utf8" });
  const rows = parseCsv(csv);
  const fingerprint = buildFingerprint(rows, await migrationSourceIndex(root));
  if (fingerprint.canonicalMigrationCount !== ORDERED_MIGRATION_FILENAMES.length || fingerprint.legalConsentPrerequisiteCount !== 12) throw new Error("Unexpected canonical migration scope");
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(fingerprint, null, 2)}\n`);
  }
  return fingerprint;
}

async function main() {
  const root = process.cwd();
  const index = process.argv.indexOf("--output");
  const outputPath = index >= 0 ? path.resolve(process.argv[index + 1]) : path.join(root, "tests", "fixtures", "production-schema-expected-fingerprint.json");
  const fingerprint = await generateLocalFingerprint({ root, outputPath });
  console.log(JSON.stringify({ localOnly: true, objectCount: fingerprint.objectCount, outputPath }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
