import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthAProductionCapability, getAuthAProductionAttempt, observeAuthARepository } from
  "../lib/verified-session-auth-a-production-gate.mjs";
import { AUTH_A_CATALOG_SHA256, AUTH_A_HISTORY_SHA256, prepareAuthADbPacket,
  runAuthADbCaptureInternal } from "./verified-session-auth-a-db-capture.mjs";
import { EXPECTED_OLD_WORKER } from "../lib/verified-session-old-worker-baseline.mjs";
import { readCloudflareWorker } from "./verified-session-auth-a-cloudflare-read.mjs";
import { readSupabaseInventory } from "./verified-session-auth-a-supabase-read.mjs";
import { readBrevoReadiness } from "./verified-session-auth-a-brevo-read.mjs";
import { runAuthAOrchestrator } from "./verified-session-auth-a-execute.mjs";
import { parseP9Connection } from "./p9-readonly-postgres-transport.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CATALOG = "docs/ops/verified-session-v1-hosted-catalog-preflight.sql";
const HISTORY = "docs/ops/p9-migration-history-rows-read-only.sql";
const CREDENTIAL_FIELDS = ["cloudflareToken", "cloudflareAccountId", "supabaseToken",
  "brevoToken", "brevoSender", "databaseUrl"];
const FOUNDATION_SHA256 = "575cfcea2ed0e4415e07370d97474518c957ba409248790b2f6309748c1597f9";
const ENFORCEMENT_SHA256 = "89d74d4e96f1b6dcc1298ae443e21389ebc86c6ee0a6c46f7fef9dc15755d10e";
const TARGET_REF = "xcbnxzjlsvtgzixurcof";
const BLOCKERS = new Set(["AUTHORIZATION_GATE_BLOCKED", "PREFLIGHT_BLOCKED", "CLOUDFLARE_BLOCKED",
  "SUPABASE_BLOCKED", "BREVO_BLOCKED", "DATABASE_BLOCKED", "WORKER_VERSION_DRIFT",
  "DATABASE_INVENTORY_BLOCKED", "AUTH_A_PRODUCTION_GATE_AUTHORIZATION_ALREADY_CONSUMED"]);
const deny = () => { throw new Error("AUTH_A_PRODUCTION_PREFLIGHT_BLOCKED"); };

function authorizationFromEnvironment(env) {
  return { AUTH_A_EXECUTE: env.AUTH_A_EXECUTE, AUTHORIZATION_ID: env.AUTHORIZATION_ID,
    AUTHORIZED_AT_UTC: env.AUTHORIZED_AT_UTC, SOURCE_HEAD: env.SOURCE_HEAD,
    PACKET_SHA256: env.PACKET_SHA256 };
}

function credentialsFromEnvironment(env) {
  const credentials = {
    cloudflareToken: env.CLOUDFLARE_API_TOKEN,
    cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID,
    supabaseToken: env.SUPABASE_ACCESS_TOKEN,
    brevoToken: env.BREVO_API_KEY,
    brevoSender: env.BREVO_VERIFIED_SENDER_EMAIL,
    databaseUrl: env.P9_PRODUCTION_DATABASE_URL,
  };
  if (CREDENTIAL_FIELDS.some((name) => typeof credentials[name] !== "string"
    || credentials[name].trim() === "")) deny();
  return credentials;
}

export function createAuthAProductionSteps({ capability, credentials, fetchImpl, spawnImpl, nonce }) {
  if (!credentials || CREDENTIAL_FIELDS.some((name) => typeof credentials[name] !== "string"
    || credentials[name].trim() === "")) deny();
  parseP9Connection({ mode: "PRODUCTION", dsn: credentials.databaseUrl });
  const catalog = readFileSync(path.join(ROOT, CATALOG), "utf8");
  const history = readFileSync(path.join(ROOT, HISTORY), "utf8");
  prepareAuthADbPacket({ catalog, history });
  const fakeFetch = fetchImpl ? { fetchImpl } : {};
  return Object.freeze({
    cloudflare: () => readCloudflareWorker({ mode: "PRODUCTION", capability,
      accountId: credentials.cloudflareAccountId, token: credentials.cloudflareToken, ...fakeFetch }),
    supabase: () => readSupabaseInventory({ mode: "PRODUCTION", capability,
      token: credentials.supabaseToken, ...fakeFetch }),
    brevo: () => readBrevoReadiness({ mode: "PRODUCTION", capability,
      token: credentials.brevoToken, expectedSenderEmail: credentials.brevoSender,
      minimumCredits: 0, ...fakeFetch }),
    database: () => runAuthADbCaptureInternal({ mode: "PRODUCTION", capability,
      dsn: credentials.databaseUrl, catalog, history,
      ...(spawnImpl ? { spawnImpl } : {}), ...(nonce ? { nonce } : {}) }),
  });
}

