export const PACKET_VERSION = "operational-guardrails-preflight-v1";
export const OUTPUT_COLUMNS = ["packet_version", "section_order", "section", "row_key", "object_schema", "object_name", "attribute", "value", "evidence_status", "security_classification"];
export const REQUIRED_SECTIONS = ["packet_manifest", "attempts_relation_rls_acl", "attempts_columns", "expected_indexes", "extra_policies", "attempts_table_acl", "aggregate_safety_counts", "runtime_dependency_contract", "dependent_catalog_objects"];
const SAFE_RELATION = "public.forum_upload_attempts";

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV must have a header and at least one data row");
  const parseLine = (line) => { const fields = []; let field = ""; let quoted = false; for (let i = 0; i < line.length; i += 1) { const char = line[i]; if (char === '"') { if (quoted && line[i + 1] === '"') { field += '"'; i += 1; } else quoted = !quoted; } else if (char === "," && !quoted) { fields.push(field); field = ""; } else field += char; } if (quoted) throw new Error("malformed CSV quoting"); fields.push(field); return fields; };
  const header = parseLine(lines[0]);
  if (header.join(",") !== OUTPUT_COLUMNS.join(",")) throw new Error("unexpected CSV header");
  return lines.slice(1).map((line) => { const values = parseLine(line); if (values.length !== header.length) throw new Error("malformed CSV row"); return Object.fromEntries(header.map((column, index) => [column, values[index] || null])); });
}

export function serializeCsv(rows) { const escape = (value) => { const text = value == null ? "" : String(value); return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }; return [OUTPUT_COLUMNS.join(","), ...rows.map((row) => OUTPUT_COLUMNS.map((column) => escape(row[column])).join(","))].join("\n"); }

function rowsFor(rows, section, rowKey) { return rows.filter((row) => row.section === section && (rowKey === undefined || row.row_key === rowKey)); }
function hasMissing(rows, section, rowKey) { return rowsFor(rows, section, rowKey).some((row) => row.evidence_status === "MISSING"); }

export function validatePacketRows(rows) {
  if (!rows.length) throw new Error("truncated CSV: no packet rows");
  const seen = new Set();
  for (const row of rows) {
    if (row.packet_version !== PACKET_VERSION) throw new Error("unexpected packet version");
    const key = OUTPUT_COLUMNS.map((column) => row[column] ?? "").join("\u0000"); if (seen.has(key)) throw new Error("duplicate packet row"); seen.add(key);
    const text = Object.values(row).filter(Boolean).join(" ");
    if (/(?:[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:secret|token|password|apikey)\s*[=:]|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|auth\.users)/i.test(text)) throw new Error("unsafe secret-like, email-like, or auth-user evidence");
    if (row.object_schema !== "public" || row.object_name !== "forum_upload_attempts") throw new Error("non-allowlisted business-row evidence");
  }
  for (const section of REQUIRED_SECTIONS) if (!rowsFor(rows, section).length) throw new Error(`required section missing or truncated: ${section}`);
  const manifest = rowsFor(rows, "packet_manifest");
  const lookup = (attribute) => manifest.find((row) => row.attribute === attribute)?.value;
  if (lookup("packet_identifier") !== "operational-guardrails-production-preflight" || lookup("packet_version") !== PACKET_VERSION || lookup("expected_section_count") !== String(REQUIRED_SECTIONS.length) || lookup("target_relation") !== SAFE_RELATION) throw new Error("packet manifest mismatch");
  for (const column of ["user_id", "purpose", "ip_hash", "bytes", "created_at"]) if (!rowsFor(rows, "attempts_columns", column).length) throw new Error(`missing column sentinel: ${column}`);
  for (const index of ["forum_upload_attempts_purpose_ip_created_idx", "forum_upload_attempts_purpose_user_created_idx"]) if (!rowsFor(rows, "expected_indexes", index).length) throw new Error(`missing index sentinel: ${index}`);
  for (const policy of ["forum_upload_attempts_insert_self", "forum_upload_attempts_select_self"]) if (!rowsFor(rows, "extra_policies", policy).length) throw new Error(`missing policy sentinel: ${policy}`);
  const repairObjects = {};
  for (const index of ["forum_upload_attempts_purpose_ip_created_idx", "forum_upload_attempts_purpose_user_created_idx"]) repairObjects[`public.forum_upload_attempts.${index}`] = hasMissing(rows, "expected_indexes", index) ? "MISSING" : "PRESENT_BUT_DIVERGENT";
  for (const policy of ["forum_upload_attempts_insert_self", "forum_upload_attempts_select_self"]) repairObjects[`public.forum_upload_attempts.${policy}`] = hasMissing(rows, "extra_policies", policy) ? "PRESENT_AND_MATCHING" : "EXTRA_REQUIRES_SECURITY_REVIEW";
  const missingDependencies = ["public.forum_upload_attempts", ...["user_id", "purpose", "ip_hash", "bytes", "created_at"].filter((column) => hasMissing(rows, "attempts_columns", column)).map((column) => `${SAFE_RELATION}.${column}`)].filter((dependency, index) => index > 0 || hasMissing(rows, "attempts_relation_rls_acl", "public.forum_upload_attempts"));
  const humanDecisions = Object.entries(repairObjects).filter(([, status]) => status === "EXTRA_REQUIRES_SECURITY_REVIEW").map(([identity]) => `${identity}: retain or remove requires reviewed policy-intent decision`);
  return { packetVersion: PACKET_VERSION, rowCount: rows.length, repairObjects, missingDependencies, humanDecisions, aggregateEvidenceScope: "aggregate-only counts over public.forum_upload_attempts", proposalEligible: missingDependencies.length === 0 && humanDecisions.length === 0, preflightStatus: "ONE_SHOT_PREFLIGHT_PACKET_READY" };
}
