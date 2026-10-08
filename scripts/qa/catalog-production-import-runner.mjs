import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createImportPacket, loadImportBundle, executeImport, claimImportAuthorization } from "./lib/catalog-production-import-executor.mjs";
import { prepareImportConnection, createImportPostgresAdapter } from "./lib/catalog-production-import-postgres.mjs";
import { safeImportFailure, fail } from "./lib/catalog-production-import.mjs";

export async function runImportMain({ args = process.argv.slice(2), root = path.resolve(import.meta.dirname, "../.."), environment = process.env } = {}) {
  if (!args.length) return { status: "NOT_AUTHORIZED", connections: 0, importAttempts: 0, activationAttempts: 0 };
  if (args.length === 2 && args[0] === "--prepare-packet") {
    const packet = await createImportPacket(root);
    await writeFile(args[1], JSON.stringify(packet, null, 2) + "\n", { flag: "wx" });
    return { status: "PREPARED_NOT_AUTHORIZED", candidateHead: packet.candidateHead, connections: 0, importAttempts: 0 };
  }
  if (args.length !== 5 || args[0] !== "--execute-production" || args[1] !== "--packet" || args[3] !== "--authorization-receipt") fail("IMPORT_CLI_SCOPE_INVALID");
  const packet = JSON.parse(await readFile(args[2], "utf8"));
  const receipt = JSON.parse(await readFile(args[4], "utf8"));
  const bundle = await loadImportBundle({ root, packet, receipt });
  const config = await prepareImportConnection(environment);
  return executeImport({ bundle, open: createImportPostgresAdapter({ config }), claim: (id, digest) => claimImportAuthorization(root, id, digest) });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const result = await runImportMain(); console.log(JSON.stringify(result)); if (!["PASS", "NOT_AUTHORIZED", "PREPARED_NOT_AUTHORIZED"].includes(result.status)) process.exitCode = 1; }
  catch (error) { console.log(JSON.stringify({ status: "BLOCKED", diagnostic: safeImportFailure(error, "APPROVAL", 0, false) })); process.exitCode = 1; }
}
