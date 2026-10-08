import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prepareCanonicalCatalogImport } from "../../lib/catalog-canonical-import.mjs";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const SOURCE_PATH = "src/data/devices/openglasshub_device_data_v1.yaml";
export const SOURCE_SHA256 = "3aa86ad35fc021f24056774ec4afda676035b1624ed58321c370ee6ab082368a";
export const TABLES = Object.freeze({ definition: "device_spec_definitions", device: "devices", source: "device_sources", sourceLink: "device_source_links", spec: "device_specs", evidence: "device_spec_evidence" });
const collections = { definition: "definitions", device: "devices", source: "sources", sourceLink: "sourceLinks", spec: "specs", evidence: "evidence" };
export const fail = code => { throw Object.assign(new Error(code), { importCode: code }); };
export const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const key = (entity, row) => canonical(entity === "device" ? [row.slug] : entity === "definition" ? [row.key] : entity === "source" ? [row.url]
  : entity === "sourceLink" ? [row.deviceSlug, row.sourceUrl] : entity === "spec" ? [row.deviceSlug, row.definitionKey, row.region ?? "Global", row.variant ?? ""]
  : [row.deviceSlug, row.definitionKey, row.region ?? "Global", row.variant ?? "", row.sourceUrl, String(row.claimedValue ?? row.claimed_value)]);

