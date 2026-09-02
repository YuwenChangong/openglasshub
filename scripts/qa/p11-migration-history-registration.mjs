export const P11_PROJECT_REF = "xcbnxzjlsvtgzixurcof";
export const P11_VERSION = "20260902042807";
export const P11_NAME = "forward_reconcile_devices";
export const P11_MIGRATION_SHA256 = "2F98FEA88B4B5619DCE82A0E48C0653C96F4DB3E212D6F52A85FBAB083405E65";

function fail(code) { throw new Error(code); }

export function validateP11Repair({ version, status, projectRef, migrationHash, actualCommit, approvedCommit, clean, passwordPresent }) {
  if (version !== P11_VERSION) fail("P11_VERSION_REJECTED");
  if (status !== "applied") fail("P11_STATUS_REJECTED");
  if (projectRef !== P11_PROJECT_REF) fail("P11_LINK_TARGET_REJECTED");
  if (migrationHash !== P11_MIGRATION_SHA256) fail("P11_MIGRATION_HASH_REJECTED");
  if (actualCommit !== approvedCommit || !/^[a-f0-9]{40}$/i.test(actualCommit ?? "") || !clean) fail("P11_SOURCE_BINDING_REJECTED");
  if (passwordPresent !== true) fail("P11_PASSWORD_UNAVAILABLE");
  return ["migration", "repair", P11_VERSION, "--status", "applied", "--linked"];
}

export function validateP11LocalRepair({ version, status, historyCount }) {
  if (version !== P11_VERSION || status !== "applied") fail("P11_LOCAL_IDENTITY_REJECTED");
  if (historyCount !== 0) fail("P11_LOCAL_ALREADY_PRESENT_REJECTED");
  return ["migration", "repair", P11_VERSION, "--status", "applied", "--local"];
}

export async function runP11LocalRepairGuard({ historyCount, spawnImpl }) {
  if (historyCount !== 0) fail("P11_LOCAL_ALREADY_PRESENT_REJECTED");
  const argv = validateP11LocalRepair({ version: P11_VERSION, status: "applied", historyCount });
  return spawnImpl(argv);
}

export function parseP11LinkedProjectRef(value) {
  if (typeof value !== "string" || value.trim() !== P11_PROJECT_REF) fail("P11_LINK_TARGET_REJECTED");
  return P11_PROJECT_REF;
}

export function classifyP11Execution() {
  return { PRODUCTION_MIGRATION_HISTORY_MUTATION: 1, PRODUCTION_SCHEMA_MUTATION: 0, PRODUCTION_APPLICATION_DATA_MUTATION: 0 };
}
