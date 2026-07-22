import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entrypoint = path.join(root, "scripts", "qa", "run-cloudflare-pages-project-metadata-preparation.mjs");
const cwd = await mkdtemp(path.join(os.tmpdir(), "r6-project-entrypoint-")); const original = process.cwd();
try {
  process.chdir(cwd);
  const module = await import(`${pathToFileURL(entrypoint).href}?load-only=${Date.now()}`);
  assert.equal(module.R6_PAGES_PROJECT_METADATA_ENTRYPOINT_LOAD_ONLY, "R6_PAGES_PROJECT_METADATA_ENTRYPOINT_LOAD_ONLY_OK");
  assert.equal(typeof module.runProjectMetadataPreparationCli, "function");
  assert.equal(process.cwd(), cwd);
  console.log("R6_PAGES_PROJECT_METADATA_ENTRYPOINT_LOAD_ONLY_OK absolute Project CLI load did not prompt, call HTTP, create an attestation, or allocate a Run ID");
} finally { process.chdir(original); await rm(cwd, { recursive: true, force: true }); }
