import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadP9CredentialIntoEnvironment } from "../lib/p9-session-pooler-credential-handoff.mjs";
import { createP9PostfixGate, observeP9PostfixRepository } from "../lib/p9-session-pooler-postfix-gate.mjs";
import { createPsqlEnvironment, parseP9Connection,
  P9_EXPECTED_SESSION_POOLER_HOST, P9_EXPECTED_SESSION_POOLER_USER } from "./p9-readonly-postgres-transport.mjs";

const SQL = "SELECT 1";
const TIMEOUT_MS = 15000;
const MAX_OUTPUT_BYTES = 8192;
const TERMINATION_GRACE_MS = 2000;
const DNS_TIMEOUT_MS = 5000;
const PG_KEYS = ["PGDATABASE", "PGGSSENCMODE", "PGHOST", "PGHOSTADDR", "PGPASSWORD", "PGPORT", "PGSSLMODE", "PGSSLROOTCERT", "PGUSER"];
const PRE_DNS_PG_KEYS = PG_KEYS.filter((key) => key !== "PGHOSTADDR");
const BASE_KEYS = ["TEMP", "TMP", "HOME", "USERPROFILE", "LANG", "LC_ALL", "LC_CTYPE"];
const AUTH_KEYS = ["APPROVE_P9_SESSION_POOLER_POST_FIX_READ_ONLY_PROBE", "PROBE_EXECUTE", "PROBE_ID",
  "AUTHORIZED_BY", "AUTHORIZED_AT_UTC", "TARGET_PROJECT", "TARGET_HOST", "TARGET_PORT",
  "TARGET_DATABASE", "TARGET_USER", "SOURCE_HEAD", "PROBE_IMPLEMENTATION_SHA256",
  "PROBE_REVIEW_SHA256", "MAX_PRODUCTION_CONNECTION_ATTEMPTS", "MAX_DATABASE_SESSIONS",
  "MAX_SQL_STATEMENTS", "SQL_PAYLOAD", "MAX_WRITES", "MAX_RETRIES", "AUTOMATIC_RETRY",
  "MANUAL_RETRY_WITH_SAME_PROBE_ID", "REUSABLE", "CONSUMED_IMMEDIATELY_BEFORE_FIRST_EXTERNAL_DISPATCH"];
const fail = (reason) => { throw new Error(`P9_POSTFIX_PROBE_${reason}`); };

function childEnvironment(source, pgEnv, psqlPath) {
  const base = Object.fromEntries(BASE_KEYS.filter((key) => source[key] !== undefined)
    .map((key) => [key, source[key]]));
  const systemRoot = source.SystemRoot ?? "C:\\Windows";
  if (!path.isAbsolute(systemRoot) || !path.isAbsolute(psqlPath)) fail("EXECUTABLE_PATH_INVALID");
  base.SystemRoot = systemRoot;
  base.Path = `${path.dirname(psqlPath)};${path.join(systemRoot, "System32")}`;
  const child = createPsqlEnvironment(base, pgEnv);
  const actual = Object.keys(child).filter((key) => /^PG/i.test(key)).sort();
  if (actual.join(",") !== PRE_DNS_PG_KEYS.join(",")
    || PRE_DNS_PG_KEYS.some((key) => child[key] !== pgEnv[key]))
    fail("CHILD_ENV_INVALID");
  return child;
}

function receipt(status, resultClass, attempts, sqlExecuted) {
  return Object.freeze({ P9_SESSION_POOLER_PROBE_STATUS: status, RESULT_CLASS: resultClass,
    SQL_EXECUTED: status === "PASS" ? true : attempts === 0 ? false : "UNKNOWN",
    PRODUCTION_CONNECTION_ATTEMPTS: attempts,
    PRODUCTION_WRITES: 0, RETRIES: 0 });
}

function isPublicIpv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return a > 0 && a < 224 && a !== 10 && a !== 127
    && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && b === 168) && !(a === 192 && b === 0 && c === 0)
    && !(a === 198 && (b === 18 || b === 19));
}

async function resolveSingleAddress(host, resolver) {
  let timer;
  try {
    const addresses = await Promise.race([
      resolver.resolve4(host),
      new Promise((_, reject) => {
        timer = setTimeout(() => { resolver.cancel?.(); reject(new Error("DNS_TIMEOUT")); }, DNS_TIMEOUT_MS);
      }),
    ]);
    const address = addresses?.[0];
    if (!isPublicIpv4(address)) fail("DNS_ADDRESS_INVALID");
    return address;
  } finally { clearTimeout(timer); }
}

