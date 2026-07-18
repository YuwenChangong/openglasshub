import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  inventoryPagesAccountSources,
  PagesAccountIdResolverError,
  resolvePagesAccountId,
} from "./qa/cloudflare-pages-account-resolver.mjs";

const accountA = "a".repeat(32);
const accountB = "b".repeat(32);
const temp = await mkdtemp(path.join(os.tmpdir(), "pages-account-resolver-"));
const repo = path.join(temp, "repo");
const home = path.join(temp, "home");
const appData = path.join(temp, "appdata");
const wrangler = path.join(appData, "xdg.config", ".wrangler");
const resolve = (options = {}) => resolvePagesAccountId({ repositoryRoot: repo, home, appData, ...options });
const reject = async (code, options) => assert.rejects(resolve(options), (error) => error instanceof PagesAccountIdResolverError && error.code === code);

try {
  const resolverSource = await readFile(new URL("./qa/cloudflare-pages-account-resolver.mjs", import.meta.url), "utf8");
  assert.equal(resolverSource.includes("process.argv"), false, "account ID is never accepted through command-line arguments");
  assert.equal(resolverSource.includes("CLOUDFLARE_ACCOUNT_ID"), false, "ambient account-ID environment is intentionally excluded");
  assert.equal(resolverSource.includes("console."), false, "resolver cannot echo account IDs");
  await mkdir(repo, { recursive: true });
  await mkdir(path.join(wrangler, "config"), { recursive: true });
  await writeFile(path.join(wrangler, "config", "default.toml"), 'oauth_token = "test_token.value"\nexpiration_time = "2099-01-01T00:00:00.000Z"\n');

  await writeFile(path.join(repo, "wrangler.toml"), `account_id = "${accountA}"\n`);
  let result = await resolve();
  assert.equal(result.classification, "PAGES_ACCOUNT_ID_RESOLVED_LOCAL_CONFIG");
  assert.equal(result.accountId, accountA);
  assert.equal(JSON.stringify(result).includes(accountA), true, "resolver returns only in-process value and caller must redact before evidence");

  await rm(path.join(repo, "wrangler.toml"));
  result = await resolve({ requestHiddenInput: async () => accountA });
  assert.equal(result.classification, "PAGES_ACCOUNT_ID_RESOLVED_HIDDEN_INPUT");
  assert.equal(result.accountId, accountA);
  await reject("PAGES_ACCOUNT_ID_FORMAT_INVALID", { requestHiddenInput: async () => "not-an-account" });
  await reject("PAGES_ACCOUNT_ID_SOURCE_ABSENT", { requestHiddenInput: async () => null });

  await writeFile(path.join(wrangler, "wrangler-account.json"), JSON.stringify({ account: { id: accountA } }));
  result = await resolve();
  assert.equal(result.classification, "PAGES_ACCOUNT_ID_RESOLVED_EXISTING_CACHE");
  assert.equal(result.accountId, accountA);
  assert.equal(await readFile(path.join(wrangler, "wrangler-account.json"), "utf8"), JSON.stringify({ account: { id: accountA } }), "resolver never writes a cache");
  await writeFile(path.join(repo, "wrangler.toml"), `account_id = "${accountA}"\n`);
  result = await resolve();
  assert.equal(result.classification, "PAGES_ACCOUNT_ID_RESOLVED_LOCAL_CONFIG");
  await reject("PAGES_ACCOUNT_ID_INPUT_MISMATCH", { suppliedHiddenInput: accountB });
  await writeFile(path.join(repo, "wrangler.toml"), `account_id = "${accountB}"\n`);
  await reject("PAGES_ACCOUNT_ID_SOURCES_CONFLICT");
  await rm(path.join(repo, "wrangler.toml"));
  await writeFile(path.join(wrangler, "pages.json"), JSON.stringify({ account_id: accountB }));
  await reject("PAGES_ACCOUNT_ID_SOURCES_CONFLICT");
  await rm(path.join(wrangler, "pages.json"));
  await writeFile(path.join(wrangler, "wrangler-account.json"), JSON.stringify({ account: { id: accountB } }));
  result = await resolve();
  assert.equal(result.classification, "PAGES_ACCOUNT_ID_RESOLVED_EXISTING_CACHE");

  await rm(path.join(wrangler, "wrangler-account.json"));
  const inventory = await inventoryPagesAccountSources({ repositoryRoot: repo, home, appData });
  assert.equal(inventory.localConfig, "ABSENT");
  assert.equal(inventory.oauthProfile, "SECRET_MATERIAL_NOT_ACCOUNT_SOURCE");
  assert.equal(inventory.existingCache, "ABSENT");
  assert.equal(inventory.environmentAcceptedByResolver, false);
  await reject("PAGES_ACCOUNT_ID_SOURCE_ABSENT");
  console.log("PAGES_ACCOUNT_ID_RESOLVER_OK local-config, active-profile-bound caches, hidden fallback, conflicts, absence, and no-cache-creation passed without output or network");
} finally {
  await rm(temp, { recursive: true, force: true });
}
