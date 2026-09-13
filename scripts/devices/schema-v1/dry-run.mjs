import { createHash } from "node:crypto";

const ENTITY_SPECS = Object.freeze([
  { entity: "definition", modelKey: "definitions", key: (row) => row.key },
  { entity: "device", modelKey: "devices", key: (row) => row.slug, deviceSlug: (row) => row.slug },
  { entity: "spec", modelKey: "specs", key: (row) => `${row.deviceSlug}\u0000${row.definitionKey}\u0000${row.region ?? ""}\u0000${row.variant ?? ""}`, deviceSlug: (row) => row.deviceSlug },
  { entity: "source", modelKey: "sources", key: (row) => row.url },
  { entity: "sourceLink", modelKey: "sourceLinks", key: (row) => `${row.deviceSlug}\u0000${row.sourceUrl}`, deviceSlug: (row) => row.deviceSlug },
  { entity: "evidence", modelKey: "evidence", key: (row) => `${row.deviceSlug}\u0000${row.definitionKey}\u0000${row.sourceUrl}\u0000${String(row.claimedValue)}`, deviceSlug: (row) => row.deviceSlug },
  { entity: "compatibility", modelKey: "compatibility", key: (row) => row.deviceSlug, deviceSlug: (row) => row.deviceSlug },
]);

const INITIAL_IMPORT_PROVENANCE = "initial-import";

function compareOrdinal(left, right) {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex);
    const rightPoint = right.codePointAt(rightIndex);
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return left.length - right.length;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compareOrdinal).map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function desiredShape(desired, existing) {
  const comparable = {};
  for (const key of Object.keys(desired)) comparable[key] = existing?.[key];
  return comparable;
}

function sameDesiredFields(desired, existing) {
  return stableJson(desired) === stableJson(desiredShape(desired, existing));
}

function isInitialImportOwned(existing) {
  return existing?.catalogAuditProvenance === INITIAL_IMPORT_PROVENANCE
    || existing?.provenance?.source === INITIAL_IMPORT_PROVENANCE;
}

function requireRows(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function indexRows(rows, entity, keyFor) {
  const indexed = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (typeof key !== "string" || !key) throw new TypeError(`${entity} row has no deterministic key`);
    if (indexed.has(key)) throw new TypeError(`DUPLICATE_${entity.toUpperCase()}_KEY: ${key}`);
    indexed.set(key, row);
  }
  return indexed;
}

function blockerMap(model) {
  const identityRows = model.deviceIdentities === undefined
    ? requireRows(model.devices, "model.devices")
    : requireRows(model.deviceIdentities, "model.deviceIdentities");
  const deviceSlugByKey = new Map(identityRows.map((device) => [
    `${device.brand}|${device.model}|${device.generation}`, device.slug,
  ]));
  const mapped = new Map();
  for (const blocker of requireRows(model.blockers, "model.blockers")) {
    const slug = deviceSlugByKey.get(blocker.deviceKey);
    if (!slug) continue;
    if (!mapped.has(slug)) mapped.set(slug, []);
    mapped.get(slug).push(blocker);
  }
  for (const blockers of mapped.values()) blockers.sort((left, right) => compareOrdinal(stableJson(left), stableJson(right)));
  return mapped;
}

/**
 * Calculate a deterministic, read-only recovery plan. This module accepts data
 * already loaded by a caller and intentionally has no credential, network, or
 * database write capability.
 */
export function buildRecoveryPlan({ model, existing }) {
  if (!model || typeof model !== "object") throw new TypeError("model is required");
  if (!existing || typeof existing !== "object") throw new TypeError("existing is required");

  const blockersBySlug = blockerMap(model);
  const entries = [];
  for (const spec of ENTITY_SPECS) {
    const desiredRows = requireRows(model[spec.modelKey], `model.${spec.modelKey}`);
    const existingRows = requireRows(existing[spec.modelKey], `existing.${spec.modelKey}`);
    const desiredByKey = indexRows(desiredRows, spec.entity, spec.key);
    const existingByKey = indexRows(existingRows, spec.entity, spec.key);
    for (const [key, desired] of desiredByKey) {
      const current = existingByKey.get(key) ?? null;
      const blockers = spec.deviceSlug ? (blockersBySlug.get(spec.deviceSlug(desired)) ?? []) : [];
      let operation;
      let reason;
      if (blockers.length) operation = "BLOCKED";
      else if (!current) operation = "INSERT";
      else if (sameDesiredFields(desired, current)) operation = "UNCHANGED";
      else if (isInitialImportOwned(current)) operation = "UPDATE";
      else {
        operation = "CONFLICT";
        reason = "ADMIN_OR_PROVENANCE_DRIFT";
      }
      entries.push(Object.freeze({ entity: spec.entity, key, operation, desired, existing: current, blockers, ...(reason ? { reason } : {}) }));
    }
    for (const [key, current] of existingByKey) {
      if (desiredByKey.has(key)) continue;
      entries.push(Object.freeze({
        entity: spec.entity,
        key,
        operation: "CONFLICT",
        desired: null,
        existing: current,
        blockers: [],
        reason: "STALE_EXISTING_ROW_NO_DELETE",
      }));
    }
  }
  entries.sort((left, right) => compareOrdinal(left.entity, right.entity) || compareOrdinal(left.key, right.key));
  return Object.freeze({ delete: "NONE", entries: Object.freeze(entries) });
}

/** Return a stable SHA-256 hex fingerprint for a recovery plan. */
export function fingerprintRecoveryPlan(plan) {
  if (!plan || typeof plan !== "object") throw new TypeError("plan is required");
  return createHash("sha256").update(stableJson(plan), "utf8").digest("hex");
}
