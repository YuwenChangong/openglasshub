import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ORDERED_MIGRATION_FILENAMES = [
  "20260518_forum_phase1_schema.sql",
  "20260519_forum_phase2_grants.sql",
  "20260524_forum_phase3_post_media.sql",
  "20260525_forum_phase4_video_media.sql",
  "20260525_forum_phase5_publish_posts_rls.sql",
  "20260525_forum_phase5_circle_creator_and_images.sql",
  "20260531_forum_phase6_upload_guardrails.sql",
  "20260603_forum_comments_interactions.sql",
  "20260603_forum_hot_sort_and_circle_name_guard.sql",
  "20260603_forum_circle_owner_management.sql",
  "20260604_forum_circle_soft_delete_and_management.sql",
  "20260604_circle_cover_storage_policy.sql",
  "20260605_circle_cover_public_select.sql",
  "20260605_forum_rate_limit_purposes.sql",
  "20260605_forum_posts_body_short_content.sql",
  "20260606_profile_banner_and_storage.sql",
  "20260606_forum_notifications_mvp.sql",
  "20260607_auth_resend_confirmation_limit.sql",
  "20260607_enable_forum_realtime.sql",
  "20260607_fix_notification_relike_update_guard.sql",
  "20260611_fix_forum_notification_realtime.sql",
  "20260611_stabilize_forum_notifications_realtime_permissions.sql",
  "20260611_forum_permission_lockdown.sql",
  "20260612_hot_news_mvp.sql",
  "20260612_news_view_count_and_pagination.sql",
  "20260612_news_media_storage_policy.sql",
  "20260616_community_moderation_mvp.sql",
  "20260620_lock_profile_role_updates.sql",
  "20260620_admin_qa_role_grant_path.sql",
  "20260626_user_safety_states_and_bans.sql",
  "20260627_reports_optimization_mvp.sql",
  "20260703_moderation_action_notifications.sql",
  "20260712_legal_policy_acceptances.sql",
  "20260713_comment_creation_circle_authorization.sql",
  "20260713_comment_reaction_visibility_authorization.sql",
  "20260713_comment_read_circle_visibility_authorization.sql",
  "20260713_forum_posts_circle_authorization.sql",
  "20260713_forum_report_target_authorization.sql",
  "20260713_post_bound_media_provenance.sql",
  "20260714_circle_cover_public_visibility_authorization.sql",
  "20260715_post_media_delivery_visibility_authorization.sql",
  "20260716_profile_media_delivery_authorization.sql",
  "20260717_security_definer_execute_hardening.sql",
];

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const ALLOWED_CONTROL_BYTES = new Set([0x09, 0x0a, 0x0d]);
const legalPrerequisiteNames = [
  "20260703_moderation_action_notifications.sql",
  "20260712_legal_policy_acceptances.sql",
  "20260713_comment_creation_circle_authorization.sql",
  "20260713_comment_reaction_visibility_authorization.sql",
  "20260713_comment_read_circle_visibility_authorization.sql",
  "20260713_forum_posts_circle_authorization.sql",
  "20260713_forum_report_target_authorization.sql",
  "20260713_post_bound_media_provenance.sql",
  "20260714_circle_cover_public_visibility_authorization.sql",
  "20260715_post_media_delivery_visibility_authorization.sql",
  "20260716_profile_media_delivery_authorization.sql",
  "20260717_security_definer_execute_hardening.sql",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hasBomAt(bytes, index) {
  return bytes[index] === 0xef && bytes[index + 1] === 0xbb && bytes[index + 2] === 0xbf;
}

function newlineForm(bytes) {
  let crlf = 0;
  let lf = 0;
  let loneCr = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0d && bytes[index + 1] === 0x0a) {
      crlf += 1;
      index += 1;
    } else if (bytes[index] === 0x0a) {
      lf += 1;
    } else if (bytes[index] === 0x0d) {
      loneCr += 1;
    }
  }
  if (loneCr > 0 || (crlf > 0 && lf > 0)) return "mixed";
  if (crlf > 0) return "CRLF";
  return "LF";
}

