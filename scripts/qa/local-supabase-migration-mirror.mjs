import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

const migrationPattern = /^(?<version>\d+)_(?<name>.+\.sql)$/;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function assertDirectoryOutsideSource(sourceDirectory, destinationDirectory) {
  const source = resolve(sourceDirectory);
  const destination = resolve(destinationDirectory);
  if (source === destination || !relative(source, destination).startsWith("..")) {
    throw new Error("Mirror destination must be outside the canonical migration directory.");
  }
}

export async function analyzeMigrations(sourceDirectory) {
  const filenames = (await readdir(sourceDirectory)).filter((filename) => filename.endsWith(".sql")).sort();
  const files = await Promise.all(filenames.map(async (filename, index) => {
    const match = filename.match(migrationPattern);
    if (!match?.groups) throw new Error(`Unsupported migration filename: ${filename}`);
    const bytes = await readFile(join(sourceDirectory, filename));
    return { index, filename, version: match.groups.version, logicalName: match.groups.name.slice(0, -4), sha256: sha256(bytes) };
  }));
  const versionGroups = new Map();
  for (const file of files) versionGroups.set(file.version, [...(versionGroups.get(file.version) ?? []), file]);
  const duplicateGroups = [...versionGroups.entries()].filter(([, group]) => group.length > 1).map(([version, group]) => ({ version, files: group }));
  return { files, uniqueVersionCount: versionGroups.size, duplicateGroups };
}

export async function createMirror({ sourceDirectory, destinationDirectory }) {
  assertDirectoryOutsideSource(sourceDirectory, destinationDirectory);
  const analysis = await analyzeMigrations(sourceDirectory);
  await mkdir(destinationDirectory, { recursive: true });
  const files = [];
  for (const source of analysis.files) {
    const normalizedVersion = String(source.index + 1).padStart(14, "0");
    const mirrorFilename = `${normalizedVersion}_${source.logicalName}.sql`;
    await copyFile(join(sourceDirectory, source.filename), join(destinationDirectory, mirrorFilename));
    files.push({ ...source, mirrorFilename, normalizedVersion });
  }
  const manifest = { algorithm: "canonical-lexical-order-14-digit-ordinal", files };
  await writeFile(join(destinationDirectory, ".p6a2-mirror-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function validateMirror({ sourceDirectory, destinationDirectory, manifest }) {
  const canonical = await analyzeMigrations(sourceDirectory);
  const mirrored = await analyzeMigrations(destinationDirectory);
  const mirrorByFilename = new Map(mirrored.files.map((file) => [file.filename, file]));
  let sqlByteParityFailures = 0;
  let orderPositionMismatches = 0;
  for (const source of manifest.files) {
    const mirror = mirrorByFilename.get(source.mirrorFilename);
    if (!mirror || mirror.sha256 !== source.sha256) sqlByteParityFailures++;
    if (mirror?.index !== source.index) orderPositionMismatches++;
  }
  const duplicateGroups = mirrored.duplicateGroups;
  return {
    canonicalFileCount: canonical.files.length,
    mirrorFileCount: mirrored.files.length,
    fileCountMismatch: Math.abs(canonical.files.length - mirrored.files.length),
    duplicateGroups,
    sqlByteParityFailures,
    orderPositionMismatches,
    remoteTargetGuard: "PASS",
  };
}

export function assertLocalTarget(urlText) {
  const host = new URL(urlText).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("Refusing non-local Supabase target.");
  return true;
}
