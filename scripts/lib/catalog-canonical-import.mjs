import path from "node:path";
import { buildRepositoryInventory } from "./product-detail-repository-inventory.mjs";
import { loadApprovedDeviceYaml } from "../devices/schema-v1/yaml-input.mjs";
import { normalizeCatalogYaml } from "../devices/schema-v1/normalize.mjs";
import { buildNormalizedModel } from "../devices/schema-v1/model.mjs";
import { classifyConflicts, loadConflictMappings } from "../devices/schema-v1/conflicts.mjs";
import { renderReleaseBAuthorizedOperation } from "../devices/schema-v1/disposable-postgres-transaction-client.mjs";

export async function prepareCanonicalCatalogImport({ root, publication }) {
  if (publication.blocked_count !== 0 || !Array.isArray(publication.candidates)) throw new Error("PUBLICATION_CONTRACT_BLOCKED");
  const inventory = await buildRepositoryInventory({ root });
  const normalized = normalizeCatalogYaml(await loadApprovedDeviceYaml(path.join(root, "src/data/devices/openglasshub_device_data_v1.yaml")));
  const conflicts = classifyConflicts({ normalized,
    mappings: await loadConflictMappings(path.join(root, "scripts/devices/schema-v1/conflict-map.json")),
    reviewedEvidenceSourceUrls: inventory.sources.map(source => source.url) });
  const model = buildNormalizedModel({ normalized, definitions: inventory.definitions,
    sourceMetadata: inventory.sources, identityMappings: inventory.identities, conflicts });
  if (model.blockers.length) throw new Error("CANONICAL_IMPORT_MODEL_BLOCKED");
  const decisions = new Map(publication.candidates.map(item => [item.slug, item]));
  if (decisions.size !== inventory.identities.length) throw new Error("PUBLICATION_IDENTITY_SET_MISMATCH");
  const devices = inventory.pipeline.readerCompatibleRows.map(row => {
    const identity = model.devices.find(item => item.slug === row.slug);
    const decision = decisions.get(row.slug);
    if (!identity || !decision || decision.brand !== row.brand_key || !["PUBLISHED", "NOT_PUBLISHED"].includes(decision.decision)) throw new Error("PUBLICATION_IDENTITY_SET_MISMATCH");
    return { ...row, publication_status: decision.decision === "PUBLISHED" ? "published" : "draft",
      generation: identity.generation, schema_type: identity.schemaType, device_type: identity.deviceType, status: identity.status };
  });
  const operations = [
    ...model.definitions.map(row => ({ entity: "definition", row })),
    ...devices.map(row => ({ entity: "device", row })),
    ...model.sources.map(row => ({ entity: "source", row })),
    ...model.sourceLinks.map(row => ({ entity: "sourceLink", row })),
    ...model.specs.map(row => ({ entity: "spec", row })),
    ...model.evidence.map(row => ({ entity: "evidence", row })),
  ];
  // INSERT ONLY. Existing richer/admin-owned records are never overwritten.
  // Any incompatible existing definition/identity instead fails the transaction.
  const statements = operations.map(operation => renderReleaseBAuthorizedOperation(operation)
    .replace(/ON CONFLICT \([^;]+\) DO UPDATE SET [^;]+;/, "ON CONFLICT DO NOTHING;"));
  return { inventory, model, devices, sql: ["BEGIN;", "SET CONSTRAINTS ALL DEFERRED;", ...statements, "COMMIT;"].join("\n") };
}
