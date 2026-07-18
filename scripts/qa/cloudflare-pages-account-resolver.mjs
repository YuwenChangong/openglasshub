import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const PAGES_ACCOUNT_ID_RESOLVER_VERSION = "cloudflare-pages-account-resolver-v1";
export const PAGES_ACCOUNT_ID_FORMAT = /^[a-f0-9]{32}$/;

export class PagesAccountIdResolverError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fail = (code) => { throw new PagesAccountIdResolverError(code); };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function normalizeCloudflareAccountId(value) {
  if (typeof value !== "string") fail("PAGES_ACCOUNT_ID_FORMAT_INVALID");
  const normalized = value.trim().toLowerCase();
  if (!PAGES_ACCOUNT_ID_FORMAT.test(normalized)) fail("PAGES_ACCOUNT_ID_FORMAT_INVALID");
  return normalized;
}

export function summarizeAccountId(accountId) {
  return { accountIdSha256: hash(normalizeCloudflareAccountId(accountId)) };
}

async function regularFile(candidate, readFileImpl = readFile) {
  try {
    const info = await lstat(candidate);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    return await readFileImpl(candidate, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail("PAGES_ACCOUNT_ID_RESOLUTION_FAILED");
  }
}

async function regularDirectory(candidate) {
  try {
    const info = await lstat(candidate);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch { return false; }
}

export async function getWranglerStatePaths({ home = os.homedir(), appData = process.env.APPDATA } = {}) {
  const legacy = path.join(home, ".wrangler");
  const xdg = typeof appData === "string" && appData.length > 0 ? path.join(appData, "xdg.config", ".wrangler") : null;
  const root = await regularDirectory(legacy) ? legacy : xdg;
  if (!root || !(await regularDirectory(root))) return null;
  return {
    root,
    oauthProfile: path.join(root, "config", "default.toml"),
    accountCache: path.join(root, "wrangler-account.json"),
    pagesCache: path.join(root, "pages.json"),
  };
}

function tomlAccountId(text) {
  const matches = [...text.matchAll(/^(?:account_id)\s*=\s*"([^"\r\n]+)"\s*(?:#.*)?$/gm)];
  if (matches.length === 0) return null;
  if (matches.length !== 1) fail("PAGES_ACCOUNT_ID_RESOLUTION_FAILED");
  return normalizeCloudflareAccountId(matches[0][1]);
}

function jsonAccountId(text, jsonc = false) {
  if (!jsonc) {
    let value;
    try { value = JSON.parse(text); } catch { fail("PAGES_ACCOUNT_ID_RESOLUTION_FAILED"); }
    if (value === null || typeof value !== "object" || Array.isArray(value) || !own(value, "account_id")) return null;
    return normalizeCloudflareAccountId(value.account_id);
  }
  // JSONC is accepted only for a single, unambiguous top-level scalar. This resolver never implements a permissive config parser.
  const matches = [...text.matchAll(/^\s*"account_id"\s*:\s*"([^"\r\n]+)"\s*,?\s*(?:\/\/.*)?$/gm)];
  if (matches.length === 0) return null;
  if (matches.length !== 1) fail("PAGES_ACCOUNT_ID_RESOLUTION_FAILED");
  return normalizeCloudflareAccountId(matches[0][1]);
}

export async function readProjectLocalAccountId({ repositoryRoot, readFileImpl = readFile } = {}) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) fail("PAGES_ACCOUNT_ID_RESOLUTION_FAILED");
  const candidates = [
    ["wrangler.json", (text) => jsonAccountId(text)],
    ["wrangler.jsonc", (text) => jsonAccountId(text, true)],
    ["wrangler.toml", tomlAccountId],
  ];
  const found = [];
  for (const [name, parse] of candidates) {
    const text = await regularFile(path.join(repositoryRoot, name), readFileImpl);
    if (text === null) continue;
    const accountId = parse(text);
    if (accountId) found.push({ source: "local-config", accountId, path: name });
  }
  const ids = new Set(found.map((entry) => entry.accountId));
  if (ids.size > 1) fail("PAGES_ACCOUNT_ID_SOURCES_CONFLICT");
  return found[0] ?? null;
}

