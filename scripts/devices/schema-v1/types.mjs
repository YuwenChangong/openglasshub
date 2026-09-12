/** Shared, runtime-safe enum values for the Schema v1 import pipeline. */
export const DEVICE_SCHEMA_TYPES = Object.freeze(["display_ar", "ai_hud"]);
export const DEVICE_SPEC_VALUE_TYPES = Object.freeze(["number", "boolean", "text", "json"]);
export const DEVICE_SPEC_COMPARISON_MODES = Object.freeze(["higher", "lower", "equal_only", "none"]);

/** @typedef {{ code: string, deviceKey: string, path: string, detail: string }} Blocker */
/** @typedef {{ devices: unknown[] }} ApprovedCatalog */
/** @typedef {{ devices: NormalizedDevice[] }} NormalizedCatalog */
/** @typedef {{ schemaType: "display_ar" | "ai_hud", specs: NormalizedSpec[], evidence?: object }} NormalizedDevice */
/** @typedef {{ path: string, value?: unknown, valueType?: "number" | "boolean" | "text" | "json", canonicalUnit?: string | null, measurementContext?: string | null, comparisonMode?: "higher" | "lower" | "equal_only" | "none", requireSameContext?: boolean, isCore?: boolean, adminOrder?: number, helpText?: string | null, label?: string, definition?: object }} NormalizedSpec */
/** @typedef {{ key: string, groupKey: string, label: string, helpText: string | null, valueType: "number" | "boolean" | "text" | "json", canonicalUnit: string | null, measurementContext: string | null, comparisonMode: "higher" | "lower" | "equal_only" | "none", requireSameContext: boolean, applicableSchemaTypes: string[], isCore: boolean, adminOrder: number, isActive: boolean }} DeviceSpecDefinition */
/** @typedef {{ url: string, publisher: string, sourceType: string, accessedAt: string, title?: string | null, publishedAt?: string | null, region?: string | null }} SourceMetadata */
/** @typedef {{ classification: string, deviceKey: string, canonicalKey: string }} ConflictMapping */
/** @typedef {{ yamlBrand: string, yamlModel: string, yamlGeneration: string, slug?: string, blocker?: Blocker }} IdentityMapping */
/** @typedef {{ definitions: DeviceSpecDefinition[], devices: unknown[], specs: unknown[], sources: unknown[], sourceLinks: unknown[], evidence: unknown[], blockers: Blocker[] }} RecoveryPlan */
/** @typedef {{ status: string, blockers: Blocker[] }} RecoveryReceipt */

export function isSchemaType(value) {
  return DEVICE_SCHEMA_TYPES.includes(value);
}

export function isValueType(value) {
  return DEVICE_SPEC_VALUE_TYPES.includes(value);
}

export function isComparisonMode(value) {
  return DEVICE_SPEC_COMPARISON_MODES.includes(value);
}
