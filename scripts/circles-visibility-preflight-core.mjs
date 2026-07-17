import assert from "node:assert/strict";

export const PACKET_VERSION = "circles-visibility-preflight-v1";
export const OUTPUT_COLUMNS = ["packet_version", "section_order", "section", "row_key", "object_schema", "object_name", "attribute", "value", "evidence_status", "security_classification"];
export const REQUIRED_SECTIONS = [
  "packet_manifest",
  "circles_relation_rls_acl",
  "circles_columns",
  "circles_status_constraint",
  "circles_status_aggregate_counts",
  "circles_select_policy",
  "circles_delete_policy",
  "policy_roles_and_dependencies",
  "visibility_helper_functions",
  "dependent_catalog_objects",
];

const EXPECTED_MANIFEST = {
  packet_identifier: "circles-visibility-production-preflight",
  packet_version: PACKET_VERSION,
  expected_section_count: "10",
  target_relation: "public.circles",
  read_only_classification: "CATALOG_AND_AGGREGATE_READ_ONLY",
};
const EXPECTED_SELECT = "(can_access_public_circle(id) OR (owner_id = auth.uid()) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin))";
const EXPECTED_STATUS = "CHECK (status = ANY (ARRAY['active'::text, 'deleted'::text]))";
const AGGREGATE_ATTRIBUTES = new Set([
  "total_circle_count", "active_circle_count", "hidden_circle_count", "deleted_circle_count", "null_status_count", "unknown_status_count",
  "expected_constraint_violation_count", "current_anonymous_public_visible_count", "expected_anonymous_public_visible_count",
  "current_vs_expected_anonymous_visibility_delta", "potential_delete_policy_impact_count",
]);

export function parseCsv(csv) {
  const rows = [];
  let row = []; let cell = ""; let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') { cell += '"'; index += 1; } else quoted = false;
      } else cell += character;
    } else if (character === '"') {
      if (cell) throw new Error("CSV has an unescaped quote");
      quoted = true;
    } else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += character;
  }
  if (quoted) throw new Error("CSV ends inside a quoted value");
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  if (rows.length < 2) throw new Error("CSV must contain a header and at least one data row");
  const header = rows.shift().map((value, index) => index === 0 ? value.replace(/^\uFEFF/, "") : value);
  assert.deepEqual(header, OUTPUT_COLUMNS, "CSV columns must exactly match the preflight schema");
  return rows.map((values, index) => {
    if (values.length !== header.length) throw new Error(`CSV row ${index + 2} has ${values.length} columns; expected ${header.length}`);
    return Object.fromEntries(header.map((column, columnIndex) => [column, values[columnIndex] === "" ? null : values[columnIndex]]));
  });
}

export function serializeCsv(rows) {
  const quote = (value) => {
    const text = value ?? "";
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [OUTPUT_COLUMNS, ...rows.map((row) => OUTPUT_COLUMNS.map((column) => row[column] ?? ""))]
    .map((line) => line.map(quote).join(",")).join("\n") + "\n";
}

function section(rows, name) { return rows.filter((row) => row.section === name); }
function attributes(rows) { return new Map(rows.map((row) => [row.attribute, row])); }
function count(rows, attribute) {
  const value = attributes(rows).get(attribute)?.value;
  assert.match(value ?? "", /^\d+$/, `${attribute} must be a non-negative aggregate count`);
  return Number(value);
}
function assertSafeContent(rows) {
  const prohibited = [
    [/(?:^|[^A-Za-z0-9_])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./i, "JWT-like content"],
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, "email-like content"],
    [/(?:password|api[_-]?key|private[_-]?key|connection[_-]?string)\s*[:=]/i, "secret-like content"],
    [/\bauth\.users\b|\b(?:posts|comments|post_media|reports|storage\.objects)\b/i, "out-of-scope business relation"],
    [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, "individual identifier"],
  ];
  for (const row of rows) {
    const text = OUTPUT_COLUMNS.map((column) => row[column] ?? "").join("\n");
    for (const [pattern, label] of prohibited) assert.doesNotMatch(text, pattern, `packet contains ${label}`);
  }
}

