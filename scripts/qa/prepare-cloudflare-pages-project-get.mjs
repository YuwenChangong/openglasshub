import { executeFixedProjectGet, parsePagesProjectGet, selectExactCanonicalProjectTarget } from "./cloudflare-pages-project-get.mjs";

export const PAGES_PROJECT_METADATA_PREPARATION_VERSION = "cloudflare-pages-project-metadata-preparation-v1";

/** Inert orchestration primitive for a separately approved single Project GET. */
export async function prepareFixedPagesProjectMetadata({ accountId, auth, deploymentId, sourceCommit, fetchImpl, environment, onTransportStart = () => undefined } = {}) {
  onTransportStart();
  const executed = await executeFixedProjectGet({ accountId, auth, fetchImpl, environment });
  const selection = selectExactCanonicalProjectTarget(parsePagesProjectGet(executed.raw), { deploymentId, sourceCommit });
  return Object.freeze({ preparationVersion: PAGES_PROJECT_METADATA_PREPARATION_VERSION, request: executed.request, selection });
}
