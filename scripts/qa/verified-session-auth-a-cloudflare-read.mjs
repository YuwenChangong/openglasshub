import { createAuthAReadClient } from "./verified-session-auth-a-read-client.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCTION_ORIGIN = "https://api.cloudflare.com/";
const fail = (code) => { throw new Error(`AUTH_A_CF_${code}`); };
const object = (value) => value && typeof value === "object" && !Array.isArray(value);

export async function readCloudflareWorker({ mode = "LOCAL_TEST", origin = PRODUCTION_ORIGIN,
  accountId, token } = {}) {
  if (mode === "PRODUCTION" && origin !== PRODUCTION_ORIGIN) fail("ORIGIN_DENIED");
  if (typeof accountId !== "string" || !/^[a-f0-9]{32}$/i.test(accountId)) fail("ACCOUNT_INVALID");
  const root = `/client/v4/accounts/${accountId}/workers/scripts/openglasshub`;
  const client = createAuthAReadClient({ mode, origin, token, headerName: "Authorization",
    allowedPaths: [`${root}/deployments`, new RegExp(`^${root}/versions/[a-f0-9-]{36}$`)],
    maxRequests: 2 });
  const list = await client.get(`${root}/deployments`);
  if (list?.success !== true || !Array.isArray(list.result) || !list.result.length) fail("DEPLOYMENT_UNKNOWN");
  const deployment = list.result[0];
  if (!object(deployment) || !UUID.test(deployment.id ?? "")
    || (deployment.script_name !== undefined && deployment.script_name !== "openglasshub")
    || !Array.isArray(deployment.versions) || deployment.versions.length !== 1
    || !UUID.test(deployment.versions[0]?.version_id ?? "")
    || deployment.versions[0].percentage !== 100) fail("DEPLOYMENT_AMBIGUOUS");
  const versionId = deployment.versions[0].version_id;
  const detail = await client.get(`${root}/versions/${versionId}`);
  if (detail?.success !== true || !object(detail.result) || detail.result.id !== versionId)
    fail("VERSION_TARGET_DRIFT");
  const version = detail.result;
  const resources = version.resources;
  if (!object(resources) || !object(resources.script) || !object(resources.script_runtime)
    || typeof resources.script.etag !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(resources.script.etag)
    || !/^\d{4}-\d{2}-\d{2}$/.test(resources.script_runtime.compatibility_date ?? "")
    || !Array.isArray(resources.script_runtime.compatibility_flags)
    || resources.script_runtime.compatibility_flags.some((flag) => typeof flag !== "string" || !/^[a-z0-9_]+$/.test(flag)))
    fail("RESOURCES_UNKNOWN");
  if (!Array.isArray(resources.bindings) || resources.bindings.some((entry) => !object(entry)
    || typeof entry.name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(entry.name)
    || typeof entry.type !== "string" || !/^[a-z0-9_]+$/.test(entry.type))) fail("BINDINGS_UNKNOWN");
  const bindings = resources.bindings.map(({ name, type }) => ({ name, type }));
  if (new Set(bindings.map((binding) => binding.name)).size !== bindings.length) fail("BINDINGS_AMBIGUOUS");
  return {
    workerName: "openglasshub", deploymentId: deployment.id,
    versionId, versionCreatedAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(version.metadata?.created_on ?? "")
      ? version.metadata.created_on : "UNKNOWN",
    versionSource: ["api", "dash", "wrangler", "terraform"].includes(version.metadata?.source)
      ? version.metadata.source : "UNKNOWN",
    scriptEtag: resources.script.etag,
    compatibilityDate: resources.script_runtime.compatibility_date,
    compatibilityFlags: resources.script_runtime.compatibility_flags,
    bindingNamesAndTypes: bindings, requestCount: client.requestCount,
  };
}
