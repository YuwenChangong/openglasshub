import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const testRoot = mkdtempSync(path.join(tmpdir(), "p9-postfix-probe-test-"));
after(() => {
  const root = path.resolve(tmpdir()) + path.sep;
  if (!path.resolve(testRoot).startsWith(root)) throw new Error("TEST_ROOT_OUTSIDE_TEMP");
  rmSync(testRoot, { recursive: true, force: true });
});

const dsn = "postgresql://postgres.xcbnxzjlsvtgzixurcof:synthetic-password@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require";
const target = { TARGET_PROJECT: "xcbnxzjlsvtgzixurcof",
  TARGET_HOST: "aws-1-ap-northeast-1.pooler.supabase.com", TARGET_PORT: "5432",
  TARGET_DATABASE: "postgres", TARGET_USER: "postgres.xcbnxzjlsvtgzixurcof" };
const now = Date.parse("2026-09-28T00:00:00.000Z");
const snapshot = { head: "a".repeat(40), branch: "feature/auth-verified-session-v1",
  worktreeClean: true, implementationSha256: "b".repeat(64), reviewSha256: "c".repeat(64),
  filesVerified: true, commonDir: testRoot };
const authorization = (id = "p9-session-pooler-postfix-1790559999") => ({
  APPROVE_P9_SESSION_POOLER_POST_FIX_READ_ONLY_PROBE: "1", PROBE_EXECUTE: "1", PROBE_ID: id,
  AUTHORIZED_BY: "Jayden", AUTHORIZED_AT_UTC: new Date(now).toISOString(), ...target,
  SOURCE_HEAD: snapshot.head, PROBE_IMPLEMENTATION_SHA256: snapshot.implementationSha256,
  PROBE_REVIEW_SHA256: snapshot.reviewSha256,
  MAX_PRODUCTION_CONNECTION_ATTEMPTS: "1", MAX_DATABASE_SESSIONS: "1",
  MAX_SQL_STATEMENTS: "1", SQL_PAYLOAD: "SELECT_1_ONLY", MAX_WRITES: "0", MAX_RETRIES: "0",
  AUTOMATIC_RETRY: "false", MANUAL_RETRY_WITH_SAME_PROBE_ID: "false", REUSABLE: "false",
  CONSUMED_IMMEDIATELY_BEFORE_FIRST_EXTERNAL_DISPATCH: "true",
});
const credentialFile = (id, content = `P9_PRODUCTION_DATABASE_URL=${dsn}\n`) => {
  const file = path.join(testRoot, `${id}.env`);
  writeFileSync(file, content);
  return file;
};

test("credential handoff accepts exactly one quoted or unquoted P9 entry and loads no other key", async () => {
  const { loadP9CredentialIntoEnvironment } = await import("../lib/p9-session-pooler-credential-handoff.mjs");
  for (const [id, value] of [["plain", dsn], ["double", `"${dsn}"`], ["single", `'${dsn}'`]]) {
    const env = { PATH: "synthetic-path" };
    const filePath = credentialFile(id, `OTHER_SECRET=must-not-load\nP9_PRODUCTION_DATABASE_URL=${value}\n`);
    const result = loadP9CredentialIntoEnvironment({ filePath, environment: env });
    assert.equal(result.sourceEquivalent, true);
    assert.equal(result.dsn, dsn);
    assert.equal(env.P9_PRODUCTION_DATABASE_URL, dsn);
    assert.equal("OTHER_SECRET" in env, false);
  }
});

test("credential handoff rejects missing, duplicate, empty, malformed and conflicting P9 values", async () => {
  const { loadP9CredentialIntoEnvironment } = await import("../lib/p9-session-pooler-credential-handoff.mjs");
  const cases = ["OTHER=x\n", "P9_PRODUCTION_DATABASE_URL=\n",
    `P9_PRODUCTION_DATABASE_URL=${dsn}\nP9_PRODUCTION_DATABASE_URL=${dsn}\n`,
    `P9_PRODUCTION_DATABASE_URL="${dsn}\n`, `P9_PRODUCTION_DATABASE_URL=${dsn} #tail\n`];
  for (const [index, content] of cases.entries()) {
    const env = {};
    assert.throws(() => loadP9CredentialIntoEnvironment({
      filePath: credentialFile(`bad-${index}`, content), environment: env }), /P9_POSTFIX_ENV_/);
    assert.equal("P9_PRODUCTION_DATABASE_URL" in env, false);
  }
  assert.throws(() => loadP9CredentialIntoEnvironment({
    filePath: credentialFile("conflict"), environment: { P9_PRODUCTION_DATABASE_URL: "stale" } }),
  /P9_POSTFIX_ENV_CONFLICT/);
});

