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
  const quote=value=>`'${String(value).replaceAll("'","''")}'`;
  const identities=devices.map(device=>`(${quote(device.slug)},${quote(device.brand_key)},${quote(device.schema_type)}::public.device_schema_type)`).join(',\n');
  // Legacy rows predate Schema v1. Initialize only absent applicability metadata;
  // never replace an existing type, publication decision, copy, or factual value.
  const initializeLegacy=`DO $$ BEGIN
    PERFORM 1 FROM public.devices WHERE slug IN (${devices.map(d=>quote(d.slug)).join(',')}) FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.devices d JOIN (VALUES ${identities}) AS e(slug,brand,schema_type) ON d.slug=e.slug
      WHERE d.brand_key<>e.brand OR d.schema_type IS NOT NULL AND d.schema_type<>e.schema_type) THEN
      RAISE EXCEPTION 'CANONICAL_EXISTING_IDENTITY_INCOMPATIBLE'; END IF;
  END $$;
  UPDATE public.devices d SET schema_type=e.schema_type FROM (VALUES ${identities}) AS e(slug,brand,schema_type)
    WHERE d.slug=e.slug AND d.brand_key=e.brand AND d.schema_type IS NULL;`;
  const expected=model.specs.map(spec=>`(${quote(spec.deviceSlug)},${quote(spec.definitionKey)},${quote(spec.region)},${quote(spec.variant)})`).join(",\n");
  // Activate the canonical reader only after every expected typed row exists.
  // This updates no facts, labels, publication states, or admin-owned values.
  const activationSql=`BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM (VALUES ${expected}) AS e(slug,key,region,variant)
    WHERE NOT EXISTS (SELECT 1 FROM public.device_specs s JOIN public.devices d ON d.id=s.device_id
      JOIN public.device_spec_definitions f ON f.id=s.spec_definition_id
      WHERE d.slug=e.slug AND f.key=e.key AND s.region=e.region AND s.variant=e.variant)) THEN
    RAISE EXCEPTION 'CANONICAL_IMPORT_INCOMPLETE'; END IF;
END $$;
WITH ranked AS (
  SELECT s.id,row_number() OVER (PARTITION BY s.device_id ORDER BY f.admin_order,f.key,s.region,s.variant) AS position
  FROM public.device_specs s JOIN public.device_spec_definitions f ON f.id=s.spec_definition_id
  JOIN public.devices d ON d.id=s.device_id
  WHERE NOT d.catalog_normalized AND s.state='KNOWN' AND d.slug IN (${devices.map(d=>quote(d.slug)).join(',')})
)
UPDATE public.device_specs s SET presentation=s.presentation||jsonb_build_object('keySpec',r.position<=6,'keySpecOrder',r.position-1)
FROM ranked r WHERE r.id=s.id AND NOT(s.presentation ? 'keySpec');
UPDATE public.devices SET catalog_normalized=true WHERE NOT catalog_normalized AND slug IN (${devices.map(d=>quote(d.slug)).join(",")});
COMMIT;`;
  const hardeningSql=`BEGIN;
REVOKE SELECT ON public.devices FROM anon;
REVOKE SELECT(full_specs,key_specs) ON public.devices FROM anon;
GRANT SELECT(id,slug,brand_key,brand_name,name,short_description,long_description,positioning,release_year,availability,type_label,status_label,media,product_image_url,official_image_url,image_alt,product_url,official_product_url,buy_url,category,route_label,route_description,best_for,not_ideal_for,key_limitations,catalog_normalized,publication_status) ON public.devices TO anon;
DROP POLICY devices_select_published_public ON public.devices;
CREATE POLICY devices_select_published_public ON public.devices FOR SELECT TO anon USING(publication_status='published');
COMMIT;`;
  return { inventory, model, devices, activationSql,hardeningSql, sql: ["BEGIN;", "SET CONSTRAINTS ALL DEFERRED;",initializeLegacy, ...statements, "COMMIT;"].join("\n") };
}
