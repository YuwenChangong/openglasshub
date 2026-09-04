import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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
  "20260814_admin_circle_lifecycle_and_safe_purge.sql",
  "20260829_device_library_admin.sql",
  "20260829_device_slug_lock.sql",
  "20260829054707_device_service_role_bootstrap_grants.sql",
  "20260902042807_forward_reconcile_devices.sql",
];

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const ALLOWED_CONTROL_BYTES = new Set([0x09, 0x0a, 0x0d]);
const CANONICAL_MIGRATION_SHA256 = new Map([
  ["20260518_forum_phase1_schema.sql", "d7bc1f7732d9694d1a6c0f699f38ee42183e8d13c9784e21b19fa64ec392978d"],
  ["20260519_forum_phase2_grants.sql", "21542c25c7c2b37f421043e5de103d8eb07dca583316023ed6f55f35ed403aa0"],
  ["20260524_forum_phase3_post_media.sql", "e99cec8d49003b0b8648b0a9c2ea85d7fa53cb7cb854051d2ef2d07ef895137e"],
  ["20260525_forum_phase4_video_media.sql", "3783e46a895ed6b969f588d96a0e512fabaf00878d7b822ff19024475df6125a"],
  ["20260525_forum_phase5_publish_posts_rls.sql", "9b37b6e37f835028c40df997e95b6650deb8ce512262497efe395e518fd10fe0"],
  ["20260525_forum_phase5_circle_creator_and_images.sql", "489d8c7ff6596909333470e92e0262afb096cb8d1740485fe5d066b1e66b40c8"],
  ["20260531_forum_phase6_upload_guardrails.sql", "9c8f4b4eb4f4ad704f239c987c7125005d8b6e4b7cb43dc2f92d5f4bdb6ffc55"],
  ["20260603_forum_comments_interactions.sql", "2dc45626b146fbf97ed56d010b2592f0d5e8a778f4c2c6c339d9b171826613b4"],
  ["20260603_forum_hot_sort_and_circle_name_guard.sql", "00d3050d63ff2e93492a4edb0d0235dc447dac46ff9232fffa79f7f4ae72a2e5"],
  ["20260603_forum_circle_owner_management.sql", "b5b77824ac54f1332f54dc68c3c80b38578fd942d44d6cd611186fd9ac060f57"],
  ["20260604_forum_circle_soft_delete_and_management.sql", "32334d5063c9b28c6962ed7770330f5f4e9936c59967915e6c1a3527b3b1e421"],
  ["20260604_circle_cover_storage_policy.sql", "1aadb3e79ab8d42289ed42d98bb1cdcb7e5d1de303a556b24133128f57f57f25"],
  ["20260605_circle_cover_public_select.sql", "63d537930b1ba7aaad28ab3355e723d34d884ba0a8c5e50847e8424489910ad1"],
  ["20260605_forum_rate_limit_purposes.sql", "041da6d0e18ac16e3e173546a04726b18c74b39630c10fb9ab0fbbea3b51a2ad"],
  ["20260605_forum_posts_body_short_content.sql", "a2bab89f2126504ad51eed90c61a22c940ebdce5c2f0666e4b4a0d6e348b0cd1"],
  ["20260606_profile_banner_and_storage.sql", "6269207b03e8638f4274be7388a90b2e9bfa0c21f0c15acb86f95ca766765da4"],
  ["20260606_forum_notifications_mvp.sql", "c30763b24b8ea8297f44566127d39b880a7499b80b398977330af1d007fdeed3"],
  ["20260607_auth_resend_confirmation_limit.sql", "b92c26b0ba3945be971df3a4028f7710bf4648ec44ea6d4ca4d8576b8eefd2ec"],
  ["20260607_enable_forum_realtime.sql", "bdb41a8ccf7f58a01cf1147a4d252e3586ddcea9075d852c1728baff1ed3fa44"],
  ["20260607_fix_notification_relike_update_guard.sql", "58320e0a0c9e6b3a82069dcb4ea8d352f611ca3ef2c66f3bad4bb7f9ce4588da"],
  ["20260611_fix_forum_notification_realtime.sql", "ee4c4d50043fce45eea0b70fc3de040e412fb97547c9f4d55135cbbed417f064"],
  ["20260611_stabilize_forum_notifications_realtime_permissions.sql", "11d7f72735b8e31df5978fce19af52be6d9687bb2428c04c9157bf7ae93bcfd3"],
  ["20260611_forum_permission_lockdown.sql", "8fc4d72dac5a1fe8ef6fcd80a79754e6834d0f11914810978d3c60786e5f5e07"],
  ["20260612_hot_news_mvp.sql", "34ae3035ccdda7acc8a14ce7b2618ba6314d2a37c813297c8748830e8985274c"],
  ["20260612_news_view_count_and_pagination.sql", "ccc6a53d1c6148e03bcd167fba087f80ebe0ea4d9e03abcd78a3f06cbed6424f"],
  ["20260612_news_media_storage_policy.sql", "da48e0ec534b489ee1cc7ebeacd1b9e8912bd426bed5a4d179986319c63a2ba6"],
  ["20260616_community_moderation_mvp.sql", "ce009b9ad3e062002a04333e9520c0cd72a420c56c695e8464cc5052421fba87"],
  ["20260620_lock_profile_role_updates.sql", "5154b6e7da1a8c55d4181c6270c22972a6e6841d12a3b9f534193d80f60f24f1"],
  ["20260620_admin_qa_role_grant_path.sql", "27599662f9b2aa86cfbe72ceeb56c08b8ebd9e6256716745550818eccba7936a"],
  ["20260626_user_safety_states_and_bans.sql", "dd67ef344b44cdcbd7d6ef704931b8dc053584108850c3e62fae5c96d813f96b"],
  ["20260627_reports_optimization_mvp.sql", "5fae219c9562965ba539143838e22e8c3fdda15eddc904cc17c0c93db790fb21"],
  ["20260703_moderation_action_notifications.sql", "3c354d714d2a050b7f02efd646fb2becc6939848f9397fabc8c94013234407d3"],
  ["20260712_legal_policy_acceptances.sql", "b40867c1f085e8d5cb83eac8e8300da2a9f7086b789c7b851de6e206b5e95374"],
  ["20260713_comment_creation_circle_authorization.sql", "84fdaa9b3519ff38ecf1b3ecf43e3601bc28d72f842418e986b351bb32618f26"],
  ["20260713_comment_reaction_visibility_authorization.sql", "09cd413ff6d6271522f59066a4e698188c4ea41b914c795e377a96eccda07bb6"],
  ["20260713_comment_read_circle_visibility_authorization.sql", "a09a1bbe73e3bc7729cb5d41d312e4a2487d3f1109317840ec6d6f802fa99845"],
  ["20260713_forum_posts_circle_authorization.sql", "5486fe9dcbc4123f35d2f0640a0cbdf0d90790710af6a6f2bddb49b627f13a5a"],
  ["20260713_forum_report_target_authorization.sql", "e1513ee78cd48dfaaa686f66a7b123a7270c88de06964ef015e94168a1128121"],
  ["20260713_post_bound_media_provenance.sql", "b8c18247dba2f62f373d61bf8ed6ef3c7d556b01fa791cc51c35fef42c82d59e"],
  ["20260714_circle_cover_public_visibility_authorization.sql", "d13086c379ae578ab6fb11415fec8d39b2fa06bd4f9067f66e68017b7bedd0b6"],
  ["20260715_post_media_delivery_visibility_authorization.sql", "fe61319e4608f50a742cf1371a89ab8ebf94426f10ad080b4ce62e0bae4ed90a"],
  ["20260716_profile_media_delivery_authorization.sql", "4ec3e14486d6940c1380c0a67c85889bced7842b22f1ea8ae342233f4a3fcd77"],
  ["20260717_security_definer_execute_hardening.sql", "ca444ab20fd44ffd07f44f0ce95f8afaee458b603d57bf15e0d64364416bc2df"],
  ["20260814_admin_circle_lifecycle_and_safe_purge.sql", "0cffadf9013286d3d57997d49b42fca20d21299f5c9214fd101e77c9acdb6433"],
  ["20260829054707_device_service_role_bootstrap_grants.sql", "f36212527389dfcda8099029912fc824bc0179012a3efc0c5aa83eb348c1ed69"],
  ["20260829_device_library_admin.sql", "4427bf0506fb82b634994069418fd3bc7c31617eeaadddf2bfef8ab2363d7904"],
  ["20260829_device_slug_lock.sql", "26e47a4a68d8201bfb87aed906e054e08e5a4f3e010557289ae05dd673dd4543"],
  ["20260902042807_forward_reconcile_devices.sql", "2f98fea88b4b5619dce82a0e48c0653c96f4db3e212d6f52a85fbab083405e65"],
]);
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
  const match = /^(\d{8})(?:\d{6})?_(.+\.sql)$/.exec(filename);
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