test("gate rejects malformed, expired, future, wrong-target and drifting authorization before consumption", async () => {
  const { createP9PostfixGate } = await import("../lib/p9-session-pooler-postfix-gate.mjs");
  const base = authorization();
  const invalid = [
    { PROBE_EXECUTE: "0" }, { PROBE_ID: "p9-session-pooler-probe-1790552145" },
    { AUTHORIZED_AT_UTC: new Date(now - 15 * 60 * 1000 - 1).toISOString() },
    { AUTHORIZED_AT_UTC: new Date(now + 30 * 1000 + 1).toISOString() },
    { TARGET_PORT: "6543" }, { SOURCE_HEAD: "d".repeat(40) },
    { PROBE_IMPLEMENTATION_SHA256: "e".repeat(64) }, { PROBE_REVIEW_SHA256: "f".repeat(64) },
  ];
  for (const change of invalid) assert.throws(() => createP9PostfixGate({
    authorization: { ...base, ...change }, snapshot, now, testSentinelDir: testRoot }),
  /P9_POSTFIX_GATE_/);
  assert.equal(existsSync(path.join(testRoot, base.PROBE_ID)), false);
});

test("one fixed SQL command uses isolated effective PG target and consumes before spawn", async () => {
  const { simulateP9PostfixProbeTest } = await import("./p9-session-pooler-postfix-probe.mjs");
  const id = "p9-session-pooler-postfix-1790560001";
  const { receipt: result, audit } = await simulateP9PostfixProbeTest({ authorization: authorization(id), snapshot, now,
    testSentinelDir: testRoot,
    sourceEnvironment: { PGHOSTADDR: "elsewhere", PGSERVICE: "bad", PgHoSt: "bad",
      PGPASSWORD: "old", PGCONNECT_TIMEOUT: "999", PATH: "synthetic-path" } });
  assert.equal(result.P9_SESSION_POOLER_PROBE_STATUS, "PASS");
  assert.equal(result.RESULT_CLASS, "SESSION_POOLER_CREDENTIAL_VALID");
  assert.equal(result.DNS_RESULT_CLASS, "DNS_MULTIPLE_ADDRESSES_FIRST_SELECTED");
  assert.equal(result.SQL_EXECUTED, true);
  assert.equal(result.PRODUCTION_CONNECTION_ATTEMPTS, 1);
  assert.equal(result.RETRIES, 0);
  assert.equal(audit.calls.length, 1);
  assert.equal(audit.dnsCalls, 1);
  assert.equal(audit.dnsHost, target.TARGET_HOST);
  assert.equal(audit.sentinelConsumedBeforeDns, true);
  const [{ file, args, options, sentinelConsumedBeforeSpawn }] = audit.calls;
  assert.equal(sentinelConsumedBeforeSpawn, true);
  assert.equal(file, path.join(testRoot, "synthetic-psql.exe"));
  assert.equal(options.shell, false);
  assert.deepEqual(args.slice(-2), ["-c", "SELECT 1"]);
  assert.equal(JSON.stringify(args).includes("synthetic-password"), false);
  assert.deepEqual(Object.keys(options.env).filter((key) => /^PG/i.test(key)).sort(),
    ["PGDATABASE", "PGGSSENCMODE", "PGHOST", "PGHOSTADDR", "PGPASSWORD", "PGPORT",
      "PGSSLMODE", "PGSSLROOTCERT", "PGUSER"]);
  assert.equal(options.env.PGHOST, target.TARGET_HOST);
  assert.equal(options.env.PGHOSTADDR, "93.184.216.34");
  assert.equal(options.env.PGSSLMODE, "verify-full");
  assert.equal(options.env.PGSSLROOTCERT, "system");
  assert.equal(options.env.PGGSSENCMODE, "disable");
  assert.equal(options.env.PGUSER, target.TARGET_USER);
  assert.equal(options.env.PGPASSWORD, "synthetic-password");
  assert.equal(JSON.stringify(result).includes("synthetic-password"), false);
  const { receipt: replay, audit: replayAudit } = await simulateP9PostfixProbeTest({
    authorization: authorization(id), snapshot, now, testSentinelDir: testRoot });
  assert.equal(replay.P9_SESSION_POOLER_PROBE_STATUS, "BLOCKED");
  assert.equal(replay.PRODUCTION_CONNECTION_ATTEMPTS, 0);
  assert.equal(replayAudit.calls.length, 0);
  assert.equal(replayAudit.dnsCalls, 0);
  assert.equal(readFileSync(path.join(testRoot, id), "utf8").includes("synthetic-password"), false);
});

