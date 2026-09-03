import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ORDERED_MIGRATION_FILENAMES } from "./build-local-supabase-replay-mirror.mjs";
import { buildFingerprint, loadPacketSql, migrationSourceIndex, parseCsv } from "./production-schema-fingerprint-core.mjs";

export function assertExplicitOwnedDisposableContainer({ containerId, projectId, containerName }) {
  if (!containerId || !projectId) throw new Error("LOCAL_DOCKER_ONLY requires an explicit owned disposable container and project identity");
  const expectedName = `supabase_db_${projectId}`;
  if (containerName !== expectedName) throw new Error("Explicit disposable container does not match this run's owned project identity");
  return containerId;
}

function localDatabaseContainer(environment = process.env) {
  const containerId = environment.OPENGLASS_LOCAL_DISPOSABLE_DB_CONTAINER;
  const projectId = environment.OPENGLASS_LOCAL_DISPOSABLE_PROJECT_ID;
  if (!containerId || !projectId) return assertExplicitOwnedDisposableContainer({ containerId, projectId, containerName: "" });
  const containerName = execFileSync("docker", ["inspect", "--format", "{{.Name}}", containerId], { encoding: "utf8" }).trim().replace(/^\//, "");
  return assertExplicitOwnedDisposableContainer({ containerId, projectId, containerName });
}

export async function generateLocalFingerprint({ root = process.cwd(), outputPath, environment = process.env }) {
  const fixturePath = path.join(root, "tests", "fixtures", "production-schema-expected-fingerprint.json");
  if (outputPath && path.resolve(outputPath) === path.resolve(fixturePath)) {
    throw new Error("Fingerprint candidates may not overwrite the committed fixture; use the reviewed update path");
  }
  const sql = await loadPacketSql(root);
  const container = localDatabaseContainer(environment);
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
  if (index < 0 || !process.argv[index + 1]) throw new Error("A local fingerprint candidate requires an explicit --output path; fixture updates require the reviewed update command");
  const outputPath = path.resolve(process.argv[index + 1]);
  const fingerprint = await generateLocalFingerprint({ root, outputPath });
  console.log(JSON.stringify({ localOnly: true, objectCount: fingerprint.objectCount, outputPath }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
