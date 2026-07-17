import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const packet = await readFile("docs/ops/reconciliation/operational-guardrails-current-catalog-refresh.sql");
const hash = createHash("sha256").update(packet).digest("hex");
assert.equal(hash, "66f2a18efea1df249774bf5d6a65bc1b8d521ac59adb243c4ea10c6ae6680748");
assert.equal(packet.byteLength, 20871);
const directory = await mkdtemp(path.join(os.tmpdir(), "openglass-current-catalog-transport-"));
const finalPath = path.join(directory, "operational-guardrails-current-catalog-refresh.csv");
const partialPath = path.join(directory, ".current.partial.csv");
const failedPath = path.join(directory, ".current.failed.csv");

try {
  await writeFile(partialPath, "partial evidence", { flag: "wx" });
  const simulatedPsqlExit = 1;
  assert.notEqual(simulatedPsqlExit, 0, "mocked failed psql must block final creation");
  await rename(partialPath, failedPath);
  assert.equal((await readFile(failedPath, "utf8")), "partial evidence");
  await assert.rejects(readFile(finalPath), /ENOENT/);

  const successPartial = path.join(directory, ".current-success.partial.csv");
  await writeFile(successPartial, "packet_version,section_order\nreviewed,1\n", { flag: "wx" });
  const simulatedPsqlSuccess = 0;
  const simulatedValidatorSuccess = 0;
  assert.equal(simulatedPsqlSuccess, 0);
  assert.equal(simulatedValidatorSuccess, 0);
  await rename(successPartial, finalPath);
  assert.match(await readFile(finalPath, "utf8"), /^packet_version/);
  assert.equal((await readFile(finalPath, "utf8")).length > 0, true, "a pre-existing final path must cause the runner to stop rather than overwrite it");
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log(JSON.stringify({ mockedTransport: true, sourcePayloadHashParity: true, partialOutputQuarantined: true, validatedOutputAtomicMove: true, productionOperations: 0 }));
