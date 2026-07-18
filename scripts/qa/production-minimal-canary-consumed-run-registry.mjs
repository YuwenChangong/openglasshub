import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";

export const CONSUMED_RUN_REGISTRY_VERSION = "consumed-run-registry-v1";
export const CONSUMED_RUN_STATUS = "PERMANENTLY_INELIGIBLE";
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const RUN_ID = /^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES = new Set(["dry-run", "live", "recovery"]);

export function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
export function validateConsumedRunId(value) {
  const runId = String(value ?? "").trim();
  if (!RUN_ID.test(runId)) throw new Error("QA_CANARY_RUN_ID_INVALID");
  return runId.toLowerCase();
}

function canonical(value) { return JSON.stringify(value); }
function entryDigest(entry) { const copy = { ...entry }; delete copy.entryDigest; return sha256(canonical(copy)); }
function registryDigest(registry) { const copy = { ...registry }; delete copy.integrity; return sha256(canonical(copy)); }
function ledgerEntryDigest(entry) { return sha256(canonical(entry)); }
function registryPaths(root) {
  const resolvedRoot = path.resolve(String(root ?? ""));
  if (!path.isAbsolute(resolvedRoot)) throw new Error("QA_CANARY_CONSUMED_RUN_ROOT_INVALID");
  return {
    root: resolvedRoot,
    registry: path.join(resolvedRoot, "consumed-run-registry-v1.json"),
    ledger: path.join(resolvedRoot, "confirmation-token-ledger-v1.json"),
    lock: path.join(resolvedRoot, "consumed-run-registry-v1.lock"),
    receipts: path.join(resolvedRoot, "consumed-run-receipts-v1"),
  };
}

function assertPathInside(root, candidate, code) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(code);
}

async function assertNoReparse(file, code) {
  const info = await lstat(file).catch((error) => { if (error?.code === "ENOENT") throw error; throw new Error(code); });
  if (info.isSymbolicLink()) throw new Error(code);
  return info;
}

async function durableWrite(file, raw) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(raw, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, file);
}

async function withLock(root, action) {
  const paths = registryPaths(root);
  await mkdir(paths.root, { recursive: true });
  let acquired = false;
  try {
    await mkdir(paths.lock);
    acquired = true;
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("QA_CANARY_CONSUMED_RUN_REGISTRY_LOCKED");
    throw error;
  }
  try { return await action(paths); }
  finally { if (acquired) await rm(paths.lock, { recursive: true, force: false }).catch(() => { throw new Error("QA_CANARY_CONSUMED_RUN_REGISTRY_LOCK_RELEASE_FAILED"); }); }
}

function emptyRegistry() { return { schemaVersion: CONSUMED_RUN_REGISTRY_VERSION, entries: [] }; }
function emptyLedger() { return { schemaVersion: CONSUMED_RUN_REGISTRY_VERSION, entries: [] }; }

function assertTimestamp(value, code, { historicalPrecision = false } = {}) {
  const pattern = historicalPrecision ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  if (!pattern.test(String(value ?? "")) || !Number.isFinite(Date.parse(value))) throw new Error(code);
  return value;
}

function validateLedger(ledger) {
  if (!ledger || ledger.schemaVersion !== CONSUMED_RUN_REGISTRY_VERSION || !Array.isArray(ledger.entries)) throw new Error("QA_CANARY_CONSUMED_RUN_LEDGER_INVALID");
  const ids = new Set();
  for (const entry of ledger.entries) {
    const runId = validateConsumedRunId(entry?.runId);
    if (!MODES.has(entry?.mode) || !SHA256.test(String(entry?.confirmationTokenSha256 ?? "")) || !SHA256.test(String(entry?.entryDigest ?? ""))) throw new Error("QA_CANARY_CONSUMED_RUN_LEDGER_INVALID");
    assertTimestamp(entry.recordedAt, "QA_CANARY_CONSUMED_RUN_LEDGER_INVALID");
    if (ledgerEntryDigest({ runId, mode: entry.mode, confirmationTokenSha256: entry.confirmationTokenSha256, recordedAt: entry.recordedAt }) !== entry.entryDigest) throw new Error("QA_CANARY_CONSUMED_RUN_LEDGER_INVALID");
    if (ids.has(runId)) throw new Error("QA_CANARY_CONSUMED_RUN_LEDGER_CONFLICT");
    ids.add(runId);
  }
  return ledger;
}

