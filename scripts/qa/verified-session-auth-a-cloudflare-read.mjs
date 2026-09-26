import { createAuthAReadClient } from "./verified-session-auth-a-read-client.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (code) => { throw new Error(`AUTH_A_CF_${code}`); };
const object = (value) => value && typeof value === "object" && !Array.isArray(value);

export async function readCloudflareWorker({ mode = "LOCAL_TEST", origin = "https://api.cloudflare.com/",
  accountId, token } = {}) {
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
  if (detail?.success !== true || !object(detail.result) || detail.result.id !== versionId
    || detail.result.name !== "openglasshub" || detail.result.environment !== "production") fail("VERSION_TARGET_DRIFT");
  const version = detail.result;
  if (!Array.isArray(version.bindings) || version.bindings.some((entry) => !object(entry)
    || typeof entry.name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(entry.name)
    || typeof entry.type !== "string" || !/^[a-z_]+$/.test(entry.type))) fail("BINDINGS_UNKNOWN");
  const bindings = version.bindings.map(({ name, type }) => ({ name, type }));
  if (new Set(bindings.map((binding) => binding.name)).size !== bindings.length) fail("BINDINGS_AMBIGUOUS");
  return {
    workerName: "openglasshub", environment: "production", deploymentId: deployment.id,
    versionId, versionCreatedAt: typeof version.metadata?.created_on === "string"
      ? version.metadata.created_on : "UNKNOWN",
    artifactEtag: typeof version.etag === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(version.etag)
      ? version.etag : "UNKNOWN",
    compatibilityDate: typeof version.compatibility_date === "string" ? version.compatibility_date : "UNKNOWN",
    compatibilityFlags: Array.isArray(version.compatibility_flags)
      ? version.compatibility_flags.filter((value) => typeof value === "string") : [],
    bindings, sourceCommit: "UNKNOWN", requestCount: client.requestCount,
  };
}