function normalizeWorkingTreeLineEndings(bytes) {
  const normalized = [];
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0d) {
      if (bytes[index + 1] !== 0x0a) throw new Error("Canonical migration worktree contains a lone CR byte");
      normalized.push(0x0a);
      index += 1;
    } else {
      normalized.push(bytes[index]);
    }
  }
  return Buffer.from(normalized);
}

async function readCanonicalMigrationBytes({ canonicalRoot, repositoryRoot, filename }) {
  const sourcePath = path.join(canonicalRoot, filename);
  const workingBytes = await readFile(sourcePath);
  const repositoryMigrations = path.join(repositoryRoot, "supabase", "migrations");
  if (path.resolve(canonicalRoot) !== path.resolve(repositoryMigrations)) return workingBytes;

  const gitPath = `supabase/migrations/${filename}`;
  const canonicalBytes = execFileSync("git", ["-C", repositoryRoot, "cat-file", "blob", `HEAD:${gitPath}`]);
  if (!normalizeWorkingTreeLineEndings(workingBytes).equals(canonicalBytes)) {
    throw new Error(`${filename}: worktree content differs from the canonical Git migration identity`);
  }
  return canonicalBytes;
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
    throw new Error("Canonical migration inventory differs from the deterministic 48-file manifest");
  }
  if (CANONICAL_MIGRATION_SHA256.size !== ORDERED_MIGRATION_FILENAMES.length || ORDERED_MIGRATION_FILENAMES.some((filename) => !CANONICAL_MIGRATION_SHA256.has(filename))) {
    throw new Error("Canonical migration SHA-256 anchor inventory is incomplete");
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
    const canonicalBytes = await readCanonicalMigrationBytes({ canonicalRoot, repositoryRoot: repoRoot, filename: canonicalFile });
    const audit = inspectMigrationBytes(canonicalFile, canonicalBytes);
    const expectedSha256 = CANONICAL_MIGRATION_SHA256.get(canonicalFile);
    if (expectedSha256 && audit.sha256 !== expectedSha256) {
      throw new Error(`${canonicalFile}: canonical SHA-256 differs from the deterministic manifest`);
    }
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
