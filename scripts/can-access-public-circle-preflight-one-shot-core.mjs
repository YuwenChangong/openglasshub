import assert from "node:assert/strict";

export const PACKET_VERSION = "can-access-public-circle-preflight-v1";
export const OUTPUT_COLUMNS = ["packet_version", "section_order", "section", "row_key", "object_schema", "object_name", "attribute", "value", "evidence_status"];
export const REQUIRED_SECTIONS = [
  "function_metadata_acl",
  "function_signature_overloads",
  "circles_relation_rls_acl",
  "circles_columns",
  "circles_constraints",
  "circles_policies",
  "required_roles",
];

const MANIFEST = {
  packet_identifier: "can-access-public-circle-prerequisite",
  packet_version: PACKET_VERSION,
  expected_section_count: "7",
  target_function: "public.can_access_public_circle(uuid)",
  target_relation: "public.circles",
  query_scope: "PostgreSQL catalogs and public.circles structural metadata only",
  read_only_classification: "CATALOG_ONLY_READ_ONLY",
};

const expectedColumns = {
  id: { data_type: "uuid", not_null: true, default_expression: "gen_random_uuid()" },
  status: { data_type: "text", not_null: true, default_expression: "'active'::text" },
  slug: { data_type: "text", not_null: true, default_expression: null },
  name: { data_type: "text", not_null: true, default_expression: null },
};

const expectedConstraints = {
  circles_owner_id_fkey: { constraint_type: "f", definition: "FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE SET NULL" },
  circles_pkey: { constraint_type: "p", definition: "PRIMARY KEY (id)" },
  circles_slug_check: { constraint_type: "c", definition: "CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text)" },
  circles_slug_key: { constraint_type: "u", definition: "UNIQUE (slug)" },
  circles_status_check: { constraint_type: "c", definition: "CHECK (status = ANY (ARRAY['active'::text, 'deleted'::text]))" },
};

const expectedPolicies = {
  circles_insert_owner_or_staff: { command: "a", using_expression: null, with_check_expression: "((owner_id = auth.uid()) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin))" },
  circles_select_public: { command: "r", using_expression: "(can_access_public_circle(id) OR (owner_id = auth.uid()) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin))", with_check_expression: null },
  circles_update_owner_or_staff: { command: "w", using_expression: "((owner_id = auth.uid()) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin))", with_check_expression: "((owner_id = auth.uid()) OR ( SELECT is_moderator_or_admin() AS is_moderator_or_admin))" },
};

const expectedRoles = {
  anon: { can_login: false, inherit: true, bypass_rls: false },
  authenticated: { can_login: false, inherit: true, bypass_rls: false },
  postgres: { can_login: true, inherit: true, bypass_rls: true },
};

export function parseCsv(csv) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      if (cell !== "") throw new Error("CSV has an unescaped quote");
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("CSV ends inside a quoted value");
  if (cell !== "" || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  if (rows.length < 2) throw new Error("CSV must contain a header and at least one data row");
  const header = rows.shift().map((value, index) => index === 0 ? value.replace(/^\uFEFF/, "") : value);
  assert.deepEqual(header, OUTPUT_COLUMNS, "CSV output columns must exactly match the one-shot packet schema");
  return rows.map((values, rowIndex) => {
    if (values.length !== header.length) throw new Error(`CSV row ${rowIndex + 2} has ${values.length} columns; expected ${header.length}`);
    return Object.fromEntries(header.map((column, index) => [column, values[index] === "" ? null : values[index]]));
  });
}

function safeText(row) {
  return OUTPUT_COLUMNS.map((column) => row[column] ?? "").join("\n");
}

function assertSafeContent(rows) {
  const prohibited = [
    [/(?:^|[^A-Za-z0-9_])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./i, "JWT-like content"],
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, "email-like content"],
    [/(?:password|api[_-]?key|private[_-]?key|connection[_-]?string)\s*[:=]/i, "secret-like content"],
    [/\bauth\.users\b/i, "auth-user catalog content"],
    [/\b(?:public\.)?(?:posts|comments|post_media)\b|\bstorage\.objects\b/i, "business-row relation content"],
  ];
  for (const row of rows) {
    const text = safeText(row);
    for (const [pattern, label] of prohibited) assert.doesNotMatch(text, pattern, `packet contains ${label}`);
  }
}

function rowsFor(rows, section) {
  return rows.filter((row) => row.section === section);
}

function mapAttributes(rows) {
  return new Map(rows.map((row) => [row.attribute, row]));
}

function jsonValue(row) {
  assert(row?.value, `missing JSON value for ${row?.section ?? "unknown"}`);
  return JSON.parse(row.value);
}

