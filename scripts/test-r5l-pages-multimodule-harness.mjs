import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  R5L_LOCAL_ONLY_MARKERS,
  assertPortAvailable,
  assertRawSqlPayload,
  inspectBuiltWorker,
  validateLocalBindings,
} from "./lib/r5l-pages-multimodule-harness.mjs";

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "openglass-r5l-pages-harness-"));
const localBindings = {
  ...Object.fromEntries(R5L_LOCAL_ONLY_MARKERS.map((marker) => [marker, "true"])),
  SUPABASE_URL: "http://127.0.0.1:54321",
  PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "local-only-anon",
  SUPABASE_SERVICE_ROLE_KEY: "local-only-service",
};

try {
  const worker = path.join(temporaryRoot, "dist", "_worker.js");
  await mkdir(path.join(worker, "chunks"), { recursive: true });
  await writeFile(path.join(worker, "index.js"), "import './chunks/route.mjs'; export default { fetch() { return new Response('ok'); } };\n");
  await writeFile(path.join(worker, "chunks", "route.mjs"), "export const route = true;\n");
  const inspected = await inspectBuiltWorker({ repositoryRoot: temporaryRoot, artifactDirectory: worker });
  assert.equal(path.basename(inspected.entrypoint), "index.js");
  assert.equal(inspected.modules.length, 2);

  await rm(path.join(worker, "index.js"));
  await assert.rejects(() => inspectBuiltWorker({ repositoryRoot: temporaryRoot, artifactDirectory: worker }), /missing/);
  await writeFile(path.join(worker, "index.js"), "export default {};\n");
  await writeFile(path.join(worker, "index.mjs"), "export default {};\n");
  await assert.rejects(() => inspectBuiltWorker({ repositoryRoot: temporaryRoot, artifactDirectory: worker }), /ambiguous/);
  await rm(path.join(worker, "index.mjs"));
  await writeFile(path.join(worker, "chunks", "route.mjs"), "await import('node:fs/promises');\n");
  assert.equal((await inspectBuiltWorker({ repositoryRoot: temporaryRoot, artifactDirectory: worker })).nodeFsImports.length, 1);

  validateLocalBindings(localBindings);
  assert.throws(() => validateLocalBindings({ ...localBindings, SUPABASE_URL: "https://cloud.example" }), /loopback|cloud/);
  assert.throws(() => validateLocalBindings({ ...localBindings, LOCAL_R5L_ONLY: "false" }), /LOCAL_R5L_ONLY/);
  assert.throws(() => assertRawSqlPayload("Exit code: 0\nBEGIN;"), /rejected/);
  assert.doesNotThrow(() => assertRawSqlPayload("BEGIN TRANSACTION READ ONLY;\nROLLBACK;"));

  const occupied = await new Promise((resolve) => {
    import("node:http").then(({ createServer }) => {
      const server = createServer().listen(0, "127.0.0.1", () => resolve(server));
    });
  });
  const port = occupied.address().port;
  await assert.rejects(() => assertPortAvailable(port));
  await new Promise((resolve) => occupied.close(resolve));
  await assertPortAvailable(port);
  console.log(JSON.stringify({ status: "PASS", checks: ["multimodule", "missing-entry", "ambiguous-entry", "node-fs-detection", "loopback", "cloud-rejection", "occupied-port", "raw-payload-guard"] }));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
