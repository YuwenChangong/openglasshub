import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OUTPUT_COLUMNS = [
  "packet_version", "phase", "section_order", "check_order", "check_id", "object_identity",
  "expected_value", "actual_value_redacted", "status", "blocking", "classification", "evidence_fingerprint",
];

export const CAPTURE_VERSION = "r6-schema-aware-capture-v1";

export const CONTRACTS = {
  preflight: {
    version: "r6-single-result-preflight-v3",
    phase: "R6-2",
    classifications: new Set(["FUNCTION_ABSENT_SAFE_TO_CREATE", "EXACT_FUNCTION_ALREADY_PRESENT", "CONFLICTING_FUNCTION_PRESENT", "INSUFFICIENT_EVIDENCE"]),
    checks: ["target_database_fingerprint", "attempts_relation", "required_columns", "index_ip_exact", "index_user_exact", "index_no_equivalent_conflict", "index_inventory_fingerprint", "rls_enabled", "force_rls_state", "policy_inventory_fingerprint", "table_privileges_fingerprint", "target_function_overloads", "target_function_signature", "target_function_metadata_fingerprint", "target_function_acl_fingerprint", "resend_source_contract", "resend_acl_contract", "resend_target_identity_separation", "resend_metadata_fingerprint", "resend_acl_fingerprint"],
  },
  postflight: {
    version: "r6-single-result-postflight-v3",
    phase: "R6-6",
    classifications: new Set(["PRODUCTION_RPC_POSTFLIGHT_PASSED", "PRODUCTION_RPC_POSTFLIGHT_FAILED", "PRODUCTION_RPC_STATE_AMBIGUOUS"]),
    checks: ["target_relation_present", "target_function_overloads", "target_function_signature", "target_function_owner", "target_function_security", "target_function_return", "target_function_settings", "target_function_acl", "target_function_fingerprint", "baseline_policy_fingerprint", "baseline_index_fingerprint", "baseline_grant_fingerprint", "resend_source_contract", "resend_acl_contract", "resend_target_identity_separation", "baseline_resend_metadata_fingerprint", "baseline_resend_acl_fingerprint"],
  },
};

const RESEND_IDENTITY = "public.consume_verification_email_resend_limit(text,integer,integer)";
const resendChecks = new Set(["resend_source_contract", "resend_acl_contract", "resend_target_identity_separation", "resend_metadata_fingerprint", "resend_acl_fingerprint", "baseline_resend_metadata_fingerprint", "baseline_resend_acl_fingerprint"]);

const forbidden = /(?:\b(?:password|secret|token|connection_string|service_role_key)\b|\b(?:auth\.users|forum_upload_attempts\s+where)\b|@)/i;
const parseCsv = (text) => {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { value += '"'; i += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === ',') { row.push(value); value = ""; continue; }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(value); value = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      continue;
    }
    value += char;
  }
  if (quoted) throw new Error("malformed CSV quoting");
  if (value !== "" || row.length) { row.push(value); rows.push(row); }
  return rows;
};

export function parsePacketCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("packet has no data rows");
  if (rows[0].join("\u0000") !== OUTPUT_COLUMNS.join("\u0000")) throw new Error("packet schema mismatch");
  return rows.slice(1).map((values) => {
    if (values.length !== OUTPUT_COLUMNS.length) throw new Error("malformed packet row");
    return Object.fromEntries(OUTPUT_COLUMNS.map((column, index) => [column, values[index]]));
  });
}

export function parsePacketDocument(text) {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{")) return parsePacketCsv(text);
  let capture;
  try {
    capture = JSON.parse(text);
  } catch {
    throw new Error("invalid capture JSON");
  }
  if (!capture || typeof capture !== "object" || Array.isArray(capture)) throw new Error("invalid capture document");
  const keys = Object.keys(capture).sort();
  if (keys.join("\u0000") !== ["capture_version", "kind", "rows"].join("\u0000")) throw new Error("capture document schema mismatch");
  if (capture.capture_version !== CAPTURE_VERSION || typeof capture.kind !== "string" || !Array.isArray(capture.rows)) throw new Error("capture document metadata mismatch");
  return capture.rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("malformed capture row");
    const rowKeys = Object.keys(row).sort();
    if (rowKeys.join("\u0000") !== [...OUTPUT_COLUMNS].sort().join("\u0000")) throw new Error("capture row schema mismatch");
    if (Object.values(row).some((value) => typeof value !== "string")) throw new Error("capture row value must be text");
    return Object.fromEntries(OUTPUT_COLUMNS.map((column) => [column, row[column]]));
  });
}

