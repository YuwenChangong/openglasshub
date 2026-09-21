import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  RELEASE_B_PRODUCTION_RUNNER_PATH,
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1,
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2,
  AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3,
  executeReleaseBProductionImport,
  hashAuthorizationReceipt,
  loadTask17FrozenGate,
  computeReleaseBExecutionSurfaceFingerprints,
  validateCurrentReleaseBAuthorizationReceiptV4,
} from "./release-b-production-import.mjs";
import {
  createReleaseBProductionTransport,
  preflightReleaseBProductionTransport,
} from "./lib/release-b-production-transport.mjs";
import { createReleaseBProductionPostgresAdapter } from "./lib/release-b-production-postgres-adapter.mjs";

export { RELEASE_B_PRODUCTION_RUNNER_PATH };

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function parseArgs(args) {
  if (!Array.isArray(args) || args.length < 1) fail("RELEASE_B_EXECUTION_FLAG_REQUIRED");
  if (args[0] === "--preflight-production-transport" && args.length === 1) return { mode: "preflight" };
  if (args[0] !== "--execute-production") fail("RELEASE_B_EXECUTION_FLAG_REQUIRED");
  const options = { mode: "execute" };
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (value === undefined) fail("RELEASE_B_RUNNER_ARGUMENTS_INVALID");
    if (key === "--authorization-receipt") options.authorizationReceiptPath = value;
    else if (key === "--authorization-receipt-sha256") options.authorizationReceiptSha256 = value;
    else fail("RELEASE_B_RUNNER_ARGUMENTS_INVALID");
  }
  if (!options.authorizationReceiptPath || !options.authorizationReceiptSha256) fail("RELEASE_B_AUTHORIZATION_RECEIPT_REQUIRED");
  return options;
}

async function loadReceipt(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export function preflightReleaseBProductionRunner({ environment = process.env } = {}) {
  const transport = preflightReleaseBProductionTransport({
    environment,
    createSession: async () => fail("RELEASE_B_PRODUCTION_SESSION_FACTORY_UNAVAILABLE"),
    readPostcheck: async () => fail("RELEASE_B_PRODUCTION_POSTCHECK_UNAVAILABLE"),
  });
  return Object.freeze({
    runnerPath: RELEASE_B_PRODUCTION_RUNNER_PATH,
    ...transport,
    authorizationConsumed: false,
    productionConnections: 0,
  });
}

export function createReleaseBProductionRunnerTransport(options = {}) {
  return createReleaseBProductionTransport(options);
}

export async function runReleaseBProductionRunner({
  args,
  environment = process.env,
  authorizationReceipt,
  authorizationReceiptSha256,
  createSession,
  readPostcheck,
  PostgresClient,
  executeProductionImport = executeReleaseBProductionImport,
} = {}) {
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== "--execute-production") fail("RELEASE_B_EXECUTION_FLAG_REQUIRED");
  if (
    authorizationReceipt?.schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V1
    || authorizationReceipt?.schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V2
    || authorizationReceipt?.schemaVersion === AUTHORIZATION_RECEIPT_SCHEMA_VERSION_V3
  ) fail("RELEASE_B_AUTHORIZATION_V4_REQUIRED");
  const frozen = await loadTask17FrozenGate();
  validateCurrentReleaseBAuthorizationReceiptV4(
    authorizationReceipt,
    authorizationReceiptSha256,
    frozen,
    await computeReleaseBExecutionSurfaceFingerprints(),
  );
  const adapter = createSession && readPostcheck
    ? null
    : createReleaseBProductionPostgresAdapter({ environment, Client: PostgresClient });
  const transport = createReleaseBProductionRunnerTransport({
    environment,
    createSession: createSession ?? adapter.createSession,
    readPostcheck: readPostcheck ?? adapter.readPostcheck,
  });
  return executeProductionImport({ args, authorizationReceipt, authorizationReceiptSha256, transport });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.mode === "preflight") {
    console.log(JSON.stringify(preflightReleaseBProductionRunner()));
    return;
  }
  const authorizationReceipt = await loadReceipt(parsed.authorizationReceiptPath);
  await runReleaseBProductionRunner({
    args: ["--execute-production"],
    authorizationReceipt,
    authorizationReceiptSha256: parsed.authorizationReceiptSha256,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`RELEASE_B_PRODUCTION_RUNNER_BLOCKED ${error.code ?? error.message}`);
    process.exitCode = 1;
  });
}
