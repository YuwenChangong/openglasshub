import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

const KEY = "P9_PRODUCTION_DATABASE_URL";
const fail = (reason) => { throw new Error(`P9_POSTFIX_ENV_${reason}`); };

export function loadP9CredentialIntoEnvironment({
  filePath = path.join(homedir(), ".codex", ".env"), environment = process.env,
} = {}) {
  let content;
  try { content = readFileSync(filePath, "utf8"); } catch { fail("FILE_UNAVAILABLE"); }
  const entries = content.split(/\r?\n/).filter((line) =>
    /^\s*(?:export\s+)?P9_PRODUCTION_DATABASE_URL\b/i.test(line));
  if (entries.length !== 1) fail("ENTRY_COUNT");
  const line = entries[0];
  if (!/^P9_PRODUCTION_DATABASE_URL=/.test(line)) fail("MALFORMED");
  const raw = line.slice(KEY.length + 1);
  if (!raw || /[\r\n\0]/.test(raw)) fail("EMPTY_OR_MALFORMED");
  const quoted = (raw.startsWith('"') && raw.endsWith('"'))
    || (raw.startsWith("'") && raw.endsWith("'"));
  if (!quoted && (/[\s#'"`]/.test(raw))) fail("MALFORMED");
  if ((raw.startsWith('"') || raw.startsWith("'")) && !quoted) fail("MALFORMED");
  let parsed;
  try { parsed = parseEnv(line)[KEY]; } catch { fail("MALFORMED"); }
  if (typeof parsed !== "string" || !parsed) fail("EMPTY_OR_MALFORMED");
  if (environment[KEY] !== undefined && environment[KEY] !== parsed) fail("CONFLICT");
  environment[KEY] = parsed;
  if (environment[KEY] !== parsed) fail("HANDOFF_FAILED");
  return { dsn: parsed, sourceEquivalent: true };
}
