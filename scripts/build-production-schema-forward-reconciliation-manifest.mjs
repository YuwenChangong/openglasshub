import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseExport, compareFingerprint } from "./compare-production-schema-fingerprint.mjs";
import { normalize, rowKey, rowsFromFingerprint, sha256, validateProductionExport } from "./production-schema-fingerprint-core.mjs";

const REQUIRED_CLASSIFICATIONS = new Set(["MISSING_IN_PRODUCTION", "DIVERGENT_IN_PRODUCTION"]);
const WAVES = [
  { id: "W0_OPERATOR_GATE", dependencies: [], domain: "operator", operationTypes: ["NO_SQL"], maxObjects: 0 },
  { id: "W1_ACL_FUNCTION_HARDENING", dependencies: ["W0_OPERATOR_GATE"], domain: "function-acl", operationTypes: ["REPLACE_FUNCTION", "REVOKE_AND_GRANT"], maxObjects: 15 },
  { id: "W2A_LEGAL_TABLE_COLUMNS", dependencies: ["W0_OPERATOR_GATE"], domain: "legal-consent", operationTypes: ["CREATE_MISSING"], maxObjects: 15 },
  { id: "W2B_LEGAL_CONSTRAINTS_TRIGGER", dependencies: ["W2A_LEGAL_TABLE_COLUMNS"], domain: "legal-consent", operationTypes: ["ADD_CONSTRAINT_NOT_VALID_THEN_VALIDATE", "CREATE_MISSING"], maxObjects: 15 },
  { id: "W2C_LEGAL_INDEXES", dependencies: ["W2B_LEGAL_CONSTRAINTS_TRIGGER"], domain: "legal-consent", operationTypes: ["CREATE_INDEX_CONCURRENTLY"], maxObjects: 15 },
  { id: "W2D_LEGAL_RLS_GRANTS", dependencies: ["W2A_LEGAL_TABLE_COLUMNS"], domain: "legal-consent", operationTypes: ["DROP_AND_RECREATE_POLICY_IN_TRANSACTION", "REVOKE_AND_GRANT"], maxObjects: 15 },
  { id: "W2E_LEGAL_RPC_ACL", dependencies: ["W2A_LEGAL_TABLE_COLUMNS"], domain: "legal-consent", operationTypes: ["REPLACE_FUNCTION", "REVOKE_AND_GRANT"], maxObjects: 15 },
  { id: "W3A_PUBLIC_CIRCLE_BOUNDARY", dependencies: ["W0_OPERATOR_GATE"], domain: "circle-visibility", operationTypes: ["REPLACE_FUNCTION", "DROP_AND_RECREATE_POLICY_IN_TRANSACTION"], maxObjects: 15 },
  { id: "W3B_COMMENT_REACTION_AUTHORIZATION", dependencies: ["W3A_PUBLIC_CIRCLE_BOUNDARY"], domain: "comments", operationTypes: ["REPLACE_FUNCTION", "DROP_AND_RECREATE_POLICY_IN_TRANSACTION", "REVOKE_AND_GRANT"], maxObjects: 15 },
  { id: "W4_POST_AND_REPORT_AUTHORIZATION", dependencies: ["W3A_PUBLIC_CIRCLE_BOUNDARY", "W1_ACL_FUNCTION_HARDENING"], domain: "posts-reports", operationTypes: ["REPLACE_FUNCTION", "DROP_AND_RECREATE_POLICY_IN_TRANSACTION"], maxObjects: 15 },
  { id: "W5_MEDIA_PROVENANCE_AND_DELIVERY", dependencies: ["W3A_PUBLIC_CIRCLE_BOUNDARY", "W4_POST_AND_REPORT_AUTHORIZATION"], domain: "media", operationTypes: ["REPLACE_FUNCTION", "DROP_AND_RECREATE_POLICY_IN_TRANSACTION"], maxObjects: 15 },
  { id: "W6_OPERATIONAL_GUARDRAILS", dependencies: ["W0_OPERATOR_GATE"], domain: "operational-drift", operationTypes: ["CREATE_INDEX_CONCURRENTLY", "ALTER_EXISTING", "HUMAN_DECISION_REQUIRED"], maxObjects: 15 },
];