function validateRegistry(registry, ledger) {
  if (!registry || registry.schemaVersion !== CONSUMED_RUN_REGISTRY_VERSION || !Array.isArray(registry.entries) || !SHA256.test(String(registry.integrity ?? ""))) throw new Error("QA_CANARY_CONSUMED_RUN_REGISTRY_INVALID");
  if (registryDigest(registry) !== registry.integrity) throw new Error("QA_CANARY_CONSUMED_RUN_REGISTRY_INVALID");
  const ledgerByRunId = new Map(ledger.entries.map((entry) => [entry.runId, entry]));
  const ids = new Set();
  for (const entry of registry.entries) {
    const runId = validateConsumedRunId(entry?.runId);
    if (entry.status !== CONSUMED_RUN_STATUS || !MODES.has(entry.mode) || !SHA256.test(String(entry.entryDigest ?? "")) || !SHA256.test(String(entry.confirmationTokenSha256 ?? ""))) throw new Error("QA_CANARY_CONSUMED_RUN_REGISTRY_INVALID");
    assertTimestamp(entry.consumedAt, "QA_CANARY_CONSUMED_RUN_REGISTRY_INVALID");
    if (entryDigest(entry) !== entry.entryDigest || ids.has(runId)) throw new Error("QA_CANARY_CONSUMED_RUN_REGISTRY_CONFLICT");
    const ledgerEntry = ledgerByRunId.get(runId);
    if (!ledgerEntry || ledgerEntry.entryDigest !== entry.tokenLedgerEntryDigest || ledgerEntry.confirmationTokenSha256 !== entry.confirmationTokenSha256 || ledgerEntry.mode !== entry.mode) throw new Error("QA_CANARY_CONSUMED_RUN_REGISTRY_LEDGER_MISMATCH");
    if (!entry.provenance || typeof entry.provenance !== "object" || !["historical-ledger", "new-reservation", "legacy-block"].includes(entry.provenance.kind)) throw new Error("QA_CANARY_CONSUMED_RUN_REGISTRY_INVALID");
    ids.add(runId);
  }
  return registry;
}

async function readJson(file, code) {
  const raw = await readFile(file).catch((error) => { if (error?.code === "ENOENT") throw error; throw new Error(code); });
  try { return { raw, value: JSON.parse(raw.toString("utf8")) }; } catch { throw new Error(code); }
}

async function loadState(root, { allowMissing = false } = {}) {
  const paths = registryPaths(root);
  const [registryResult, ledgerResult] = await Promise.all([
    readJson(paths.registry, "QA_CANARY_CONSUMED_RUN_REGISTRY_INVALID").catch((error) => { if (allowMissing && error?.code === "ENOENT") return null; throw error; }),
    readJson(paths.ledger, "QA_CANARY_CONSUMED_RUN_LEDGER_INVALID").catch((error) => { if (allowMissing && error?.code === "ENOENT") return null; throw error; }),
  ]);
  if (!registryResult && !ledgerResult && allowMissing) return { paths, registry: emptyRegistry(), ledger: emptyLedger(), fresh: true };
  if (!registryResult || !ledgerResult) throw new Error("QA_CANARY_CONSUMED_RUN_REGISTRY_LEDGER_MISMATCH");
  await Promise.all([assertNoReparse(paths.registry, "QA_CANARY_CONSUMED_RUN_REGISTRY_PATH_INVALID"), assertNoReparse(paths.ledger, "QA_CANARY_CONSUMED_RUN_REGISTRY_PATH_INVALID")]);
  validateLedger(ledgerResult.value);
  validateRegistry(registryResult.value, ledgerResult.value);
  return { paths, registry: registryResult.value, ledger: ledgerResult.value, fresh: false };
}

async function writeState(paths, registry, ledger) {
  const sealedRegistry = { ...registry, integrity: registryDigest(registry) };
  validateLedger(ledger);
  validateRegistry(sealedRegistry, ledger);
  await durableWrite(paths.registry, `${JSON.stringify(sealedRegistry, null, 2)}\n`);
  await durableWrite(paths.ledger, `${JSON.stringify(ledger, null, 2)}\n`);
  return sealedRegistry;
}

