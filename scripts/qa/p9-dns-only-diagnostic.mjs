import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, realpathSync } from "node:fs";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDnsOnlyGate, DNS_ONLY_HOST, dnsOnlyChildEnvironment,
  observeDnsOnlyRepository } from "../lib/p9-dns-only-gate.mjs";

export { DNS_ONLY_HOST };
const WORKER = fileURLToPath(new URL("./p9-dns-only-worker.mjs", import.meta.url));
const ERRORS = Object.freeze({ ENOTFOUND: "NAME_NOT_FOUND", ENODATA: "NO_DATA",
  ESERVFAIL: "SERVER_FAILURE", EREFUSED: "SERVER_REFUSED", ETIMEOUT: "TIMEOUT",
  ENOTINITIALIZED: "RESOLVER_CONFIGURATION_FAILURE", ELOADIPHLPAPI: "RESOLVER_CONFIGURATION_FAILURE",
  EADDRGETNETWORKPARAMS: "RESOLVER_CONFIGURATION_FAILURE" });
const failure = (classification) => ({ classification, count: "UNKNOWN", addresses: [] });
export const DNS_ONLY_FAILURE_CLASSES = Object.freeze([...new Set(Object.values(ERRORS)),
  "EMPTY_RESULT", "MALFORMED_RESULT", "NON_IPV4_RESULT", "PRIVATE_ADDRESS_PRESENT",
  "LOOPBACK_ADDRESS_PRESENT", "RESERVED_ADDRESS_PRESENT", "OTHER_RESOLVER_ERROR"]);

export function classifyDnsOnlyResult({ method, raw, errorCode } = {}) {
  if (errorCode !== undefined) return failure(Object.hasOwn(ERRORS, errorCode) ? ERRORS[errorCode] : "OTHER_RESOLVER_ERROR");
  if (![1, 2].includes(method) || !Array.isArray(raw) || raw.length > 128) return failure("MALFORMED_RESULT");
  if (!raw.length) return failure("EMPTY_RESULT");
  const addresses = [];
  for (const item of raw) {
    const address = method === 1 ? item : item?.address;
    if (typeof address !== "string" || address.length > 45) return failure("MALFORMED_RESULT");
    if (method === 2 && item?.family !== 4 || isIP(address) !== 4) return failure("NON_IPV4_RESULT");
    const [a, b, c] = address.split(".").map(Number);
    if (a === 127) return failure("LOOPBACK_ADDRESS_PRESENT");
    if (a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168)
      return failure("PRIVATE_ADDRESS_PRESENT");
    if (a === 0 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254
      || a === 192 && b === 0 && (c === 0 || c === 2) || a === 192 && b === 88 && c === 99
      || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
      || a === 203 && b === 0 && c === 113) return failure("RESERVED_ADDRESS_PRESENT");
    addresses.push(address);
  }
  return { classification: raw.length === 1 ? "SUCCESS_ONE_IPV4" : "SUCCESS_MULTIPLE_IPV4",
    count: raw.length, addresses: [...new Set(addresses)].sort() };
}

function emptyReceipt() {
  const receipt = { ADDRESS_SET_EQUALITY: "UNKNOWN", RESULT_COUNT_EQUALITY: "UNKNOWN", RETRIES: 0 };
  for (const method of [1, 2]) Object.assign(receipt, {
    [`METHOD_${method}_STATUS`]: "BLOCKED", [`METHOD_${method}_CLASS`]: "OTHER_RESOLVER_ERROR",
    [`METHOD_${method}_DURATION_MS`]: 0, [`METHOD_${method}_RESULT_COUNT`]: "UNKNOWN",
  });
  return receipt;
}

// Children isolate non-cancellable OS lookup. No subsequent method starts until close is confirmed.
function runMethod(method, launch, timeoutMs) {
  return new Promise((resolve) => {
    const start = performance.now();
    let child, timer, grace, forced, bytes = 0, output = "", done = false;
    const finish = (result, closed) => {
      if (done) return;
      done = true;
      clearTimeout(timer); clearTimeout(grace);
      resolve({ ...result, closed, duration: Math.min(timeoutMs, Math.max(0, Math.floor(performance.now() - start))) });
    };
    const stop = (classification) => {
      if (forced || done) return;
      forced = classification;
      grace = setTimeout(() => finish(failure(classification), false), 500);
      try { child.kill("SIGKILL"); } catch { /* Unconfirmed termination blocks method 2. */ }
    };
    timer = setTimeout(() => stop("TIMEOUT"), timeoutMs);
    try { child = launch(method); } catch { finish(failure("OTHER_RESOLVER_ERROR"), true); return; }
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 8192) { stop("MALFORMED_RESULT"); return; }
      if (!forced) output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      bytes += chunk.length;
      stop("OTHER_RESOLVER_ERROR");
    });
    child.on("error", () => stop("OTHER_RESOLVER_ERROR"));
    child.on("close", (code) => {
      if (forced) { finish(failure(forced), true); return; }
      if (code !== 0) { finish(failure("OTHER_RESOLVER_ERROR"), true); return; }
      try {
        const result = JSON.parse(output);
        if (result && Object.keys(result).join(",") === "raw")
          finish(classifyDnsOnlyResult({ method, raw: result.raw }), true);
        else if (result && Object.keys(result).join(",") === "errorCode" && typeof result.errorCode === "string")
          finish(classifyDnsOnlyResult({ method, errorCode: result.errorCode }), true);
        else if (result && Object.keys(result).join(",") === "classification"
          && DNS_ONLY_FAILURE_CLASSES.includes(result.classification)) finish(failure(result.classification), true);
        else finish(failure("MALFORMED_RESULT"), true);
      } catch { finish(failure("MALFORMED_RESULT"), true); }
    });
  });
}

