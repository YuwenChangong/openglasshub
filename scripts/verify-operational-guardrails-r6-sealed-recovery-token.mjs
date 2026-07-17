import { mkdir, open, readFile, lstat, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { classifyRecovery, loadBaseline, parseRecoveryPacket } from "./validate-operational-guardrails-r6-compact-recovery.mjs";
import { decodeSealedRecoveryToken, sha256 } from "./lib/operational-guardrails-r6-sealed-token.mjs";

const safeError = (code) => new Error(code);
const REVIEWED_SQL_SHA256 = "1cce650d890fe481a5c9d83033ab88ea189ee28168a6ff91df24513d2d65f819";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function requireUnused(target) {
  try { await lstat(target); } catch (error) { if (error?.code === "ENOENT") return; throw error; }
  throw safeError("R6_SEALED_EVIDENCE_OUTPUT_EXISTS");
}

async function atomicWrite(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  let closed = false;
  try { await handle.writeFile(value, "utf8"); await handle.sync(); await handle.close(); closed = true; await rename(temporary, target); }
  catch (error) { if (!closed) await handle.close().catch(() => undefined); await rm(temporary, { force: true }); throw error; }
}

function validateOutputPath(target, suffix) {
  if (typeof target !== "string" || !path.isAbsolute(target) || !target.endsWith(suffix)) throw safeError("R6_SEALED_EVIDENCE_OUTPUT_PATH_INVALID");
  const resolved = path.resolve(target);
  const relative = path.relative(REPOSITORY_ROOT, resolved);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw safeError("R6_SEALED_EVIDENCE_PATH_MUST_BE_OUTSIDE_REPOSITORY");
  return resolved;
}

export async function verifySealedRecoveryToken({ tokenPath, tokenShaPath, outputPath, outputShaPath, verificationPath, baselinePath, baselineSha256, approvedCommit }) {
  const tokenFile = validateOutputPath(tokenPath, ".txt");
  const tokenShaFile = validateOutputPath(tokenShaPath, ".sha256");
  const evidenceFile = validateOutputPath(outputPath, ".json");
  const evidenceShaFile = validateOutputPath(outputShaPath, ".sha256");
  const metadataFile = validateOutputPath(verificationPath, ".json");
  if (new Set([evidenceFile.toLowerCase(), evidenceShaFile.toLowerCase(), metadataFile.toLowerCase(), tokenFile.toLowerCase(), tokenShaFile.toLowerCase()]).size !== 5) throw safeError("R6_SEALED_EVIDENCE_OUTPUT_PATH_COLLISION");
  const [token, tokenSidecar] = await Promise.all([readFile(tokenFile, "utf8"), readFile(tokenShaFile, "utf8")]);
  if (tokenSidecar !== `${sha256(token)}  ${path.basename(tokenFile)}\n`) throw safeError("R6_SEALED_TOKEN_FILE_SHA_MISMATCH");
  let sealed;
  try { sealed = decodeSealedRecoveryToken(token); } catch { throw safeError("R6_SEALED_PAYLOAD_SCHEMA_INVALID"); }
  let packet;
  try { packet = parseRecoveryPacket(sealed.packet); } catch { throw safeError("R6_SEALED_PAYLOAD_SCHEMA_INVALID"); }
  const baseline = await loadBaseline(baselinePath, baselineSha256);
  const classification = classifyRecovery(packet, baseline);
  const evidence = `${JSON.stringify(packet)}\n`;
  const evidenceSha = sha256(evidence);
  const metadata = `${JSON.stringify({ record_version: "r6-sealed-recovery-verification-v1", token_prefix: "R6SEALED1", token_byte_length: Buffer.byteLength(token, "ascii"), declared_payload_length: sealed.declaredLength, decoded_payload_length: sealed.payloadBytes.byteLength, token_sha_verified: true, schema_verified: true, baseline_sha_verified: true, final_classification: classification, approved_commit: approvedCommit, sealed_sql_sha256: REVIEWED_SQL_SHA256 }, null, 2)}\n`;
  await Promise.all([requireUnused(evidenceFile), requireUnused(evidenceShaFile), requireUnused(metadataFile)]);
  const wrote = [];
  try {
    await atomicWrite(evidenceFile, evidence); wrote.push(evidenceFile);
    await atomicWrite(evidenceShaFile, `${evidenceSha}  ${path.basename(evidenceFile)}\n`); wrote.push(evidenceShaFile);
    await atomicWrite(metadataFile, metadata); wrote.push(metadataFile);
    const [verifiedEvidence, verifiedSidecar] = await Promise.all([readFile(evidenceFile, "utf8"), readFile(evidenceShaFile, "utf8")]);
    if (verifiedEvidence !== evidence || verifiedSidecar !== `${evidenceSha}  ${path.basename(evidenceFile)}\n`) throw safeError("R6_SEALED_EVIDENCE_REREAD_MISMATCH");
    return { classification, declaredPayloadLength: sealed.declaredLength, tokenBytes: Buffer.byteLength(token, "ascii"), evidenceSha256: evidenceSha };
  } catch (error) {
    await Promise.all(wrote.map((target) => rm(target, { force: true })));
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [tokenPath, tokenShaPath, outputPath, outputShaPath, verificationPath, baselinePath, baselineSha256, approvedCommit] = process.argv.slice(2);
  try {
    if (process.argv.length !== 10 || !/^[0-9a-f]{40}$/.test(approvedCommit ?? "")) throw safeError("R6_SEALED_VERIFIER_CLI_ARGUMENTS_INVALID");
    const result = await verifySealedRecoveryToken({ tokenPath, tokenShaPath, outputPath, outputShaPath, verificationPath, baselinePath, baselineSha256, approvedCommit });
    console.log(JSON.stringify({ status: "PASS", ...result }));
  } catch (error) { console.error(JSON.stringify({ status: "FAIL", classification: error.message })); process.exitCode = 1; }
}
