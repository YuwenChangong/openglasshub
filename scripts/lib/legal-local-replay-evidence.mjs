import { createHash } from "node:crypto";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const HASH = /^[a-f0-9]{64}$/;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertEvidenceName(name) {
  if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(String(name ?? ""))) fail("R6_LOCAL_REPLAY_EVIDENCE_NAME_INVALID");
  return name;
}

export function assertEvidenceLogName(name) {
  if (!/^(?:baseline-)?migration-attempt-[1-9][0-9]*-(?:stdout|stderr)\.log$/.test(String(name ?? ""))) fail("R6_LOCAL_REPLAY_EVIDENCE_NAME_INVALID");
  return name;
}

async function writeAtomicEvidence({ evidenceRoot, name, body, assertName }) {
  const root = path.resolve(evidenceRoot);
  const filename = assertName(name);
  const destination = path.resolve(root, filename);
  if (path.dirname(destination) !== root) fail("R6_LOCAL_REPLAY_EVIDENCE_PATH_TRAVERSAL");
  try {
    await access(destination);
    fail("R6_LOCAL_REPLAY_EVIDENCE_ALREADY_EXISTS");
  } catch (error) {
    if (error?.code === "R6_LOCAL_REPLAY_EVIDENCE_ALREADY_EXISTS") throw error;
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(root, { recursive: true });
  const temporary = path.join(root, `.${filename}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, body, { encoding: "utf8", flag: "wx" });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return Object.freeze({ path: destination, sha256: sha256(body), bytes: Buffer.byteLength(body) });
}

export async function writeCanonicalEvidence({ evidenceRoot, name, payload }) {
  const body = `${stableJson(payload)}\n`;
  return writeAtomicEvidence({ evidenceRoot, name, body, assertName: assertEvidenceName });
}

export async function writeRedactedMigrationLog({ evidenceRoot, name, text }) {
  if (typeof text !== "string") fail("R6_LOCAL_MIGRATION_FAILURE_DIAGNOSTIC_REDACTION_FAILED");
  return writeAtomicEvidence({ evidenceRoot, name, body: text, assertName: assertEvidenceLogName });
}

export function assertEvidenceSha256(value) {
  if (!HASH.test(String(value ?? ""))) fail("R6_LOCAL_REPLAY_EVIDENCE_SHA_INVALID");
  return value;
}
