import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import { isSchemaType } from "./types.mjs";

const ROOT_KEYS = new Set([
  "dataset", "verified_at", "device_count", "brand_count", "normalization_rules",
  "display_ar_schema_keys", "ai_hud_schema_keys", "devices",
]);
const EVIDENCE_KEYS = new Set(["verified_at", "region", "overall_confidence", "source_urls", "conflicts", "notes"]);
const APPROVED_VERIFIED_AT = "2026-09-05";

function assertPlainObject(value, description) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${description} must be an object`);
}

function assertExactKeys(value, expected, description) {
  assertPlainObject(value, description);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw new TypeError(`${description} has unsupported keys`);
  }
}

function assertScalar(value, description) {
  if (!["string", "number", "boolean"].includes(typeof value)) throw new TypeError(`${description} must be a string, number, or boolean`);
}

function validateDevice(device, catalog, index) {
  assertPlainObject(device, `devices[${index}]`);
  if (!isSchemaType(device.schema_type)) throw new TypeError(`devices[${index}].schema_type is not approved`);
  const schema = catalog[`${device.schema_type}_schema_keys`];
  assertPlainObject(schema, `schema keys for ${device.schema_type}`);
  assertExactKeys(device, new Set(["schema_type", ...Object.keys(schema)]), `devices[${index}]`);

  for (const [section, template] of Object.entries(schema)) {
    assertPlainObject(template, `${device.schema_type}.${section} schema`);
    assertExactKeys(device[section], new Set(Object.keys(template)), `devices[${index}].${section}`);
    if (section === "evidence") continue;
    for (const [key, value] of Object.entries(device[section])) assertScalar(value, `devices[${index}].${section}.${key}`);
  }

  const evidence = device.evidence;
  assertExactKeys(evidence, EVIDENCE_KEYS, `devices[${index}].evidence`);
  if (evidence.verified_at !== APPROVED_VERIFIED_AT) {
    throw new TypeError(`devices[${index}].evidence.verified_at must equal ${APPROVED_VERIFIED_AT}`);
  }
  for (const key of ["verified_at", "region", "overall_confidence"]) {
    if (typeof evidence[key] !== "string") throw new TypeError(`devices[${index}].evidence.${key} must be a string`);
  }
  for (const key of ["source_urls", "conflicts", "notes"]) {
    if (!Array.isArray(evidence[key]) || evidence[key].some((value) => typeof value !== "string")) {
      throw new TypeError(`devices[${index}].evidence.${key} must be an array of strings`);
    }
  }
}

/**
 * Parse and validate the byte-preserved approved Schema v1 catalog.
 *
 * @param {string | URL} sourcePath
 * @returns {Promise<import("./types.mjs").ApprovedCatalog>}
 */
export async function loadApprovedDeviceYaml(sourcePath) {
  const source = await readFile(sourcePath, "utf8");
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) throw new TypeError(`Approved YAML parse failed: ${document.errors[0].message}`);
  const catalog = document.toJS();
  assertExactKeys(catalog, ROOT_KEYS, "approved catalog");
  if (catalog.verified_at !== APPROVED_VERIFIED_AT) throw new TypeError(`approved catalog verified_at must equal ${APPROVED_VERIFIED_AT}`);
  if (!Array.isArray(catalog.devices)) throw new TypeError("approved catalog devices must be an array");
  if (!Array.isArray(catalog.normalization_rules) || catalog.normalization_rules.some((value) => typeof value !== "string")) {
    throw new TypeError("approved catalog normalization_rules must be an array of strings");
  }
  if (catalog.device_count !== 24 || catalog.brand_count !== 8) throw new TypeError("approved catalog must declare 24 devices and 8 brands");
  if (catalog.devices.length !== catalog.device_count) throw new TypeError("approved catalog device count does not match devices");
  for (const [schemaType, sectionKeys] of [["display_ar", catalog.display_ar_schema_keys], ["ai_hud", catalog.ai_hud_schema_keys]]) {
    assertPlainObject(sectionKeys, `${schemaType}_schema_keys`);
    if (!Object.hasOwn(sectionKeys, "basic") || !Object.hasOwn(sectionKeys, "evidence")) throw new TypeError(`${schemaType}_schema_keys must declare basic and evidence`);
    assertExactKeys(sectionKeys.evidence, EVIDENCE_KEYS, `${schemaType}_schema_keys.evidence`);
  }
  catalog.devices.forEach((device, index) => validateDevice(device, catalog, index));
  if (new Set(catalog.devices.map((device) => device.basic.brand)).size !== catalog.brand_count) {
    throw new TypeError("approved catalog brand count does not match devices");
  }
  return catalog;
}