const CONTEXT = {
  legal: { callers: ["src/lib/server/legal-consent-repository.server.ts", "src/pages/api/legal/acceptance.ts"], dependencies: ["auth.users", "set_updated_at"], verification: ["aggregate duplicate user/bundle count is zero", "aggregate invalid version/count rows is zero", "RLS/ACL catalog fingerprint matches"], data: "ADDITIONAL_READ_ONLY_PREFLIGHT_REQUIRED", rollback: "FORWARD_FIX_ONLY" },
  acl: { callers: ["src/lib/post-engagement.ts", "src/lib/server/moderation-notifications.server.ts", "src/pages/api/forum/reports.ts"], dependencies: ["exact function signature", "function owner", "SECURITY DEFINER", "trusted search_path"], verification: ["function definition, owner, search_path, and ACL fingerprint matches", "runtime caller role matrix passes in non-production"], data: "NO_DOMAIN_DATA_CHANGE", rollback: "FORWARD_FIX_ONLY" },
  comments: { callers: ["src/pages/api/forum/comments.ts", "src/components/forum/CommentsSection.tsx"], dependencies: ["comments", "posts", "circles", "can_access_public_circle"], verification: ["aggregate inaccessible-comment/reaction ancestry count is zero", "RLS policy fingerprint matches"], data: "ADDITIONAL_READ_ONLY_PREFLIGHT_REQUIRED", rollback: "FORWARD_FIX_ONLY" },
  posts: { callers: ["src/pages/api/forum/posts.ts", "src/lib/forum-feed.ts", "src/lib/post-engagement.ts"], dependencies: ["posts", "circles", "can_access_public_circle"], verification: ["aggregate posts with missing/inaccessible circles is zero", "public feed and view-count non-production checks pass"], data: "ADDITIONAL_READ_ONLY_PREFLIGHT_REQUIRED", rollback: "FORWARD_FIX_ONLY" },
  reports: { callers: ["src/pages/api/forum/reports.ts", "src/pages/api/admin/reports/[id]/action.ts"], dependencies: ["reports", "report_events", "can_access_public_circle"], verification: ["aggregate invalid report targets is zero", "report create/admin moderation matrix passes"], data: "ADDITIONAL_READ_ONLY_PREFLIGHT_REQUIRED", rollback: "FORWARD_FIX_ONLY" },
  media: { callers: ["src/pages/api/forum/post-media.ts", "src/pages/api/forum/external-video-upload.ts", "src/lib/r2-server.ts"], dependencies: ["post_media", "posts", "circles", "storage.objects"], verification: ["aggregate malformed/cross-owner/cross-post media-key count is zero", "storage and post-media RLS fingerprint matches"], data: "ADDITIONAL_READ_ONLY_PREFLIGHT_REQUIRED", rollback: "FORWARD_FIX_ONLY" },
  circles: { callers: ["src/pages/api/forum/circles.ts", "src/lib/forum-feed.ts"], dependencies: ["circles"], verification: ["circle status/visibility catalog fingerprint matches", "public-circle non-production smoke passes"], data: "ADDITIONAL_READ_ONLY_PREFLIGHT_REQUIRED", rollback: "FORWARD_FIX_ONLY" },
  operations: { callers: ["src/lib/server/rate-limit.ts", "src/pages/api/forum/external-video-upload.ts"], dependencies: ["forum_upload_attempts"], verification: ["rate-limit indexes and policies match", "aggregate duplicate operational rows is reviewed"], data: "ADDITIONAL_READ_ONLY_PREFLIGHT_REQUIRED", rollback: "FORWARD_FIX_ONLY" },
  drift: { callers: [], dependencies: [], verification: ["catalog fingerprint matches expected object"], data: "HUMAN_DECISION_REQUIRED", rollback: "HUMAN_DECISION_REQUIRED" },
};

