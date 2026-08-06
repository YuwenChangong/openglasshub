import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { REQUIRED_FORWARD_MIGRATION_FILES } from "./legal-consent-forward-migration-inventory.mjs";
import { sha256, stableJson } from "./legal-local-replay-evidence.mjs";

export const LEGAL_LOCAL_PRELEGAL_BASELINE_SCHEMA = "legal-local-prelegal-baseline-manifest-v1";
export const LEGAL_LOCAL_PRELEGAL_BASELINE_TERMINAL_SCHEMA = "legal-local-prelegal-baseline-terminal-v1";
export const LEGAL_LOCAL_PRELEGAL_BOUNDARY_MIGRATION = "20260703_moderation_action_notifications.sql";
export const LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED = "R6_LOCAL_PRELEGAL_BASELINE_REQUIRES_LOCAL_SUPABASE_RUNTIME";

const FILE = /^(?<identity>\d{8})_(?<name>[a-z0-9_]+)\.sql$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

function parseMigrationFilename(filename) {
  const match = FILE.exec(String(filename ?? ""));
  if (!match) fail("R6_LOCAL_PRELEGAL_BASELINE_MIGRATION_IDENTITY_INVALID");
  return Object.freeze({ identity: match.groups.identity, filename });
}

function baselineRequirements(contents) {
  const combined = contents.join("\n");
  const requirements = [];
  if (/\bauth\./i.test(combined)) requirements.push("AUTH_SCHEMA");
  if (/\bstorage\./i.test(combined)) requirements.push("STORAGE_SCHEMA");
  if (/\b(?:anon|authenticated|service_role)\b/i.test(combined)) requirements.push("SUPABASE_ROLES");
  return Object.freeze(requirements);
}

export function createBoundaryCheckpointRequirements() {
  return Object.freeze({
    relation: "public.forum_notifications",
    columns: Object.freeze(["recipient_id", "actor_id", "type", "post_id", "comment_id", "circle_id", "read_at", "created_at", "last_event_at"]),
    constraints: Object.freeze(["forum_notifications_type_check"]),
    functions: Object.freeze(["public.insert_forum_notification"]),
    prerequisiteClassification: "CANONICAL_PRELEGAL_DEPENDENCY_GRAPH_VERIFIED",
  });
}

export async function resolveLegalPrelegalBaseline({ repositoryRoot, implementationCommit, generatedAt = new Date().toISOString() }) {
  if (!/^[a-f0-9]{40}$/.test(String(implementationCommit ?? ""))) fail("R6_LOCAL_PRELEGAL_BASELINE_COMMIT_INVALID");
  const migrationRoot = path.join(path.resolve(repositoryRoot), "supabase", "migrations");
  const boundary = parseMigrationFilename(LEGAL_LOCAL_PRELEGAL_BOUNDARY_MIGRATION);
  const filenames = (await readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name);
  const parsed = filenames.map(parseMigrationFilename);
  const duplicateNames = new Set();
  if (new Set(parsed.map(({ filename }) => filename)).size !== parsed.length) fail("R6_LOCAL_PRELEGAL_BASELINE_DUPLICATE_MIGRATION");
  const candidates = parsed
    .filter(({ identity, filename }) => identity < boundary.identity && !REQUIRED_FORWARD_MIGRATION_FILES.includes(filename))
    .sort((left, right) => left.identity.localeCompare(right.identity) || left.filename.localeCompare(right.filename));
  if (candidates.length === 0 || candidates.some(({ filename }) => filename === LEGAL_LOCAL_PRELEGAL_BOUNDARY_MIGRATION)) fail("R6_LOCAL_PRELEGAL_BASELINE_BOUNDARY_INVALID");
  const entries = [];
  const contents = [];
  for (const [index, candidate] of candidates.entries()) {
    const relativePath = path.posix.join("supabase", "migrations", candidate.filename);
    const bytes = await readFile(path.join(migrationRoot, candidate.filename));
    entries.push(Object.freeze({ sequence: index + 1, identity: candidate.identity, filename: candidate.filename, repositoryRelativePath: relativePath, canonicalSha256: sha256(bytes) }));
    contents.push(bytes.toString("utf8"));
  }
  const requiredFiles = new Set(["20260606_forum_notifications_mvp.sql", "20260611_stabilize_forum_notifications_realtime_permissions.sql"]);
  if ([...requiredFiles].some((filename) => !entries.some((entry) => entry.filename === filename))) fail("R6_LOCAL_PRELEGAL_BASELINE_PREREQUISITE_MISSING");
  if (entries.some((entry) => REQUIRED_FORWARD_MIGRATION_FILES.includes(entry.filename))) fail("R6_LOCAL_PRELEGAL_BASELINE_LEGAL_OVERLAP");
  const runtimeRequirements = baselineRequirements(contents);
  const manifest = Object.freeze({
    schemaVersion: LEGAL_LOCAL_PRELEGAL_BASELINE_SCHEMA,
    implementationCommit,
    boundaryMigrationIdentity: boundary.identity,
    boundaryMigrationFilename: boundary.filename,
    baselineMigrationCount: entries.length,
    migrations: Object.freeze(entries),
    baselineInventorySha256: sha256(stableJson(entries)),
    dependencyOrderClassification: "CANONICAL_MIGRATION_IDENTITY_ASCENDING_VERIFIED",
    runtimeRequirements,
    runtimeClassification: runtimeRequirements.length === 0 ? "R6_LOCAL_PRELEGAL_BASELINE_RUNTIME_READY" : LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED,
    checkpointRequirements: createBoundaryCheckpointRequirements(),
    generatedAt,
  });
  validateLegalPrelegalBaselineManifest(manifest, { implementationCommit });
  return manifest;
}

