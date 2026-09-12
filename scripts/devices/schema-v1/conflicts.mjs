import { readFile } from "node:fs/promises";
import { normalizeSourceUrl } from "./sources.mjs";

const CLASSIFICATIONS = new Set(["TRUE_VALUE_CONFLICT", "NORMALIZATION_OR_CONTEXT_NOTE"]);
const NOTE_KEYS = new Set(["deviceKey", "conflict", "classification"]);
const TRUE_CONFLICT_KEYS = new Set([...NOTE_KEYS, "canonicalKey", "primaryClaim", "conflictingClaims"]);

function identityKey(device) {
  return `${device.identity.brand}|${device.identity.model}|${device.identity.generation}`;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== keys.size || actual.some((key) => !keys.has(key))) throw new TypeError(`${label} has unsupported fields`);
}

function nonEmptyText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be non-empty text`);
  return value;
}

function claimValue(value, label) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new TypeError(`${label} must be a scalar claim`);
  if (typeof value === "string") nonEmptyText(value, label);
  return value;
}

function publicMapping(mapping) {
  const { conflict, ...result } = mapping;
  return Object.freeze(result);
}

function validateMapping(mapping, index, devicesByKey) {
  const label = `conflict mapping ${index}`;
  nonEmptyText(mapping?.deviceKey, `${label} deviceKey`);
  nonEmptyText(mapping?.conflict, `${label} conflict`);
  if (!CLASSIFICATIONS.has(mapping?.classification)) throw new TypeError(`${label} classification is not approved`);
  const device = devicesByKey.get(mapping.deviceKey);
  if (!device) throw new TypeError(`${label} deviceKey is not in normalized catalog`);
  if (mapping.classification === "NORMALIZATION_OR_CONTEXT_NOTE") {
    if (["canonicalKey", "primaryClaim", "primarySource", "conflictingClaims"].some((key) => Object.hasOwn(mapping, key))) {
      throw new TypeError("NORMALIZATION_OR_CONTEXT_NOTE cannot carry field-level claim data");
    }
    exactKeys(mapping, NOTE_KEYS, "NORMALIZATION_OR_CONTEXT_NOTE");
    return Object.freeze({ ...mapping });
  }
  exactKeys(mapping, TRUE_CONFLICT_KEYS, "TRUE_VALUE_CONFLICT");
  nonEmptyText(mapping.canonicalKey, `${label} canonicalKey`);
  exactKeys(mapping.primaryClaim, new Set(["claim", "source"]), `${label} primaryClaim`);
  claimValue(mapping.primaryClaim.claim, `${label} primaryClaim claim`);
  nonEmptyText(mapping.primaryClaim.source, `${label} primaryClaim source`);
  if (!Array.isArray(mapping.conflictingClaims) || mapping.conflictingClaims.length === 0) throw new TypeError("TRUE_VALUE_CONFLICT requires exact conflicting claim/source data");
  const spec = device.specs.find((candidate) => candidate.path === mapping.canonicalKey);
  if (!spec) throw new TypeError(`${label} canonicalKey is not a normalized device spec`);
  if (spec.rawValue !== mapping.primaryClaim.claim) throw new TypeError(`${label} primaryClaim must exactly match the normalized primary raw value`);
  const sourceUrls = new Set(device.evidence.sourceUrls.map(normalizeSourceUrl));
  if (!sourceUrls.has(normalizeSourceUrl(mapping.primaryClaim.source))) throw new TypeError(`${label} primaryClaim source is not a device-level source URL`);
  const claimSourcePairs = new Set();
  const conflictingClaims = mapping.conflictingClaims.map((claim, claimIndex) => {
    exactKeys(claim, new Set(["claim", "source"]), `${label} conflicting claim ${claimIndex}`);
    claimValue(claim.claim, `${label} conflicting claim ${claimIndex} claim`);
    if (!sourceUrls.has(normalizeSourceUrl(claim.source))) throw new TypeError(`${label} conflicting claim ${claimIndex} source is not a device-level source URL`);
    if (claim.claim === mapping.primaryClaim.claim) throw new TypeError("conflicting claim must differ from the primary claim");
    const pair = `${JSON.stringify(claim.claim)}\u0000${normalizeSourceUrl(claim.source)}`;
    if (claimSourcePairs.has(pair)) throw new TypeError("duplicate conflicting claim/source mapping");
    claimSourcePairs.add(pair);
    return Object.freeze({ ...claim, source: normalizeSourceUrl(claim.source) });
  });
  return Object.freeze({ ...mapping, primaryClaim: Object.freeze({ ...mapping.primaryClaim, source: normalizeSourceUrl(mapping.primaryClaim.source) }), conflictingClaims: Object.freeze(conflictingClaims) });
}

/** Load the reviewed, exact conflict curation sidecar. */
export async function loadConflictMappings(mappingPath) {
  const parsed = JSON.parse(await readFile(mappingPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== 1 || !Array.isArray(parsed.mappings)) {
    throw new TypeError("conflict map must contain version 1 and mappings");
  }
  return Object.freeze(parsed.mappings.map((mapping) => Object.freeze({ ...mapping })));
}

/**
 * Classify only reviewed YAML conflict prose. Unmapped prose blocks evidence
 * creation instead of guessing a canonical field or source link.
 */
export function classifyConflicts({ normalized, mappings }) {
  if (!normalized || !Array.isArray(normalized.devices)) throw new TypeError("Normalized catalog must contain devices");
  if (!Array.isArray(mappings)) throw new TypeError("mappings must be an array");
  const devicesByKey = new Map(normalized.devices.map((device) => [identityKey(device), device]));
  const mappingsByProse = new Map();
  for (const [index, mapping] of mappings.entries()) {
    const validated = validateMapping(mapping, index, devicesByKey);
    const key = `${validated.deviceKey}\u0000${validated.conflict}`;
    if (mappingsByProse.has(key)) throw new TypeError(`duplicate curated conflict mapping for ${validated.deviceKey}`);
    mappingsByProse.set(key, validated);
  }
  const blockers = [];
  const classified = [];
  for (const device of normalized.devices) {
    const deviceKey = identityKey(device);
    for (const conflict of device.evidence.conflicts) {
      const mapping = mappingsByProse.get(`${deviceKey}\u0000${conflict}`);
      if (!mapping) {
        blockers.push(Object.freeze({
          code: "BLOCKED_EVIDENCE_MAP",
          deviceKey,
          path: "evidence.conflicts",
          detail: conflict,
          sourceUrls: Object.freeze([...device.evidence.sourceUrls]),
        }));
      } else {
        classified.push(publicMapping(mapping));
      }
    }
  }
  return Object.freeze({ mappings: Object.freeze(classified), blockers: Object.freeze(blockers) });
}