export function validatePacketRows(rows) {
  assert(rows.length > 0, "packet must contain rows");
  const unique = new Set();
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), OUTPUT_COLUMNS, "every row must use the stable output schema");
    assert.equal(row.packet_version, PACKET_VERSION, "packet version mismatch");
    assert.match(row.evidence_status ?? "", /^(?:PRESENT|MISSING)$/, "evidence status must be PRESENT or MISSING");
    assert.match(row.security_classification ?? "", /^(?:SECURITY_BROADENING|AVAILABILITY_NARROWING|PRODUCT_SEMANTIC_DIFFERENCE|NON_SECURITY_DRIFT|INSUFFICIENT_EVIDENCE)$/, "invalid security classification");
    const key = [row.section, row.row_key, row.object_schema, row.object_name, row.attribute].join("\u0000");
    assert(!unique.has(key), `duplicate packet row: ${row.section}/${row.row_key}/${row.attribute}`);
    unique.add(key);
  }
  assertSafeContent(rows);
  assert.deepEqual(new Set(rows.map((row) => row.section)), new Set(REQUIRED_SECTIONS), "packet must contain exactly the ten required sections");
  for (const name of REQUIRED_SECTIONS) assert(section(rows, name).length > 0, `packet is truncated: ${name} is absent`);

  const manifest = attributes(section(rows, "packet_manifest"));
  for (const [attribute, value] of Object.entries(EXPECTED_MANIFEST)) assert.equal(manifest.get(attribute)?.value, value, `manifest ${attribute} is missing or divergent`);
  assert.match(manifest.get("query_scope")?.value ?? "", /aggregate-only public\.circles/i);

  const relation = attributes(section(rows, "circles_relation_rls_acl"));
  const constraint = attributes(section(rows, "circles_status_constraint"));
  const selectPolicy = attributes(section(rows, "circles_select_policy"));
  const deletePolicy = attributes(section(rows, "circles_delete_policy"));
  const helpers = section(rows, "visibility_helper_functions");
  const aggregates = section(rows, "circles_status_aggregate_counts");
  assert.equal(section(rows, "circles_columns").length, 5, "exactly the five allowlisted circles columns must be present");
  assert.deepEqual(new Set(aggregates.map((row) => row.attribute)), AGGREGATE_ATTRIBUTES, "aggregate evidence is incomplete or broadened");
  for (const attribute of AGGREGATE_ATTRIBUTES) count(aggregates, attribute);

  const constraintStatus = section(rows, "circles_status_constraint").some((row) => row.evidence_status === "MISSING") ? "INSUFFICIENT_EVIDENCE"
    : constraint.get("definition")?.value === EXPECTED_STATUS ? "PRESENT_AND_MATCHING"
      : /hidden/i.test(constraint.get("definition")?.value ?? "") ? "PRODUCT_SEMANTIC_DIFFERENCE" : "PRESENT_BUT_DIVERGENT";
  const selectIsExpected = selectPolicy.get("command")?.value === "r"
    && selectPolicy.get("permissive")?.value === "true"
    && selectPolicy.get("roles")?.value === "anon,authenticated"
    && selectPolicy.get("using_expression")?.value === EXPECTED_SELECT
    && selectPolicy.get("with_check_expression")?.value === "";
  const selectStatus = section(rows, "circles_select_policy").some((row) => row.evidence_status === "MISSING") ? "INSUFFICIENT_EVIDENCE"
    : selectPolicy.get("using_expression")?.value === "true" ? "SECURITY_BROADENING"
      : selectIsExpected ? "PRESENT_AND_MATCHING" : "PRESENT_BUT_DIVERGENT";
  const deleteUsing = deletePolicy.get("using_expression")?.value;
  const deleteStatus = section(rows, "circles_delete_policy").some((row) => row.evidence_status === "MISSING") ? "HUMAN_DECISION_REQUIRED"
    : deleteUsing === "true" || !/owner_id\s*=\s*auth\.uid\(\)/i.test(deleteUsing ?? "") ? "SECURITY_BROADENING"
      : "HUMAN_DECISION_REQUIRED";
  const helperStatus = {};
  for (const signature of ["public.can_access_public_circle(uuid)", "public.is_moderator_or_admin()"]) {
    const rowsForHelper = helpers.filter((row) => row.row_key === signature);
    helperStatus[signature] = rowsForHelper.some((row) => row.evidence_status === "MISSING") ? "MISSING" : "PRESENT_REQUIRES_OFFLINE_COMPARISON";
  }
  const hiddenCount = count(aggregates, "hidden_circle_count");
  const unknownCount = count(aggregates, "unknown_status_count") + count(aggregates, "null_status_count");
  return {
    packetVersion: PACKET_VERSION,
    rowCount: rows.length,
    repairObjects: {
      "public.circles.circles_status_check": constraintStatus,
      "public.circles.circles_select_public": selectStatus,
      "public.circles.circles_delete_owner_or_staff": deleteStatus,
    },
    helperStatus,
    productOrDataDecisionRequired: hiddenCount > 0 || unknownCount > 0 || deleteStatus === "HUMAN_DECISION_REQUIRED",
    aggregateEvidence: { hiddenCount, unknownCount, currentVisibilityDelta: count(aggregates, "current_vs_expected_anonymous_visibility_delta") },
    preflightStatus: "ONE_SHOT_PREFLIGHT_PACKET_READY",
  };
}