function makeLedgerEntry({ runId, mode, confirmationTokenSha256, recordedAt }) {
  const entry = { runId, mode, confirmationTokenSha256, recordedAt };
  return { ...entry, entryDigest: ledgerEntryDigest(entry) };
}

function makeRegistryEntry({ runId, mode, confirmationTokenSha256, tokenLedgerEntryDigest, consumedAt, provenance }) {
  const entry = { runId, mode, status: CONSUMED_RUN_STATUS, confirmationTokenSha256, tokenLedgerEntryDigest, consumedAt, provenance };
  return { ...entry, entryDigest: entryDigest(entry) };
}

export async function loadConsumedRunRegistry({ root }) {
  const state = await loadState(root);
  return { ...state, registrySha256: sha256(await readFile(state.paths.registry)), ledgerSha256: sha256(await readFile(state.paths.ledger)) };
}

export async function assertRunIdNotConsumed({ root, runId }) {
  const id = validateConsumedRunId(runId);
  const state = await loadState(root);
  if (state.registry.entries.some((entry) => entry.runId === id)) throw new Error("QA_CANARY_RUN_ID_ALREADY_CONSUMED");
  return { runId: id, registrySha256: sha256(await readFile(state.paths.registry)) };
}

export async function assertReservedRunMayUseReceipt({ root, runId }) {
  const id = validateConsumedRunId(runId);
  const state = await loadState(root);
  const entry = state.registry.entries.find((candidate) => candidate.runId === id);
  if (!entry || entry.provenance.kind !== "new-reservation") {
    throw new Error(entry ? "QA_CANARY_RUN_ID_ALREADY_CONSUMED" : "QA_CANARY_CONSUMED_RUN_RECEIPT_REQUIRED");
  }
  return entry;
}

function parseHistoricalLedger(raw, expectedRunId) {
  let value;
  try { value = JSON.parse(raw.toString("utf8")); } catch { throw new Error("QA_CANARY_HISTORICAL_LEDGER_INVALID"); }
  const entry = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value;
  if (!entry || validateConsumedRunId(entry.runId) !== expectedRunId || !["dry-run", "live"].includes(entry.domain) || !SHA256.test(String(entry.sha256 ?? ""))) throw new Error("QA_CANARY_HISTORICAL_LEDGER_INVALID");
  assertTimestamp(entry.recordedAt, "QA_CANARY_HISTORICAL_LEDGER_INVALID", { historicalPrecision: true });
  return entry;
}

export async function backfillHistoricalConsumedRuns({ root, records, now = new Date().toISOString() }) {
  if (!Array.isArray(records) || records.length === 0) throw new Error("QA_CANARY_HISTORICAL_BACKFILL_INVALID");
  assertTimestamp(now, "QA_CANARY_HISTORICAL_BACKFILL_INVALID");
  return withLock(root, async (paths) => {
    const state = await loadState(paths.root, { allowMissing: true });
    const registry = structuredClone(state.registry); const ledger = structuredClone(state.ledger);
    const existing = new Map(registry.entries.map((entry) => [entry.runId, entry]));
    const added = [];
    for (const record of records) {
      const runId = validateConsumedRunId(record?.runId);
      if (existing.has(runId)) continue;
      let tokenSha = "0".repeat(64); let mode = "recovery"; let provenance;
      if (record.sourceLedgerPath) {
        const sourcePath = path.resolve(record.sourceLedgerPath);
        const sourceRaw = await readFile(sourcePath).catch(() => { throw new Error("QA_CANARY_HISTORICAL_LEDGER_MISSING"); });
        const source = parseHistoricalLedger(sourceRaw, runId);
        tokenSha = source.sha256; mode = source.domain;
        provenance = { kind: "historical-ledger", sourceLedgerPath: sourcePath, sourceLedgerSha256: sha256(sourceRaw), backfillReason: "existing protected confirmation ledger" };
      } else if (record.legacyBlock === true) {
        provenance = { kind: "legacy-block", backfillReason: "pre-registry permanent ineligibility" };
      } else throw new Error("QA_CANARY_HISTORICAL_BACKFILL_INVALID");
      const ledgerEntry = makeLedgerEntry({ runId, mode, confirmationTokenSha256: tokenSha, recordedAt: now });
      const registryEntry = makeRegistryEntry({ runId, mode, confirmationTokenSha256: tokenSha, tokenLedgerEntryDigest: ledgerEntry.entryDigest, consumedAt: now, provenance });
      ledger.entries.push(ledgerEntry); registry.entries.push(registryEntry); existing.set(runId, registryEntry); added.push(runId);
    }
    const sealedRegistry = await writeState(paths, registry, ledger);
    return { added, registrySha256: sha256(await readFile(paths.registry)), ledgerSha256: sha256(await readFile(paths.ledger)), entries: sealedRegistry.entries };
  });
}

