import { isComparisonMode, isSchemaType, isValueType } from "./types.mjs";

const IDENTITY_PATHS = new Set([
  "schema_type",
  "basic.brand",
  "basic.model",
  "basic.generation",
  "basic.device_type",
  "basic.status",
  "basic.release_date",
]);
const FORBIDDEN_SPEC_PATHS = new Set(["display.brightness"]);

function definitionValue(spec, name, fallback = undefined) {
  return spec.definition?.[name] ?? spec[name] ?? fallback;
}

function labelFor(path) {
  return path.split(".").at(-1).split("_").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
}

function concreteValueTypeFor(spec) {
  const explicit = definitionValue(spec, "valueType");
  if (isValueType(explicit)) return explicit;
  if (spec.state !== undefined && spec.state !== "KNOWN" && spec.state !== "CONFLICT") return null;
  if (typeof spec.value === "boolean") return "boolean";
  if (typeof spec.value === "number") return "number";
  if (spec.value !== null && typeof spec.value === "object") return "json";
  return "text";
}

function resolvedValueType(valueTypes) {
  if (valueTypes.size === 0) return "text";
  if (valueTypes.size === 1) return [...valueTypes][0];
  return "json";
}

function isDefinitionPath(path) {
  return typeof path === "string"
    && path.length > 0
    && !IDENTITY_PATHS.has(path)
    && !FORBIDDEN_SPEC_PATHS.has(path)
    && !path.startsWith("evidence.");
}

function metadataFor(path, spec, valueType = concreteValueTypeFor(spec) ?? "text") {
  const context = path === "display.eye_brightness"
    ? "eye_brightness"
    : path === "display.panel_or_projector_brightness"
      ? "panel_or_projector_brightness"
      : definitionValue(spec, "measurementContext", null);
  const comparisonMode = definitionValue(spec, "comparisonMode", "none");
  if (!isComparisonMode(comparisonMode)) throw new TypeError(`Invalid comparison mode for ${path}: ${comparisonMode}`);
  return {
    key: path,
    groupKey: definitionValue(spec, "groupKey", path.split(".")[0]),
    label: definitionValue(spec, "label", labelFor(path)),
    helpText: definitionValue(spec, "helpText", null),
    valueType,
    canonicalUnit: definitionValue(spec, "canonicalUnit", null),
    measurementContext: context,
    comparisonMode,
    requireSameContext: definitionValue(spec, "requireSameContext", context !== null),
    isCore: definitionValue(spec, "isCore", false),
    adminOrder: definitionValue(spec, "adminOrder", 0),
    isActive: definitionValue(spec, "isActive", true),
  };
}

function sameMetadata(left, right) {
  return ["groupKey", "label", "helpText", "canonicalUnit", "measurementContext", "comparisonMode", "requireSameContext", "isCore", "adminOrder", "isActive"]
    .every((key) => left[key] === right[key]);
}

/**
 * Derive the immutable canonical definition registry from normalized YAML.
 * Identity and evidence paths are deliberately excluded by the ownership matrix.
 *
 * @param {import("./types.mjs").NormalizedCatalog} normalized
 * @returns {import("./types.mjs").DeviceSpecDefinition[]}
 */
export function buildDefinitionRegistry(normalized) {
  if (!normalized || !Array.isArray(normalized.devices)) throw new TypeError("Normalized catalog must contain devices");
  const definitions = new Map();
  for (const device of normalized.devices) {
    if (!isSchemaType(device?.schemaType)) throw new TypeError(`Invalid device schema type: ${device?.schemaType}`);
    if (!Array.isArray(device.specs)) throw new TypeError("Normalized device must contain specs");
    for (const spec of device.specs) {
      if (!isDefinitionPath(spec?.path)) continue;
      const candidate = metadataFor(spec.path, spec);
      const existing = definitions.get(candidate.key);
      if (existing && !sameMetadata(existing, candidate)) {
        throw new TypeError(`Conflicting definition metadata for ${candidate.key}`);
      }
      if (!existing) definitions.set(candidate.key, { ...candidate, valueTypes: new Set(), applicableSchemaTypes: new Set() });
      const definition = definitions.get(candidate.key);
      const valueType = concreteValueTypeFor(spec);
      if (valueType) definition.valueTypes.add(valueType);
      definition.applicableSchemaTypes.add(device.schemaType);
    }
  }
  return [...definitions.values()]
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    .map(({ valueTypes, applicableSchemaTypes, ...definition }) => Object.freeze({
      ...definition,
      valueType: resolvedValueType(valueTypes),
      applicableSchemaTypes: Object.freeze([...applicableSchemaTypes].sort()),
    }));
}