export function validateLegalPrelegalBaselineManifest(manifest, { implementationCommit } = {}) {
  if (!manifest || manifest.schemaVersion !== LEGAL_LOCAL_PRELEGAL_BASELINE_SCHEMA) fail("R6_LOCAL_PRELEGAL_BASELINE_MANIFEST_INVALID");
  if (implementationCommit && manifest.implementationCommit !== implementationCommit) fail("R6_LOCAL_PRELEGAL_BASELINE_COMMIT_MISMATCH");
  if (manifest.boundaryMigrationFilename !== LEGAL_LOCAL_PRELEGAL_BOUNDARY_MIGRATION || manifest.boundaryMigrationIdentity !== "20260703") fail("R6_LOCAL_PRELEGAL_BASELINE_BOUNDARY_INVALID");
  if (!Array.isArray(manifest.migrations) || manifest.baselineMigrationCount !== manifest.migrations.length || manifest.migrations.length === 0) fail("R6_LOCAL_PRELEGAL_BASELINE_MANIFEST_INVALID");
  if (!HASH.test(String(manifest.baselineInventorySha256 ?? ""))) fail("R6_LOCAL_PRELEGAL_BASELINE_INVENTORY_INVALID");
  const observed = manifest.migrations.map((entry, index) => {
    const parsed = parseMigrationFilename(entry.filename);
    if (entry.sequence !== index + 1 || entry.identity !== parsed.identity || entry.repositoryRelativePath !== path.posix.join("supabase", "migrations", entry.filename) || !HASH.test(String(entry.canonicalSha256 ?? ""))) fail("R6_LOCAL_PRELEGAL_BASELINE_ENTRY_INVALID");
    return entry;
  });
  if (new Set(observed.map((entry) => entry.filename)).size !== observed.length || observed.some((entry) => entry.filename === LEGAL_LOCAL_PRELEGAL_BOUNDARY_MIGRATION || REQUIRED_FORWARD_MIGRATION_FILES.includes(entry.filename))) fail("R6_LOCAL_PRELEGAL_BASELINE_DUPLICATE_MIGRATION");
  if (sha256(stableJson(observed)) !== manifest.baselineInventorySha256) fail("R6_LOCAL_PRELEGAL_BASELINE_INVENTORY_INVALID");
  if (!Array.isArray(manifest.runtimeRequirements) || !manifest.runtimeRequirements.every((item) => typeof item === "string")) fail("R6_LOCAL_PRELEGAL_BASELINE_RUNTIME_INVALID");
  if (manifest.runtimeClassification !== LEGAL_LOCAL_PRELEGAL_RUNTIME_REQUIRED && manifest.runtimeClassification !== "R6_LOCAL_PRELEGAL_BASELINE_RUNTIME_READY") fail("R6_LOCAL_PRELEGAL_BASELINE_RUNTIME_INVALID");
  const requirements = createBoundaryCheckpointRequirements();
  if (stableJson(manifest.checkpointRequirements) !== stableJson(requirements)) fail("R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_INVALID");
  return Object.freeze({ classification: "R6_LOCAL_PRELEGAL_BASELINE_MANIFEST_READY", baselineMigrationCount: observed.length, baselineInventorySha256: manifest.baselineInventorySha256 });
}

export function validateLegalPrelegalBaselineCheckpoint(checkpoint, { taskId, implementationCommit, baselineManifestSha256 } = {}) {
  if (!checkpoint || checkpoint.schemaVersion !== "legal-local-prelegal-baseline-checkpoint-v1" || checkpoint.taskId !== taskId || checkpoint.implementationCommit !== implementationCommit || checkpoint.baselineManifestSha256 !== baselineManifestSha256) fail("R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_INCOMPLETE");
  const required = createBoundaryCheckpointRequirements();
  if (checkpoint.classification !== "R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_READY" || checkpoint.relation !== required.relation || !Array.isArray(checkpoint.columns) || !Array.isArray(checkpoint.constraints) || !Array.isArray(checkpoint.functions)) fail("R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_INCOMPLETE");
  for (const key of ["columns", "constraints", "functions"]) if (required[key].some((value) => !checkpoint[key].includes(value))) fail("R6_LOCAL_PRELEGAL_BASELINE_CHECKPOINT_INCOMPLETE");
  return Object.freeze({ classification: checkpoint.classification });
}
