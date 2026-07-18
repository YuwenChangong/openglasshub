import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareFixedPagesDeploymentMetadata } from "./qa/prepare-cloudflare-pages-deployment-get.mjs";

const accountId = "a".repeat(32);
const deploymentId = "6f11bcf1-65a7-4e9c-aa25-30ec1fd7fb8a";
const sourceCommit = "b9ec4a06fb4aa67d7963c5d53ccc91e5c3965ed6";
const temp = await mkdtemp(path.join(os.tmpdir(), "pages-metadata-preparation-"));
let networkCalls = 0;
try {
  await mkdir(path.join(temp, "repo"), { recursive: true });
  await writeFile(path.join(temp, "repo", "wrangler.toml"), `account_id = "${accountId}"\n`);
  const result = await prepareFixedPagesDeploymentMetadata({
    repositoryRoot: path.join(temp, "repo"), deploymentId, sourceCommit,
    auth: { token: "test_token.value" }, environment: {},
    fetchImpl: async (url, init) => {
      networkCalls += 1;
      assert.equal(init.method, "GET");
      assert.equal(new URL(url).search, "");
      return new Response(JSON.stringify({ success: true, errors: [], result: {
        id: deploymentId, project_name: "openglasshub", environment: "production", url: "https://6f11bcf1.openglasshub.pages.dev/",
        aliases: ["https://openglasshub.pages.dev"], deployment_trigger: { metadata: { branch: "main", commit_hash: sourceCommit } },
        latest_stage: { name: "deploy", status: "success" }, is_skipped: false,
      } }), { status: 200 });
    },
  });
  assert.equal(networkCalls, 1);
  assert.equal(result.accountSource.classification, "PAGES_ACCOUNT_ID_RESOLVED_LOCAL_CONFIG");
  assert.equal(JSON.stringify(result).includes(accountId), false, "sanitized preparation output never includes the account ID");
  console.log("PAGES_METADATA_PREPARATION_OK fake fixed GET accepts only in-process routing and returns sanitized deployment evidence");
} finally { await rm(temp, { recursive: true, force: true }); }
