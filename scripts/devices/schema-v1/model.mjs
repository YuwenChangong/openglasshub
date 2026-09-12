function deviceKey(device) {
  return `${device.identity.brand}|${device.identity.model}|${device.identity.generation}`;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function typedValues(spec) {
  const values = { valueNumber: null, valueBoolean: null, valueText: null, valueJson: null };
  if (spec.state !== "KNOWN" && spec.state !== "CONFLICT") return values;
  if (spec.state === "CONFLICT" && spec.valueType === undefined) return values;
  if (spec.value === undefined) return values;
  if (spec.valueType === "number") values.valueNumber = spec.value;
  else if (spec.valueType === "boolean") values.valueBoolean = spec.value;
  else if (spec.valueType === "text") values.valueText = spec.value;
  else if (spec.valueType === "json") values.valueJson = spec.value;
  else throw new TypeError(`Unsupported normalized value type for ${spec.path}`);
  return values;
}

function identityBlocker(mapping, key) {
  return Object.freeze({
    code: mapping.blocker.code,
    deviceKey: key,
    path: "identity",
    detail: mapping.blocker.detail,
  });
}

/**
 * Build deterministic database-shaped records from reviewed, normalized inputs.
 * This is intentionally pure: it performs no database or network operations.
 */
export function buildNormalizedModel({ normalized, definitions, sourceMetadata, identityMappings, conflicts }) {
  if (!normalized || !Array.isArray(normalized.devices)) throw new TypeError("normalized must contain devices");
  requireArray(definitions, "definitions");
  requireArray(sourceMetadata, "sourceMetadata");
  requireArray(identityMappings, "identityMappings");
  if (!conflicts || !Array.isArray(conflicts.mappings) || !Array.isArray(conflicts.blockers)) throw new TypeError("conflicts must contain mappings and blockers");

  const definitionsByKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const sourcesByUrl = new Map(sourceMetadata.map((source) => [source.url, source]));
  const identitiesByKey = new Map(identityMappings.map((mapping) => [`${mapping.yamlBrand}|${mapping.yamlModel}|${mapping.yamlGeneration}`, mapping]));
  const conflictsByDeviceAndKey = new Map(conflicts.mappings
    .filter((mapping) => mapping.classification === "TRUE_VALUE_CONFLICT")
    .map((mapping) => [`${mapping.deviceKey}\u0000${mapping.canonicalKey}`, mapping]));
  const blockers = [...(normalized.blockers ?? []), ...conflicts.blockers];
  const devices = [], specs = [], sourceLinks = [], evidence = [];
  const usedSources = new Set();

  for (const device of normalized.devices) {
    const key = deviceKey(device);
    const identity = identitiesByKey.get(key);
    if (!identity) {
      blockers.push(Object.freeze({ code: "BLOCKED_IDENTITY_UNMAPPED", deviceKey: key, path: "identity", detail: "No reviewed identity mapping" }));
      continue;
    }
    if (identity.blocker) {
      blockers.push(identityBlocker(identity, key));
      continue;
    }
    if (typeof identity.slug !== "string" || !identity.slug) throw new TypeError(`Resolved identity requires a slug: ${key}`);
    const slug = identity.slug;
    devices.push(Object.freeze({
      slug, brand: device.identity.brand, model: device.identity.model, generation: device.identity.generation,
      schemaType: device.schemaType, deviceType: device.identity.deviceType, status: device.identity.status,
    }));

    for (const sourceUrl of device.evidence.sourceUrls) {
      if (!sourcesByUrl.has(sourceUrl)) {
        blockers.push(Object.freeze({ code: "BLOCKED_SOURCE_METADATA", deviceKey: key, path: "evidence.source_urls", detail: sourceUrl }));
        continue;
      }
      usedSources.add(sourceUrl);
      sourceLinks.push(Object.freeze({ deviceSlug: slug, sourceUrl, isPrimary: false }));
    }
    for (const spec of device.specs) {
      const definition = definitionsByKey.get(spec.path);
      if (!definition) throw new TypeError(`BLOCKED_MODEL_DEFINITION: ${spec.path}`);
      const conflict = conflictsByDeviceAndKey.get(`${key}\u0000${spec.path}`);
      const state = conflict ? "CONFLICT" : spec.state;
      specs.push(Object.freeze({
        deviceSlug: slug, definitionKey: spec.path, state, ...typedValues({ ...spec, state, valueType: definition.valueType }),
        canonicalUnit: definition.canonicalUnit, measurementContext: definition.measurementContext,
        rawValue: spec.rawValue, region: device.evidence.region, variant: "",
        confidence: device.evidence.confidence, verifiedAt: device.evidence.verifiedAt,
      }));
      if (conflict) {
        const claims = [conflict.primaryClaim, ...conflict.conflictingClaims];
        if (claims.every((claim) => sourcesByUrl.has(claim.source))) {
          evidence.push(Object.freeze({ deviceSlug: slug, definitionKey: spec.path, sourceUrl: conflict.primaryClaim.source, claimedValue: conflict.primaryClaim.claim, isPrimary: true, isConflicting: false }));
          for (const claim of conflict.conflictingClaims) {
            evidence.push(Object.freeze({ deviceSlug: slug, definitionKey: spec.path, sourceUrl: claim.source, claimedValue: claim.claim, isPrimary: false, isConflicting: true }));
          }
        }
      }
    }
  }
  return Object.freeze({
    definitions: Object.freeze([...definitions]), devices: Object.freeze(devices), specs: Object.freeze(specs),
    sources: Object.freeze(sourceMetadata.filter((source) => usedSources.has(source.url))),
    sourceLinks: Object.freeze(sourceLinks), evidence: Object.freeze(evidence), blockers: Object.freeze(blockers),
  });
}
