import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REVIEW = "docs/ops/verified-session-v1-p9-postfix-probe-review.json";
const BRANCH = "feature/auth-verified-session-v1";
const TARGET = Object.freeze({ TARGET_PROJECT: "xcbnxzjlsvtgzixurcof",
  TARGET_HOST: "aws-1-ap-northeast-1.pooler.supabase.com", TARGET_PORT: "5432",
  TARGET_DATABASE: "postgres", TARGET_USER: "postgres.xcbnxzjlsvtgzixurcof" });
const FIXED = Object.freeze({ APPROVE_P9_SESSION_POOLER_POST_FIX_READ_ONLY_PROBE: "1",
  PROBE_EXECUTE: "1", AUTHORIZED_BY: "Jayden", ...TARGET,
  MAX_PRODUCTION_CONNECTION_ATTEMPTS: "1", MAX_DATABASE_SESSIONS: "1",
  MAX_SQL_STATEMENTS: "1", SQL_PAYLOAD: "SELECT_1_ONLY", MAX_WRITES: "0", MAX_RETRIES: "0",
  AUTOMATIC_RETRY: "false", MANUAL_RETRY_WITH_SAME_PROBE_ID: "false", REUSABLE: "false",
  CONSUMED_IMMEDIATELY_BEFORE_FIRST_EXTERNAL_DISPATCH: "true" });
const FILES = Object.freeze([
  "scripts/lib/p9-session-pooler-credential-handoff.mjs",
  "scripts/lib/p9-session-pooler-postfix-gate.mjs",
  "scripts/qa/p9-session-pooler-postfix-probe.mjs",
  "scripts/qa/p9-readonly-postgres-transport.mjs",
  "scripts/lib/p9-bounded-os-lookup.mjs",
]);
const TRANSPORT = "scripts/qa/p9-readonly-postgres-transport.mjs";
const fail = (reason) => { throw new Error(`P9_POSTFIX_GATE_${reason}`); };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (args) => {
  const result = spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8", shell: false,
    windowsHide: true, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) fail("REPOSITORY_UNKNOWN");
  return result.stdout.trim();
};

export function observeP9PostfixRepository() {
  let review, reviewBytes;
  try {
    reviewBytes = readFileSync(path.join(ROOT, REVIEW));
    review = JSON.parse(reviewBytes);
  } catch { fail("REVIEW_UNAVAILABLE"); }
  if (!review || Object.keys(review).sort().join(",") !== "files,psql,transportLineEndingCanonicalization,version"
    || review.version !== 1 || review.transportLineEndingCanonicalization !== "LF"
    || !review.files
    || Object.keys(review.files).sort().join(",") !== [...FILES].sort().join(","))
    fail("REVIEW_INVALID");
  if (!review.psql || Object.keys(review.psql).sort().join(",") !== "path,sha256"
    || !path.isAbsolute(review.psql.path ?? "")
    || !/^[a-f0-9]{64}$/.test(review.psql.sha256 ?? "")) fail("REVIEW_INVALID");
  for (const file of FILES) {
    if (!/^[a-f0-9]{64}$/.test(review.files[file] ?? "")) fail("REVIEW_INVALID");
    let actual;
    try {
      const bytes = readFileSync(path.join(ROOT, file));
      actual = sha(file === TRANSPORT ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n")) : bytes);
    } catch { fail("FILE_UNAVAILABLE"); }
    if (actual !== review.files[file]) fail("IMPLEMENTATION_DRIFT");
  }
  let psqlHash;
  try { psqlHash = sha(readFileSync(review.psql.path)); } catch { fail("PSQL_UNAVAILABLE"); }
  if (psqlHash !== review.psql.sha256) fail("PSQL_DRIFT");
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!path.isAbsolute(common)) fail("COMMON_DIR_INVALID");
  return Object.freeze({ head: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]),
    worktreeClean: git(["status", "--porcelain"]) === "",
    implementationSha256: review.files["scripts/qa/p9-session-pooler-postfix-probe.mjs"],
    reviewSha256: sha(reviewBytes), filesVerified: true, commonDir: common,
    psqlPath: review.psql.path });
}

export function createP9PostfixGate({ authorization, snapshot, now = Date.now(), testSentinelDir } = {}) {
  if (!authorization || Object.entries(FIXED).some(([key, value]) => authorization[key] !== value)
    || !/^p9-session-pooler-postfix-[0-9]{10,20}$/.test(authorization.PROBE_ID ?? "")
    || !/^[a-f0-9]{40}$/.test(authorization.SOURCE_HEAD ?? "")
    || !/^[a-f0-9]{64}$/.test(authorization.PROBE_IMPLEMENTATION_SHA256 ?? "")
    || !/^[a-f0-9]{64}$/.test(authorization.PROBE_REVIEW_SHA256 ?? "")) fail("AUTHORIZATION_INVALID");
  const at = authorization.AUTHORIZED_AT_UTC;
  const epoch = typeof at === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at)
    ? Date.parse(at) : NaN;
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== at
    || !Number.isFinite(now) || now - epoch > 15 * 60 * 1000 || epoch - now > 30 * 1000)
    fail("AUTHORIZATION_TIME_INVALID");
  if (snapshot?.branch !== BRANCH || snapshot.worktreeClean !== true || snapshot.filesVerified !== true
    || snapshot.head !== authorization.SOURCE_HEAD
    || snapshot.implementationSha256 !== authorization.PROBE_IMPLEMENTATION_SHA256
    || snapshot.reviewSha256 !== authorization.PROBE_REVIEW_SHA256
    || !path.isAbsolute(snapshot.commonDir ?? "")) fail("BINDING_DRIFT");
  if (testSentinelDir !== undefined && (!path.isAbsolute(testSentinelDir)
    || !path.resolve(testSentinelDir).startsWith(path.resolve(snapshot.commonDir) + path.sep)
      && path.resolve(testSentinelDir) !== path.resolve(snapshot.commonDir))) fail("TEST_DIR_INVALID");
  const directory = testSentinelDir ?? path.join(snapshot.commonDir, "ogh-p9-session-pooler-postfix-consumed");
  const sentinel = path.join(directory, authorization.PROBE_ID);
  let consumed = false;
  return Object.freeze({ consume() {
    if (consumed) fail("ALREADY_CONSUMED");
    try {
      mkdirSync(directory, { recursive: true });
      const fd = openSync(sentinel, "wx", 0o600);
      try { writeFileSync(fd, JSON.stringify({ PROBE_ID: authorization.PROBE_ID,
        SOURCE_HEAD: snapshot.head, CONSUMED_AT_UTC: new Date().toISOString() })); }
      finally { closeSync(fd); }
    } catch (error) {
      if (error?.code === "EEXIST") fail("ALREADY_CONSUMED");
      fail("SENTINEL_PERSIST_FAILED");
    }
    consumed = true;
  } });
}
