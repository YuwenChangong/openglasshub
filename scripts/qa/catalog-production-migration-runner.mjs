import { readFile } from "node:fs/promises";
import { fileURLToPath,pathToFileURL } from "node:url";
import path from "node:path";
import { loadCatalogBundle,claimAuthorization,executeCatalogMigrations,fail } from "./lib/catalog-production-migration-transport.mjs";
import { prepareCatalogConnection,createCatalogPostgresAdapter } from "./lib/catalog-production-migration-postgres-adapter.mjs";

const ROOT=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
export async function runCatalogMigrationMain({args=process.argv.slice(2),root=ROOT,environment=process.env}={}) {
  if(!args.length)return {status:"NOT_AUTHORIZED",connections:0,sqlStatements:0};
  if(args.length!==3||args[0]!=="--execute-production"||args[1]!=="--authorization-receipt"||!args[2])fail("STAGE_B_CLI_SCOPE_INVALID");
  const receipt=JSON.parse(await readFile(args[2],"utf8"));
  const bundle=await loadCatalogBundle({root,receipt});
  const config=await prepareCatalogConnection({environment});
  return executeCatalogMigrations({bundle,open:createCatalogPostgresAdapter({config}),claim:id=>claimAuthorization(root,id)});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{const result=await runCatalogMigrationMain();console.log(JSON.stringify(result));if(result.status!=="PASS"&&result.status!=="NOT_AUTHORIZED")process.exitCode=1;}
  catch(error){console.log(JSON.stringify({status:"BLOCKED",firstFailure:/^STAGE_B_[A-Z_]+$/.test(error?.code??"")?error.code:"STAGE_B_LOCAL_VALIDATION_FAILED"}));process.exitCode=1;}
}
