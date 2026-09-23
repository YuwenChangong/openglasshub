import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { analyzeMigrations } from "./local-supabase-migration-mirror.mjs";
import { validateReleaseAHistoryForensicArtifact } from "./device-schema-v1-release-a-history-forensic.mjs";

const execFile = promisify(execFileCallback);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CANONICAL_MIGRATIONS = resolve(ROOT, "supabase/migrations");
const DEFAULT_ARTIFACT = "docs/ops/device-schema-v1-release-a-migration-history-forensic.json";
const RELEASE_A_FILENAME = "20260909195640_device_schema_v1_foundation.sql";
const RELEASE_A_PATH = "supabase/migrations/20260909195640_device_schema_v1_foundation.sql";
const RELEASE_A_SHA256 = "a117631dd7a1ffa848b1df8dfbc8286bc7f901a1375961b3d4fe9ad5b2a2d215";

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fingerprint(value) {
  return sha256(Buffer.from(`${JSON.stringify(value)}\n`, "utf8"));
}

function assertOutsideCanonicalMigrations(destinationRoot) {
  const destination = resolve(ROOT, destinationRoot);
  const migrationRootRelationship = relative(CANONICAL_MIGRATIONS, destination);
  if (destination === CANONICAL_MIGRATIONS || !migrationRootRelationship.startsWith("..") || migrationRootRelationship.split(sep).includes("..") === false) {
    fail("OVERLAY_DESTINATION_INSIDE_CANONICAL_MIGRATIONS");
  }
  const repositoryRelationship = relative(ROOT, destination);
  if (!repositoryRelationship.startsWith("..") && repositoryRelationship !== "") {
    const canonicalRelationship = relative(CANONICAL_MIGRATIONS, destination);
    if (canonicalRelationship === "" || !canonicalRelationship.startsWith("..")) fail("OVERLAY_DESTINATION_INSIDE_CANONICAL_MIGRATIONS");
  }
  return destination;
}

function assertOwnedTempRoot(destinationRoot) {
  const destination = assertOutsideCanonicalMigrations(destinationRoot);
  const tempRoot = resolve(tmpdir());
  const tempRelationship = relative(tempRoot, destination);
  if (tempRelationship === "" || tempRelationship.startsWith("..") || tempRelationship.split(sep).includes("..")) fail("OVERLAY_DESTINATION_OUTSIDE_OS_TEMP");
  const marker = `${sep}release-a-history-overlay-`;
  if (!destination.includes(marker) && !basename(destination).startsWith("release-a-history-overlay-")) fail("OVERLAY_DESTINATION_NOT_OWNED_TEMP");
  return destination;
}

async function assertDefaultArtifactCommitted(artifactPath) {
  if (artifactPath !== DEFAULT_ARTIFACT) return;
  try {
    await execFile("git", ["ls-files", "--error-unmatch", artifactPath], { cwd: ROOT });
    await execFile("git", ["diff", "--quiet", "--", artifactPath], { cwd: ROOT });
    await execFile("git", ["diff", "--cached", "--quiet", "--", artifactPath], { cwd: ROOT });
  } catch {
    fail("FORENSIC_ARTIFACT_UNCOMMITTED_OR_UNTRACKED");
  }
}