async function runP9PostfixProbeCore({ authorization, snapshot, now, dsn,
  sourceEnvironment, spawnImpl, resolver, psqlPath, timeoutMs, terminationGraceMs, testSentinelDir }) {
  let gate, childEnv;
  try {
    gate = createP9PostfixGate({ authorization, snapshot, now, testSentinelDir });
    const connection = parseP9Connection({ mode: "PRODUCTION", dsn });
    const { safeTarget } = connection;
    const pgEnv = { ...connection.pgEnv, PGSSLMODE: "verify-full",
      PGSSLROOTCERT: "system", PGGSSENCMODE: "disable" };
    if (safeTarget.endpointClass !== "SUPAVISOR_SESSION"
      || safeTarget.host !== P9_EXPECTED_SESSION_POOLER_HOST || safeTarget.port !== 5432
      || safeTarget.database !== "postgres" || pgEnv.PGUSER !== P9_EXPECTED_SESSION_POOLER_USER)
      fail("TARGET_INVALID");
    childEnv = childEnvironment(sourceEnvironment, pgEnv, psqlPath);
    if (childEnv.PGHOST !== authorization.TARGET_HOST || childEnv.PGPORT !== authorization.TARGET_PORT
      || childEnv.PGDATABASE !== authorization.TARGET_DATABASE || childEnv.PGUSER !== authorization.TARGET_USER)
      fail("EFFECTIVE_TARGET_INVALID");
  } catch {
    return receipt("BLOCKED", "PREFLIGHT_BLOCKED", 0, false);
  }
  try { gate.consume(); } catch { return receipt("BLOCKED", "AUTHORIZATION_CONSUMED_OR_UNAVAILABLE", 0, false); }
  let address;
  try { address = await resolveSingleAddress(childEnv.PGHOST, resolver); }
  catch { return receipt("BLOCKED", "DNS_RESOLUTION_BLOCKED", 0, false); }
  childEnv.PGHOSTADDR = address;
  const effectivePgKeys = Object.keys(childEnv).filter((key) => /^PG/i.test(key)).sort();
  if (effectivePgKeys.join(",") !== PG_KEYS.join(",") || !isPublicIpv4(childEnv.PGHOSTADDR)
    || childEnv.PGSSLMODE !== "verify-full" || childEnv.PGSSLROOTCERT !== "system"
    || childEnv.PGGSSENCMODE !== "disable")
    return receipt("BLOCKED", "EFFECTIVE_TARGET_INVALID", 0, false);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(psqlPath, ["-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", SQL],
        { shell: false, windowsHide: true, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    } catch { resolve(receipt("BLOCKED", "PROCESS_START_FAILED", 1, false)); return; }
    let settled = false; let bytes = 0; let stdout = ""; let stopReason = null; let graceTimer;
    const finish = (resultClass, success = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      resolve(receipt(success ? "PASS" : "BLOCKED", resultClass, 1, success));
    };
    const stop = (reason) => {
      if (settled || stopReason) return;
      stopReason = reason;
      try { child.kill(); } catch {}
      graceTimer = setTimeout(() => finish("TERMINATION_UNCONFIRMED"), terminationGraceMs);
    };
    const timer = setTimeout(() => stop("TIMEOUT"), timeoutMs);
    const collect = (data, isStdout) => {
      if (settled || stopReason) return;
      bytes += Buffer.byteLength(data);
      if (bytes > MAX_OUTPUT_BYTES) { stop("OUTPUT_LIMIT"); return; }
      if (isStdout) stdout += data.toString();
    };
    child.stdout?.on("data", (data) => collect(data, true));
    child.stderr?.on("data", (data) => collect(data, false));
    child.on("error", () => stop("PROCESS_ERROR"));
    child.on("close", (code) => {
      if (stopReason) { finish(stopReason); return; }
      if (code !== 0) { finish("PSQL_NONZERO_EXIT"); return; }
      if (stdout === "1\n" || stdout === "1\r\n") finish("SESSION_POOLER_CREDENTIAL_VALID", true);
      else finish("UNEXPECTED_SELECT_OUTPUT");
    });
  });
}

