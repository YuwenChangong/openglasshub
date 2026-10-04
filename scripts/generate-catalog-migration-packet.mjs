import {readFile,mkdir,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {prepareCanonicalCatalogImport} from "./lib/catalog-canonical-import.mjs";

const root=path.resolve(import.meta.dirname,"..");
const publication=JSON.parse(await readFile(path.join(root,"artifacts/qa/product-publication-cohort-v1/publication-contract.json"),"utf8"));
const prepared=await prepareCanonicalCatalogImport({root,publication});
const directory=path.join(root,"artifacts/qa/catalog-migration-packet-v1");
await mkdir(directory,{recursive:true});
const files={"canonical-import.sql":prepared.sql,"canonical-activate.sql":prepared.activationSql,"canonical-public-read-hardening.sql":prepared.hardeningSql};
const hashes={};
for(const [name,sql] of Object.entries(files)){await writeFile(path.join(directory,name),sql+"\n");hashes[name]=createHash('sha256').update(sql+"\n").digest('hex');}
const migrations=["supabase/migrations/20261004003349_public_device_detail_v1.sql","supabase/migrations/20261004014637_catalog_editor_presentation_v1.sql"];
const migrationHashes=Object.fromEntries(await Promise.all(migrations.map(async name=>[name,createHash('sha256').update(await readFile(path.join(root,name))).digest('hex')])));
const packet={format:"catalog-migration-packet-v1",executionAuthorized:false,productionSqlExecutions:0,productionRequests:0,migrations,migrationHashes,
  sourceKnown:prepared.inventory.parameterLedger.filter(row=>row.state==='KNOWN').length,knownValueDrops:"NOT_MEASURED_BY_GENERATION",
  importMaximums:{devices:prepared.devices.length,definitions:prepared.model.definitions.length,sources:prepared.model.sources.length,sourceLinks:prepared.model.sourceLinks.length,specs:prepared.model.specs.length,evidence:prepared.model.evidence.length},
  metadataUpdateMaximums:{nullSchemaType:prepared.devices.length,initialKeySpecPresentation:prepared.inventory.parameterLedger.filter(row=>row.state==='KNOWN').length,canonicalActivation:publication.published_count},
  existingRows:"INSERT_ONLY_FACTS_NULL_SCHEMA_TYPE_INITIALIZATION_ONLY",publicationAuthority:"artifacts/qa/product-publication-cohort-v1/publication-contract.json",publicationExistingRows:"PRESERVE_EXISTING_STATE",
  keySpecInitialization:"FIRST_ACTIVATION_ONLY_KNOWN_TOP_6_IF_NO_EXISTING_EXPLICIT_SELECTION",
  publicGrantHardening:"SEPARATE_FINAL_TRANSACTION_AFTER_COMPATIBLE_APP_READER_DEPLOYMENT_PRESERVE_ADMIN_LEGACY_DATA",
  canonicalActivation:"SEPARATE_TRANSACTION_ALL_EXPECTED_IDENTITIES_REQUIRED",hashes,
  proof:"Consult exact-hash genuine-local receipt; generated files alone are not acceptance evidence."};
await writeFile(path.join(directory,"manifest.json"),JSON.stringify(packet,null,2)+"\n");
console.log("CATALOG_MIGRATION_PACKET=GENERATED_NOT_EXECUTED");console.log(`PATH=${directory}`);
