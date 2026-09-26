import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NO_HOSTED = /^(?:SUPABASE_|P9_|CLOUDFLARE_|CF_|BREVO_|WRANGLER_|DATABASE_URL$|PG(?:HOST|PORT|USER|PASSWORD|DATABASE|SERVICE|SSLMODE)$|RELEASE_B_)/i;
const KEEP = /^(?:PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|APPDATA|LOCALAPPDATA|USERPROFILE|HOME)$/i;
const fail = (reason) => { throw new Error(`CUTOVER_PROOF_INCOMPLETE:${reason}`); };

if (process.argv.length !== 2) fail("CACHED_PROOF_OR_EXTRA_ARGUMENT_REFUSED");
for (const name of Object.keys(process.env)) if (NO_HOSTED.test(name)) fail("HOSTED_ENV_PRESENT");
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => KEEP.test(name)));
Object.assign(env, { CI: "1", NO_UPDATE_NOTIFIER: "1", WRANGLER_SEND_METRICS: "false",
  SUPABASE_ACCESS_TOKEN: "", SUPABASE_PROJECT_REF: "", SUPABASE_DB_URL: "" });

const migrationNames = readdirSync(path.join(ROOT, "supabase/migrations"))
  .filter((name) => /20260923|20260925/.test(name)).sort();
const expected = [
  "20260923000000_ogh_verified_session_v1_foundation.sql",
  "20260925012231_ogh_verified_session_v1_enforcement.sql",
];
assert.deepEqual(migrationNames, expected, "CUTOVER_PROOF_INCOMPLETE:MIGRATION_PAIR_DRIFT");
const readiness = readFileSync(path.join(ROOT, "docs/ops/verified-session-v1-hosted-readiness.md"), "utf8");
for (const name of expected) {
  const digest = createHash("sha256").update(readFileSync(path.join(ROOT, "supabase/migrations", name))).digest("hex");
  if (!readiness.includes(digest)) fail("ARTIFACT_SHA256_DRIFT");
}
if (!readiness.includes("HOSTED_READINESS_STATUS=READY_FOR_BOUNDED_HOSTED_AUTHORIZATION")
  || !readiness.includes("AUTH_RELEASE_STATUS=NO_GO")) fail("RELEASE_STATUS_DRIFT");

function run(label, program, args, markers) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: ROOT, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
      output += chunk.toString();
      if (output.length > 4_000_000) child.kill();
    });
    child.on("error", () => reject(new Error(`CUTOVER_PROOF_INCOMPLETE:${label}_SPAWN`)));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`CUTOVER_PROOF_INCOMPLETE:${label}_EXIT_${code}`));
      if (!markers.every((marker) => marker.test(output)))
        return reject(new Error(`CUTOVER_PROOF_INCOMPLETE:${label}_MARKER`));
      console.log(`CUTOVER_${label}=PASS CURRENT_RUN=true`);
      resolve(output);
    });
  });
}

const node = process.execPath;
const npm = (args) => process.platform === "win32"
  ? [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npm ${args.join(" ")}`]]
  : ["npm", args];

const sqlSource = readFileSync(path.join(ROOT, "scripts/test-verified-session-sql.mjs"), "utf8");
if (!sqlSource.includes("verifyOldNewEquivalence(client")
  || !sqlSource.includes('classifyVerifiedSessionDbStage(currentSnapshot, REVIEWED_LOCAL_STAGE_DIGESTS) === "ENFORCEMENT"'))
  fail("FINAL_EQUIVALENCE_ASSERTION_MISSING");
await run("SQL", node, ["scripts/test-verified-session-sql.mjs"],
  [/PASS verified session SQL:.*Enforcement replay/, /PASS verified session bypass/i]);
console.log("CUTOVER_FINAL_CATALOG_EQUIVALENCE=PASS CURRENT_RUN=true");
await run("MATRIX", node, ["scripts/test-verified-session-cutover-matrix.mjs", "--all"],
  [/MATRIX_A=PASS /, /MATRIX_B=PASS /, /MATRIX_C=PASS /, /MATRIX_D=PASS /,
    /MATRIX_C_D=PASS .*SAME_WORKER_ARTIFACT=true/, /MATRIX_ALL=PASS STATES=A,B,C,D,C-D CURRENT_RUN=true/,
    /MATRIX_C=PASS .*VERIFIED_SESSION_FULLY_ACTIVE=false/,
    /MATRIX_D=PASS .*DIRECT_BYPASS_DENIED=PASS/]);
await run("CLASSIFIER", node, ["scripts/test-verified-session-db-stage.mjs"],
  [/PASS verified session DB stage classifier: exact A\/B\/D and drift refusal/]);
await run("PAIRING", node, ["scripts/test-verified-session-cutover-guard.mjs"],
  [/PASS Worker\/DB pairing guard: A\/B\/C\/D allowed, forbidden pairs and identity drift denied; C entry evidence gated/]);
await run("C_WINDOW", node, ["scripts/test-verified-session-c-window.mjs"],
  [/PASS C-window integrity, bounded exit and exact suspect-row reentry guard/]);
await run("RELEASE", node, ["scripts/test-verified-session-release.mjs"],
  [/PASS verified-session release packet:/]);
const [npmTestExe, npmTestArgs] = npm(["test"]);
await run("NPM_TEST", npmTestExe, npmTestArgs, [/PASS|passed|Tests:/i]);
const [npmBuildExe, npmBuildArgs] = npm(["run", "build"]);
await run("BUILD", npmBuildExe, npmBuildArgs, [/build|complete|generated/i]);
console.log("CUTOVER_FINAL=PASS LOCAL_ONLY=true PRODUCTION_CONNECTIONS=0 HOSTED_ACTIONS=0 AUTH_RELEASE_STATUS=NO_GO");