async function runCore({ gate, launch, timeoutMs }) {
  const receipt = emptyReceipt();
  const results = [];
  try { gate.consume(); } catch { return receipt; }
  for (const method of [1, 2]) {
    const result = await runMethod(method, launch, timeoutMs);
    results.push(result);
    const pass = result.classification.startsWith("SUCCESS_");
    Object.assign(receipt, { [`METHOD_${method}_STATUS`]: pass ? "PASS" : "BLOCKED",
      [`METHOD_${method}_CLASS`]: result.classification, [`METHOD_${method}_DURATION_MS`]: result.duration,
      [`METHOD_${method}_RESULT_COUNT`]: result.count });
    if (!result.closed) break;
    if (method === 1) {
      try { gate.confirmFirstMethodClosed(); } catch { break; }
    }
  }
  if (results.length === 2 && results.every((result) => result.classification.startsWith("SUCCESS_"))) {
    receipt.ADDRESS_SET_EQUALITY = JSON.stringify(results[0].addresses) === JSON.stringify(results[1].addresses);
    receipt.RESULT_COUNT_EQUALITY = results[0].count === results[1].count;
  }
  return receipt;
}

// Data-only simulation: callers cannot inject a real resolver or process launcher.
export async function simulateDnsOnlyDiagnostic({ authorization, snapshot, now, testDirectory,
  outcomes = [], timeoutMs = 25 } = {}) {
  const audit = { calls: [], kills: 0 };
  let gate;
  try {
    if (!testDirectory || !path.basename(testDirectory).startsWith("p9-dns-only-test-")
      || path.dirname(realpathSync(testDirectory)) !== realpathSync(tmpdir())) throw new Error("TEST_DIR_BLOCKED");
    gate = createDnsOnlyGate({ authorization, snapshot, now, testDirectory });
  }
  catch { return { receipt: emptyReceipt(), audit }; }
  const launch = (method) => {
    audit.calls.push({ method, host: DNS_ONLY_HOST, consumed: existsSync(path.join(testDirectory, authorization.DIAGNOSTIC_ID)),
      options: { shell: false, env: dnsOnlyChildEnvironment() } });
    const outcome = outcomes[method - 1] ?? {};
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => { audit.kills++; if (!outcome.unconfirmed) queueMicrotask(() => child.emit("close", null)); };
    queueMicrotask(() => {
      if (outcome.timeout) return;
      if (outcome.oversized) child.stdout.emit("data", Buffer.alloc(8193));
      else if (outcome.stderr) child.stderr.emit("data", Buffer.from(outcome.stderr));
      else child.stdout.emit("data", Buffer.from(JSON.stringify(outcome.errorCode !== undefined
        ? { errorCode: outcome.errorCode } : { raw: outcome.raw })));
      if (!outcome.unconfirmed) child.emit("close", 0);
    });
    return child;
  };
  const receipt = await runCore({ gate, launch, timeoutMs: Math.max(1, Math.min(100, timeoutMs)) });
  return { receipt, audit };
}

function readAuthorization() {
  return new Promise((resolve, reject) => {
    let bytes = 0, input = "";
    const timer = setTimeout(() => { process.stdin.destroy(); reject(new Error("INPUT_BLOCKED")); }, 3000);
    process.stdin.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 8192) { clearTimeout(timer); process.stdin.destroy(); reject(new Error("INPUT_BLOCKED")); }
      else input += chunk.toString("utf8");
    });
    process.stdin.on("error", () => { clearTimeout(timer); reject(new Error("INPUT_BLOCKED")); });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(input)); } catch { reject(new Error("INPUT_BLOCKED")); }
    });
  });
}

async function main() {
  // 3s input + four 2s Git commands + two (5s + 0.5s termination) methods < 24s.
  const deadline = setTimeout(() => process.exit(1), 24000);
  let receipt = emptyReceipt();
  try {
    if (process.argv.length !== 2) throw new Error("ARGUMENTS_BLOCKED");
    const authorization = await readAuthorization();
    const snapshot = observeDnsOnlyRepository();
    const gate = createDnsOnlyGate({ authorization, snapshot });
    receipt = await runCore({ gate, timeoutMs: 5000, launch: (method) => {
      const child = spawn(process.execPath, [WORKER, String(method)], { shell: false, windowsHide: true,
        env: dnsOnlyChildEnvironment(), stdio: ["ignore", "pipe", "pipe", "ipc"] });
      child.once("spawn", () => child.send({ authorization }, () => {}));
      return child;
    } });
  } catch { /* Fail closed without printing input or underlying errors. */ }
  clearTimeout(deadline);
  for (const [key, value] of Object.entries(receipt)) process.stdout.write(`${key}=${value}\n`);
  process.exit(receipt.METHOD_1_STATUS === "PASS" && receipt.METHOD_2_STATUS === "PASS" ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
