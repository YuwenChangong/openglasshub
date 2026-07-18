import assert from "node:assert/strict";
import { mkdtemp, lstat, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(scriptsRoot);
const entrypoint = path.join(repositoryRoot, "scripts", "qa", "run-cloudflare-pages-metadata-preparation.mjs");
const originalCwd = process.cwd();
const isolatedCwd = await mkdtemp(path.join(os.tmpdir(), "r6 entrypoint cwd "));

try {
  const info = await lstat(entrypoint);
  assert.equal(info.isFile(), true, "the committed metadata CLI must be a regular file");
  process.chdir(isolatedCwd);
  const module = await import(`${pathToFileURL(entrypoint).href}?load-only=${Date.now()}`);
  assert.equal(module.R6_METADATA_PREPARATION_OPERATION, "PREPARE_AUTH_DRY_RUN_ATTESTATION");
  assert.equal(typeof module.runMetadataPreparationCli, "function");
  assert.equal(process.cwd(), isolatedCwd, "absolute entrypoint loading must not depend on the caller directory");
  await assert.rejects(import(`${pathToFileURL(path.join(isolatedCwd, "missing-entrypoint.mjs")).href}?load-only=missing`), (error) => error?.code === "ERR_MODULE_NOT_FOUND");
  const missingImport = path.join(isolatedCwd, "missing-import.mjs");
  await writeFile(missingImport, "import './absent-local-module.mjs';\n");
  await assert.rejects(import(`${pathToFileURL(missingImport).href}?load-only=import`), (error) => error?.code === "ERR_MODULE_NOT_FOUND");
  const wrongFormat = path.join(isolatedCwd, "wrong-format.cjs");
  await writeFile(wrongFormat, "export const unsupported = true;\n");
  await assert.rejects(import(`${pathToFileURL(wrongFormat).href}?load-only=format`), (error) => error instanceof SyntaxError);
  console.log("R6_METADATA_ENTRYPOINT_LOAD_ONLY_OK complete committed ESM graph loaded without profile, prompt, HTTP, attestation, or run allocation");
} finally {
  process.chdir(originalCwd);
  await rm(isolatedCwd, { recursive: true, force: true });
}