test("malformed target and expired authorization block without consuming or spawning", async () => {
  const { simulateP9PostfixProbeTest } = await import("./p9-session-pooler-postfix-probe.mjs");
  for (const [id, change, targetVariant] of [
    ["1790560002", {}, "transaction"],
    ["1790560003", { AUTHORIZED_AT_UTC: new Date(now - 901000).toISOString() }, "session"],
  ]) {
    const probeId = `p9-session-pooler-postfix-${id}`;
    const { receipt: result, audit } = await simulateP9PostfixProbeTest({
      authorization: { ...authorization(probeId), ...change },
      snapshot, now, targetVariant, testSentinelDir: testRoot });
    assert.equal(result.P9_SESSION_POOLER_PROBE_STATUS, "BLOCKED");
    assert.equal(result.PRODUCTION_CONNECTION_ATTEMPTS, 0);
    assert.equal(audit.calls.length, 0);
    assert.equal(audit.dnsCalls, 0);
    assert.equal(existsSync(path.join(testRoot, probeId)), false);
  }
});

test("localized stderr, oversized output and unknown output block without retry or leakage", async () => {
  const { simulateP9PostfixProbeTest } = await import("./p9-session-pooler-postfix-probe.mjs");
  for (const [id, behavior, expected] of [
    ["1790560004", { stdout: "", stderr: "synthetic-password authentication failed localized", exitCode: 2 }, "PSQL_NONZERO_EXIT"],
    ["1790560005", { stdout: "x".repeat(9000) }, "OUTPUT_LIMIT"],
    ["1790560006", { stdout: "2\n" }, "UNEXPECTED_SELECT_OUTPUT"],
  ]) {
    const { receipt: result, audit } = await simulateP9PostfixProbeTest({
      authorization: authorization(`p9-session-pooler-postfix-${id}`),
      snapshot, now, testSentinelDir: testRoot, fakeOutcome: behavior });
    assert.equal(result.P9_SESSION_POOLER_PROBE_STATUS, "BLOCKED");
    assert.equal(result.RESULT_CLASS, expected);
    assert.equal(result.PRODUCTION_CONNECTION_ATTEMPTS, 1);
    assert.equal(result.RETRIES, 0);
    assert.equal(audit.calls.length, 1);
    assert.equal(JSON.stringify(result).includes("synthetic-password"), false);
  }
});

test("timeout and unconfirmed termination remain blocked with one attempted process", async () => {
  const { simulateP9PostfixProbeTest } = await import("./p9-session-pooler-postfix-probe.mjs");
  const { receipt: result, audit } = await simulateP9PostfixProbeTest({
    authorization: authorization("p9-session-pooler-postfix-1790560007"), snapshot, now,
    testSentinelDir: testRoot, timeoutMs: 5, terminationGraceMs: 5,
    fakeOutcome: { stdout: "", neverClose: true },
  });
  assert.equal(audit.calls.length, 1);
  assert.equal(audit.killed, true);
  assert.equal(result.P9_SESSION_POOLER_PROBE_STATUS, "BLOCKED");
  assert.equal(result.RESULT_CLASS, "TERMINATION_UNCONFIRMED");
  assert.equal(result.PRODUCTION_CONNECTION_ATTEMPTS, 1);
  assert.equal(result.SQL_EXECUTED, "UNKNOWN");
  assert.equal(result.RETRIES, 0);
});

test("DNS failure consumes once, makes no database attempt and cannot replay", async () => {
  const { simulateP9PostfixProbeTest } = await import("./p9-session-pooler-postfix-probe.mjs");
  const id = "p9-session-pooler-postfix-1790560008";
  const { receipt: first, audit } = await simulateP9PostfixProbeTest({
    authorization: authorization(id), snapshot, now, testSentinelDir: testRoot, dnsOutcome: "error" });
  assert.equal(first.P9_SESSION_POOLER_PROBE_STATUS, "BLOCKED");
  assert.equal(first.RESULT_CLASS, "DNS_RESOLVER_ERROR");
  assert.equal(first.PRODUCTION_CONNECTION_ATTEMPTS, 0);
  assert.equal(audit.sentinelConsumedBeforeDns, true);
  assert.equal(audit.calls.length, 0);
  const { receipt: replay, audit: replayAudit } = await simulateP9PostfixProbeTest({
    authorization: authorization(id), snapshot, now, testSentinelDir: testRoot });
  assert.equal(replay.P9_SESSION_POOLER_PROBE_STATUS, "BLOCKED");
  assert.equal(replayAudit.dnsCalls, 0);
  assert.equal(replayAudit.calls.length, 0);
});

