const HEAD = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const BRANCH = "feature/auth-verified-session-v1";
const ARTIFACT_HASHES = Object.freeze({
  foundation: "575cfcea2ed0e4415e07370d97474518c957ba409248790b2f6309748c1597f9",
  enforcement: "89d74d4e96f1b6dcc1298ae443e21389ebc86c6ee0a6c46f7fef9dc15755d10e",
  catalog: "b033239a1b7bc689e9ad5be1409a19363eaba2c7a8c6eddb791bcabc9cf6bfc7",
  history: "6018ce149a1520c7c097e2577281ace773a2329cc8f36ca74350fd03be347002",
});
const ARTIFACT_PATHS = Object.freeze({
  foundation: "supabase/migrations/20260923000000_ogh_verified_session_v1_foundation.sql",
  enforcement: "supabase/migrations/20260925012231_ogh_verified_session_v1_enforcement.sql",
  catalog: "docs/ops/verified-session-v1-hosted-catalog-preflight.sql",
  history: "docs/ops/p9-migration-history-rows-read-only.sql",
});
const MAX_AUTHORIZATION_AGE_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 30 * 1000;
const DISPATCH_ORDER = ["cloudflare", "cloudflare", "supabase", "supabase", "brevo", "brevo", "database"];
const capabilities = new WeakMap();
const claimedIds = new Set();
const fail = (reason) => { throw new Error(`AUTH_A_PRODUCTION_GATE_${reason}`); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function git(args) {
  const result = spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8", windowsHide: true,
    shell: false, maxBuffer: 1024 * 1024 });
  if (result.status !== 0 || result.error) fail("REPOSITORY_UNKNOWN");
  return result.stdout.trim();
}

export function observeAuthARepository() {
  const hashes = Object.fromEntries(Object.entries(ARTIFACT_PATHS).map(([name, file]) =>
    [name, createHash("sha256").update(readFileSync(path.join(ROOT, file))).digest("hex")]));
  validateAuthAArtifactHashes(hashes);
  return Object.freeze({ observedHead: git(["rev-parse", "HEAD"]),
    branch: git(["branch", "--show-current"]),
    worktreeClean: git(["status", "--porcelain"]) === "",
    observedPacketSha256: createHash("sha256").update(readFileSync(path.join(ROOT,
      "docs/ops/verified-session-v1-auth-a-authorization.md"))).digest("hex") });
}

export function validateAuthAArtifactHashes(hashes) {
  if (!hashes || Object.entries(ARTIFACT_HASHES).some(([name, expected]) => hashes[name] !== expected))
    fail("ARTIFACT_DRIFT");
}

function validateBinding({ authorization, observedHead, observedPacketSha256, branch, worktreeClean }) {
  const at = authorization?.AUTHORIZED_AT_UTC;
  const time = typeof at === "string" && UTC.test(at) ? Date.parse(at) : NaN;
  const canonicalTime = Number.isFinite(time) &&
    (new Date(time).toISOString() === at || new Date(time).toISOString().replace(".000Z", "Z") === at);
  const age = Date.now() - time;
  if (authorization?.AUTH_A_EXECUTE !== "1"
    || !/^auth-a-verified-session-[0-9]+$/.test(authorization?.AUTHORIZATION_ID ?? "")
    || !/^[a-f0-9]{32}$/i.test(authorization?.TARGET_CLOUDFLARE_ACCOUNT_ID ?? "")
    || ["auth-a-verified-session-001", "auth-a-verified-session-002"].includes(authorization.AUTHORIZATION_ID)
    || !canonicalTime || age > MAX_AUTHORIZATION_AGE_MS || age < -MAX_FUTURE_SKEW_MS
    || !HEAD.test(observedHead ?? "") || authorization.SOURCE_HEAD !== observedHead
    || !SHA256.test(observedPacketSha256 ?? "") || authorization.PACKET_SHA256 !== observedPacketSha256
    || branch !== BRANCH || worktreeClean !== true) fail("AUTHORIZATION_INVALID");
  return { id: authorization.AUTHORIZATION_ID, at, head: observedHead, packet: observedPacketSha256,
    cloudflareAccountId: authorization.TARGET_CLOUDFLARE_ACCOUNT_ID.toLowerCase() };
}

function createCapability(binding, testOnly) {
  const verified = validateBinding(binding);
  if (testOnly && (typeof binding.sentinelDir !== "string" || !path.isAbsolute(binding.sentinelDir)))
    fail("TEST_SENTINEL_DIR_INVALID");
  const sentinelPath = testOnly
    ? path.join(binding.sentinelDir, verified.id)
    : path.resolve(ROOT, git(["rev-parse", "--git-path", `ogh-auth-a-consumed/${verified.id}`]));
  const capability = Object.freeze(Object.create(null));
  capabilities.set(capability, { ...verified, testOnly, claimed: false, consumed: false, index: 0,
    sentinelPath, counts: { cloudflare: 0, supabase: 0, brevo: 0, database: 0 } });
  return capability;
}

export function createAuthAProductionCapability({ authorization } = {}) {
  return createCapability({ authorization, ...observeAuthARepository() }, false);
}

export function createAuthAProductionTestCapability(binding) {
  return createCapability(binding, true);
}

function stateFor(capability, { claimed = true } = {}) {
  const state = capabilities.get(capability);
  if (!state || (claimed && !state.claimed)) fail("CAPABILITY_INVALID");
  return state;
}

export function assertAuthAProductionCapability(capability) {
  const state = stateFor(capability);
  return Object.freeze({ testOnly: state.testOnly, cloudflareAccountId: state.cloudflareAccountId });
}

export function claimAuthAProductionAttempt(capability, binding) {
  const state = stateFor(capability, { claimed: false });
  if (existsSync(state.sentinelPath)) fail("AUTHORIZATION_ALREADY_CONSUMED");
  if (state.claimed || claimedIds.has(state.id)) fail("ATTEMPT_ALREADY_CLAIMED");
  const verified = validateBinding(binding);
  if (verified.id !== state.id || verified.at !== state.at || verified.head !== state.head
    || verified.cloudflareAccountId !== state.cloudflareAccountId
    || verified.packet !== state.packet) fail("BINDING_DRIFT");
  claimedIds.add(state.id);
  state.claimed = true;
}

export function markAuthAExternalDispatch(capability, provider) {
  const state = stateFor(capability);
  if (DISPATCH_ORDER[state.index] !== provider) fail("DISPATCH_ORDER_OR_BUDGET");
  if (!state.consumed) {
    try {
      mkdirSync(path.dirname(state.sentinelPath), { recursive: true });
      const fd = openSync(state.sentinelPath, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ AUTHORIZATION_ID: state.id,
          AUTHORIZED_AT_UTC: state.at, SOURCE_HEAD: state.head,
          PACKET_SHA256: state.packet, CONSUMED_AT_UTC: new Date().toISOString() }));
      } finally { closeSync(fd); }
    } catch (error) {
      if (error?.code === "EEXIST") fail("AUTHORIZATION_ALREADY_CONSUMED");
      fail("SENTINEL_PERSIST_FAILED");
    }
  }
  state.consumed = true;
  state.index += 1;
  state.counts[provider] += 1;
}

export function getAuthAProductionAttempt(capability) {
  const state = stateFor(capability, { claimed: false });
  return Object.freeze({ authorized: true, authorizationId: state.id,
    sourceHead: state.head, packetSha256: state.packet,
    consumed: state.consumed || existsSync(state.sentinelPath),
    counts: Object.freeze({ ...state.counts }) });
}
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