export async function prepareImport(root) {
  const sourceSha256 = sha256(await readFile(path.join(root, SOURCE_PATH)));
  if (sourceSha256 !== SOURCE_SHA256) fail("IMPORT_SOURCE_HASH_MISMATCH");
  const publication = JSON.parse(await readFile(path.join(root, "artifacts/qa/product-publication-cohort-v1/publication-contract.json"), "utf8"));
  const prepared = await prepareCanonicalCatalogImport({ root, publication });
  const sql = prepared.sql + "\n";
  const frozen = execFileSync("git", ["-C", root, "show", "HEAD:artifacts/qa/catalog-migration-packet-v1/canonical-import.sql"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (sql !== frozen || !sql.startsWith("BEGIN;\n") || !sql.endsWith("COMMIT;\n")) fail("IMPORT_FROZEN_SQL_MISMATCH");
  const operations = [
    ...prepared.model.definitions.map(row => ({ entity: "definition", row })),
    ...prepared.devices.map(row => ({ entity: "device", row })),
    ...prepared.model.sources.map(row => ({ entity: "source", row })),
    ...prepared.model.sourceLinks.map(row => ({ entity: "sourceLink", row })),
    ...prepared.model.specs.map(row => ({ entity: "spec", row })),
    ...prepared.model.evidence.map(row => ({ entity: "evidence", row })),
  ];
  const knownValues = prepared.inventory.parameterLedger.filter(row => row.state === "KNOWN").length;
  if (prepared.devices.length !== 24 || prepared.model.specs.length !== 1488 || knownValues !== 829 || prepared.model.blockers.length) fail("IMPORT_SOURCE_COUNTS_MISMATCH");
  return { sourceSha256, knownValues, operations, sql, inputPaths: prepared.inventory.sourceHashes.map(item => item.path), body: sql.slice("BEGIN;\n".length, -"COMMIT;\n".length) };
}

// Full private rows stay in memory only. Limits fail closed instead of silently
// truncating reconciliation. Joins expose stable identities, never UUID matching.
export const SNAPSHOT_SQL = `SELECT jsonb_build_object(
  'devices', (SELECT coalesce(jsonb_agg(x ORDER BY x.slug),'[]') FROM (SELECT * FROM public.devices ORDER BY slug LIMIT 50001) x),
  'definitions', (SELECT coalesce(jsonb_agg(x ORDER BY x.key),'[]') FROM (SELECT * FROM public.device_spec_definitions ORDER BY key LIMIT 50001) x),
  'sources', (SELECT coalesce(jsonb_agg(x ORDER BY x.url),'[]') FROM (SELECT * FROM public.device_sources ORDER BY url LIMIT 50001) x),
  'sourceLinks', (SELECT coalesce(jsonb_agg(x ORDER BY x."deviceSlug",x."sourceUrl"),'[]') FROM (SELECT l.*,d.slug AS "deviceSlug",s.url AS "sourceUrl" FROM public.device_source_links l JOIN public.devices d ON d.id=l.device_id JOIN public.device_sources s ON s.id=l.source_id ORDER BY d.slug,s.url LIMIT 50001) x),
  'specs', (SELECT coalesce(jsonb_agg(x ORDER BY x."deviceSlug",x."definitionKey",x.region_key,x.variant_key),'[]') FROM (SELECT s.*,d.slug AS "deviceSlug",f.key AS "definitionKey" FROM public.device_specs s JOIN public.devices d ON d.id=s.device_id JOIN public.device_spec_definitions f ON f.id=s.spec_definition_id ORDER BY d.slug,f.key,s.region_key,s.variant_key LIMIT 50001) x),
  'evidence', (SELECT coalesce(jsonb_agg(x ORDER BY x."deviceSlug",x."definitionKey",x.region,x.variant,x."sourceUrl",x.claimed_value),'[]') FROM (SELECT e.*,d.slug AS "deviceSlug",f.key AS "definitionKey",s.region_key AS region,s.variant_key AS variant,src.url AS "sourceUrl" FROM public.device_spec_evidence e JOIN public.device_specs s ON s.id=e.device_spec_id JOIN public.devices d ON d.id=s.device_id JOIN public.device_spec_definitions f ON f.id=s.spec_definition_id JOIN public.device_sources src ON src.id=e.source_id ORDER BY d.slug,f.key,s.region_key,s.variant_key,src.url,e.claimed_value LIMIT 50001) x)
) AS snapshot;`;

const rawText = row => { const value = row.raw_value ?? row.rawValue; return value === null || value === undefined ? null : String(value); };
const specValue = row => canonical([row.state, row.value_number ?? row.valueNumber ?? null, row.value_boolean ?? row.valueBoolean ?? null,
  row.value_text ?? row.valueText ?? null, row.value_json ?? row.valueJson ?? null, row.canonical_unit ?? row.canonicalUnit ?? null,
  row.measurement_context ?? row.measurementContext ?? null, rawText(row)]);
function indexSnapshot(snapshot) {
  const index = {};
  for (const [entity, collection] of Object.entries(collections)) {
    const rows = snapshot?.[collection];
    if (!Array.isArray(rows) || rows.length > 50000) fail("IMPORT_SNAPSHOT_INVALID_OR_LIMIT");
    index[entity] = new Map(rows.map(row => [key(entity, row), row]));
    if (index[entity].size !== rows.length) fail("IMPORT_SNAPSHOT_DUPLICATE_IDENTITY");
  }
  return index;
}

export function reconcileImport(prepared, snapshot) {
  const index = indexSnapshot(snapshot);
  const actions = [], blockers = [], inserts = Object.fromEntries(Object.keys(TABLES).map(entity => [entity, 0]));
  let nullSchemaType = 0;
  for (const { entity, row } of prepared.operations) {
    const identity = key(entity, row), existing = index[entity].get(identity);
    let classification = "ALREADY_PRESENT_PRESERVE";
    if (!existing) { inserts[entity]++; classification = entity === "spec" && !["KNOWN", "CONFLICT"].includes(row.state) ? "INSERT_UNKNOWN" : "INSERT_MISSING"; }
    else if (entity === "device") {
      if (existing.brand_key !== row.brand_key || existing.schema_type !== null && existing.schema_type !== row.schema_type) classification = "BLOCK_IDENTITY_INCOMPATIBLE";
      else if (existing.schema_type === null) { nullSchemaType++; classification = "INITIALIZE_NULL_SCHEMA_ONLY"; }
    } else if (entity === "definition") {
      const pairs = [["value_type", "valueType"], ["canonical_unit", "canonicalUnit"], ["measurement_context", "measurementContext"], ["comparison_mode", "comparisonMode"], ["require_same_context", "requireSameContext"]];
      if (pairs.some(([a, b]) => canonical(existing[a]) !== canonical(row[b])) || canonical([...existing.applicable_schema_types].sort()) !== canonical([...row.applicableSchemaTypes].sort())) classification = "BLOCK_DEFINITION_INCOMPATIBLE";
    } else if (entity === "spec") {
      if (specValue(existing) === specValue(row)) classification = "ALREADY_CONSISTENT";
      else if (existing.state === "CONFLICT" || row.state === "CONFLICT") classification = "BLOCK_UNRECONCILED_CONFLICT";
      else if (["KNOWN"].includes(row.state) && existing.state !== "KNOWN") classification = "BLOCK_EXISTING_EMPTY_REQUIRES_ADJUDICATION";
      else classification = existing.updated_by ? "PRESERVE_ADMIN_VALUE" : "PRESERVE_EXISTING_RICHER_VALUE";
      if (row.state === "CONFLICT") {
        const expected = prepared.operations.filter(op => op.entity === "evidence" && op.row.deviceSlug === row.deviceSlug && op.row.definitionKey === row.definitionKey).map(op => key("evidence", op.row));
        if (snapshot.evidence.some(ev => ev.deviceSlug === row.deviceSlug && ev.definitionKey === row.definitionKey && !expected.includes(key("evidence", ev)))) classification = "BLOCK_UNRECONCILED_CONFLICT";
      }
    } else if (entity === "evidence" && (existing.is_primary !== row.isPrimary || existing.is_conflicting !== row.isConflicting)) classification = "BLOCK_EVIDENCE_INCOMPATIBLE";
    if (classification.startsWith("BLOCK_")) blockers.push({ entity, identity, classification });
    actions.push({ entity, identity, classification });
  }
  const report = { sourceSha256: prepared.sourceSha256, knownValues: prepared.knownValues, snapshotSha256: sha256(canonical(snapshot)), actions, blockers, inserts, nullSchemaType };
  return { ...report, reconciliationSha256: sha256(canonical(report)) };
}

export function verifyImport(prepared, before, after, plan) {
  const oldIndex = indexSnapshot(before), newIndex = indexSnapshot(after);
  for (const entity of Object.keys(TABLES)) {
    if (newIndex[entity].size - oldIndex[entity].size !== plan.inserts[entity]) fail("IMPORT_POSTCHECK_INSERT_COUNT");
    for (const [identity, oldRow] of oldIndex[entity]) {
      const next = newIndex[entity].get(identity);
      if (!next) fail("IMPORT_POSTCHECK_EXISTING_ROW_REMOVED");
      const allowed = structuredClone(oldRow);
      if (entity === "device" && oldRow.schema_type === null) {
        const target = prepared.operations.find(op => op.entity === "device" && key(entity, op.row) === identity);
        if (target) { allowed.schema_type = target.row.schema_type; allowed.updated_at = next.updated_at; }
      }
      if (canonical(next) !== canonical(allowed)) fail("IMPORT_POSTCHECK_EXISTING_ROW_CHANGED");
    }
  }
  for (const { entity, row } of prepared.operations) {
    const identity = key(entity, row), current = newIndex[entity].get(identity);
    if (!current) fail("IMPORT_POSTCHECK_IDENTITY_MISSING");
    if (!oldIndex[entity].has(identity) && entity === "spec" && specValue(current) !== specValue(row)) fail("IMPORT_POSTCHECK_SOURCE_VALUE_DROPPED");
    if (!oldIndex[entity].has(identity) && entity === "evidence" && (current.is_primary !== row.isPrimary || current.is_conflicting !== row.isConflicting)) fail("IMPORT_POSTCHECK_EVIDENCE_CHANGED");
    if (entity === "device" && !oldIndex.device.has(identity) && current.catalog_normalized !== false) fail("IMPORT_POSTCHECK_ACTIVATION");
  }
  if (reconcileImport(prepared, after).blockers.length) fail("IMPORT_POSTCHECK_RECONCILIATION_BLOCKED");
  return true;
}

const OPERATIONS = new Set(["APPROVAL", "CLAIM", "CONNECT", "IDENTITY", "SCHEMA", "SNAPSHOT", "BEGIN", "LOCK", "IMPORT", "VERIFY", "COMMIT", "POSTCOMMIT", "ROLLBACK", "CLOSE"]);
export function safeImportFailure(error, operation, durationMs, connected) {
  const sqlstate = /^[0-9A-Z]{5}$/.test(error?.code ?? "") ? error.code : "UNKNOWN";
  const connectionClasses = { ENOTFOUND: "DNS_RESOLUTION_FAILURE", EAI_AGAIN: "DNS_RESOLUTION_FAILURE", ECONNREFUSED: "TCP_CONNECTION_REFUSED", ETIMEDOUT: "TCP_CONNECTION_TIMEOUT", ECONNRESET: "TCP_CONNECTION_RESET",
    ERR_TLS_CERT_ALTNAME_INVALID: "TLS_HOSTNAME_REJECTED", CERT_HAS_EXPIRED: "TLS_CERTIFICATE_REJECTED", UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS_CERTIFICATE_REJECTED" };
  return { operation: OPERATIONS.has(operation) ? operation : "UNKNOWN", sqlstate,
    failureClass: /^IMPORT_[A-Z0-9_]{1,80}$/.test(error?.importCode ?? "") ? error.importCode : sqlstate === "28P01" ? "POSTGRES_AUTH_REJECTED" : sqlstate === "57014" ? "STATEMENT_TIMEOUT" : Object.hasOwn(connectionClasses, error?.code ?? "") ? connectionClasses[error.code] : "DATABASE_OR_TRANSPORT_FAILURE",
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : 0, sessionConnected: connected === true };
}