test("redirected private DNS address is rejected before psql dispatch", async () => {
  const { simulateP9PostfixProbeTest } = await import("./p9-session-pooler-postfix-probe.mjs");
  const { receipt: result, audit } = await simulateP9PostfixProbeTest({
    authorization: authorization("p9-session-pooler-postfix-1790560009"),
    snapshot, now, testSentinelDir: testRoot, dnsOutcome: "redirected" });
  assert.equal(result.P9_SESSION_POOLER_PROBE_STATUS, "BLOCKED");
  assert.equal(result.RESULT_CLASS, "DNS_LOOPBACK_ADDRESS");
  assert.equal(result.PRODUCTION_CONNECTION_ATTEMPTS, 0);
  assert.equal(audit.sentinelConsumedBeforeDns, true);
  assert.equal(audit.calls.length, 0);
});

test("DNS outcomes have distinct sanitized classes without fallback or secret output", async () => {
  const { simulateP9PostfixProbeTest } = await import("./p9-session-pooler-postfix-probe.mjs");
  const cases = [
    ["timeout", "DNS_TIMEOUT"], ["notfound", "DNS_NAME_NOT_FOUND"],
    ["nodata", "DNS_NO_A_RECORD"], ["servfail", "DNS_SERVER_FAILURE"],
    ["refused", "DNS_SERVER_REFUSED"], ["resolver-error", "DNS_RESOLVER_ERROR"],
    ["resolver-config", "DNS_RESOLVER_CONFIGURATION_FAILURE"],
    ["empty", "DNS_EMPTY_RESULT"], ["malformed", "DNS_MALFORMED_RESULT"],
    ["private", "DNS_PRIVATE_ADDRESS"], ["loopback", "DNS_LOOPBACK_ADDRESS"],
    ["reserved", "DNS_RESERVED_ADDRESS"], ["invalid", "DNS_INVALID_ADDRESS"],
    ["documentation", "DNS_RESERVED_ADDRESS"],
    ["private-then-public", "DNS_PRIVATE_ADDRESS"],
  ];
  for (const [index, [dnsOutcome, expected]] of cases.entries()) {
    const id = `p9-session-pooler-postfix-${1790560100 + index}`;
    const { receipt: result, audit } = await simulateP9PostfixProbeTest({
      authorization: authorization(id), snapshot, now, dnsOutcome,
      dnsTimeoutMs: 5, testSentinelDir: testRoot });
    assert.equal(result.P9_SESSION_POOLER_PROBE_STATUS, "BLOCKED", dnsOutcome);
    assert.equal(result.RESULT_CLASS, expected, dnsOutcome);
    assert.equal(result.DNS_RESULT_CLASS, expected, dnsOutcome);
    assert.equal(result.PRODUCTION_CONNECTION_ATTEMPTS, 0, dnsOutcome);
    assert.equal(result.SQL_EXECUTED, false, dnsOutcome);
    assert.equal(result.RETRIES, 0, dnsOutcome);
    assert.equal(audit.dnsCalls, 1, dnsOutcome);
    assert.equal(audit.sentinelConsumedBeforeDns, true, dnsOutcome);
    assert.equal(audit.calls.length, 0, dnsOutcome);
    if (dnsOutcome === "timeout") assert.equal(audit.dnsCancelled, true);
    assert.equal(JSON.stringify(result).includes("synthetic-password"), false);
    assert.equal(JSON.stringify(result).includes("93.184.216"), false);
  }
});

test("one or multiple public DNS records select only the first numeric address", async () => {
  const { simulateP9PostfixProbeTest } = await import("./p9-session-pooler-postfix-probe.mjs");
  for (const [index, [dnsOutcome, expected]] of [
    ["one-public", "DNS_ONE_PUBLIC_ADDRESS"],
    ["multiple-public", "DNS_MULTIPLE_ADDRESSES_FIRST_SELECTED"],
  ].entries()) {
    const id = `p9-session-pooler-postfix-${1790560200 + index}`;
    const { receipt: result, audit } = await simulateP9PostfixProbeTest({
      authorization: authorization(id), snapshot, now, dnsOutcome, testSentinelDir: testRoot });
    assert.equal(result.P9_SESSION_POOLER_PROBE_STATUS, "PASS");
    assert.equal(result.DNS_RESULT_CLASS, expected);
    assert.equal(audit.dnsCalls, 1);
    assert.equal(audit.calls.length, 1);
    assert.equal(audit.calls[0].options.env.PGHOSTADDR, "93.184.216.34");
    assert.equal(audit.calls[0].options.env.PGHOST, target.TARGET_HOST);
  }
});
