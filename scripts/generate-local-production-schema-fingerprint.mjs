import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildFingerprint, loadPacketSql, migrationSourceIndex, parseCsv } from "./production-schema-fingerprint-core.mjs";

const NORMALIZED_REPLAY_LABELS = Object.freeze({
  "io.openglasshub.replay.project": "openglasshub",
  "io.openglasshub.replay.role": "normalized-replay",
  "io.openglasshub.replay.disposable": "true",
  "io.openglasshub.replay.contract-version": "openglass-normalized-replay-task-v1",
});

export function discoverLocalDatabaseContainer(run = execFileSync) {
  const ids = String(run("docker", ["ps", "--format", "{{.ID}}"], { encoding: "utf8" })).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const candidates = ids.map((id) => {
    const raw = String(run("docker", ["inspect", "--format", "{{json .Config.Labels}}\t{{.State.Running}}\t{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}\t{{.Config.Image}}\t{{.Name}}", id], { encoding: "utf8" })).trim();
    const [labelsRaw, running, health, image, name] = raw.split("\t");
    return { id, labels: JSON.parse(labelsRaw), running: running === "true", health, image, name: name.replace(/^\//, "") };
  }).filter((entry) => entry.running && entry.health === "healthy" && /supabase\/postgres:/i.test(entry.image)
    && Object.entries(NORMALIZED_REPLAY_LABELS).every(([key, value]) => entry.labels?.[key] === value)
    && typeof entry.labels?.["io.openglasshub.replay.task-id"] === "string");
  if (candidates.length !== 1) throw new Error("LOCAL_DOCKER_ONLY requires exactly one verified disposable Supabase database container");
  return candidates[0].name;
}

export async function generateLocalFingerprint({ root = process.cwd(), outputPath }) {
  const sql = await loadPacketSql(root);
  const container = discoverLocalDatabaseContainer();
  const csv = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "--csv"], { input: sql, encoding: "utf8" });
  const rows = parseCsv(csv);
  const fingerprint = buildFingerprint(rows, await migrationSourceIndex(root));
  if (fingerprint.canonicalMigrationCount !== 43 || fingerprint.legalConsentPrerequisiteCount !== 12) throw new Error("Unexpected canonical migration scope");
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
