import { executeFixedProjectR2Get, parsePagesProjectR2Get, selectObservedCurrentProjectV3Target } from "./cloudflare-pages-project-v3-get.mjs";

export const PAGES_PROJECT_R2_METADATA_PREPARATION_VERSION = "cloudflare-pages-project-r2-metadata-preparation-v1";
export async function prepareCurrentCanonicalProductionV3Metadata({ accountId, auth, fetchImpl, environment, onTransportStart = () => undefined } = {}) {
  onTransportStart();
  const executed = await executeFixedProjectR2Get({ accountId, auth, fetchImpl, environment });
  try { return Object.freeze({ preparationVersion: PAGES_PROJECT_R2_METADATA_PREPARATION_VERSION, request: executed.request, selection: selectObservedCurrentProjectV3Target(parsePagesProjectR2Get(executed.raw)) }); }
  finally { executed.raw.fill(0); }
}
