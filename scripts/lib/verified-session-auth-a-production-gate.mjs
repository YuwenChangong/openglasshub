const HEAD = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const BRANCH = "feature/auth-verified-session-v1";
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
  return Object.freeze({ observedHead: git(["rev-parse", "HEAD"]),
    branch: git(["branch", "--show-current"]),
    worktreeClean: git(["status", "--porcelain"]) === "",
    observedPacketSha256: createHash("sha256").update(readFileSync(path.join(ROOT,
      "docs/ops/verified-session-v1-auth-a-authorization.md"))).digest("hex") });
}

function validateBinding({ authorization, observedHead, observedPacketSha256, branch, worktreeClean }) {
  const at = authorization?.AUTHORIZED_AT_UTC;
  const time = typeof at === "string" && UTC.test(at) ? Date.parse(at) : NaN;
  const canonicalTime = Number.isFinite(time) &&
    (new Date(time).toISOString() === at || new Date(time).toISOString().replace(".000Z", "Z") === at);
  const age = Date.now() - time;
  if (authorization?.AUTH_A_EXECUTE !== "1"
    || !/^auth-a-verified-session-[0-9]+$/.test(authorization?.AUTHORIZATION_ID ?? "")
    || ["auth-a-verified-session-001", "auth-a-verified-session-002"].includes(authorization.AUTHORIZATION_ID)
    || !canonicalTime || age > MAX_AUTHORIZATION_AGE_MS || age < -MAX_FUTURE_SKEW_MS
    || !HEAD.test(observedHead ?? "") || authorization.SOURCE_HEAD !== observedHead
    || !SHA256.test(observedPacketSha256 ?? "") || authorization.PACKET_SHA256 !== observedPacketSha256
    || branch !== BRANCH || worktreeClean !== true) fail("AUTHORIZATION_INVALID");
  return { id: authorization.AUTHORIZATION_ID, at, head: observedHead, packet: observedPacketSha256 };
}

function createCapability(binding, testOnly) {
  const verified = validateBinding(binding);
  const capability = Object.freeze(Object.create(null));
  capabilities.set(capability, { ...verified, testOnly, claimed: false, consumed: false, index: 0,
    counts: { cloudflare: 0, supabase: 0, brevo: 0, database: 0 } });
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
  return Object.freeze({ testOnly: state.testOnly });
}

export function claimAuthAProductionAttempt(capability, binding) {
  const state = stateFor(capability, { claimed: false });
  if (state.claimed || claimedIds.has(state.id)) fail("ATTEMPT_ALREADY_CLAIMED");
  const verified = validateBinding(binding);
  if (verified.id !== state.id || verified.at !== state.at || verified.head !== state.head
    || verified.packet !== state.packet) fail("BINDING_DRIFT");
  claimedIds.add(state.id);
  state.claimed = true;
}

export function markAuthAExternalDispatch(capability, provider) {
  const state = stateFor(capability);
  if (DISPATCH_ORDER[state.index] !== provider) fail("DISPATCH_ORDER_OR_BUDGET");
  state.consumed = true;
  state.index += 1;
  state.counts[provider] += 1;
}

export function getAuthAProductionAttempt(capability) {
  const state = stateFor(capability, { claimed: false });
  return Object.freeze({ authorized: true, consumed: state.consumed,
    counts: Object.freeze({ ...state.counts }) });
}
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
