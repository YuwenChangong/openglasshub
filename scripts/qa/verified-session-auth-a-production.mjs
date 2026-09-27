import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthAProductionCapability, getAuthAProductionAttempt, observeAuthARepository } from
  "../lib/verified-session-auth-a-production-gate.mjs";
import { prepareAuthADbPacket, runAuthADbCaptureInternal } from "./verified-session-auth-a-db-capture.mjs";
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

function emitReceipt({ authorization, capability, result }) {
  const attempt = capability ? getAuthAProductionAttempt(capability) : null;
  const counts = attempt?.counts ?? { cloudflare: 0, supabase: 0, brevo: 0, database: 0 };
  const lines = [
    `AUTH_A_STATUS=${result?.authAStatus ?? "BLOCKED"}`,
    "AUTH_RELEASE_STATUS=NO_GO",
    `AUTHORIZATION_ID=${/^auth-a-verified-session-[0-9]+$/.test(authorization?.AUTHORIZATION_ID ?? "")
      ? authorization.AUTHORIZATION_ID : "UNKNOWN"}`,
    `AUTHORIZATION_VALID=${attempt?.authorized === true}`,
    `AUTHORIZATION_CONSUMED=${attempt?.consumed === true}`,
    `DEPLOYED_WORKER_IDENTITY_MATCH=${result?.deployedWorkerIdentityMatch === true}`,
    `DEPLOYED_WORKER_IDENTITY_DRIFT=${result?.deployedWorkerIdentityDrift ?? "UNKNOWN"}`,
    `FREE_CAPACITY_STATUS=${result?.freeCapacityStatus ?? "UNKNOWN"}`,
    "CAPACITY_GATE=BLOCKED_BEFORE_AUTH_B",
    `CLOUDFLARE_READ_REQUESTS=${counts.cloudflare}`,
    `SUPABASE_READ_REQUESTS=${counts.supabase}`,
    `BREVO_READ_REQUESTS=${counts.brevo}`,
    `PRODUCTION_CONNECTION_ATTEMPTS=${counts.database}`,
    "PRODUCTION_WRITES=0", "EMAIL_SENDS=0", "DEPLOYS=0",
    `NEXT_ACTION=${result?.nextAction ?? "STOP_FOR_REVIEW"}`,
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

async function main() {
  let capability;
  let result;
  const authorization = authorizationFromEnvironment(process.env);
  try {
    if (process.argv.length !== 2) deny();
    const snapshot = observeAuthARepository();
    capability = createAuthAProductionCapability({ authorization });
    const credentials = credentialsFromEnvironment(process.env);
    const steps = createAuthAProductionSteps({ capability, credentials });
    result = await runAuthAOrchestrator({ mode: "PRODUCTION", authorization,
      sourceHead: snapshot.observedHead, observedHead: snapshot.observedHead,
      packetSha256: snapshot.observedPacketSha256, observedPacketSha256: snapshot.observedPacketSha256,
      worktreeClean: snapshot.worktreeClean, branch: snapshot.branch, capability, steps });
  } catch {
    result = { authAStatus: "BLOCKED", nextAction: "STOP_FOR_REVIEW" };
  }
  emitReceipt({ authorization, capability, result });
  if (result.authAStatus !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