export function validateRows(kind, rows, options = {}) {
  const contract = CONTRACTS[kind];
  if (!contract) throw new Error(`unsupported packet kind: ${kind}`);
  if (rows.length !== contract.checks.length) throw new Error("missing, duplicate, or unexpected check rows");
  const classifications = new Set(rows.map((row) => row.classification));
  if (classifications.size !== 1 || !contract.classifications.has([...classifications][0])) throw new Error("classification ambiguity");
  const seen = new Set();
  let lastOrder = 0;
  for (const row of rows) {
    if (row.packet_version !== contract.version || row.phase !== contract.phase || row.section_order !== "1") throw new Error("packet version or phase mismatch");
    if (!contract.checks.includes(row.check_id) || seen.has(row.check_id)) throw new Error("missing or duplicate check id");
    seen.add(row.check_id);
    const order = Number(row.check_order);
    if (!Number.isSafeInteger(order) || order <= lastOrder) throw new Error("nondeterministic check ordering");
    lastOrder = order;
    if (!new Set(["PASS", "FAIL"]).has(row.status) || !new Set(["true", "false"]).has(row.blocking)) throw new Error("unknown status or blocking value");
    if (!/^[0-9a-f]{32}$/.test(row.evidence_fingerprint)) throw new Error("invalid evidence fingerprint");
    if (forbidden.test([row.object_identity, row.expected_value, row.actual_value_redacted].join("\n"))) throw new Error("forbidden sensitive or row-level evidence");
    if (resendChecks.has(row.check_id) && row.object_identity !== RESEND_IDENTITY) throw new Error("resend identity must be the exact source-backed signature");
  }
  if (kind === "preflight") {
    if (!options.expectedTargetMarker || rows.find((row) => row.check_id === "target_database_fingerprint")?.actual_value_redacted !== options.expectedTargetMarker) throw new Error("safe expected target marker missing or mismatched");
  }
  if (kind === "postflight") {
    if (rows.some((row) => row.status === "FAIL") && [...classifications][0] === "PRODUCTION_RPC_POSTFLIGHT_PASSED") throw new Error("postflight cannot pass with a failed check");
    if (!options.baseline) throw new Error("redacted baseline packet is required for postflight");
    const baseline = new Map(options.baseline.map((row) => [row.check_id, row.actual_value_redacted]));
    const pairs = [["policy_inventory_fingerprint", "baseline_policy_fingerprint"], ["index_inventory_fingerprint", "baseline_index_fingerprint"], ["table_privileges_fingerprint", "baseline_grant_fingerprint"], ["resend_metadata_fingerprint", "baseline_resend_metadata_fingerprint"], ["resend_acl_fingerprint", "baseline_resend_acl_fingerprint"]];
    for (const [before, after] of pairs) {
      const expected = baseline.get(before);
      const actual = rows.find((row) => row.check_id === after)?.actual_value_redacted;
      if (!expected || !actual || expected !== actual) throw new Error(`baseline mismatch for ${after}`);
    }
  }
  return { classification: [...classifications][0], checks: rows.length };
}

const [kind, packetPath, baselinePath, expectedTargetMarker] = process.argv.slice(2);
if (process.argv[1] === fileURLToPath(import.meta.url) && kind && packetPath) {
  const rows = parsePacketDocument(await readFile(path.resolve(packetPath), "utf8"));
  const baseline = baselinePath ? parsePacketDocument(await readFile(path.resolve(baselinePath), "utf8")) : undefined;
  const result = validateRows(kind, rows, { baseline, expectedTargetMarker });
  console.log(JSON.stringify({ status: "PASS", kind, ...result }));
}
