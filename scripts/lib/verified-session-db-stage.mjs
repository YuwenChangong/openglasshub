import { createHash } from "node:crypto";

const FAMILIES = ["schemas", "objects", "tables", "columns", "constraints", "indexes", "functions", "policies", "rls", "readAcl", "publication"];
const STAGES = ["PRE_V1", "FOUNDATION", "ENFORCEMENT"];
const SHA256 = /^[a-f0-9]{64}$/;

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : null;
  if (Array.isArray(value)) {
    const entries = value.map(canonical);
    if (entries.includes(null)) return null;
    entries.sort();
    if (entries.some((entry, index) => index > 0 && entry === entries[index - 1])) return null;
    return `[${entries.join(",")}]`;
  }
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const entries = [];
  for (const key of Object.keys(value).sort()) {
    const item = canonical(value[key]);
    if (item === null) return null;
    entries.push(`${JSON.stringify(key)}:${item}`);
  }
  return `{${entries.join(",")}}`;
}

export function catalogDigest(snapshot) {
  if (!snapshot || Object.getPrototypeOf(snapshot) !== Object.prototype) return null;
  const keys = Object.keys(snapshot).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...FAMILIES].sort())) return null;
  if (FAMILIES.some((family) => !Array.isArray(snapshot[family]))) return null;
  const encoded = canonical(snapshot);
  return encoded === null ? null : createHash("sha256").update(encoded).digest("hex");
}

export function classifyVerifiedSessionDbStage(snapshot, expected) {
  const digest = catalogDigest(snapshot);
  if (!digest || !expected || Object.getPrototypeOf(expected) !== Object.prototype) return "UNKNOWN";
  if (JSON.stringify(Object.keys(expected).sort()) !== JSON.stringify([...STAGES].sort())) return "UNKNOWN";
  const values = STAGES.map((stage) => expected[stage]);
  if (values.some((value) => typeof value !== "string" || !SHA256.test(value)) || new Set(values).size !== 3) return "UNKNOWN";
  return STAGES.find((stage) => expected[stage] === digest) ?? "UNKNOWN";
}
