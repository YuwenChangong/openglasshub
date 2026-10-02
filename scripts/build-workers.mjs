import { spawnSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { unstable_readConfig } from "wrangler";
import { withWorkerRuntimeVars } from "./lib/workers-runtime-vars.mjs";
import { resolveWorkersBuildEnvironment } from "./lib/workers-build-environment.mjs";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
let localConfigPath;
if (args.length) {
  if (args.length !== 2 || args[0] !== "--local-config") throw new Error("WORKERS_BUILD_ARGUMENTS_INVALID");
  if (!isAbsolute(args[1])) throw new Error("LOCAL_BUILD_CONFIG_PATH");
  localConfigPath = args[1];
}
const sourceConfig = unstable_readConfig(
  { config: localConfigPath ?? resolve(root, "wrangler.toml"), env: resolveWorkersBuildEnvironment(process.env) },
  { hideWarnings: true },
);

function requireLocalUrl(value, name, protocols) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`LOCAL_BUILD_TARGET_INVALID:${name}`); }
  if (!protocols.includes(url.protocol) || url.hostname !== "127.0.0.1" || url.username || url.password || url.search || url.hash) {
    throw new Error(`LOCAL_BUILD_TARGET_INVALID:${name}`);
  }
  return url;
}

if (localConfigPath) {
  const vars = sourceConfig.vars ?? {};
  for (const [name, value] of Object.entries(vars)) {
    if (/SERVICE_ROLE|SECRET|ACCESS_TOKEN|API_TOKEN|API_KEY|PASSWORD|DATABASE_URL|POSTGRES_URL|SUPABASE_DB_URL|SUPABASE_PROJECT_REF|^PG[A-Z_]/.test(name)) {
      throw new Error(`LOCAL_BUILD_PRIVILEGED_VAR:${name}`);
    }
    if (name.startsWith("PUBLIC_") && typeof value === "string") {
      let url;
      try { url = new URL(value); } catch { /* Explicit non-URL public strings are permitted. */ }
      if (url && ["http:", "https:", "ws:", "wss:"].includes(url.protocol) && (url.hostname !== "127.0.0.1" || url.username || url.password)) {
        throw new Error(`LOCAL_BUILD_PUBLIC_REMOTE_TARGET:${name}`);
      }
    }
  }
  for (const name of ["SUPABASE_URL", "PUBLIC_SUPABASE_URL", "PUBLIC_SUPABASE_ANON_KEY", "SITE_ORIGIN"]) {
    if (typeof vars[name] !== "string" || !vars[name].trim()) throw new Error(`LOCAL_BUILD_REQUIRED_VAR:${name}`);
  }
  const server = requireLocalUrl(vars.SUPABASE_URL, "SUPABASE_URL", ["http:", "https:"]);
  const client = requireLocalUrl(vars.PUBLIC_SUPABASE_URL, "PUBLIC_SUPABASE_URL", ["http:", "https:"]);
  requireLocalUrl(vars.SITE_ORIGIN, "SITE_ORIGIN", ["https:"]);
  if (server.origin !== client.origin) throw new Error("LOCAL_BUILD_ORIGIN_MISMATCH");
  if (vars.AUTH_CAPTCHA_MODE !== "off") throw new Error("LOCAL_BUILD_AUTH_MODE");
  if (Object.hasOwn(vars, "PUBLIC_AUTH_TURNSTILE_SITE_KEY")) throw new Error("LOCAL_BUILD_AUTH_SITEKEY");
  // Astro loads dotenv independently; reject local builds that could fall back to repository files.
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    const exists = await access(resolve(root, file)).then(() => true, error => {
      if (error.code !== "ENOENT") throw error;
      return false;
    });
    if (exists) throw new Error("LOCAL_BUILD_REPOSITORY_ENV_FILE_PRESENT");
  }
}

const buildEnvironment = Object.fromEntries(
  Object.entries(sourceConfig.vars ?? {}).filter(([name, value]) =>
    (name.startsWith("PUBLIC_") || name === "SITE_ORIGIN") && typeof value === "string" && value.trim() !== "",
  ),
);

// An absent source binding must not inherit a production Auth key from the caller.
const localAllowedEnvironment = ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "COMSPEC"];
const childEnvironment = localConfigPath ? {
  ...Object.fromEntries(localAllowedEnvironment.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]])),
  ASTRO_TELEMETRY_DISABLED: "1", ASTRO_DISABLE_UPDATE_CHECK: "true", CLOUDFLARE_CF_FETCH_ENABLED: "false",
  ...sourceConfig.vars,
} : { ...process.env, ...buildEnvironment };
if (!Object.hasOwn(buildEnvironment, "PUBLIC_AUTH_TURNSTILE_SITE_KEY")) {
  delete childEnvironment.PUBLIC_AUTH_TURNSTILE_SITE_KEY;
}

const result = spawnSync(process.execPath, [resolve(root, "node_modules", "astro", "bin", "astro.mjs"), "build"], {
  cwd: root,
  env: childEnvironment,
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  const generatedPath = resolve(root, "dist", "server", "wrangler.json");
  const generated = JSON.parse(await readFile(generatedPath, "utf8"));
  const configured = withWorkerRuntimeVars(generated, sourceConfig.vars ?? {});
  await writeFile(generatedPath, `${JSON.stringify(configured, null, 2)}\n`, "utf8");
}
