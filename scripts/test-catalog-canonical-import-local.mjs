import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { prepareCanonicalCatalogImport } from "./lib/catalog-canonical-import.mjs";
import { readSchemaV1SqlState } from "./devices/schema-v1/disposable-postgres-transaction-client.mjs";
import { preparePreferenceRunEnvironment } from "./test-user-preferences-rls-local.mjs";
import { assertLocalReplayTarget, runLocalDisposableReplay, withCanonicalBaselineDirectory } from "./qa/local-disposable-supabase-replay.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runId = randomUUID();
const receipt = { format: "catalog-canonical-import-local-v1", runId, status: "BLOCKED", assertions: [], productionRequests: 0 };
const check = (condition, name) => { assert.ok(condition, name); receipt.assertions.push(name); };
const typed = spec => spec.valueNumber ?? spec.valueBoolean ?? spec.valueText ?? spec.valueJson;
try {
  const publication = JSON.parse(await readFile(path.join(root, "artifacts/qa/product-publication-cohort-v1/publication-contract.json"), "utf8"));
  const prepared = await prepareCanonicalCatalogImport({ root, publication });
  const expected = prepared.inventory.parameterLedger.filter(item => item.state === "KNOWN");
  check(expected.length === 829, "SOURCE_KNOWN_PARAMETER_COUNT_829");
  check(!/DO UPDATE/i.test(prepared.sql), "NO_RICHER_DATA_OVERWRITE");
  const allowed = ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "COMSPEC"];
  const environment = preparePreferenceRunEnvironment(Object.fromEntries(allowed.filter(key => process.env[key]).map(key => [key, process.env[key]])));
  await withCanonicalBaselineDirectory({ root, environment }, async canonicalBaselineDirectory => runLocalDisposableReplay({
    root, environment, migrationLimit: 50, canonicalBaselineDirectory,
    afterMigrationLedgerValidated: async ({ target, executeSql }) => {
      assertLocalReplayTarget(target);
      await executeSql(prepared.sql);
      const stored = await readSchemaV1SqlState({ executeSql });
      const dropped = expected.filter(entry => {
        const spec = stored.specs.find(item => item.deviceSlug === entry.slug && item.definitionKey === entry.canonicalPath && item.region === entry.region && item.variant === "");
        // Schema v1's accepted, lossless Yes/No normalization is presentation
        // independent. Check the original text too, not just the typed fact.
        const expectedTyped = entry.value === "Yes" ? true : entry.value === "No" ? false : entry.value;
        return !spec || JSON.stringify(typed(spec)) !== JSON.stringify(expectedTyped) || spec.rawValue !== String(entry.value);
      });
      receipt.sourceKnownParameterCount = expected.length;
      receipt.canonicalImportedParameterCount = expected.length - dropped.length;
      receipt.importDroppedParameterCount = dropped.length;
      receipt.equivalenceRule = "SCHEMA_V1_YES_TRUE_NO_FALSE_PLUS_ORIGINAL_RAW_VALUE";
      receipt.firstDropped = dropped.length ? { slug: dropped[0].slug, field: dropped[0].canonicalPath, pointer: dropped[0].pointer } : null;
      check(dropped.length === 0, "CANONICAL_IMPORTED_PARAMETER_COUNT_829_ZERO_DROPS");
      check(stored.devices.length === publication.candidate_count, "EXACT_CANDIDATE_IMPORT");
      check(stored.devices.filter(item => item.publication_status === "published").length === publication.published_count, "PUBLICATION_SEED_FROM_CONTRACT");
      // A second import cannot replace any administrator's richer factual edit.
      const sentinel = stored.specs.find(item => item.state === "KNOWN" && item.valueText !== null);
      await executeSql(`UPDATE public.device_specs SET value_text='LOCAL_ADMIN_OWNED_VALUE' WHERE id=(SELECT s.id FROM public.device_specs s JOIN public.devices d ON d.id=s.device_id JOIN public.device_spec_definitions f ON f.id=s.spec_definition_id WHERE d.slug='${sentinel.deviceSlug}' AND f.key='${sentinel.definitionKey}' LIMIT 1);`);
      await executeSql(prepared.sql);
      const reimported = await readSchemaV1SqlState({ executeSql });
      check(reimported.specs.some(item => item.deviceSlug === sentinel.deviceSlug && item.definitionKey === sentinel.definitionKey && item.valueText === "LOCAL_ADMIN_OWNED_VALUE"), "ADMIN_EDIT_NOT_OVERWRITTEN");
      return { status: "PASS" };
    },
  }));
  receipt.status = "PASS";
  receipt.cleanup = "PASS";
} catch (error) {
  receipt.firstFailure = error instanceof assert.AssertionError ? error.message : "LOCAL_IMPORT_OR_REPLAY_FAILED";
  process.exitCode = 1;
} finally {
  const directory = path.join(root, "artifacts/qa/catalog-canonical-import-v1");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${runId}.json`);
  await writeFile(file, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log(`CANONICAL_IMPORT_LOCAL=${receipt.status}`);
  console.log(`ASSERTIONS=${receipt.assertions.length}`);
  if (receipt.firstFailure) console.log(`FIRST_FAIL=${receipt.firstFailure}`);
  console.log(`RECEIPT=${file}`);
}
