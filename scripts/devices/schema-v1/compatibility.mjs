export const BOOTSTRAP_SPEC_VALUES_AUTHORITATIVE = false;
export const LEGACY_COMPAT_SPEC_SOURCE = "YAML_DERIVED";

function labelFor(path) {
  return path.split(".").at(-1).split("_").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
}

function isLegacyScalar(value) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * Produce the legacy JSONB surface solely from an already normalized YAML device.
 * State-bearing values that the string-only reader cannot faithfully express are
 * omitted and recorded for importer/operator visibility.
 *
 * @param {import("./types.mjs").NormalizedDevice} device
 */
export function buildLegacyCompatibility(device) {
  if (!device || !Array.isArray(device.specs)) throw new TypeError("Normalized device must contain specs");

  const groups = new Map();
  const compatibilityGaps = [];
  for (const spec of [...device.specs].sort((left, right) => left.path.localeCompare(right.path))) {
    if (spec.state !== "KNOWN" && spec.state !== "CONFLICT") {
      compatibilityGaps.push(Object.freeze({
        code: "LEGACY_COMPAT_UNREPRESENTABLE_STATE", path: spec.path, state: spec.state, rawValue: spec.rawValue,
      }));
      continue;
    }
    if (typeof spec.path !== "string" || !spec.path.includes(".") || !isLegacyScalar(spec.rawValue)) {
      compatibilityGaps.push(Object.freeze({
        code: "LEGACY_COMPAT_UNREPRESENTABLE_VALUE", path: spec.path, state: spec.state, rawValue: spec.rawValue,
      }));
      continue;
    }
    const [group, ...fieldParts] = spec.path.split(".");
    if (!groups.has(group)) groups.set(group, {});
    groups.get(group)[fieldParts.join(".")] = String(spec.rawValue);
  }

  const full_specs = Object.freeze(Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, fields]) => [group, Object.freeze(Object.fromEntries(Object.entries(fields).sort(([left], [right]) => left.localeCompare(right))))])));
  const key_specs = Object.freeze(Object.entries(full_specs)
    .flatMap(([group, fields]) => Object.entries(fields).map(([field, value]) => Object.freeze({
      field: `${group}.${field}`, label: labelFor(`${group}.${field}`), value,
    })))
    .slice(0, 5));

  return Object.freeze({
    key_specs,
    full_specs,
    compatibilityGaps: Object.freeze(compatibilityGaps),
    BOOTSTRAP_SPEC_VALUES_AUTHORITATIVE,
    LEGACY_COMPAT_SPEC_SOURCE,
  });
}