async function readArtifact(artifactPath) {
  try {
    await validateReleaseAHistoryForensicArtifact({ artifactPath });
    await assertDefaultArtifactCommitted(artifactPath);
    return JSON.parse(await readFile(resolve(ROOT, artifactPath), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") fail("FORENSIC_ARTIFACT_UNAVAILABLE");
    throw error;
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function overlayFilenameForRow(row) {
  return `${row.remoteVersion}_${row.remoteName}.sql`;
}

function compareByVersionThenFilename(left, right) {
  const versionComparison = BigInt(left.version) < BigInt(right.version) ? -1 : BigInt(left.version) > BigInt(right.version) ? 1 : 0;
  return versionComparison || left.filename.localeCompare(right.filename);
}

export async function compareCanonicalMigrationsToReleaseAHistory({ artifactPath = DEFAULT_ARTIFACT } = {}) {
  const artifact = await readArtifact(artifactPath);
  const canonical = await analyzeMigrations(CANONICAL_MIGRATIONS);
  const remoteVersions = new Set(artifact.rows.map((row) => row.remoteVersion));
  const canonicalVersions = new Set(canonical.files.map((file) => file.version));
  const pending = canonical.files
    .filter((file) => !remoteVersions.has(file.version))
    .sort(compareByVersionThenFilename)
    .map(({ version, filename }) => ({ version, filename }));
  return Object.freeze({
    remoteRecorded: artifact.rows.length,
    canonicalMigrationCount: canonical.files.length,
    providerAliasVersionsAbsentFromCanonical: artifact.rows
      .filter((row) => row.classification !== "SHARED_EXACT_VERSION")
      .every((row) => !canonicalVersions.has(row.remoteVersion)),
    pending,
    directCanonicalTransportSafeForReleaseAOnly: pending.length === 1 && pending[0]?.filename === RELEASE_A_FILENAME,
  });
}

export async function buildReleaseAHistoryCompatibilityOverlay({ artifactPath = DEFAULT_ARTIFACT, destinationRoot } = {}) {
  const artifact = await readArtifact(artifactPath);
  const canonicalBefore = await analyzeMigrations(CANONICAL_MIGRATIONS);
  if (canonicalBefore.files.length !== 50) fail("CANONICAL_MIGRATION_COUNT_CHANGED");
  const destination = destinationRoot
    ? assertOwnedTempRoot(destinationRoot)
    : await mkdtemp(join(tmpdir(), "release-a-history-overlay-"));
  const overlayMigrations = join(destination, "supabase", "migrations");
  await mkdir(overlayMigrations, { recursive: true });
  const canonicalConfig = resolve(ROOT, "supabase/config.toml");
  const configCopied = await pathExists(canonicalConfig);
  if (configCopied) await copyFile(canonicalConfig, join(destination, "supabase", "config.toml"));

  const files = [];
  for (const row of artifact.rows) {
    const source = resolve(ROOT, row.canonicalLocalPath);
    const sourceBytes = await readFile(source);
    const overlayFilename = overlayFilenameForRow(row);
    const overlayPath = join(overlayMigrations, overlayFilename);
    await copyFile(source, overlayPath);
    const overlayBytes = await readFile(overlayPath);
    const overlaySha256 = sha256(overlayBytes);
    const canonicalSha256 = sha256(sourceBytes);
    if (overlaySha256 !== canonicalSha256 || canonicalSha256 !== row.canonicalSha256) fail(`OVERLAY_BYTE_PARITY_FAILED:${row.remoteVersion}`);
    files.push({
      remoteVersion: row.remoteVersion,
      overlayFilename,
      overlayRelativePath: `supabase/migrations/${overlayFilename}`,
      canonicalSourcePath: row.canonicalLocalPath,
      canonicalAbsolutePath: source,
      overlaySha256,
      canonicalSha256,
      byteIdentical: true,
      historyCompatible: true,
    });
  }

  const releaseASource = resolve(ROOT, RELEASE_A_PATH);
  const releaseABytes = await readFile(releaseASource);
  const overlayReleaseAPath = join(overlayMigrations, RELEASE_A_FILENAME);
  await copyFile(releaseASource, overlayReleaseAPath);
  const overlayReleaseASha256 = sha256(await readFile(overlayReleaseAPath));
  if (overlayReleaseASha256 !== RELEASE_A_SHA256) fail("RELEASE_A_SHA256_MISMATCH");
  files.push({
    remoteVersion: "20260909195640",
    overlayFilename: RELEASE_A_FILENAME,
    overlayRelativePath: `supabase/migrations/${RELEASE_A_FILENAME}`,
    canonicalSourcePath: RELEASE_A_PATH,
    canonicalAbsolutePath: releaseASource,
    overlaySha256: overlayReleaseASha256,
    canonicalSha256: RELEASE_A_SHA256,
    byteIdentical: true,
    historyCompatible: false,
  });

  const generated = (await readdir(overlayMigrations)).filter((name) => name.endsWith(".sql")).sort();
  if (generated.length !== 6) fail("OVERLAY_MIGRATION_COUNT_CHANGED");
  const historyFiles = files.filter((file) => file.historyCompatible);
  const pending = files.filter((file) => !file.historyCompatible).map((file) => file.overlayFilename);
  if (historyFiles.length !== 5 || pending.length !== 1 || pending[0] !== RELEASE_A_FILENAME) fail("OVERLAY_PENDING_CONTRACT_CHANGED");

  const canonicalAfter = await analyzeMigrations(CANONICAL_MIGRATIONS);
  const canonicalMigrationDirectoryUnchanged = JSON.stringify(canonicalBefore.files) === JSON.stringify(canonicalAfter.files);
  if (!canonicalMigrationDirectoryUnchanged) fail("CANONICAL_MIGRATION_DIRECTORY_CHANGED");

  const manifest = {
    format: "openglass-release-a-history-compatibility-overlay-v1",
    artifactPath,
    remoteRecorded: artifact.rows.length,
    files: files.map(({ canonicalAbsolutePath: _canonicalAbsolutePath, ...file }) => file),
  };
  const overlayFingerprint = fingerprint(manifest);
  await writeFile(join(destination, ".release-a-history-overlay-manifest.json"), `${JSON.stringify({ ...manifest, overlayFingerprint }, null, 2)}\n`, "utf8");

  return Object.freeze({
    destinationRoot: destination,
    remoteRecorded: artifact.rows.length,
    overlayMigrationCount: generated.length,
    overlayHistoryVersionCount: historyFiles.length,
    overlayPendingCount: pending.length,
    pending,
    overlayReleaseASha256,
    aliasCoverage: `${artifact.rows.filter((row) => row.classification !== "SHARED_EXACT_VERSION").length}/2`,
    remoteHistoryCoverage: `${historyFiles.length}/5`,
    canonicalMigrationDirectoryUnchanged,
    configCopied,
    overlayFingerprint,
    files,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify(await buildReleaseAHistoryCompatibilityOverlay(), null, 2));
}