function domainFor(row) {
  const text = `${row.schema_name}|${row.object_name}|${row.identity}`.toLowerCase();
  if (text.includes("legal_policy") || text.includes("record_current_legal")) return "legal";
  if (text.includes("insert_forum_notification") || text.includes("increment_post_view_count")) return "acl";
  if (text.includes("report")) return "reports";
  if (text.includes("comment")) return "comments";
  if (text.includes("media") || text.includes("circle_cover") || text.includes("storage.objects")) return "media";
  if (text.includes("post")) return "posts";
  if (text.includes("circle")) return "circles";
  if (text.includes("upload_attempt")) return "operations";
  return "drift";
}

function waveFor(row, classification, domain) {
  const text = `${row.object_name}|${row.identity}|${row.attribute}`.toLowerCase();
  if (domain === "acl") return "W1_ACL_FUNCTION_HARDENING";
  if (domain === "legal") {
    if (row.section === "columns" || row.section === "schemas_and_tables") return "W2A_LEGAL_TABLE_COLUMNS";
    if (row.section === "constraints_and_indexes" && row.object_type === "constraint") return "W2B_LEGAL_CONSTRAINTS_TRIGGER";
    if (row.section === "triggers") return "W2B_LEGAL_CONSTRAINTS_TRIGGER";
    if (row.section === "constraints_and_indexes") return "W2C_LEGAL_INDEXES";
    if (row.section === "functions" || row.section === "function_acl" || row.object_type === "function_grant") return "W2E_LEGAL_RPC_ACL";
    return "W2D_LEGAL_RLS_GRANTS";
  }
  if (domain === "circles") return "W3A_PUBLIC_CIRCLE_BOUNDARY";
  if (domain === "comments") return "W3B_COMMENT_REACTION_AUTHORIZATION";
  if (domain === "posts" || domain === "reports") return "W4_POST_AND_REPORT_AUTHORIZATION";
  if (domain === "media") return "W5_MEDIA_PROVENANCE_AND_DELIVERY";
  if (domain === "operations") return "W6_OPERATIONAL_GUARDRAILS";
  return classification === "EXTRA_IN_PRODUCTION" ? "W7_HUMAN_REVIEWED_EXTRAS" : "W6_OPERATIONAL_GUARDRAILS";
}

function severityFor(result, row, domain) {
  if (result.classification === "MISSING_IN_PRODUCTION") {
    return result.severity === "SECURITY_BROADENING" || result.severity === "POSSIBLE_SECURITY_BROADENING" ? "P1_REQUIRED_SECURITY_OBJECT_MISSING" : "P3_NON_SECURITY_SCHEMA_DRIFT";
  }
  if (result.severity === "SECURITY_BROADENING" || result.severity === "POSSIBLE_SECURITY_BROADENING") return "P0_SECURITY_BROADENING";
  if (result.classification === "DIVERGENT_IN_PRODUCTION") return "P2_SECURITY_AVAILABILITY_DIVERGENCE";
  return "P3_NON_SECURITY_SCHEMA_DRIFT";
}

function strategyFor(result, row) {
  if (result.classification === "EXTRA_IN_PRODUCTION") return result.severity === "HARMLESS_EXTRA_OBJECT" ? "RETAIN_EXTRA_OBJECT" : "HUMAN_DECISION_REQUIRED";
  if (row.object_type === "policy") return "DROP_AND_RECREATE_POLICY_IN_TRANSACTION";
  if (row.object_type === "function" || row.object_type.endsWith("grant")) return row.object_type.endsWith("grant") ? "REVOKE_AND_GRANT" : "REPLACE_FUNCTION";
  if (row.object_type === "index") return "CREATE_INDEX_CONCURRENTLY";
  if (row.object_type === "constraint") return "ADD_CONSTRAINT_NOT_VALID_THEN_VALIDATE";
  return result.classification === "MISSING_IN_PRODUCTION" ? "CREATE_MISSING" : "ALTER_EXISTING";
}

function repairObjectId(row) {
  if (row.object_type === "function" || row.object_type === "function_grant") return `function:${row.schema_name}:${row.identity}`;
  if (row.object_type === "table_grant") return `table-acl:${row.schema_name}:${row.identity}`;
  return `${row.object_type}:${row.schema_name}:${row.identity}`;
}