const flag = (value) => value === true ? "true" : value === false ? "false" : "UNKNOWN";
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? String(value) : "UNKNOWN";
const oneOf = (value, choices) => choices.includes(value) ? value : "UNKNOWN";
const acl = (value) => value && typeof value === "object"
  && [value.anon, value.authenticated, value.service].every((part) => typeof part === "boolean")
  ? `anon=${value.anon},authenticated=${value.authenticated},service=${value.service}` : "UNKNOWN";

export function formatAuthAProductionReceipt({ authorization, capability, result } = {}) {
  const attempt = capability ? getAuthAProductionAttempt(capability) : null;
  const counts = attempt?.counts ?? { cloudflare: 0, supabase: 0, brevo: 0, database: 0 };
  const db = counts.database === 1 ? result : null;
  const completeDispatch = counts.cloudflare === 2 && counts.supabase === 2
    && counts.brevo === 2 && counts.database === 1;
  const status = result?.authAStatus === "PASS" && completeDispatch ? "PASS" : "BLOCKED";
  const blocker = status === "PASS" ? "NONE"
    : BLOCKERS.has(result?.blockerClass) ? result.blockerClass : "UNKNOWN";
  const lines = [
    `AUTH_A_STATUS=${status}`,
    "AUTH_RELEASE_STATUS=NO_GO",
    `AUTHORIZATION_ID=${attempt?.authorizationId
      ?? (/^auth-a-verified-session-[0-9]+$/.test(authorization?.AUTHORIZATION_ID ?? "")
        ? authorization.AUTHORIZATION_ID : "UNKNOWN")}`,
    `AUTHORIZATION_VALID=${attempt?.authorized === true}`,
    `AUTHORIZATION_CONSUMED=${attempt?.consumed === true}`,
    "REUSABLE=false",
    `SOURCE_HEAD=${attempt?.sourceHead ?? "UNKNOWN"}`,
    `PACKET_SHA256=${attempt?.packetSha256 ?? "UNKNOWN"}`,
    `CATALOG_PACKET_SHA256=${AUTH_A_CATALOG_SHA256}`,
    `MIGRATION_HISTORY_PACKET_SHA256=${AUTH_A_HISTORY_SHA256}`,
    `FOUNDATION_SHA256=${FOUNDATION_SHA256}`,
    `ENFORCEMENT_SHA256=${ENFORCEMENT_SHA256}`,
    `TARGET_WORKER=${counts.cloudflare === 2 && result?.targetWorker === EXPECTED_OLD_WORKER.workerName
      ? EXPECTED_OLD_WORKER.workerName : "UNKNOWN"}`,
    `TARGET_SUPABASE=${counts.supabase === 2 && result?.targetSupabase === TARGET_REF ? TARGET_REF : "UNKNOWN"}`,
    `TARGET_MATCH=${counts.supabase === 2 ? flag(result?.targetMatch) : "UNKNOWN"}`,
    `DEPLOYED_WORKER_IDENTITY=${counts.cloudflare === 2
      && /^[a-f0-9-]{36}$/.test(result?.deployedWorkerIdentity ?? "")
      ? result.deployedWorkerIdentity : "UNKNOWN"}`,
    `DEPLOYED_WORKER_IDENTITY_MATCH=${result?.deployedWorkerIdentityMatch === true}`,
    `DEPLOYED_WORKER_IDENTITY_DRIFT=${flag(result?.deployedWorkerIdentityDrift)}`,
    `DEPLOYED_WORKER_SOURCE_EQUIVALENCE=${oneOf(result?.deployedWorkerSourceEquivalence,
      ["PROVEN_BY_HISTORICAL_VERSION_BINDING", "UNKNOWN"])}`,
    `EXPECTED_SOURCE_COMMIT=${EXPECTED_OLD_WORKER.sourceCommit}`,
    `DB_STAGE=${oneOf(db?.dbStage, ["PRE_V1", "FOUNDATION", "ENFORCEMENT", "UNKNOWN"])}`,
    "EXPECTED_DB_STAGE=PRE_V1",
    `MIGRATION_PROVENANCE=${oneOf(db?.migrationProvenance, ["CLEAN_UNSHIPPED_V1", "DIVERGENT", "UNKNOWN"])}`,
    `OLD_MONOLITH_APPLIED=${flag(db?.oldMonolithApplied)}`,
    `OLD_RESEND_LOCK_APPLIED=${flag(db?.oldResendLockApplied)}`,
    `NEW_FOUNDATION_APPLIED=${flag(db?.newFoundationApplied)}`,
    `NEW_ENFORCEMENT_APPLIED=${flag(db?.newEnforcementApplied)}`,
    `V1_PRIVATE_TABLE_COUNT=${count(db?.v1PrivateTableCount)}`,
    `V1_FUNCTION_COUNT=${count(db?.v1FunctionCount)}`,
    `V1_RESTRICTIVE_POLICY_COUNT=${count(db?.v1RestrictivePolicyCount)}`,
    `RESEND_EFFECTIVE_ACL=${acl(db?.resendEffectiveAcl)}`,
    `CATALOG_PREFLIGHT_STATUS=${oneOf(db?.catalogPreflightStatus, ["PASS", "FAIL", "UNKNOWN"])}`,
    `CATALOG_DRIFT=${oneOf(db?.catalogDrift, ["none", "UNKNOWN"])}`,
    "FREE_CAPACITY_STATUS=UNKNOWN",
    "CAPACITY_GATE=BLOCKED_BEFORE_AUTH_B",
    `CLOUDFLARE_READ_REQUESTS=${counts.cloudflare}`,
    `SUPABASE_CONTROL_PLANE_READ_REQUESTS=${counts.supabase}`,
    `BREVO_READ_REQUESTS=${counts.brevo}`,
    `PRODUCTION_CONNECTION_ATTEMPTS=${counts.database}`,
    "PRODUCTION_WRITES=0", "AUTH_STATE_CHANGES=0", "EMAIL_SENDS=0", "STORAGE_WRITES=0",
    "REALTIME_SENTINELS=0", "DEPLOYS=0", "CONFIG_CHANGES=0", "ZERO_PAID_INFRA=true",
    `BLOCKER_CLASS=${blocker}`,
    `NEXT_ACTION=${status === "PASS" ? "REQUEST_SEPARATE_CAPACITY_REVIEW" : "STOP_FOR_REVIEW"}`,
  ];
  return lines.join("\n") + "\n";
}

