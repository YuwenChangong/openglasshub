import { lstat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getWranglerStatePaths } from "./cloudflare-pages-account-resolver.mjs";

export const OAUTH_PROFILE_MINIMUM_REMAINING_MS = 5 * 60 * 1000;
const MAX_PROFILE_BYTES = 64 * 1024;
const TOKEN = /^[A-Za-z0-9._~-]+$/;
const WRANGLER_EXPIRY_ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const WRANGLER_LEGACY_EXPIRY_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/;

export class OAuthProfileReadinessError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const fail = (code) => { throw new OAuthProfileReadinessError(code); };
const inside = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

async function regularFile(candidate, lstatImpl) {
  try {
    const info = await lstatImpl(candidate);
    if (!info.isFile() || info.isSymbolicLink()) fail("R6_OAUTH_PROFILE_PATH_UNSAFE");
    if (!Number.isSafeInteger(info.size) || info.size <= 0 || info.size > MAX_PROFILE_BYTES) fail("R6_OAUTH_PROFILE_FORMAT_INVALID");
    return info;
  } catch (error) {
    if (error?.code === "ENOENT") fail("R6_OAUTH_PROFILE_ABSENT");
    if (error instanceof OAuthProfileReadinessError) throw error;
    fail("R6_OAUTH_PROFILE_PATH_UNSAFE");
  }
}

function oneMatch(text, expression, missingCode, invalidCode) {
  const matches = [...text.matchAll(expression)];
  if (matches.length === 0) fail(missingCode);
  if (matches.length !== 1) fail(invalidCode);
  return matches[0][1];
}

function optionalRefreshCapability(text) {
  const declared = /^\s*refresh_token\s*=/m.test(text);
  const matches = [...text.matchAll(/^\s*refresh_token\s*=\s*"([^"\r\n]*)"\s*$/gm)];
  if (!declared) return false;
  // Wrangler persists this optional field as a TOML string. Reject an ambiguous
  // declaration rather than treating malformed capability metadata as a refresh request.
  if (matches.length !== 1) fail("R6_OAUTH_PROFILE_FORMAT_INVALID");
  return matches[0][1].length > 0;
}

function parseWranglerExpiryUtc(expiry) {
  if (typeof expiry !== "string") fail("R6_OAUTH_PROFILE_EXPIRY_UNPROVEN");
  if (!WRANGLER_EXPIRY_ISO_UTC.test(expiry) && !WRANGLER_LEGACY_EXPIRY_UTC.test(expiry)) fail("R6_OAUTH_PROFILE_EXPIRY_UNPROVEN");
  const expiresAt = Date.parse(expiry);
  if (!Number.isSafeInteger(expiresAt)) fail("R6_OAUTH_PROFILE_EXPIRY_UNPROVEN");
  const canonical = new Date(expiresAt).toISOString();
  const valid = WRANGLER_EXPIRY_ISO_UTC.test(expiry)
    ? canonical === expiry
    : canonical === expiry.replace("+00:00", ".000Z");
  if (!valid) fail("R6_OAUTH_PROFILE_EXPIRY_UNPROVEN");
  return expiresAt;
}

/** Rechecks the access credential immediately before any future provider request. */
export function assertOfflineOAuthProfileReady(profile, { now = () => Date.now() } = {}) {
  const expiresAt = Date.parse(profile?.expiresAt);
  if (!Number.isSafeInteger(expiresAt)) fail("R6_OAUTH_PROFILE_EXPIRY_UNPROVEN");
  const remainingValidityMilliseconds = expiresAt - now();
  if (remainingValidityMilliseconds <= 0) fail(profile.hasRefreshCapability ? "R6_OAUTH_PROFILE_REFRESH_REQUIRED" : "R6_OAUTH_PROFILE_EXPIRED");
  if (remainingValidityMilliseconds < OAUTH_PROFILE_MINIMUM_REMAINING_MS) fail(profile.hasRefreshCapability ? "R6_OAUTH_PROFILE_REFRESH_REQUIRED" : "R6_OAUTH_PROFILE_INSUFFICIENT_REMAINING_VALIDITY");
  return remainingValidityMilliseconds;
}

async function findConflictingProfile({ home, appData, selectedPath, lstatImpl }) {
  const roots = [path.join(home, ".wrangler")];
  if (typeof appData === "string" && appData.length > 0) roots.push(path.join(appData, "xdg.config", ".wrangler"));
  const candidates = roots.map((root) => path.join(root, "config", "default.toml"));
  let found = 0;
  for (const candidate of candidates) {
    try {
      const info = await lstatImpl(candidate);
      if (info.isFile() && !info.isSymbolicLink()) found += 1;
    } catch (error) {
      if (error?.code !== "ENOENT") fail("R6_OAUTH_PROFILE_PATH_UNSAFE");
    }
  }
  if (found > 1 || !candidates.includes(selectedPath)) fail("R6_OAUTH_PROFILE_CONFLICTING");
}

/** Validates only local Wrangler OAuth material; it never contacts Cloudflare or refreshes a credential. */
export async function validateOfflineWranglerOAuthProfile({
  home = os.homedir(), appData = process.env.APPDATA, now = () => Date.now(),
  getPaths = getWranglerStatePaths, lstatImpl = lstat, readFileImpl = readFile,
} = {}) {
  const paths = await getPaths({ home, appData });
  if (!paths || !inside(paths.root, paths.oauthProfile)) fail("R6_OAUTH_PROFILE_ABSENT");
  await findConflictingProfile({ home, appData, selectedPath: paths.oauthProfile, lstatImpl });
  await regularFile(paths.oauthProfile, lstatImpl);
  let text;
  try { text = await readFileImpl(paths.oauthProfile, "utf8"); }
  catch { fail("R6_OAUTH_PROFILE_PATH_UNSAFE"); }
  if (typeof text !== "string" || text.includes("\u0000")) fail("R6_OAUTH_PROFILE_FORMAT_INVALID");
  const version = [...text.matchAll(/^\s*profile_version\s*=\s*"([^"\r\n]+)"\s*$/gm)];
  if (version.length > 1 || (version.length === 1 && version[0][1] !== "1")) fail("R6_OAUTH_PROFILE_FORMAT_INVALID");
  const token = oneMatch(text, /^\s*oauth_token\s*=\s*"([^"\r\n]+)"\s*$/gm, "R6_OAUTH_PROFILE_REQUIRED_FIELD_MISSING", "R6_OAUTH_PROFILE_FORMAT_INVALID");
  const expiry = oneMatch(text, /^\s*expiration_time\s*=\s*"([^"\r\n]+)"\s*$/gm, "R6_OAUTH_PROFILE_EXPIRY_UNPROVEN", "R6_OAUTH_PROFILE_FORMAT_INVALID");
  if (!TOKEN.test(token)) fail("R6_OAUTH_PROFILE_FORMAT_INVALID");
  const expiresAt = parseWranglerExpiryUtc(expiry);
  const profile = { token, expiresAt: new Date(expiresAt).toISOString(), hasRefreshCapability: optionalRefreshCapability(text), profilePath: paths.oauthProfile };
  const remainingValidityMilliseconds = assertOfflineOAuthProfileReady(profile, { now });
  return { classification: "R6_OAUTH_PROFILE_READY_OFFLINE", ...profile, remainingValidityMilliseconds };
}