function receiptFile(paths, runId, nonce) {
  const directory = path.join(paths.receipts, runId);
  const file = path.join(directory, `${nonce}.json`);
  assertPathInside(paths.receipts, file, "QA_CANARY_CONSUMED_RUN_RECEIPT_PATH_INVALID");
  return { directory, file };
}

function validateReceiptShape(receipt) {
  if (!receipt || receipt.schemaVersion !== CONSUMED_RUN_REGISTRY_VERSION || !["PENDING", "CONSUMED"].includes(receipt.state) || !RUN_ID.test(String(receipt.runId ?? "")) || !MODES.has(receipt.mode) || !COMMIT.test(String(receipt.runnerCommit ?? "")) || receipt.wrapperVersion !== "r6-consumed-run-wrapper-v1" || !SHA256.test(String(receipt.wrapperSha256 ?? "")) || !SHA256.test(String(receipt.tokenLedgerEntryDigest ?? "")) || !SHA256.test(String(receipt.registryEntryDigest ?? "")) || !SHA256.test(String(receipt.childCommandDigest ?? "")) || !/^[a-f0-9-]{36}$/.test(String(receipt.invocationNonce ?? "")) || !SHA256.test(String(receipt.integrity ?? ""))) throw new Error("QA_CANARY_CONSUMED_RUN_RECEIPT_INVALID");
  assertTimestamp(receipt.createdAt, "QA_CANARY_CONSUMED_RUN_RECEIPT_INVALID");
  const copy = { ...receipt }; delete copy.integrity;
  if (sha256(canonical(copy)) !== receipt.integrity) throw new Error("QA_CANARY_CONSUMED_RUN_RECEIPT_INVALID");
  return receipt;
}

export async function reserveConsumedRun({ root, runId, mode, confirmationTokenSha256, runnerCommit, wrapperVersion, wrapperSha256, childCommandDigest, now = new Date().toISOString(), nonce = randomUUID() }) {
  const id = validateConsumedRunId(runId);
  if (!MODES.has(mode) || !SHA256.test(String(confirmationTokenSha256 ?? "")) || !COMMIT.test(String(runnerCommit ?? "")) || wrapperVersion !== "r6-consumed-run-wrapper-v1" || !SHA256.test(String(wrapperSha256 ?? "")) || !SHA256.test(String(childCommandDigest ?? "")) || !/^[a-f0-9-]{36}$/.test(nonce)) throw new Error("QA_CANARY_CONSUMED_RUN_RESERVATION_INVALID");
  assertTimestamp(now, "QA_CANARY_CONSUMED_RUN_RESERVATION_INVALID");
  return withLock(root, async (paths) => {
    const state = await loadState(paths.root);
    if (state.registry.entries.some((entry) => entry.runId === id)) throw new Error("QA_CANARY_RUN_ID_ALREADY_CONSUMED");
    if (state.ledger.entries.some((entry) => entry.confirmationTokenSha256 === confirmationTokenSha256)) throw new Error("QA_CANARY_CONFIRMATION_TOKEN_REUSED");
    const ledger = structuredClone(state.ledger); const registry = structuredClone(state.registry);
    const tokenLedgerEntry = makeLedgerEntry({ runId: id, mode, confirmationTokenSha256, recordedAt: now });
    const registryEntry = makeRegistryEntry({ runId: id, mode, confirmationTokenSha256, tokenLedgerEntryDigest: tokenLedgerEntry.entryDigest, consumedAt: now, provenance: { kind: "new-reservation", backfillReason: "one-shot wrapper reservation" } });
    ledger.entries.push(tokenLedgerEntry); registry.entries.push(registryEntry);
    const sealedRegistry = await writeState(paths, registry, ledger);
    const target = receiptFile(paths, id, nonce); await mkdir(target.directory, { recursive: true });
    const base = { schemaVersion: CONSUMED_RUN_REGISTRY_VERSION, state: "PENDING", runId: id, mode, runnerCommit, wrapperVersion, wrapperSha256, tokenLedgerEntryDigest: tokenLedgerEntry.entryDigest, registryEntryDigest: registryEntry.entryDigest, invocationNonce: nonce, createdAt: now, childCommandDigest };
    const receipt = { ...base, integrity: sha256(canonical(base)) };
    await durableWrite(target.file, `${JSON.stringify(receipt, null, 2)}\n`);
    return { receiptPath: target.file, receiptSha256: sha256(await readFile(target.file)), invocationNonce: nonce, registrySha256: sha256(await readFile(paths.registry)), registryEntryDigest: registryEntry.entryDigest };
  });
}

