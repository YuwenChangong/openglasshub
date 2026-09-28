import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DNS_ONLY_HOST = "aws-1-ap-northeast-1.pooler.supabase.com";
export const DNS_ONLY_FIXED_AUTHORIZATION = Object.freeze({
  APPROVE_P9_SESSION_POOLER_DNS_ONLY_DIAGNOSTIC: "1", DIAGNOSTIC_EXECUTE: "1",
  AUTHORIZED_BY: "Jayden", TARGET_HOST: DNS_ONLY_HOST,
  METHOD_1: "NODE_RESOLVER_RESOLVE4", METHOD_2: "NODE_OS_LOOKUP_FAMILY_4_ALL_TRUE",
  MAX_LOGICAL_RESOLVER_CALLS: "2", CALLS_PER_METHOD: "1", MAX_APPLICATION_RETRIES: "0",
  MAX_RUNTIME_MS_PER_METHOD: "5000", PUBLIC_DNS_OVERRIDE: "false", OTHER_HOST_QUERIES: "false",
  DATABASE_CONNECTIONS: "0", PSQL_EXECUTIONS: "0", AUTH_A_EXECUTIONS: "0", WRITES: "0",
  CREDENTIAL_READS: "0", OUTPUT: "SANITIZED_CLASSES_DURATION_COUNTS_ADDRESS_SET_EQUALITY_ONLY",
  RAW_ADDRESSES_OR_ERRORS_PRINTED: "false", REUSABLE: "false",
  CONSUME_BEFORE_FIRST_RESOLVER_CALL: "true", MAX_AUTHORIZATION_AGE_SECONDS: "900",
  MAX_FUTURE_SKEW_SECONDS: "30",
});
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REVIEW = "docs/ops/verified-session-v1-p9-dns-only-review.json";
const FILES = Object.freeze(["scripts/lib/p9-dns-only-gate.mjs",
  "scripts/qa/p9-dns-only-diagnostic.mjs", "scripts/qa/p9-dns-only-worker.mjs"]);
const fail = (reason) => { throw new Error(`DNS_ONLY_GATE_${reason}`); };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function dnsOnlyChildEnvironment() {
  return process.platform === "win32" ? { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" } : {};
}

export function observeDnsOnlyRepository() {
  const boundedRead = (file) => {
    if (statSync(file).size > 65536) fail("FILE_TOO_LARGE");
    return readFileSync(file);
  };
  const bytes = boundedRead(path.join(ROOT, REVIEW));
  const review = JSON.parse(bytes);
  if (review?.version !== 1 || Object.keys(review).sort().join(",") !== "files,version"
    || !review.files || Object.keys(review.files).sort().join(",") !== [...FILES].sort().join(","))
    fail("REVIEW_INVALID");
  for (const file of FILES) {
    if (!/^[a-f0-9]{64}$/.test(review.files[file] ?? "")
      || sha(boundedRead(path.join(ROOT, file))) !== review.files[file]) fail("IMPLEMENTATION_DRIFT");
  }
  const git = (args) => {
    const executable = process.platform === "win32" ? "C:/Program Files/Git/cmd/git.exe" : "/usr/bin/git";
    const result = spawnSync(executable, ["-C", ROOT, "-c", "core.fsmonitor=false", ...args], {
      shell: false, windowsHide: true, env: { ...dnsOnlyChildEnvironment(), GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" },
      encoding: "utf8", timeout: 2000, maxBuffer: 65536,
    });
    if (result.error || result.status !== 0) fail("REPOSITORY_UNKNOWN");
    return result.stdout.trim();
  };
  return Object.freeze({ head: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]),
    worktreeClean: git(["status", "--porcelain", "--untracked-files=all"]) === "",
    commonDir: git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    filesVerified: true, parentPid: process.ppid,
    implementationSha256: review.files[FILES[1]], reviewSha256: sha(bytes) });
}

