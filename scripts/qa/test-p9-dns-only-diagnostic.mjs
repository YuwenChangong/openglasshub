import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isIP } from "node:net";
import path from "node:path";
import { after, test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(path.join(tmpdir(), "p9-dns-only-test-"));
after(() => {
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
  rmSync(root, { recursive: true, force: true });
});
const now = Date.parse("2026-09-28T02:00:00.000Z");
const snapshot = { head: "a".repeat(40), branch: "feature/auth-verified-session-v1",
  worktreeClean: true, filesVerified: true, implementationSha256: "b".repeat(64),
  reviewSha256: "c".repeat(64), commonDir: root, parentPid: process.pid };
let serial = 1790561000;
async function setup() {
  const gate = await import("../lib/p9-dns-only-gate.mjs");
  const authorization = { ...gate.DNS_ONLY_FIXED_AUTHORIZATION,
    DIAGNOSTIC_ID: `p9-session-pooler-dns-${serial++}`, AUTHORIZED_AT_UTC: new Date(now).toISOString(),
    SOURCE_HEAD: snapshot.head, DNS_ONLY_IMPLEMENTATION_SHA256: snapshot.implementationSha256,
    DNS_ONLY_REVIEW_SHA256: snapshot.reviewSha256 };
  return { gate, authorization };
}
const publicA = "93.184.216.34";
const publicB = "93.184.216.35";
const lookup = (addresses) => addresses.map((address) => ({ address, family: 4 }));

test("authorization is exact, fresh, bound to clean branch/head/hashes before consumption", async () => {
  const { gate, authorization } = await setup();
  for (const change of [{ TARGET_HOST: "other.invalid" }, { PUBLIC_DNS_OVERRIDE: "true" },
    { DIAGNOSTIC_EXECUTE: "0" }, { SOURCE_HEAD: "d".repeat(40) },
    { DNS_ONLY_IMPLEMENTATION_SHA256: "e".repeat(64) }, { DNS_ONLY_REVIEW_SHA256: "f".repeat(64) },
    { AUTHORIZED_AT_UTC: new Date(now - 900001).toISOString() },
    { AUTHORIZED_AT_UTC: new Date(now + 30001).toISOString() }, { DIAGNOSTIC_ID: "bad" }]) {
    assert.throws(() => gate.createDnsOnlyGate({ authorization: { ...authorization, ...change },
      snapshot, now, testDirectory: root }), /DNS_ONLY_GATE_/);
  }
  for (const change of [{ worktreeClean: false }, { branch: "main" }])
    assert.throws(() => gate.createDnsOnlyGate({ authorization, snapshot: { ...snapshot, ...change },
      now, testDirectory: root }), /DNS_ONLY_GATE_/);
  assert.equal(existsSync(path.join(root, authorization.DIAGNOSTIC_ID)), false);
});

test("classification distinguishes every sanitized failure and bounds result handling", async () => {
  const { classifyDnsOnlyResult } = await import("./p9-dns-only-diagnostic.mjs");
  for (const [code, expected] of [["ENOTFOUND", "NAME_NOT_FOUND"], ["ENODATA", "NO_DATA"],
    ["ESERVFAIL", "SERVER_FAILURE"], ["EREFUSED", "SERVER_REFUSED"], ["ETIMEOUT", "TIMEOUT"],
    ["ENOTINITIALIZED", "RESOLVER_CONFIGURATION_FAILURE"], ["secret-error", "OTHER_RESOLVER_ERROR"]]) {
    const result = classifyDnsOnlyResult({ method: 1, errorCode: code });
    assert.equal(result.classification, expected);
    assert.equal(JSON.stringify(result).includes("secret-error"), false);
  }
  for (const [raw, expected] of [[[], "EMPTY_RESULT"], [null, "MALFORMED_RESULT"],
    [[{}], "MALFORMED_RESULT"], [["::1"], "NON_IPV4_RESULT"],
    [["10.0.0.1"], "PRIVATE_ADDRESS_PRESENT"], [["127.0.0.1"], "LOOPBACK_ADDRESS_PRESENT"],
    [["203.0.113.1"], "RESERVED_ADDRESS_PRESENT"], [Array(129).fill(publicA), "MALFORMED_RESULT"]]) {
    assert.equal(classifyDnsOnlyResult({ method: 1, raw }).classification, expected);
  }
  assert.equal(classifyDnsOnlyResult({ method: 2, raw: lookup([publicA]) }).classification, "SUCCESS_ONE_IPV4");
  assert.equal(classifyDnsOnlyResult({ method: 2, raw: [{ address: publicA, family: 6 }] }).classification, "NON_IPV4_RESULT");
  assert.equal(classifyDnsOnlyResult({ method: 1, raw: ["192.0.1.1"] }).classification, "SUCCESS_ONE_IPV4");
});

test("two frozen calls, isolated child environment, sentinel before dispatch, set equality and replay", async () => {
  const { simulateDnsOnlyDiagnostic } = await import("./p9-dns-only-diagnostic.mjs");
  const { authorization } = await setup();
  const input = { authorization, snapshot, now, testDirectory: root,
    outcomes: [{ raw: [publicA, publicB, publicA] }, { raw: lookup([publicB, publicA]) }] };
  const { receipt, audit } = await simulateDnsOnlyDiagnostic(input);
  assert.equal(receipt.METHOD_1_STATUS, "PASS");
  assert.equal(receipt.METHOD_2_STATUS, "PASS");
  assert.equal(receipt.ADDRESS_SET_EQUALITY, true);
  assert.equal(receipt.RESULT_COUNT_EQUALITY, false);
  assert.equal(audit.calls.length, 2);
  assert.deepEqual(audit.calls.map((call) => call.method), [1, 2]);
  for (const call of audit.calls) {
    assert.equal(call.consumed, true);
    assert.equal(call.options.shell, false);
    assert.equal(call.host, "aws-1-ap-northeast-1.pooler.supabase.com");
    assert.equal(Object.keys(call.options.env).some((key) => /P9|PG|TOKEN|SECRET|KEY/i.test(key)), false);
  }
  assert.equal(JSON.stringify(receipt).includes(publicA), false);
  const replay = await simulateDnsOnlyDiagnostic(input);
  assert.equal(replay.audit.calls.length, 0);
  assert.equal(replay.receipt.ADDRESS_SET_EQUALITY, "UNKNOWN");
});

test("failure or timeout compares UNKNOWN without retry; different sets compare false", async () => {
  const { simulateDnsOnlyDiagnostic } = await import("./p9-dns-only-diagnostic.mjs");
  for (const outcomes of [[{ errorCode: "ENOTFOUND" }, { raw: lookup([publicA]) }],
    [{ timeout: true }, { raw: lookup([publicA]) }],
    [{ raw: [publicA] }, { timeout: true }],
    [{ oversized: true }, { raw: lookup([publicA]) }]]) {
    const { authorization } = await setup();
    const { receipt, audit } = await simulateDnsOnlyDiagnostic({ authorization, snapshot, now,
      testDirectory: root, outcomes, timeoutMs: 5 });
    assert.equal(receipt.ADDRESS_SET_EQUALITY, "UNKNOWN");
    assert.equal(audit.calls.length, 2);
    assert.equal(receipt.RETRIES, 0);
    if (outcomes.some((item) => item.timeout)) assert.ok(audit.kills >= 1);
  }
  const { authorization } = await setup();
  const { receipt } = await simulateDnsOnlyDiagnostic({ authorization, snapshot, now,
    testDirectory: root, outcomes: [{ raw: [publicA] }, { raw: lookup([publicB]) }] });
  assert.equal(receipt.ADDRESS_SET_EQUALITY, false);
  assert.equal(receipt.RESULT_COUNT_EQUALITY, true);
});

test("unconfirmed termination fails closed before another method", async () => {
  const { simulateDnsOnlyDiagnostic } = await import("./p9-dns-only-diagnostic.mjs");
  const { authorization } = await setup();
  const { receipt, audit } = await simulateDnsOnlyDiagnostic({ authorization, snapshot, now,
    testDirectory: root, timeoutMs: 5,
    outcomes: [{ timeout: true, unconfirmed: true }, { raw: lookup([publicA]) }] });
  assert.equal(audit.calls.length, 1);
  assert.equal(receipt.METHOD_2_STATUS, "BLOCKED");
});

test("worker source has only frozen DNS APIs, no credentials, DB, psql or override calls", async () => {
  const source = readFileSync(new URL("./p9-dns-only-worker.mjs", import.meta.url), "utf8");
  assert.match(source, /resolve4\(DNS_ONLY_HOST\)/);
  assert.match(source, /lookup\(DNS_ONLY_HOST, \{ family: 4, all: true \}\)/);
  assert.doesNotMatch(source, /process\.env|setServers|P9_PRODUCTION_DATABASE_URL|\.env|psql|supabase|fetch\(|\bconnect\(/i);
});

test("worker executes exactly one frozen API per method with synthetic DNS and no ambient access", async () => {
  const { classifyDnsOnlyResult, DNS_ONLY_HOST } = await import("./p9-dns-only-diagnostic.mjs");
  const source = readFileSync(new URL("./p9-dns-only-worker.mjs", import.meta.url), "utf8")
    .replace(/^import[^;]+;\s*/gm, "")
    .replace(/if \(process\.argv\[1\][^\n]+await main\(\);/, "");
  for (const method of [1, 2]) {
    for (const outcome of [{ raw: method === 1 ? [publicA, publicB] : lookup([publicB, publicA]) },
      { raw: method === 1 ? [] : [] }, { errorCode: "ESERVFAIL" }]) {
      const { gate, authorization } = await setup();
      const parentGate = gate.createDnsOnlyGate({ authorization, snapshot, now, testDirectory: root });
      parentGate.consume();
      if (method === 2) parentGate.confirmFirstMethodClosed();
      const calls = [], output = [];
      const answer = () => {
        if (outcome.errorCode) throw { code: outcome.errorCode, message: "RAW_SECRET_ERROR" };
        return outcome.raw;
      };
      const processStub = { argv: ["node", "worker", String(method)], send() {},
        once(event, callback) { assert.equal(event, "message"); callback({ authorization }); },
        exit(code) { throw new Error(`EXIT_${code}`); }, disconnect() {},
        stdout: { write(value) { output.push(value); } } };
      Object.defineProperty(processStub, "env", { get() { throw new Error("ENV_READ"); } });
      await vm.runInNewContext(`(async () => { ${source}\n await main(); })()`, {
        process: processStub, performance, setTimeout() { return 1; }, clearTimeout() {}, classifyDnsOnlyResult, DNS_ONLY_HOST,
        observeDnsOnlyRepository() { return snapshot; },
        createDnsOnlyGate(input) { return gate.createDnsOnlyGate({ ...input, now, testDirectory: root }); },
        dns: { promises: {
          Resolver: class { async resolve4(host) { calls.push({ method: 1, host }); return answer(); } },
          async lookup(host, options) { calls.push({ method: 2, host, options }); return answer(); },
        } },
      }, { timeout: 1000 });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, method);
      assert.equal(calls[0].host, DNS_ONLY_HOST);
      if (method === 2) assert.equal(JSON.stringify(calls[0].options), '{"family":4,"all":true}');
      assert.equal(output.join("").includes("RAW_SECRET_ERROR"), false);
      if (!outcome.errorCode && outcome.raw.length === 0)
        assert.deepEqual(JSON.parse(output.join("")), { classification: "EMPTY_RESULT" });
    }
  }
});

test("worker claims require parent consumption, first close, and are atomic one-use per method", async () => {
  const { gate, authorization } = await setup();
  const input = { authorization, snapshot, now, testDirectory: root };
  const parent = gate.createDnsOnlyGate(input);
  const worker = gate.createDnsOnlyGate(input);
  assert.throws(() => worker.claimMethod(1), /DNS_ONLY_GATE_/);
  parent.consume();
  assert.throws(() => gate.createDnsOnlyGate({ ...input, authorization: { ...authorization,
    AUTHORIZED_AT_UTC: new Date(now + 1).toISOString() } }).claimMethod(1), /DNS_ONLY_GATE_/);
  assert.throws(() => gate.createDnsOnlyGate({ ...input,
    snapshot: { ...snapshot, parentPid: process.pid + 1 } }).claimMethod(1), /DNS_ONLY_GATE_/);
  assert.throws(() => worker.claimMethod(2), /DNS_ONLY_GATE_/);
  worker.claimMethod(1);
  assert.throws(() => gate.createDnsOnlyGate(input).claimMethod(1), /DNS_ONLY_GATE_/);
  parent.confirmFirstMethodClosed();
  worker.claimMethod(2);
  assert.throws(() => gate.createDnsOnlyGate(input).claimMethod(2), /DNS_ONLY_GATE_/);
  assert.throws(() => parent.consume(), /DNS_ONLY_GATE_/);
});

test("all preflight failures make zero dispatches; raw stderr is never echoed", async () => {
  const { simulateDnsOnlyDiagnostic } = await import("./p9-dns-only-diagnostic.mjs");
  const { authorization } = await setup();
  for (const change of [{ AUTHORIZED_AT_UTC: new Date(now - 900001).toISOString() },
    { AUTHORIZED_AT_UTC: new Date(now + 30001).toISOString() }, { SOURCE_HEAD: "0".repeat(40) },
    { DNS_ONLY_IMPLEMENTATION_SHA256: "0".repeat(64) }, { DNS_ONLY_REVIEW_SHA256: "0".repeat(64) },
    { TARGET_HOST: "alternate.invalid" }, { PUBLIC_DNS_OVERRIDE: "true" }, { UNREVIEWED_FIELD: "yes" }]) {
    const result = await simulateDnsOnlyDiagnostic({ authorization: { ...authorization, ...change },
      snapshot, now, testDirectory: root });
    assert.equal(result.audit.calls.length, 0);
  }
  const { authorization: next } = await setup();
  const result = await simulateDnsOnlyDiagnostic({ authorization: next, snapshot, now, testDirectory: root,
    outcomes: [{ stderr: "RAW_ERROR_PASSWORD_OR_ADDRESS" }, { raw: lookup([publicA]) }] });
  assert.equal(result.audit.calls.length, 2);
  assert.equal(JSON.stringify(result.receipt).includes("RAW_ERROR"), false);
  assert.equal(result.receipt.METHOD_1_CLASS, "OTHER_RESOLVER_ERROR");
});

test("standalone worker and extra arguments are denied before any resolver", async () => {
  const source = readFileSync(new URL("./p9-dns-only-worker.mjs", import.meta.url), "utf8")
    .replace(/^import[^;]+;\s*/gm, "")
    .replace(/if \(process\.argv\[1\][^\n]+await main\(\);/, "");
  for (const processStub of [{ argv: ["node", "worker", "1"] },
    { argv: ["node", "worker", "1", "extra"], send() {} },
    { argv: ["node", "worker", "3"], send() {} }]) {
    processStub.exit = () => { throw new Error("DENIED"); };
    await assert.rejects(vm.runInNewContext(`(async () => { ${source}\n await main(); })()`, {
      process: processStub, dns: new Proxy({}, { get() { throw new Error("DNS_ACCESS"); } }),
    }), /DENIED/);
  }
});

test("arbitrary IPC start message cannot bypass complete worker authorization", async () => {
  const source = readFileSync(new URL("./p9-dns-only-worker.mjs", import.meta.url), "utf8")
    .replace(/^import[^;]+;\s*/gm, "")
    .replace(/if \(process\.argv\[1\][^\n]+await main\(\);/, "");
  let calls = 0;
  const proc = { argv: ["node", "worker", "1"], send() {},
    once(event, callback) { callback({ start: true }); },
    stdout: { write() {} }, disconnect() {}, exit() { throw new Error("DENIED"); } };
  await assert.rejects(vm.runInNewContext(`(async () => { ${source}\n await main(); })()`, {
    process: proc, performance, setTimeout() { return 1; }, clearTimeout() {},
    dns: { promises: { Resolver: class { async resolve4() { calls++; return []; } } } },
    DNS_ONLY_HOST: "frozen", classifyDnsOnlyResult() { return { classification: "EMPTY_RESULT" }; },
  }), /DENIED/);
  assert.equal(calls, 0);
});

test("complete stdin -> observation -> spawn -> worker claim path stays synthetic and rejects replay", async () => {
  const { gate, authorization } = await setup();
  const diagnosticUrl = new URL("./p9-dns-only-diagnostic.mjs", import.meta.url);
  const runnerSource = readFileSync(diagnosticUrl, "utf8")
    .replace(/^import[^;]+;\s*/gm, "").replace(/export \{ DNS_ONLY_HOST \};/, "")
    .replace(/if \(process\.argv\[1\][^\n]+await main\(\);/, "")
    .replace(/export /g, "").replaceAll("import.meta.url", JSON.stringify(diagnosticUrl.href));
  const workerSource = readFileSync(new URL("./p9-dns-only-worker.mjs", import.meta.url), "utf8")
    .replace(/^import[^;]+;\s*/gm, "")
    .replace(/if \(process\.argv\[1\][^\n]+await main\(\);/, "");
  const { classifyDnsOnlyResult, DNS_ONLY_HOST } = await import("./p9-dns-only-diagnostic.mjs");
  const calls = [], output = [];
  let observations = 0;
  const observe = () => { observations++; return snapshot; };
  const create = (input) => gate.createDnsOnlyGate({ ...input, now, testDirectory: root });
  async function run() {
    const stdin = new EventEmitter();
    stdin.destroy = () => {};
    const proc = { argv: ["node", "synthetic-runner"], execPath: "synthetic-node", stdin,
      stdout: { write(value) { output.push(value); } }, exit(code) { throw new Error(`EXIT_${code}`); } };
    Object.defineProperty(proc, "env", { get() { throw new Error("ENV_READ"); } });
    const launch = (executable, args, options) => {
      assert.equal(executable, "synthetic-node");
      assert.equal(path.basename(args[0]), "p9-dns-only-worker.mjs");
      assert.equal(options.shell, false);
      assert.equal(existsSync(path.join(root, authorization.DIAGNOSTIC_ID)), true);
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => queueMicrotask(() => child.emit("close", 1));
      child.send = (message, callback) => {
        assert.equal(JSON.stringify(message.authorization), JSON.stringify(authorization));
        const workerProc = { argv: ["node", "worker", args[1]], send() {},
          once(event, fn) { fn(message); }, exit() { throw new Error("WORKER_DENIED"); }, disconnect() {},
          stdout: { write(value) { child.stdout.emit("data", Buffer.from(value)); } } };
        vm.runInNewContext(`(async () => { ${workerSource}\n await main(); })()`, {
          process: workerProc, performance, setTimeout() { return 1; }, clearTimeout() {},
          observeDnsOnlyRepository: observe, createDnsOnlyGate: create, classifyDnsOnlyResult, DNS_ONLY_HOST,
          dns: { promises: {
            Resolver: class { async resolve4(host) { calls.push({ method: 1, host }); return [publicA]; } },
            async lookup(host, options) { calls.push({ method: 2, host, options }); return lookup([publicA]); },
          } },
        }, { timeout: 1000 }).then(() => child.emit("close", 0), () => child.emit("close", 1));
        callback();
      };
      queueMicrotask(() => child.emit("spawn"));
      return child;
    };
    const result = vm.runInNewContext(`${runnerSource}\nmain();`, { process: proc, path, fileURLToPath, URL,
      performance, Buffer, EventEmitter, isIP, setTimeout, clearTimeout, spawn: launch,
      observeDnsOnlyRepository: observe, createDnsOnlyGate: create,
      DNS_ONLY_HOST, dnsOnlyChildEnvironment() { return {}; },
    }, { timeout: 1000 });
    queueMicrotask(() => { stdin.emit("data", Buffer.from(JSON.stringify(authorization))); stdin.emit("end"); });
    return result;
  }
  await assert.rejects(run(), /EXIT_0/);
  assert.equal(observations, 3);
  assert.deepEqual(calls.map((call) => call.method), [1, 2]);
  assert.ok(calls.every((call) => call.host === DNS_ONLY_HOST));
  assert.ok(output.join("").includes("ADDRESS_SET_EQUALITY=true"));
  assert.equal(output.join("").includes(publicA), false);
  await assert.rejects(run(), /EXIT_1/);
  assert.equal(calls.length, 2);
});