function sameJson(left, right) {
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
    return value;
  };
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function validatePacketRows(rows) {
  assert(rows.length > 0, "packet must contain rows");
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), OUTPUT_COLUMNS, "every row must have the stable output schema");
    assert.equal(row.packet_version, PACKET_VERSION, "packet version mismatch");
    assert.match(row.evidence_status ?? "", /^(?:PRESENT|MISSING)$/, "evidence status must be PRESENT or MISSING");
  }
  assertSafeContent(rows);

  const uniqueRows = new Set();
  for (const row of rows) {
    const key = [row.section, row.row_key, row.object_schema, row.object_name, row.attribute].join("\u0000");
    assert(!uniqueRows.has(key), `duplicate packet row: ${row.section}/${row.row_key}/${row.attribute}`);
    uniqueRows.add(key);
  }

  const manifestRows = rowsFor(rows, "packet_manifest");
  const manifest = mapAttributes(manifestRows);
  for (const [attribute, expected] of Object.entries(MANIFEST)) {
    assert.equal(manifest.get(attribute)?.value, expected, `packet manifest ${attribute} is missing or divergent`);
    assert.equal(manifest.get(attribute)?.evidence_status, "PRESENT", `packet manifest ${attribute} must be present`);
  }

  const packetSections = new Set(rows.map((row) => row.section));
  assert.deepEqual([...packetSections].filter((section) => section !== "packet_manifest").sort(), [...REQUIRED_SECTIONS].sort(), "packet must contain exactly the seven required evidence sections");
  for (const section of REQUIRED_SECTIONS) assert(rowsFor(rows, section).length > 0, `packet is truncated: required section ${section} is absent`);

  const functionMetadata = mapAttributes(rowsFor(rows, "function_metadata_acl"));
  assert(functionMetadata.has("present"), "function metadata must contain an explicit present sentinel");
  const signature = mapAttributes(rowsFor(rows, "function_signature_overloads"));
  assert(signature.has("exact_signature") && signature.has("overload_count"), "function signature section is incomplete");
  const relation = mapAttributes(rowsFor(rows, "circles_relation_rls_acl"));
  assert(relation.has("present"), "circles relation must contain an explicit present sentinel");

  const columns = rowsFor(rows, "circles_columns");
  assert.deepEqual(columns.map((row) => row.attribute).sort(), Object.keys(expectedColumns).sort(), "all required circles columns must be represented once");
  const constraints = rowsFor(rows, "circles_constraints");
  assert(constraints.length > 0, "constraints section must contain data or a missing sentinel");
  const policies = rowsFor(rows, "circles_policies");
  assert(policies.length > 0, "policies section must contain data or a missing sentinel");
  const roles = rowsFor(rows, "required_roles");
  assert.deepEqual(roles.map((row) => row.attribute).sort(), Object.keys(expectedRoles).sort(), "all required roles must be represented once");

  const dependencyClassification = {};
  const functionMissing = functionMetadata.get("present")?.value === "false"
    && functionMetadata.get("present")?.evidence_status === "MISSING"
    && signature.get("exact_signature")?.evidence_status === "MISSING"
    && signature.get("overload_count")?.value === "0";
  dependencyClassification["public.can_access_public_circle(uuid)"] = functionMissing ? "MISSING" : "PRESENT_BUT_DIVERGENT";

  const relationExpected = {
    relation_kind: "r",
    owner: "postgres",
    rls_enabled: "true",
    rls_forced: "false",
    relation_acl: "{postgres=arwdDxtm/postgres,anon=rDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=Dxtm/postgres}",
  };
  dependencyClassification["public.circles"] = relation.get("present")?.evidence_status === "MISSING"
    ? "MISSING"
    : Object.entries(relationExpected).every(([attribute, expected]) => relation.get(attribute)?.value === expected)
      ? "PRESENT_AND_MATCHING"
      : "PRESENT_BUT_DIVERGENT";

  for (const row of columns) {
    const expected = expectedColumns[row.attribute];
    dependencyClassification[`public.circles.${row.attribute}`] = row.evidence_status === "MISSING"
      ? "MISSING"
    : sameJson(jsonValue(row), expected)
        ? "PRESENT_AND_MATCHING"
        : "PRESENT_BUT_DIVERGENT";
  }

  const constraintValues = Object.fromEntries(constraints.filter((row) => row.evidence_status === "PRESENT").map((row) => [row.attribute, jsonValue(row)]));
  dependencyClassification["public.circles constraints"] = constraints.some((row) => row.evidence_status === "MISSING")
    ? "MISSING"
    : sameJson(constraintValues, expectedConstraints)
      ? "PRESENT_AND_MATCHING"
      : "PRESENT_BUT_DIVERGENT";

  const policyValues = Object.fromEntries(policies.filter((row) => row.evidence_status === "PRESENT").map((row) => [row.attribute, jsonValue(row)]));
  dependencyClassification["public.circles policies"] = policies.some((row) => row.evidence_status === "MISSING")
    ? "MISSING"
    : sameJson(policyValues, expectedPolicies)
      ? "PRESENT_AND_MATCHING"
      : "PRESENT_BUT_DIVERGENT";

  for (const row of roles) {
    dependencyClassification[`role:${row.attribute}`] = row.evidence_status === "MISSING"
      ? "MISSING"
      : sameJson(jsonValue(row), expectedRoles[row.attribute])
        ? "PRESENT_AND_MATCHING"
        : "PRESENT_BUT_DIVERGENT";
  }

  const nonFunctionStatuses = Object.entries(dependencyClassification)
    .filter(([identity]) => identity !== "public.can_access_public_circle(uuid)")
    .map(([, status]) => status);
  return {
    packetVersion: PACKET_VERSION,
    rowCount: rows.length,
    dependencyClassification,
    prerequisiteProposalEligible: functionMissing && nonFunctionStatuses.every((status) => status === "PRESENT_AND_MATCHING"),
  };
}

export function serializeCsv(rows) {
  const quote = (value) => {
    const text = value ?? "";
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [OUTPUT_COLUMNS, ...rows.map((row) => OUTPUT_COLUMNS.map((column) => row[column] ?? ""))]
    .map((row) => row.map(quote).join(","))
    .join("\n") + "\n";
}
