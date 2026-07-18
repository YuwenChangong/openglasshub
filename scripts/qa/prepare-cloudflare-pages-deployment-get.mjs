import {
  executeFixedDeploymentGet,
  parsePagesDeploymentGet,
  sanitizeDeploymentSelection,
  selectExactProductionDeployment,
} from "./cloudflare-pages-deployment-get.mjs";
import { resolvePagesAccountId } from "./cloudflare-pages-account-resolver.mjs";

export const PAGES_METADATA_PREPARATION_VERSION = "cloudflare-pages-metadata-preparation-v1";

/**
 * This narrow library is deliberately inert until a future human approval invokes it.
 * The account ID remains an in-process value, and the returned object contains only
 * a digest-backed account-source classification plus the already-sanitized deployment evidence.
 */
export async function prepareFixedPagesDeploymentMetadata({
  repositoryRoot,
  deploymentId,
  sourceCommit,
  auth,
  requestHiddenInput,
  suppliedHiddenInput,
  fetchImpl,
  environment,
  home,
  appData,
} = {}) {
  const account = await resolvePagesAccountId({ repositoryRoot, requestHiddenInput, suppliedHiddenInput, home, appData });
  try {
    const executed = await executeFixedDeploymentGet({ deploymentId, fetchImpl, auth, accountId: account.accountId, environment });
    const selected = selectExactProductionDeployment(parsePagesDeploymentGet(executed.raw), { deploymentId, sourceCommit });
    return {
      preparationVersion: PAGES_METADATA_PREPARATION_VERSION,
      accountSource: { classification: account.classification, accountIdSha256: account.accountIdSha256 },
      deployment: sanitizeDeploymentSelection(selected),
    };
  } finally {
    account.accountId = null;
  }
}