export function inspectMigrationBytes(filename, bytes) {
  if (bytes.length === 0) throw new Error(`${filename}: empty SQL migration`);
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new Error(`${filename}: UTF-16 SQL is unsupported`);
  }
  if (bytes.includes(0x00)) throw new Error(`${filename}: NUL byte detected`);

  const hasLeadingUtf8Bom = hasBomAt(bytes, 0);
  for (let index = hasLeadingUtf8Bom ? UTF8_BOM.length : 0; index < bytes.length - 2; index += 1) {
    if (hasBomAt(bytes, index)) throw new Error(`${filename}: UTF-8 BOM appears away from byte offset zero`);
  }

  const sqlBytes = hasLeadingUtf8Bom ? bytes.subarray(UTF8_BOM.length) : bytes;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(sqlBytes);
    if (!Buffer.from(decoded, "utf8").equals(sqlBytes)) throw new Error("round-trip mismatch");
  } catch {
    throw new Error(`${filename}: invalid UTF-8 SQL`);
  }

  for (let index = 0; index < sqlBytes.length; index += 1) {
    const byte = sqlBytes[index];
    if (byte < 0x20 && !ALLOWED_CONTROL_BYTES.has(byte)) {
      throw new Error(`${filename}: unexpected binary control byte 0x${byte.toString(16).padStart(2, "0")}`);
    }
  }

  let firstTokenOffset = 0;
  while (firstTokenOffset < sqlBytes.length && [0x09, 0x0a, 0x0d, 0x20].includes(sqlBytes[firstTokenOffset])) firstTokenOffset += 1;
  if (firstTokenOffset === sqlBytes.length) throw new Error(`${filename}: no SQL token`);

  return {
    size: bytes.length,
    sha256: sha256(bytes),
    encoding: "UTF-8",
    leadingBytes: [...bytes.subarray(0, Math.min(8, bytes.length))].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" "),
    hasLeadingUtf8Bom,
    containsInvalidUtf8: false,
    containsNul: false,
    appearsUtf16: false,
    newlineForm: newlineForm(sqlBytes),
    endsWithNewline: sqlBytes.at(-1) === 0x0a,
    nonBomControlBeforeFirstSqlToken: false,
  };
}

function parseCanonicalName(filename) {
  const match = /^(\d{8})_(.+\.sql)$/.exec(filename);
  if (!match) throw new Error(`Malformed canonical migration filename: ${filename}`);
  return { date: match[1], suffix: match[2] };
}