function cacheAccountId(text, kind) {
  let cache;
  try { cache = JSON.parse(text); } catch { fail("PAGES_ACCOUNT_ID_RESOLUTION_FAILED"); }
  const value = kind === "wrangler-account" ? cache?.account?.id : cache?.account_id;
  if (value === undefined) return null;
  return normalizeCloudflareAccountId(value);
}

export async function readExistingWranglerAccountCaches({ home, appData, readFileImpl = readFile } = {}) {
  const paths = await getWranglerStatePaths({ home, appData });
  if (!paths) return [];
  const profileText = await regularFile(paths.oauthProfile, readFileImpl);
  // A cache without a regular default profile cannot be tied to the active local Wrangler state.
  if (profileText === null || !/^oauth_token\s*=\s*"[A-Za-z0-9._~-]+"\s*$/m.test(profileText)) return [];
  const candidates = [];
  for (const [candidate, kind] of [[paths.accountCache, "wrangler-account"], [paths.pagesCache, "pages"]]) {
    const text = await regularFile(candidate, readFileImpl);
    if (text === null) continue;
    const accountId = cacheAccountId(text, kind);
    if (accountId) candidates.push({ source: "existing-cache", cacheKind: kind, accountId });
  }
  const ids = new Set(candidates.map((entry) => entry.accountId));
  if (ids.size > 1) fail("PAGES_ACCOUNT_ID_SOURCES_CONFLICT");
  return candidates;
}

function distinctLocalSources(candidates) {
  const ids = new Set(candidates.map((entry) => entry.accountId));
  if (ids.size > 1) fail("PAGES_ACCOUNT_ID_SOURCES_CONFLICT");
  return candidates[0] ?? null;
}

export async function resolvePagesAccountId({ repositoryRoot, home, appData, requestHiddenInput = null, suppliedHiddenInput = undefined, readFileImpl = readFile } = {}) {
  const localConfig = await readProjectLocalAccountId({ repositoryRoot, readFileImpl });
  const caches = await readExistingWranglerAccountCaches({ home, appData, readFileImpl });
  const selected = distinctLocalSources([...(localConfig ? [localConfig] : []), ...caches]);
  let hidden = suppliedHiddenInput;
  if (selected && hidden !== undefined && hidden !== null && normalizeCloudflareAccountId(hidden) !== selected.accountId) fail("PAGES_ACCOUNT_ID_INPUT_MISMATCH");
  if (selected) {
    return { classification: selected.source === "local-config" ? "PAGES_ACCOUNT_ID_RESOLVED_LOCAL_CONFIG" : "PAGES_ACCOUNT_ID_RESOLVED_EXISTING_CACHE", ...summarizeAccountId(selected.accountId), accountId: selected.accountId };
  }
  if (hidden === undefined && typeof requestHiddenInput === "function") hidden = await requestHiddenInput();
  if (hidden === undefined || hidden === null) fail("PAGES_ACCOUNT_ID_SOURCE_ABSENT");
  const accountId = normalizeCloudflareAccountId(hidden);
  return { classification: "PAGES_ACCOUNT_ID_RESOLVED_HIDDEN_INPUT", ...summarizeAccountId(accountId), accountId };
}

export async function inventoryPagesAccountSources(options = {}) {
  const config = await readProjectLocalAccountId(options);
  const caches = await readExistingWranglerAccountCaches(options);
  const paths = await getWranglerStatePaths(options);
  return {
    resolverVersion: PAGES_ACCOUNT_ID_RESOLVER_VERSION,
    localConfig: config ? "SOURCE_PROVEN_TRUSTED_LOCAL" : "ABSENT",
    oauthProfile: paths && await regularFile(paths.oauthProfile, options.readFileImpl ?? readFile) !== null ? "SECRET_MATERIAL_NOT_ACCOUNT_SOURCE" : "ABSENT",
    existingCache: caches.length > 0 ? "SOURCE_PROVEN_BUT_OPTIONAL" : "ABSENT",
    environmentAccountId: "SOURCE_PROVEN_BUT_OPTIONAL",
    environmentAcceptedByResolver: false,
  };
}
