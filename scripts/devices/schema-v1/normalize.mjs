import { isSchemaType } from "./types.mjs";

const IDENTITY_BASIC_KEYS = new Set(["brand", "model", "generation", "device_type", "status", "release_date"]);
const CONFIDENCE = new Map([["High", "HIGH"], ["Medium-High", "MEDIUM_HIGH"], ["Medium", "MEDIUM"], ["Low", "LOW"]]);

function deviceKey(device) {
  return `${device.basic.brand}|${device.basic.model}|${device.basic.generation}`;
}

function normalizedPath(section, field) {
  if (section !== "display_optics") return `${section}.${field}`;
  if (field === "eye_brightness_nits") return "display.eye_brightness";
  if (field === "panel_or_projector_brightness_nits") return "display.panel_or_projector_brightness";
  return `display.${field}`;
}

function normalizeValue(path, rawValue) {
  if (rawValue === "Not disclosed") return { path, rawValue, state: "NOT_DISCLOSED" };
  if (rawValue === "Not applicable") return { path, rawValue, state: "NOT_APPLICABLE" };
  if (rawValue === "No") return { path, rawValue, state: "KNOWN", value: false, valueType: "boolean" };
  if (rawValue === "Yes") return { path, rawValue, state: "KNOWN", value: true, valueType: "boolean" };
  return {
    path,
    rawValue,
    state: "KNOWN",
    value: rawValue,
    valueType: typeof rawValue === "number" ? "number" : typeof rawValue === "boolean" ? "boolean" : "text",
  };
}

function normalizeDevice(device, blockers) {
  if (!device?.basic || !isSchemaType(device.schema_type)) throw new TypeError("Normalized catalog requires approved devices");
  const key = deviceKey(device);
  const confidence = CONFIDENCE.get(device.evidence.overall_confidence) ?? null;
  if (confidence === null) {
    blockers.push({
      code: "BLOCKED_CONFIDENCE_VALUE",
      deviceKey: key,
      path: "evidence.overall_confidence",
      detail: device.evidence.overall_confidence,
    });
  }
  const specs = [];
  for (const [section, fields] of Object.entries(device)) {
    if (section === "schema_type" || section === "evidence") continue;
    for (const [field, rawValue] of Object.entries(fields)) {
      if (section === "basic" && IDENTITY_BASIC_KEYS.has(field)) continue;
      specs.push(normalizeValue(normalizedPath(section, field), rawValue));
    }
  }
  return {
    schemaType: device.schema_type,
    identity: {
      brand: device.basic.brand,
      model: device.basic.model,
      generation: device.basic.generation,
      deviceType: device.basic.device_type,
      status: device.basic.status,
    },
    specs,
    evidence: {
      verifiedAt: device.evidence.verified_at,
      region: device.evidence.region,
      confidence,
      sourceUrls: [...device.evidence.source_urls],
      conflicts: [...device.evidence.conflicts],
      notes: [...device.evidence.notes],
    },
  };
}

/**
 * Normalize approved YAML values without filling unknowns or changing source semantics.
 *
 * @param {import("./types.mjs").ApprovedCatalog} input
 * @param {{}} [options]
 * @returns {import("./types.mjs").NormalizedCatalog & { blockers: import("./types.mjs").Blocker[] }}
 */
export function normalizeCatalogYaml(input, options = {}) {
  void options;
  if (!input || !Array.isArray(input.devices)) throw new TypeError("Approved catalog must contain devices");
  const blockers = [];
  return { devices: input.devices.map((device) => normalizeDevice(device, blockers)), blockers };
}
