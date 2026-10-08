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
  return { sourceSha256, knownValues, operations, sql, statements: prepared.statements, initializationSql: prepared.initializationSql,
    inputPaths: prepared.inventory.sourceHashes.map(item => item.path), body: sql.slice("BEGIN;\n".length, -"COMMIT;\n".length) };
}

export function buildImportBody(prepared, plan) {
  if (plan.blockers.length || plan.actions.length !== prepared.operations.length) fail("IMPORT_WRITE_SET_INVALID");
  const statements = plan.actions.flatMap((action, i) => {
    const operation = prepared.operations[i];
    if (action.entity !== operation.entity || action.identity !== key(operation.entity, operation.row)) fail("IMPORT_WRITE_SET_INVALID");
    return ["INSERT_MISSING", "INSERT_UNKNOWN"].includes(action.classification) ? [prepared.statements[i]] : [];
  });
  return ["SET CONSTRAINTS ALL DEFERRED;", prepared.initializationSql, ...statements, ""].join("\n");
}

// Full private rows stay in memory only. Limits fail closed instead of silently
// truncating reconciliation. Joins expose stable identities, never UUID matching.
export const SNAPSHOT_SQL = `SELECT jsonb_build_object(
  'devices', (SELECT coalesce(jsonb_agg(x ORDER BY x.slug),'[]') FROM (SELECT * FROM public.devices ORDER BY slug LIMIT 50001) x),
  'definitions', (SELECT coalesce(jsonb_agg(x ORDER BY x.key),'[]') FROM (SELECT * FROM public.device_spec_definitions ORDER BY key LIMIT 50001) x),
  'sources', (SELECT coalesce(jsonb_agg(x ORDER BY x.url),'[]') FROM (SELECT * FROM public.device_sources ORDER BY url LIMIT 50001) x),
  'sourceLinks', (SELECT coalesce(jsonb_agg(x ORDER BY x."deviceSlug",x."sourceUrl"),'[]') FROM (SELECT l.*,d.slug AS "deviceSlug",s.url AS "sourceUrl" FROM public.device_source_links l JOIN public.devices d ON d.id=l.device_id JOIN public.device_sources s ON s.id=l.source_id ORDER BY d.slug,s.url LIMIT 50001) x),
  'specs', (SELECT coalesce(jsonb_agg(x ORDER BY x."deviceSlug",x."definitionKey",x.region_key,x.variant_key),'[]') FROM (SELECT s.*,d.slug AS "deviceSlug",f.key AS "definitionKey" FROM public.device_specs s JOIN public.devices d ON d.id=s.device_id JOIN public.device_spec_definitions f ON f.id=s.spec_definition_id ORDER BY d.slug,f.key,s.region_key,s.variant_key LIMIT 50001) x),
  'evidence', (SELECT coalesce(jsonb_agg(x ORDER BY x."deviceSlug",x."definitionKey",x.region,x.variant,x."sourceUrl",x.claimed_value),'[]') FROM (SELECT e.*,d.slug AS "deviceSlug",f.key AS "definitionKey",s.region_key AS region,s.variant_key AS variant,src.url AS "sourceUrl" FROM public.device_spec_evidence e JOIN public.device_specs s ON s.id=e.device_spec_id JOIN public.devices d ON d.id=s.device_id JOIN public.device_spec_definitions f ON f.id=s.spec_definition_id JOIN public.device_sources src ON src.id=e.source_id ORDER BY d.slug,f.key,s.region_key,s.variant_key,src.url,e.claimed_value LIMIT 50001) x),
  'auditEvents', (SELECT coalesce(jsonb_agg(x ORDER BY x.created_at,x.id),'[]') FROM (SELECT * FROM public.catalog_audit_events ORDER BY created_at,id LIMIT 50001) x),
  'auditActor', auth.uid()
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

// PostgreSQL timestamps retain microseconds. A UUID only breaks display ties;
// it does not establish which of two same-time administrator writes came last.
function auditTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  const micros = (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0");
  return BigInt(Date.parse(value)) * 1000n + BigInt(micros.slice(3));
}
function auditIndex(snapshot) {
  if (!Array.isArray(snapshot.auditEvents) || snapshot.auditEvents.length > 50000 || !(snapshot.auditActor === null || typeof snapshot.auditActor === "string")) fail("IMPORT_AUDIT_SNAPSHOT_INVALID_OR_LIMIT");
  const index = new Map();
  for (const event of snapshot.auditEvents) {
    if (!event || typeof event.id !== "string" || index.has(event.id) || !(event.actor_id === null || typeof event.actor_id === "string")
      || typeof event.entity_id !== "string" || typeof event.entity_type !== "string" || typeof event.action !== "string"
      || !event.changed_fields || typeof event.changed_fields !== "object" || Array.isArray(event.changed_fields) || auditTime(event.created_at) === null) fail("IMPORT_AUDIT_SNAPSHOT_INVALID_OR_LIMIT");
    index.set(event.id, event);
  }
  return index;
}
function reconcileAudit(prepared, snapshot, actions) {
  const events = [...auditIndex(snapshot).values()];
  const deviceIds = new Map(snapshot.devices.map(row => [row.id, row]));
  const specIds = new Map(snapshot.specs.map(row => [row.id, row]));
  const groups = new Map(snapshot.definitions.map(row => [row.key, row.group_key]));
  const associated = new Map(), issues = [], blockers = [];
  const targets = new Map(actions.filter(a => ["device", "spec"].includes(a.entity)).map(a => [a.entity + a.identity, a]));
  const attach = (entity, row, event) => {
    const identity = key(entity, row), id = entity + identity;
    if (!targets.has(id)) return;
    if (!associated.has(id)) associated.set(id, []);
    associated.get(id).push(event);
  };
  const issue = (entity, row, classification, alwaysBlock = false) => {
    const identity = key(entity, row), action = targets.get(entity + identity);
    if (!action) return;
    const affectsProposedWrite = action.classification === "INITIALIZE_NULL_SCHEMA_ONLY" || action.classification.startsWith("INSERT_");
    issues.push({ entity, identity, classification, affectsProposedWrite });
    if (alwaysBlock || affectsProposedWrite) blockers.push({ entity, identity, classification: "BLOCK_" + classification });
  };
  let unlinkedEventCount = 0;
  for (const event of events) {
    const entity = event.entity_type === "device" ? "device" : event.entity_type === "device_spec" ? "spec" : null;
    const row = entity === "device" ? deviceIds.get(event.entity_id) : entity === "spec" ? specIds.get(event.entity_id) : null;
    if (!row) { unlinkedEventCount++; continue; }
    const fields = event.changed_fields.fields;
    const fieldList = Object.keys(event.changed_fields).length === 1 && Object.hasOwn(event.changed_fields, "fields")
      && (fields === null || Array.isArray(fields) && fields.every(field => typeof field === "string") && new Set(fields).size === fields.length);
    if (entity === "spec" && event.action === "admin_save" && fieldList && event.actor_id !== null) attach(entity, row, event);
    else if (entity === "device" && ["insert", "update", "delete"].includes(event.action) && fieldList && Array.isArray(fields) && fields.length && event.actor_id !== null) attach(entity, row, event);
    else if (entity === "device" && event.action === "admin_group_save" && Object.keys(event.changed_fields).sort().join(",") === "count,group"
      && typeof event.changed_fields.group === "string" && Number.isSafeInteger(event.changed_fields.count) && event.changed_fields.count >= 0 && event.actor_id !== null) {
      attach(entity, row, event);
      // The RPC stores a device/group/count, not historical spec membership.
      // Attribute it only when the exact write time and full group count agree.
      const members = snapshot.specs.filter(spec => spec.device_id === row.id
        && (spec.presentation?.groupKey ?? groups.get(spec.definitionKey)) === event.changed_fields.group
        && auditTime(spec.updated_at) === auditTime(event.created_at));
      if (members.length === event.changed_fields.count) for (const spec of members) attach("spec", spec, event);
      else issue(entity, row, "AUDIT_GROUP_MEMBERSHIP_UNVERIFIABLE");
    } else issue(entity, row, "AUDIT_ACTION_UNVERIFIABLE");
  }
  const provenance = [];
  for (const entity of ["device", "spec"]) for (const row of snapshot[collections[entity]]) {
    const identity = key(entity, row), id = entity + identity;
    if (!targets.has(id)) continue;
    const history = associated.get(id) ?? [];
    let classification = entity === "spec" && row.updated_by ? "ADMIN_MARKER_UNAUDITED" : "UNAUDITED_NO_PROOF";
    if (history.length) {
      classification = entity === "device" ? "RECORDED_DEVICE_HISTORY" : "AUDIT_HISTORY_ONLY";
      if (entity === "spec") {
        const latestTime = history.reduce((latest, event) => auditTime(event.created_at) > latest ? auditTime(event.created_at) : latest, auditTime(history[0].created_at));
        const latest = history.filter(event => auditTime(event.created_at) === latestTime);
        if (auditTime(row.updated_at) === latestTime) {
          if (new Set(latest.map(event => event.actor_id)).size !== 1) { classification = "AUDIT_OWNERSHIP_AMBIGUOUS"; issue(entity, row, classification, true); }
          else if (latest[0].actor_id !== row.updated_by) { classification = "AUDIT_ACTOR_CONTRADICTION"; issue(entity, row, classification, true); }
          else classification = "RECORDED_ADMIN_WRITE";
        }
      }
    }
    provenance.push({ entity, identity, classification, eventCount: history.length });
  }
  return { summary: { eventCount: events.length, eventsSha256: sha256(canonical(snapshot.auditEvents)), unlinkedEventCount, provenance, issues }, blockers };
}

export function verifyAudit(before, after, plan) {
  const old = auditIndex(before), next = auditIndex(after);
  if (before.auditActor !== after.auditActor) fail("IMPORT_AUDIT_SESSION_ACTOR_CHANGED");
  for (const [id, event] of old) if (canonical(next.get(id)) !== canonical(event)) fail("IMPORT_AUDIT_EXISTING_EVENT_CHANGED_OR_REMOVED");
  const added = [...next.values()].filter(event => !old.has(event.id));
  const expected = [];
  if (after.auditActor !== null) for (const row of after.devices) {
    const action = plan.actions.find(a => a.entity === "device" && a.identity === key("device", row));
    if (!action || !["INSERT_MISSING", "INITIALIZE_NULL_SCHEMA_ONLY"].includes(action.classification)) continue;
    const previous = before.devices.find(device => device.id === row.id);
    const fields = Object.keys(row).filter(field => !["created_at", "updated_at"].includes(field)
      && (!previous || canonical(previous[field]) !== canonical(row[field]))).sort();
    if (fields.length) expected.push({ actor_id: after.auditActor, entity_type: "device", entity_id: row.id,
      action: previous ? "update" : "insert", changed_fields: { fields }, time: auditTime(row.updated_at) });
  }
  if (added.length !== expected.length) fail("IMPORT_AUDIT_UNEXPECTED_EVENT");
  for (const event of added) {
    const match = expected.findIndex(item => item.time === auditTime(event.created_at) && canonical({ actor_id: event.actor_id, entity_type: event.entity_type,
      entity_id: event.entity_id, action: event.action, changed_fields: event.changed_fields }) === canonical({ actor_id: item.actor_id, entity_type: item.entity_type,
      entity_id: item.entity_id, action: item.action, changed_fields: item.changed_fields }));
    if (match === -1) fail("IMPORT_AUDIT_UNEXPECTED_EVENT");
    expected.splice(match, 1);
  }
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
  const audit = reconcileAudit(prepared, snapshot, actions); blockers.push(...audit.blockers);
  const writeSetSha256 = blockers.length ? null : sha256(buildImportBody(prepared, { actions, blockers }));
  const report = { sourceSha256: prepared.sourceSha256, knownValues: prepared.knownValues, snapshotSha256: sha256(canonical(snapshot)), writeSetSha256, actions, blockers, inserts, nullSchemaType, audit: audit.summary };
  return { ...report, reconciliationSha256: sha256(canonical(report)) };
}

export function verifyImport(prepared, before, after, plan) {
  verifyAudit(before, after, plan);
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
      // A genuinely missing spec can invoke the accepted parent-serialization
      // trigger; only that target device's housekeeping timestamp may advance.
      if (entity === "device" && plan.actions.some(a => a.entity === "spec" && a.classification.startsWith("INSERT_") && JSON.parse(a.identity)[0] === oldRow.slug)) allowed.updated_at = next.updated_at;
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
const FAILURE_CODES = new Set([
  "IMPORT_SOURCE_HASH_MISMATCH", "IMPORT_FROZEN_SQL_MISMATCH", "IMPORT_SOURCE_COUNTS_MISMATCH", "IMPORT_WRITE_SET_INVALID",
  "IMPORT_SNAPSHOT_INVALID_OR_LIMIT", "IMPORT_SNAPSHOT_DUPLICATE_IDENTITY", "IMPORT_POSTCHECK_INSERT_COUNT", "IMPORT_POSTCHECK_EXISTING_ROW_REMOVED",
  "IMPORT_POSTCHECK_EXISTING_ROW_CHANGED", "IMPORT_POSTCHECK_IDENTITY_MISSING", "IMPORT_POSTCHECK_SOURCE_VALUE_DROPPED", "IMPORT_POSTCHECK_EVIDENCE_CHANGED",
  "IMPORT_POSTCHECK_ACTIVATION", "IMPORT_POSTCHECK_RECONCILIATION_BLOCKED", "IMPORT_EXECUTION_CHECKOUT_MISMATCH", "IMPORT_CHECKOUT_DIRTY",
  "IMPORT_AUTHORIZATION_SHAPE_INVALID", "IMPORT_AUTHORIZATION_BINDING_INVALID", "IMPORT_WINDOW_INVALID", "IMPORT_WINDOW_NOT_ACTIVE", "IMPORT_HUMAN_GATE_REQUIRED",
  "IMPORT_PACKET_DRIFT", "IMPORT_CLAIM_INVALID", "IMPORT_AUTHORIZATION_ALREADY_CLAIMED_OR_UNAVAILABLE", "IMPORT_STAGE2_OR_READER_GRANTS_DRIFT",
  "IMPORT_VALIDATED_BUNDLE_REQUIRED", "IMPORT_WINDOW_EXPIRED", "IMPORT_READ_BUDGET_EXHAUSTED", "IMPORT_SCHEMA_RESPONSE_INVALID", "IMPORT_SNAPSHOT_RESPONSE_INVALID",
  "IMPORT_SERVER_IDENTITY_MISMATCH", "IMPORT_PREWRITE_CONFLICT", "IMPORT_RECONCILIATION_NOT_APPROVED", "IMPORT_PREWRITE_CONCURRENT_CHANGE", "IMPORT_AUDIT_WRITE_SCOPE_EXCEEDED",
  "IMPORT_CA_TRUST_INVALID", "IMPORT_SESSION_POOLER_SOURCE_INVALID", "IMPORT_RECONNECT_FORBIDDEN", "IMPORT_CLI_SCOPE_INVALID",
  "IMPORT_AUDIT_SNAPSHOT_INVALID_OR_LIMIT", "IMPORT_AUDIT_SESSION_ACTOR_CHANGED", "IMPORT_AUDIT_EXISTING_EVENT_CHANGED_OR_REMOVED", "IMPORT_AUDIT_UNEXPECTED_EVENT",
]);
export function safeImportFailure(error, operation, durationMs, connected) {
  const sqlstate = /^[0-9A-Z]{5}$/.test(error?.code ?? "") ? error.code : "UNKNOWN";
  const connectionClasses = { ENOTFOUND: "DNS_RESOLUTION_FAILURE", EAI_AGAIN: "DNS_RESOLUTION_FAILURE", ECONNREFUSED: "TCP_CONNECTION_REFUSED", ETIMEDOUT: "TCP_CONNECTION_TIMEOUT", ECONNRESET: "TCP_CONNECTION_RESET",
    ERR_TLS_CERT_ALTNAME_INVALID: "TLS_HOSTNAME_REJECTED", CERT_HAS_EXPIRED: "TLS_CERTIFICATE_REJECTED", UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS_CERTIFICATE_REJECTED" };
  let failureClass = "DATABASE_OR_TRANSPORT_FAILURE", timeoutClass = "UNKNOWN";
  // Match only fixed driver/server messages internally; never return arbitrary text.
  if (FAILURE_CODES.has(error?.importCode)) failureClass = error.importCode;
  else if (sqlstate === "28P01") failureClass = "POSTGRES_AUTH_REJECTED";
  else if (sqlstate === "57014") {
    const statement = error?.message === "canceling statement due to statement timeout";
    failureClass = statement ? "POSTGRES_STATEMENT_TIMEOUT" : "POSTGRES_QUERY_CANCELLED";
    timeoutClass = statement ? "SERVER_STATEMENT_TIMEOUT" : "CANCELLATION_REASON_UNKNOWN";
  } else if (sqlstate === "55P03") {
    const lock = error?.message === "canceling statement due to lock timeout";
    failureClass = lock ? "POSTGRES_LOCK_TIMEOUT" : "POSTGRES_LOCK_NOT_AVAILABLE";
    if (lock) timeoutClass = "SERVER_LOCK_TIMEOUT";
  } else if (Object.hasOwn(connectionClasses, error?.code ?? "")) {
    failureClass = connectionClasses[error.code];
    if (error.code === "ETIMEDOUT") timeoutClass = "NETWORK_TIMEOUT";
  } else if (sqlstate !== "UNKNOWN") failureClass = "POSTGRES_SQL_ERROR";
  else if (error?.message === "Query read timeout") failureClass = timeoutClass = "CLIENT_QUERY_TIMEOUT";
  return { operation: OPERATIONS.has(operation) ? operation : "UNKNOWN", sqlstate, failureClass, timeoutClass,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : 0, sessionConnected: connected === true };
}