export async function consumeReservationReceipt({ root, receiptPath, receiptSha256, invocationNonce, runId, mode, runnerCommit, wrapperVersion, wrapperSha256, childCommandDigest }) {
  const id = validateConsumedRunId(runId); const paths = registryPaths(root);
  if (!SHA256.test(String(receiptSha256 ?? "")) || !MODES.has(mode) || !COMMIT.test(String(runnerCommit ?? "")) || wrapperVersion !== "r6-consumed-run-wrapper-v1" || !SHA256.test(String(wrapperSha256 ?? "")) || !SHA256.test(String(childCommandDigest ?? ""))) throw new Error("QA_CANARY_CONSUMED_RUN_RECEIPT_INVALID");
  return withLock(paths.root, async () => {
    const state = await loadState(paths.root);
    const entry = state.registry.entries.find((candidate) => candidate.runId === id);
    if (!entry) throw new Error("QA_CANARY_CONSUMED_RUN_RECEIPT_REQUIRED");
    if (entry.provenance.kind !== "new-reservation") throw new Error("QA_CANARY_RUN_ID_ALREADY_CONSUMED");
    const candidate = path.resolve(String(receiptPath ?? "")); assertPathInside(paths.receipts, candidate, "QA_CANARY_CONSUMED_RUN_RECEIPT_PATH_INVALID");
    const expected = receiptFile(paths, id, String(invocationNonce ?? ""));
    if (candidate !== expected.file) throw new Error("QA_CANARY_CONSUMED_RUN_RECEIPT_PATH_INVALID");
    await assertNoReparse(candidate, "QA_CANARY_CONSUMED_RUN_RECEIPT_PATH_INVALID");
    const raw = await readFile(candidate).catch(() => { throw new Error("QA_CANARY_CONSUMED_RUN_RECEIPT_REQUIRED"); });
    if (sha256(raw) !== receiptSha256) throw new Error("QA_CANARY_CONSUMED_RUN_RECEIPT_INVALID");
    let receipt; try { receipt = JSON.parse(raw.toString("utf8")); } catch { throw new Error("QA_CANARY_CONSUMED_RUN_RECEIPT_INVALID"); }
    validateReceiptShape(receipt);
    if (receipt.state !== "PENDING") throw new Error("QA_CANARY_CONSUMED_RUN_RECEIPT_REPLAY");
    if (receipt.runId !== id || receipt.mode !== mode || receipt.runnerCommit !== runnerCommit || receipt.wrapperVersion !== wrapperVersion || receipt.wrapperSha256 !== wrapperSha256 || receipt.childCommandDigest !== childCommandDigest || receipt.invocationNonce !== invocationNonce || receipt.tokenLedgerEntryDigest !== entry.tokenLedgerEntryDigest || receipt.registryEntryDigest !== entry.entryDigest) throw new Error("QA_CANARY_CONSUMED_RUN_RECEIPT_BINDING_MISMATCH");
    const consumed = { ...receipt, state: "CONSUMED", consumedAt: new Date().toISOString() }; delete consumed.integrity; consumed.integrity = sha256(canonical(consumed));
    await durableWrite(candidate, `${JSON.stringify(consumed, null, 2)}\n`);
    return { runId: id, registryEntryDigest: entry.entryDigest };
  });
}