function sourceMigrationsFor(entry, row) {
  if (entry?.sourceMigrations?.length) return entry.sourceMigrations;
  const text = `${row.object_name}|${row.identity}`.toLowerCase();
  if (text.includes("insert_forum_notification")) return ["20260703_moderation_action_notifications.sql", "20260717_security_definer_execute_hardening.sql"];
  if (text.includes("increment_post_view_count")) return ["20260713_forum_posts_circle_authorization.sql", "20260717_security_definer_execute_hardening.sql"];
  if (text.includes("comment_reaction")) return ["20260713_comment_reaction_visibility_authorization.sql"];
  if (text.includes("forum_upload")) return ["20260531_forum_phase6_upload_guardrails.sql"];
  return [];
}

function wave1Status(identity) {
  if (identity === "increment_post_view_count(uuid)") return {
    proposalStatus: "PROPOSAL_AUTHORED_LOCAL_VALIDATED",
    bodyEvidence: "FORENSIC_DIFF_SECURITY_BROADENING_NO_PRODUCT_DECISION",
    preflightRequired: true,
    proposalFile: "docs/ops/reconciliation/legal-consent-production-wave1b-proposal.sql",
    localSimulationStatus: "LOCAL_DOCKER_ONLY_BODY_METADATA_ACL_AND_BEHAVIOR_CONVERGENCE_VALIDATED",
    verificationStatus: "FORENSIC_BODY_DIFF_AND_LOCAL_CONVERGENCE_VALIDATED",
    blockerStatus: "BLOCKED_PENDING_NON_PRODUCTION_APPROVAL",
    nextApprovalRequired: "Fresh preflight attachment, target verification, backup readiness, and human non-production approval",
  };
  if (identity === "insert_forum_notification(uuid,uuid,text,uuid,uuid,uuid)") return {
    proposalStatus: "PROPOSAL_AUTHORED_LOCAL_VALIDATED",
    bodyEvidence: "EXACT_BODY_MATCH",
    preflightRequired: true,
    proposalFile: "docs/ops/reconciliation/legal-consent-production-wave1-proposal.sql",
    localSimulationStatus: "LOCAL_DOCKER_ONLY_ACL_CONVERGENCE_VALIDATED",
    verificationStatus: "BODY_HASH_AND_ACL_CONVERGENCE_VALIDATED",
    blockerStatus: "BLOCKED_PENDING_NON_PRODUCTION_APPROVAL",
    nextApprovalRequired: "Fresh preflight attachment, target verification, backup readiness, and human non-production approval",
  };
  return null;
}

