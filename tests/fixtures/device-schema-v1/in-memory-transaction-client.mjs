import { writeFile } from "node:fs/promises";
import { buildDeviceRows } from "../../../scripts/migrate-static-device-catalog-to-supabase.mjs";

const ENTITIES = Object.freeze(["definition", "device", "source", "sourceLink", "spec", "evidence", "compatibility"]);

function keyFor(entity, row) {
  if (entity === "definition") return row.key;
  if (entity === "device" || entity === "compatibility") return row.slug ?? row.deviceSlug;
  if (entity === "source") return row.url;
  if (entity === "sourceLink") return `${row.deviceSlug}\u0000${row.sourceUrl}`;
  if (entity === "spec") return `${row.deviceSlug}\u0000${row.definitionKey}\u0000${row.region}\u0000${row.variant}`;
  if (entity === "evidence") return `${row.deviceSlug}\u0000${row.definitionKey}\u0000${row.sourceUrl}\u0000${String(row.claimedValue)}`;
  throw new TypeError(`Unsupported local fixture entity: ${entity}`);
}

function upsert(rows, entity, row) {
  const key = keyFor(entity, row);
  const index = rows[entity].findIndex((candidate) => keyFor(entity, candidate) === key);
  if (index === -1) rows[entity].push(structuredClone(row));
  else rows[entity][index] = { ...rows[entity][index], ...structuredClone(row) };
}

export async function createLocalTransactionClient() {
  const snapshotPath = process.env.OPENGLASS_LOCAL_SCHEMA_V1_SNAPSHOT_PATH;
  if (!snapshotPath) throw new Error("OPENGLASS_LOCAL_SCHEMA_V1_SNAPSHOT_PATH is required by the owned in-memory fixture");
  const bootstrapRows = await buildDeviceRows();
  const rows = Object.fromEntries(ENTITIES.map((entity) => [entity, []]));
  for (const row of bootstrapRows) rows.device.push({ ...row, publicationStatus: row.publication_status });
  return {
    async transaction(work) {
      const before = structuredClone(rows);
      try {
        await work({
          async upsert(entity, row) {
            if (entity === "compatibility") {
              upsert(rows, entity, row);
              const device = rows.device.find((candidate) => candidate.slug === row.deviceSlug);
              if (!device) throw new Error(`Compatibility requires an existing device: ${row.deviceSlug}`);
              device.key_specs = row.key_specs;
              device.full_specs = row.full_specs;
              return;
            }
            upsert(rows, entity, row);
          },
        });
        await writeFile(snapshotPath, JSON.stringify({
          definitions: rows.definition,
          devices: rows.device,
          sources: rows.source,
          sourceLinks: rows.sourceLink,
          specs: rows.spec,
          evidence: rows.evidence,
          compatibility: rows.compatibility,
        }), "utf8");
      } catch (error) {
        for (const entity of ENTITIES) rows[entity] = before[entity];
        throw error;
      }
    },
  };
}
