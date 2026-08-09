import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { TRANSPORT_CONTRACT_VERSION, fail } from "./r6-production-reconciliation-transport-contract.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => JSON.stringify(value, Object.keys(value).sort());

async function durableExclusiveJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  let handle;
  try {
    handle = await open(file, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    if (error?.code === "EEXIST") fail("R6_PRODUCTION_RECONCILIATION_RECEIPT_REPLAY");
    throw error;
  } finally { await handle?.close(); }
}

async function durableReplace(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
    await handle.close(); handle = null;
    await rename(temporary, file);
  } finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
}

function seal(receipt) { const copy = { ...receipt }; delete copy.integrity; return { ...copy, integrity: hash(canonical(copy)) }; }
export function validateReceipt(receipt) {
  if (!receipt || receipt.schemaVersion !== "r6-production-reconciliation-receipt-v1" || receipt.transportContractVersion !== TRANSPORT_CONTRACT_VERSION || !["ATTEMPT_RESERVED", "SQL_SUBMITTED", "COMMITTED", "FAILED_PRE_SUBMIT", "FAILED_NOT_COMMITTED", "COMMIT_STATE_UNKNOWN", "POSTFLIGHT_FAILED", "POSTFLIGHT_COMPLETE"].includes(receipt.state) || !/^[a-f0-9]{64}$/.test(String(receipt.authorizationCandidateSha256 ?? "")) || !/^[a-f0-9]{64}$/.test(String(receipt.finalConfirmationSha256 ?? "")) || !/^[a-f0-9]{64}$/.test(String(receipt.integrity ?? "")) || seal(receipt).integrity !== receipt.integrity) fail("R6_PRODUCTION_RECONCILIATION_RECEIPT_INVALID");
  return receipt;
}

export async function assertReceiptEligible({ receiptRoot, authorizationId }) {
  const root = path.resolve(receiptRoot);
  const file = path.join(root, `${authorizationId}.json`);
  try {
    await access(file);
  } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze({ path: file, receiptConsumed: false });
    throw error;
  }
  fail("R6_PRODUCTION_RECONCILIATION_RECEIPT_REPLAY");
}

export async function reserveAttempt({ receiptRoot, authorization, authorizationCandidateSha256, finalConfirmationSha256, packageManifestSha256, now = new Date().toISOString() }) {
  const root = path.resolve(receiptRoot);
  const file = path.join(root, `${authorization.authorizationId}.json`);
  const base = { schemaVersion: "r6-production-reconciliation-receipt-v1", transportContractVersion: TRANSPORT_CONTRACT_VERSION, state: "ATTEMPT_RESERVED", authorizationId: authorization.authorizationId, executionTaskId: authorization.executionTaskId, authorizationCandidateSha256, finalConfirmationSha256, packageManifestSha256, createdAt: now, attemptConsumed: false, postflightCount: 0 };
  const receipt = seal(base);
  await durableExclusiveJson(file, receipt);
  return Object.freeze({ path: file, receipt });
}

export async function transitionReceipt({ receiptPath, expectedState, nextState, patch = {}, now = new Date().toISOString() }) {
  const raw = await readFile(receiptPath).catch(() => fail("R6_PRODUCTION_RECONCILIATION_RECEIPT_MISSING"));
  let receipt; try { receipt = validateReceipt(JSON.parse(raw.toString("utf8"))); } catch (error) { if (error?.code) throw error; fail("R6_PRODUCTION_RECONCILIATION_RECEIPT_INVALID"); }
  if (receipt.state !== expectedState) fail("R6_PRODUCTION_RECONCILIATION_RECEIPT_TRANSITION_INVALID");
  const next = seal({ ...receipt, ...patch, state: nextState, updatedAt: now });
  await durableReplace(receiptPath, next);
  return Object.freeze({ path: receiptPath, receipt: next });
}