export function buildManifest({ expected, actualRows, comparedCommit, exportSha256 }) {
  validateProductionExport(actualRows);
  const report = compareFingerprint(expected, actualRows);
  const expectedRows = rowsFromFingerprint(expected);
  const expectedByKey = new Map(expectedRows.map((row) => [rowKey(row), row]));
  const expectedEntryByKey = new Map(expected.objects.map((entry) => [rowKey({ section: sectionFor(entry), object_type: entry.objectType, schema_name: entry.schema, object_name: entry.name, identity: entry.identity, attribute: entry.attribute }), entry]));
  const actualByKey = new Map(actualRows.filter((row) => row.section !== "migration_ledger").map((row) => [rowKey(row), row]));
  const selected = report.objectResults.filter((result) => REQUIRED_CLASSIFICATIONS.has(result.classification) || result.classification === "EXTRA_IN_PRODUCTION" && result.severity !== "HARMLESS_EXTRA_OBJECT");
  const items = selected.map((result) => {
    const expectedRow = expectedByKey.get(result.key);
    const actualRow = actualByKey.get(result.key);
    const row = expectedRow ?? actualRow;
    const entry = expectedEntryByKey.get(result.key);
    const domain = domainFor(row);
    const context = CONTEXT[domain];
    const wave1 = row.identity === "increment_post_view_count(uuid)" || row.identity === "insert_forum_notification(uuid,uuid,text,uuid,uuid,uuid)" ? wave1Status(row.identity) : null;
    return {
      itemId: `reconcile:${sha256(result.key).slice(0, 20)}`,
      repairObjectId: repairObjectId(row),
      comparisonKey: result.key,
      comparisonClassification: result.classification,
      securityClassification: result.severity,
      severity: severityFor(result, row, domain),
      availabilityClassification: result.severity === "POSSIBLE_AVAILABILITY_BREAK" ? "POSSIBLE_AVAILABILITY_BREAK" : "REVIEW_REQUIRED",
      domain,
      proposedWave: waveFor(row, result.classification, domain),
      objectType: row.object_type,
      schema: row.schema_name,
      name: row.object_name,
      identity: row.identity,
      attribute: row.attribute,
      expectedDefinition: expectedRow?.value ?? null,
      expectedHash: expectedRow?.definition_hash || entry?.deterministicSha256 || null,
      observedProductionDefinition: actualRow ? normalize(actualRow.value) : null,
      observedProductionHash: actualRow ? sha256(normalize(actualRow.value)) : null,
      sourceMigrations: sourceMigrationsFor(entry, row),
      currentRuntimeCallers: context.callers,
      dependentObjects: context.dependencies,
      productionDataState: context.data,
      safeReplacement: context.data === "NO_DOMAIN_DATA_CHANGE",
      forwardOnlyRequired: true,
      reconciliationStrategy: strategyFor(result, row),
      rollbackClass: context.rollback,
      verificationRequirements: context.verification,
      blockerStatus: result.severity === "HARMLESS_EXTRA_OBJECT" ? "RETAINED_NON_BLOCKER" : "BLOCKED_PENDING_REVIEW",
      conciseReason: `${result.classification}: ${result.severity}; ${row.section}/${row.object_type} ${row.identity} (${row.attribute}) differs from the verified local fingerprint and requires a reviewed forward-only decision.`,
      ...(wave1 ?? {}),
    };
  }).sort((left, right) => left.comparisonKey.localeCompare(right.comparisonKey));
  const uniqueRepairObjects = [...new Set(items.map((item) => item.repairObjectId))];
  return {
    format: "openglass-production-schema-forward-reconciliation-v1",
    comparedCommit,
    exportSha256,
    expectedEntryCount: expected.objectCount,
    parsedProductionEntryCount: actualRows.length,
    comparisonCounts: report.counts,
    securityFindingCount: report.hardBlockers.length,
    actionableManifestItemCount: items.length,
    uniqueRepairObjectCount: uniqueRepairObjects.length,
    sourceMigrationsChanged: false,
    productionCsvCommitted: false,
    waves: WAVES,
    items,
  };
}

function sectionFor(entry) {
  if (entry.objectType === "section_marker") return "packet_sections";
  if (entry.objectType === "policy") return "policies";
  if (entry.objectType === "function" && entry.attribute.endsWith("_execute")) return "function_acl";
  if (entry.objectType.endsWith("grant")) return "grants";
  if (entry.objectType === "column") return "columns";
  if (["table", "schema"].includes(entry.objectType)) return "schemas_and_tables";
  if (["constraint", "index"].includes(entry.objectType)) return "constraints_and_indexes";
  return entry.objectType === "storage_bucket" ? "migration_configuration" : `${entry.objectType}s`;
}

async function main() {
  const [exportPath, outputPath] = process.argv.slice(2);
  if (!exportPath || !outputPath) throw new Error("Usage: node scripts/build-production-schema-forward-reconciliation-manifest.mjs export.csv output.json");
  const root = process.cwd();
  const [expectedText, exportText] = await Promise.all([readFile(path.join(root, "tests", "fixtures", "production-schema-expected-fingerprint.json"), "utf8"), readFile(path.resolve(exportPath), "utf8")]);
  const actualRows = parseExport(exportText, exportPath);
  const manifest = buildManifest({ expected: JSON.parse(expectedText), actualRows, comparedCommit: "4af2a9b023c7c75b53d40fdbe49e28de5021fc52", exportSha256: "665B90027392A3D91FB45E4A88D6B0B7F4A10E98FB2B292FD5BE775A84DCBAEF" });
  await writeFile(path.resolve(outputPath), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ actionableManifestItemCount: manifest.actionableManifestItemCount, uniqueRepairObjectCount: manifest.uniqueRepairObjectCount, securityFindingCount: manifest.securityFindingCount }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