function isPathWithin(candidate, parent) {
  if (path.parse(candidate).root.toLowerCase() !== path.parse(parent).root.toLowerCase()) return false;
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function orderingBasis(date, count) {
  if (count === 1) return "unique canonical date";
  return "source dependency review; Git introduction chronology; lexical tie-break only";
}

export async function buildLocalSupabaseReplayMirror({ canonicalDirectory, outputDirectory, mappingPath, repositoryRoot }) {
  const canonicalRoot = path.resolve(canonicalDirectory);
  const outputRoot = path.resolve(outputDirectory);
  const repoRoot = path.resolve(repositoryRoot);
  if (!path.isAbsolute(outputDirectory) || !path.isAbsolute(mappingPath)) throw new Error("Mirror output and mapping paths must be absolute");
  if (isPathWithin(outputRoot, repoRoot) || isPathWithin(path.resolve(mappingPath), repoRoot)) {
    throw new Error("Disposable mirror output must be outside the repository");
  }

  const discovered = (await readdir(canonicalRoot)).filter((filename) => filename.endsWith(".sql")).sort();
  if (JSON.stringify(discovered) !== JSON.stringify([...ORDERED_MIGRATION_FILENAMES].sort())) {
    throw new Error("Canonical migration inventory differs from the deterministic 43-file manifest");
  }

  try {
    const existing = await readdir(outputRoot);
    if (existing.length > 0) throw new Error("Disposable mirror output already exists with content");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await mkdir(outputRoot, { recursive: true });
  const dateCounts = new Map();
  const groupCounts = new Map(ORDERED_MIGRATION_FILENAMES.map((filename) => [parseCanonicalName(filename).date, 0]));
  for (const filename of ORDERED_MIGRATION_FILENAMES) {
    const { date } = parseCanonicalName(filename);
    groupCounts.set(date, groupCounts.get(date) + 1);
  }

  const mapping = [];
  for (const canonicalFile of ORDERED_MIGRATION_FILENAMES) {
    const { date, suffix } = parseCanonicalName(canonicalFile);
    const canonicalBytes = await readFile(path.join(canonicalRoot, canonicalFile));
    const audit = inspectMigrationBytes(canonicalFile, canonicalBytes);
    const sequence = (dateCounts.get(date) ?? 0) + 1;
    dateCounts.set(date, sequence);
    const temporaryVersion = `${date}${String(sequence).padStart(6, "0")}`;
    const temporaryFile = `${temporaryVersion}_${suffix}`;
    const transformation = audit.hasLeadingUtf8Bom ? "REMOVE_LEADING_UTF8_BOM" : "NONE";
    const temporaryBytes = audit.hasLeadingUtf8Bom ? canonicalBytes.subarray(UTF8_BOM.length) : canonicalBytes;
    const expectedBytes = audit.hasLeadingUtf8Bom ? canonicalBytes.subarray(UTF8_BOM.length) : canonicalBytes;
    if (!temporaryBytes.equals(expectedBytes)) throw new Error(`${canonicalFile}: unsupported byte transformation`);
    await writeFile(path.join(outputRoot, temporaryFile), temporaryBytes, { flag: "wx" });
    const replayBytes = await readFile(path.join(outputRoot, temporaryFile));
    if (!replayBytes.equals(expectedBytes)) throw new Error(`${canonicalFile}: replay bytes differ from the permitted transformation`);
    mapping.push({
      canonicalFile,
      canonicalVersion: date,
      duplicateGroupCount: groupCounts.get(date),
      orderingBasis: orderingBasis(date, groupCounts.get(date)),
      temporaryVersion,
      temporaryFile,
      transformation,
      canonicalAudit: audit,
      canonicalSha256: sha256(canonicalBytes),
      replaySha256: sha256(replayBytes),
      replayBytesEqualCanonicalSlice: true,
    });
  }

  const temporaryVersions = mapping.map((entry) => entry.temporaryVersion);
  if (new Set(temporaryVersions).size !== ORDERED_MIGRATION_FILENAMES.length) throw new Error("Temporary migration versions are not unique");
  const legalOrder = mapping.filter((entry) => legalPrerequisiteNames.includes(entry.canonicalFile)).map((entry) => entry.canonicalFile);
  if (JSON.stringify(legalOrder) !== JSON.stringify(legalPrerequisiteNames)) throw new Error("Legal-consent prerequisite order changed in mirror");

  const report = {
    classification: "LOCAL_DOCKER_ONLY_DISPOSABLE_REPLAY_MIRROR",
    migrationCount: mapping.length,
    temporaryVersionCount: new Set(temporaryVersions).size,
    bomTransformedFiles: mapping.filter((entry) => entry.transformation !== "NONE").map((entry) => entry.canonicalFile),
    legalPrerequisites: legalOrder,
    mappings: mapping,
  };
  await mkdir(path.dirname(mappingPath), { recursive: true });
  await writeFile(mappingPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  return report;
}

function readRequiredArgument(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || !argv[index + 1]) throw new Error(`Missing ${name}`);
  return argv[index + 1];
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDirectory, "..");
  const outputDirectory = readRequiredArgument(process.argv.slice(2), "--output");
  const mappingPath = readRequiredArgument(process.argv.slice(2), "--mapping");
  const report = await buildLocalSupabaseReplayMirror({
    canonicalDirectory: path.join(repositoryRoot, "supabase", "migrations"),
    outputDirectory,
    mappingPath,
    repositoryRoot,
  });
  console.log(JSON.stringify({ migrationCount: report.migrationCount, bomTransformedFiles: report.bomTransformedFiles, localOnly: true }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