export function createDnsOnlyGate({ authorization, snapshot, now = Date.now(), testDirectory } = {}) {
  const keys = [...Object.keys(DNS_ONLY_FIXED_AUTHORIZATION), "DIAGNOSTIC_ID", "AUTHORIZED_AT_UTC",
    "SOURCE_HEAD", "DNS_ONLY_IMPLEMENTATION_SHA256", "DNS_ONLY_REVIEW_SHA256"].sort();
  if (!authorization || Object.keys(authorization).sort().join(",") !== keys.join(",")
    || Object.entries(DNS_ONLY_FIXED_AUTHORIZATION).some(([key, value]) => authorization[key] !== value)
    || !/^p9-session-pooler-dns-[0-9]{10,20}$/.test(authorization.DIAGNOSTIC_ID ?? "")
    || !/^[a-f0-9]{40}$/.test(authorization.SOURCE_HEAD ?? "")
    || !/^[a-f0-9]{64}$/.test(authorization.DNS_ONLY_IMPLEMENTATION_SHA256 ?? "")
    || !/^[a-f0-9]{64}$/.test(authorization.DNS_ONLY_REVIEW_SHA256 ?? "")) fail("AUTHORIZATION_INVALID");
  const at = authorization.AUTHORIZED_AT_UTC;
  const epoch = typeof at === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at)
    ? Date.parse(at) : NaN;
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== at || !Number.isFinite(now)
    || now - epoch > 900000 || epoch - now > 30000) fail("AUTHORIZATION_TIME_INVALID");
  if (snapshot?.branch !== "feature/auth-verified-session-v1" || snapshot.worktreeClean !== true
    || snapshot.filesVerified !== true || snapshot.head !== authorization.SOURCE_HEAD
    || snapshot.implementationSha256 !== authorization.DNS_ONLY_IMPLEMENTATION_SHA256
    || snapshot.reviewSha256 !== authorization.DNS_ONLY_REVIEW_SHA256
    || !path.isAbsolute(snapshot.commonDir ?? "")) fail("BINDING_DRIFT");
  if (testDirectory !== undefined && path.resolve(testDirectory) !== path.resolve(snapshot.commonDir))
    fail("TEST_DIR_INVALID");
  const directory = testDirectory ?? path.join(snapshot.commonDir, "ogh-p9-dns-only-consumed");
  const id = authorization.DIAGNOSTIC_ID;
  const binding = sha(JSON.stringify(keys.map((key) => [key, authorization[key]])));
  const markerContents = (pid) => `DNS_ONLY_CONSUMED:${pid}:${binding}\n`;
  let consumed = false;
  const writeOnce = (name, contents) => {
    const fd = openSync(path.join(directory, name), "wx", 0o600);
    try { writeFileSync(fd, contents); } finally { closeSync(fd); }
  };
  const requireMarker = (name, contents) => {
    const marker = path.join(directory, name);
    if (statSync(marker).size !== Buffer.byteLength(contents)
      || readFileSync(marker, "utf8") !== contents) fail("MARKER_INVALID");
  };
  return Object.freeze({ consume() {
    if (consumed) fail("ALREADY_CONSUMED");
    try {
      mkdirSync(directory, { recursive: true });
      writeOnce(id, markerContents(process.pid));
      consumed = true;
    } catch { fail("CONSUMPTION_BLOCKED"); }
  }, confirmFirstMethodClosed() {
    if (!consumed) fail("NOT_CONSUMED");
    try { writeOnce(`${id}.method-1-closed`, "FIRST_METHOD_CLOSED\n"); }
    catch { fail("CLOSE_CONFIRMATION_BLOCKED"); }
  }, claimMethod(method) {
    if (![1, 2].includes(method)) fail("METHOD_INVALID");
    try {
      if (!Number.isSafeInteger(snapshot.parentPid) || snapshot.parentPid < 1) fail("PARENT_INVALID");
      requireMarker(id, markerContents(snapshot.parentPid));
      if (method === 2) requireMarker(`${id}.method-1-closed`, "FIRST_METHOD_CLOSED\n");
      writeOnce(`${id}.method-${method}`, "DNS_METHOD_CLAIMED\n");
    } catch { fail("METHOD_CLAIM_BLOCKED"); }
  } });
}