async function main() {
  let capability;
  let result;
  let phase = "AUTHORIZATION_GATE_BLOCKED";
  const authorization = authorizationFromEnvironment(process.env);
  try {
    if (process.argv.length !== 2) deny();
    const snapshot = observeAuthARepository();
    capability = createAuthAProductionCapability({ authorization });
    phase = "PREFLIGHT_BLOCKED";
    const credentials = credentialsFromEnvironment(process.env);
    const steps = createAuthAProductionSteps({ capability, credentials });
    phase = "AUTHORIZATION_GATE_BLOCKED";
    result = await runAuthAOrchestrator({ mode: "PRODUCTION", authorization,
      sourceHead: snapshot.observedHead, observedHead: snapshot.observedHead,
      packetSha256: snapshot.observedPacketSha256, observedPacketSha256: snapshot.observedPacketSha256,
      worktreeClean: snapshot.worktreeClean, branch: snapshot.branch, capability, steps });
  } catch (error) {
    result = { authAStatus: "BLOCKED",
      blockerClass: error?.message === "AUTH_A_PRODUCTION_GATE_AUTHORIZATION_ALREADY_CONSUMED"
        ? "AUTH_A_PRODUCTION_GATE_AUTHORIZATION_ALREADY_CONSUMED" : phase,
      nextAction: "STOP_FOR_REVIEW" };
  }
  const receipt = formatAuthAProductionReceipt({ authorization, capability, result });
  process.stdout.write(receipt);
  if (!receipt.startsWith("AUTH_A_STATUS=PASS\n")) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
