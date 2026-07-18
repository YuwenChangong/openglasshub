import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OAuthProfileReadinessError, OAUTH_PROFILE_MINIMUM_REMAINING_MS, validateOfflineWranglerOAuthProfile } from "./qa/cloudflare-pages-oauth-profile-readiness.mjs";
import { R6_METADATA_PREPARATION_SUCCESS, emitMetadataPreparationTerminalOutput, metadataPreparationTerminalLines, readHiddenCloudflareAccountId, runMetadataPreparationCli } from "./qa/run-cloudflare-pages-metadata-preparation.mjs";

const token = "test_token.value";
const now = Date.parse("2099-01-01T00:00:00.000Z");
const temp = await mkdtemp(path.join(os.tmpdir(), "r6-oauth-guard-"));
const appData = path.join(temp, "appdata");
const profileRoot = path.join(appData, "xdg.config", ".wrangler");
const profilePath = path.join(profileRoot, "config", "default.toml");
const repo = path.join(temp, "repo");
const options = { home: path.join(temp, "no-legacy"), appData, now: () => now };
const expect = async (code, callback) => await assert.rejects(callback, (error) => error instanceof OAuthProfileReadinessError && error.code === code);
const args = ["--operation", "PREPARE_AUTH_DRY_RUN_ATTESTATION", "--repository-root", repo, "--attestation-root", path.join(temp, "attestations"), "--registry-root", path.join(temp, "registry"), "--journal-root", path.join(temp, "journals"), "--evidence-root", path.join(temp, "evidence"), "--wrapper-path", "C:\\safe\\wrapper.ps1", "--execution-worktree", "C:\\safe\\execution", "--tooling-commit", "a".repeat(40), "--wrapper-sha256", "b".repeat(64), "--transport-sha256", "c".repeat(64), "--parser-selector-sha256", "d".repeat(64), "--deployment-id", "6f11bcf1-65a7-4e9c-aa25-30ec1fd7fb8a", "--source-commit", "b9ec4a06fb4aa67d7963c5d53ccc91e5c3965ed6"];
try {
  await mkdir(path.dirname(profilePath), { recursive: true }); await mkdir(repo, { recursive: true });
  await writeFile(profilePath, `oauth_token = "${token}"\nexpiration_time = "2099-01-01T00:06:00.000Z"\n`);
  const valid = await validateOfflineWranglerOAuthProfile(options);
  assert.equal(valid.classification, "R6_OAUTH_PROFILE_READY_OFFLINE"); assert.equal(valid.remainingValidityMilliseconds, 6 * 60 * 1000);
  await writeFile(profilePath, `oauth_token = "${token}"\nrefresh_token = "refresh-capability"\nexpiration_time = "2099-01-01T00:06:00.000Z"\n`);
  const validWithRefresh = await validateOfflineWranglerOAuthProfile(options);
  assert.equal(validWithRefresh.classification, "R6_OAUTH_PROFILE_READY_OFFLINE"); assert.equal(validWithRefresh.hasRefreshCapability, true);
  await writeFile(profilePath, `oauth_token = "${token}"\nrefresh_token = "refresh-capability"\nscopes = ["account:read", "pages:read"]\nexpiration_time = "2099-01-01T00:06:00.000Z"\n`);
  assert.equal((await validateOfflineWranglerOAuthProfile(options)).classification, "R6_OAUTH_PROFILE_READY_OFFLINE");
  await writeFile(profilePath, `oauth_token = "${token}"\n`); await expect("R6_OAUTH_PROFILE_EXPIRY_UNPROVEN", () => validateOfflineWranglerOAuthProfile(options));
  await writeFile(profilePath, `oauth_token = "${token}"\nexpiration_time = null\n`); await expect("R6_OAUTH_PROFILE_EXPIRY_UNPROVEN", () => validateOfflineWranglerOAuthProfile(options));
  await writeFile(profilePath, `oauth_token = "${token}"\nexpiration_time = "not-a-date"\n`); await expect("R6_OAUTH_PROFILE_EXPIRY_UNPROVEN", () => validateOfflineWranglerOAuthProfile(options));
  await writeFile(profilePath, `oauth_token = "${token}"\nexpiration_time = "2099-01-01T00:00:00.000Z"\n`); await expect("R6_OAUTH_PROFILE_EXPIRED", () => validateOfflineWranglerOAuthProfile(options));
  await writeFile(profilePath, `oauth_token = "${token}"\nexpiration_time = "2099-01-01T00:04:59.999Z"\n`); await expect("R6_OAUTH_PROFILE_INSUFFICIENT_REMAINING_VALIDITY", () => validateOfflineWranglerOAuthProfile(options));
  await writeFile(profilePath, `oauth_token = "${token}"\nexpiration_time = "2099-01-01T00:05:00.000Z"\n`); assert.equal((await validateOfflineWranglerOAuthProfile(options)).remainingValidityMilliseconds, OAUTH_PROFILE_MINIMUM_REMAINING_MS);
  await writeFile(profilePath, `oauth_token = "${token}"\nrefresh_token = "refresh-capability"\nexpiration_time = "2099-01-01T00:00:00.000Z"\n`); await expect("R6_OAUTH_PROFILE_REFRESH_REQUIRED", () => validateOfflineWranglerOAuthProfile(options));
  await writeFile(profilePath, `oauth_token = "${token}"\nrefresh_token = "refresh-capability"\nexpiration_time = "2099-01-01T00:04:59.999Z"\n`); await expect("R6_OAUTH_PROFILE_REFRESH_REQUIRED", () => validateOfflineWranglerOAuthProfile(options));
  await writeFile(profilePath, `oauth_token = "${token}"\nrefresh_token = { invalid = true }\nexpiration_time = "2099-01-01T00:06:00.000Z"\n`); await expect("R6_OAUTH_PROFILE_FORMAT_INVALID", () => validateOfflineWranglerOAuthProfile(options));
  await writeFile(profilePath, `profile_version = "2"\noauth_token = "${token}"\nexpiration_time = "2099-01-01T00:06:00.000Z"\n`); await expect("R6_OAUTH_PROFILE_FORMAT_INVALID", () => validateOfflineWranglerOAuthProfile(options));

  let prompts = 0; let requests = 0;
  for (const [innerCode, outerCode] of [
    ["R6_OAUTH_PROFILE_REFRESH_REQUIRED", "R6_METADATA_PREPARATION_OAUTH_PROFILE_NOT_READY"],
    ["R6_OAUTH_PROFILE_EXPIRED", "R6_METADATA_PREPARATION_OAUTH_PROFILE_EXPIRED"],
    ["R6_OAUTH_PROFILE_INSUFFICIENT_REMAINING_VALIDITY", "R6_METADATA_PREPARATION_OAUTH_PROFILE_VALIDITY_INSUFFICIENT"],
    ["R6_OAUTH_PROFILE_EXPIRY_UNPROVEN", "R6_METADATA_PREPARATION_OAUTH_PROFILE_NOT_READY"],
    ["R6_OAUTH_PROFILE_FORMAT_INVALID", "R6_METADATA_PREPARATION_OAUTH_PROFILE_NOT_READY"],
    ["R6_OAUTH_PROFILE_CONFLICTING", "R6_METADATA_PREPARATION_OAUTH_PROFILE_NOT_READY"],
  ]) {
    await assert.rejects(runMetadataPreparationCli(args, { oauthProfileValidator: async () => { throw Object.assign(new Error(innerCode), { code: innerCode }); }, accountResolver: async () => { prompts += 1; }, secureInput: async () => { prompts += 1; } }), (error) => error.code === outerCode && error.innerCode === innerCode);
  }
  assert.equal(prompts, 0, "not-ready OAuth states must fail before account resolution or prompt"); assert.equal(requests, 0);
  const result = await runMetadataPreparationCli(args, {
    oauthProfileValidator: async () => ({ token, expiresAt: "2099-01-01T00:06:00.000Z", hasRefreshCapability: true, classification: "R6_OAUTH_PROFILE_READY_OFFLINE" }),
    accountResolver: async ({ requestHiddenInput }) => ({ accountId: await requestHiddenInput(), accountIdSha256: "f".repeat(64), classification: "PAGES_ACCOUNT_ID_RESOLVED_HIDDEN_INPUT" }),
    secureInput: async () => { prompts += 1; return "a".repeat(32); },
    prepare: async ({ auth, resolvedAccount, assertOAuthReady }) => { assertOAuthReady(); requests += 1; assert.equal(auth.token, token); assert.equal(resolvedAccount.accountId, "a".repeat(32)); return { attestation: { path: "C:\\safe\\attestation.json", sha256: "f".repeat(64), observedAt: "2099-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:15:00.000Z" }, remainingValidityMilliseconds: 14 * 60 * 1000, dryRunId: "qa-canary-11111111-1111-4111-8111-111111111111", commands: { authCheckOnly: "auth", dryRunOnly: "dry" } }; },
  });
  assert.equal(result.classification, R6_METADATA_PREPARATION_SUCCESS); assert.equal(prompts, 1); assert.equal(requests, 1);
  const terminalLines = metadataPreparationTerminalLines(result);
  assert.deepEqual(terminalLines, [R6_METADATA_PREPARATION_SUCCESS, "auth", "dry"]);
  const emitted = []; emitMetadataPreparationTerminalOutput(result, { write: (line) => emitted.push(line) });
  assert.deepEqual(emitted, [`${R6_METADATA_PREPARATION_SUCCESS}\n`, "auth\n", "dry\n"], "successful terminal output must be ordered and contain only the stable classification plus two safe commands");
  assert.throws(() => metadataPreparationTerminalLines({ classification: R6_METADATA_PREPARATION_SUCCESS, commands: { authCheckOnly: "auth", dryRunOnly: "ExecuteApprovedPhase" } }), /R6_HARDENED_OFFICIAL_GET_METADATA_PREPARATION_INVALID/);

  const promptCountBeforeExpiry = prompts;
  await assert.rejects(runMetadataPreparationCli(args, {
    oauthProfileValidator: async () => ({ token, expiresAt: "2099-01-01T00:06:00.000Z", hasRefreshCapability: false, classification: "R6_OAUTH_PROFILE_READY_OFFLINE" }),
    accountResolver: async ({ requestHiddenInput }) => ({ accountId: await requestHiddenInput(), accountIdSha256: "f".repeat(64), classification: "PAGES_ACCOUNT_ID_RESOLVED_HIDDEN_INPUT" }),
    secureInput: async () => { prompts += 1; return "a".repeat(32); },
    prepare: async ({ auth, assertOAuthReady }) => { auth.expiresAt = "2000-01-01T00:00:00.000Z"; assertOAuthReady(); requests += 1; },
  }), (error) => error.code === "R6_METADATA_PREPARATION_OAUTH_PROFILE_EXPIRED" && error.innerCode === "R6_OAUTH_PROFILE_EXPIRED");
  assert.equal(prompts, promptCountBeforeExpiry + 1, "credential expiry after account resolution must not prompt a second time");
  assert.equal(requests, 1, "credential expiry immediately before request must prevent fake HTTP");

  const input = new EventEmitter(); input.isTTY = true; const rawStates = []; input.setRawMode = (value) => rawStates.push(value); input.resume = () => {};
  const writes = []; const output = { isTTY: true, write: (value) => writes.push(value) };
  const hidden = readHiddenCloudflareAccountId({ input, output }); process.nextTick(() => input.emit("data", Buffer.from(`${"a".repeat(32)}\r`)));
  assert.equal(await hidden, "a".repeat(32)); assert.deepEqual(rawStates, [true, false]); assert.equal(writes.join("").includes("a".repeat(32)), false);
  await assert.rejects(readHiddenCloudflareAccountId({ input: { isTTY: false }, output }), /R6_METADATA_PREPARATION_ACCOUNT_PROMPT_BLOCKED/);
  console.log("R6_METADATA_PREPROMPT_OAUTH_GUARD_OK offline profile readiness, zero-prompt failures, CLI ordering, hidden TTY input, and zero-network fake execution passed");
} finally { await rm(temp, { recursive: true, force: true }); }