export async function simulateP9PostfixProbeTest({ authorization, snapshot, now,
  targetVariant = "session", dnsOutcome = "success", sourceEnvironment = {}, fakeOutcome = {}, testSentinelDir,
  timeoutMs = TIMEOUT_MS, terminationGraceMs = TERMINATION_GRACE_MS } = {}) {
  const tempRoot = path.resolve(tmpdir()) + path.sep;
  if (!path.resolve(testSentinelDir ?? "").startsWith(tempRoot)
    || !path.resolve(snapshot?.commonDir ?? "").startsWith(tempRoot)
    || !["session", "transaction"].includes(targetVariant)
    || !["success", "error", "redirected"].includes(dnsOutcome)
    || Object.keys(fakeOutcome).some((key) => !["stdout", "stderr", "exitCode", "neverClose", "closeOnKill"].includes(key))
    || typeof (fakeOutcome.stdout ?? "1\n") !== "string"
    || typeof (fakeOutcome.stderr ?? "") !== "string"
    || !Number.isSafeInteger(fakeOutcome.exitCode ?? 0)
    || typeof (fakeOutcome.neverClose ?? false) !== "boolean"
    || typeof (fakeOutcome.closeOnKill ?? false) !== "boolean"
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TIMEOUT_MS
    || !Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 1
    || terminationGraceMs > TERMINATION_GRACE_MS) fail("TEST_BOUNDARY_INVALID");
  const dsn = `postgresql://postgres.xcbnxzjlsvtgzixurcof:synthetic-password@aws-1-ap-northeast-1.pooler.supabase.com:${targetVariant === "session" ? "5432" : "6543"}/postgres?sslmode=require`;
  const audit = { calls: [], dnsCalls: 0 };
  const resolver = { resolve4: async (host) => {
    audit.dnsCalls += 1;
    audit.dnsHost = host;
    audit.sentinelConsumedBeforeDns = existsSync(path.join(testSentinelDir, authorization.PROBE_ID));
    if (dnsOutcome === "error") throw new Error("SYNTHETIC_DNS_FAILURE");
    if (dnsOutcome === "redirected") return ["127.0.0.1"];
    return ["93.184.216.34", "93.184.216.35"];
  } };
  const spawnImpl = (file, args, options) => {
    audit.calls.push({ file, args, options, sentinelConsumedBeforeSpawn:
      existsSync(path.join(testSentinelDir, authorization.PROBE_ID)) });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      audit.killed = true;
      if (fakeOutcome.closeOnKill) queueMicrotask(() => child.emit("close", 1));
    };
    queueMicrotask(() => {
      if (fakeOutcome.stdout ?? "1\n") child.stdout.emit("data", Buffer.from(fakeOutcome.stdout ?? "1\n"));
      if (fakeOutcome.stderr) child.stderr.emit("data", Buffer.from(fakeOutcome.stderr));
      if (!fakeOutcome.neverClose) child.emit("close", fakeOutcome.exitCode ?? 0);
    });
    return child;
  };
  const result = await runP9PostfixProbeCore({ authorization, snapshot, now, dsn, sourceEnvironment,
    spawnImpl, resolver, psqlPath: path.join(testSentinelDir, "synthetic-psql.exe"), testSentinelDir,
    timeoutMs, terminationGraceMs });
  return { receipt: result, audit };
}

export async function runProductionP9PostfixProbe() {
  let snapshot, dsn;
  try {
    snapshot = observeP9PostfixRepository();
    const loaded = loadP9CredentialIntoEnvironment();
    dsn = loaded.dsn;
  } catch { return receipt("BLOCKED", "PREFLIGHT_BLOCKED", 0, false); }
  const authorization = Object.fromEntries(AUTH_KEYS.map((key) => [key, process.env[key]]));
  return runP9PostfixProbeCore({ authorization, snapshot, now: Date.now(), dsn,
    sourceEnvironment: process.env, spawnImpl: spawn, resolver: new Resolver(), psqlPath: snapshot.psqlPath,
    timeoutMs: TIMEOUT_MS, terminationGraceMs: TERMINATION_GRACE_MS });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await runProductionP9PostfixProbe();
  for (const [key, value] of Object.entries(result)) console.log(`${key}=${value}`);
  if (result.P9_SESSION_POOLER_PROBE_STATUS !== "PASS") process.exitCode = 1;
}
