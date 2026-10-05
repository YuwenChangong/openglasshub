import assert from "node:assert/strict";
import test from "node:test";
import { readFile,mkdtemp,rm } from "node:fs/promises";
import {execFileSync} from "node:child_process";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { APPROVED_ARTIFACTS, TOOLING_FILES, loadCatalogBundle, validateAuthorization, executeCatalogMigrations,claimAuthorization,classifyState,checkoutIdentity } from "./lib/catalog-production-migration-transport.mjs";
import { runCatalogMigrationMain } from "./catalog-production-migration-runner.mjs";
import {prepareCatalogConnection,createCatalogPostgresAdapter} from "./lib/catalog-production-migration-postgres-adapter.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const head = "bb683360b7c4bfff40a2a6da5a79f92b224a2271";
const now = Date.parse("2026-10-06T00:00:00Z");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export async function syntheticReceipt() {
  return {
    format: "catalog-stage-b-authorization-v1", authorizationId: "stage-b-test-001", candidateHead: head, executionCheckoutSha256:"a".repeat(64),
    artifacts: APPROVED_ARTIFACTS, toolingHashes: Object.fromEntries(await Promise.all(TOOLING_FILES.map(async file => [file, hash(await readFile(path.join(root,file)))]))),
    targetClass: "SUPAVISOR_SESSION", serverIdentitySha256: "a".repeat(64),
    windowStartUTC: "2026-10-06T00:00:00Z", windowEndUTC: "2026-10-06T00:45:00Z",
    maxAttempts: 1, automaticRetry: false, readOnlyStatementBudget: 30, writeTransactionBudget: 2,
    humanGates: { productionDeploymentConfirmed: true, backupRecoveryReady: true, catalogWritesPaused: true, currentReaderCompatible: true },
  };
}
const source = () => ({ head, clean: true, checkoutIdentitySha256:"a".repeat(64) });
test("no execute flag and module imports open zero connections", async () => {
  let opened=0;
  const result=await runCatalogMigrationMain({ args: [], root, open:async()=>{opened++;throw new Error("DO_NOT_CONNECT");} });
  assert.equal(result.status,"NOT_AUTHORIZED");assert.equal(opened,0);
});
test("authorization rejects widened scope, retries and invalid windows", async () => {
  const good=await syntheticReceipt();validateAuthorization(good,now);
  for(const change of [{sql:"DROP TABLE public.devices"},{maxAttempts:2},{automaticRetry:true},{targetClass:"DIRECT"},{humanGates:{...good.humanGates,backupRecoveryReady:false}},{windowEndUTC:"2026-10-06T01:00:00Z"}]) {
    assert.throws(()=>validateAuthorization({...good,...change},now));
  }
  assert.throws(()=>validateAuthorization(good,now+46*60000));
});
test("wrong HEAD, hash, arbitrary path and appended SQL reject before connection", async () => {
  const good=await syntheticReceipt();
  for(const change of [{candidateHead:"b".repeat(40)},{artifacts:{...good.artifacts,packet:{...good.artifacts.packet,sha256:"0".repeat(64)}}},{artifacts:{...good.artifacts,migrations:[{...good.artifacts.migrations[0],path:"../../other.sql"},good.artifacts.migrations[1]]}},{sql:"SELECT 1; DELETE FROM public.devices"}]) {
    await assert.rejects(loadCatalogBundle({root,receipt:{...good,...change},now,inspectSource:source}));
  }
  await assert.rejects(loadCatalogBundle({root,receipt:good,now,inspectSource:()=>({head,clean:false})}));
});
test("receipt binds every tooling and schema-proof byte", async()=>{
  const good=await syntheticReceipt();
  await assert.rejects(loadCatalogBundle({root,receipt:{...good,toolingHashes:{...good.toolingHashes,[TOOLING_FILES[0]]:"0".repeat(64)}},now,inspectSource:source}));
});
test("unvalidated bundles cannot reach a session",async()=>{
  let opened=0;
  await assert.rejects(executeCatalogMigrations({bundle:{},open:async()=>{opened++;},claim:async()=>{},now:()=>now}));
  assert.equal(opened,0);
});
test("durable authorization consumption rejects reuse across processes",async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"catalog-stage-b-journal-test-"));
  try{
    execFileSync("git",["init",directory],{stdio:"ignore"});
    assert.notEqual(checkoutIdentity(directory),checkoutIdentity(root));
    await claimAuthorization(directory,"stage-b-durable-test");
    await assert.rejects(claimAuthorization(directory,"stage-b-durable-test"));
    await assert.rejects(claimAuthorization(directory,"../arbitrary"));
    const script=`import {claimAuthorization} from ${JSON.stringify(new URL("./lib/catalog-production-migration-transport.mjs",import.meta.url).href)};try{await claimAuthorization(${JSON.stringify(directory)},'stage-b-durable-test');process.exitCode=2;}catch{console.log('DURABLE_REUSE_REJECTED');}`;
    assert.match(execFileSync(process.execPath,["--input-type=module","-e",script],{encoding:"utf8"}),/DURABLE_REUSE_REJECTED/);
  }finally{assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith("catalog-stage-b-journal-test-"));await rm(directory,{recursive:true,force:true});}
});
test("imports and native no-flag CLI ignore Production canary environment",()=>{
  const environment={...process.env,P9_PRODUCTION_DATABASE_URL:"PRODUCTION_SECRET_CANARY_MUST_NEVER_BE_PRINTED"};
  const result=execFileSync(process.execPath,[path.join(root,"scripts/qa/catalog-production-migration-runner.mjs")],{encoding:"utf8",env:environment});
  assert.equal(JSON.parse(result).status,"NOT_AUTHORIZED");assert.ok(!result.includes("SECRET_CANARY"));
  const script=`import ${JSON.stringify(new URL('./catalog-production-migration-runner.mjs',import.meta.url).href)};console.log('IMPORT_ONLY');`;
  assert.equal(execFileSync(process.execPath,["--input-type=module","-e",script],{env:environment,encoding:"utf8"}).trim(),"IMPORT_ONLY");
});
test("unknown CLI flags and SQL/stdin arguments cannot execute",async()=>{
  for(const args of [["--preflight"],["--sql","SELECT 1"],["--execute-production","--authorization-receipt","x","--retry"],["--execute-production","--stdin"]])await assert.rejects(runCatalogMigrationMain({args,root}));
});
test("connection source rejects direct, non-approved and missing CA before client construction",async()=>{
  for(const environment of [{},{P9_PRODUCTION_DATABASE_URL:"postgresql://postgres:synthetic@db.xcbnxzjlsvtgzixurcof.supabase.co:5432/postgres"},{P9_PRODUCTION_DATABASE_URL:"postgresql://postgres:synthetic@127.0.0.1:5432/postgres"},{P9_PRODUCTION_DATABASE_URL:"postgresql://postgres.xcbnxzjlsvtgzixurcof:synthetic@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"}])await assert.rejects(prepareCatalogConnection({environment}));
});
test("adapter has a single connection attempt and no hidden reconnect",async()=>{
  let connects=0,ends=0;
  class SyntheticClient{on(){}async connect(){connects++;throw new Error("SECRET_CANARY");}async end(){ends++;}}
  const open=createCatalogPostgresAdapter({config:{},Client:SyntheticClient});
  await assert.rejects(open(),/STAGE_B_CONNECTION_FAILED/);await assert.rejects(open(),/STAGE_B_RECONNECT_FORBIDDEN/);assert.equal(connects,1);assert.equal(ends,1);
});
test("validated migration bytes are read once, never replaced after hashing",async()=>{
  const reads=new Map();
  const bundle=await loadCatalogBundle({root,receipt:await syntheticReceipt(),now,inspectSource:source,readArtifact:async file=>{
    const count=(reads.get(file)??0)+1;reads.set(file,count);
    return count===1?readFile(file):Buffer.from("SELECT 'unreviewed replacement';");
  }});
  for(const migration of bundle.migrations){assert.equal(reads.get(path.join(root,migration.path)),1);assert.equal(hash(migration.sql),migration.sha256);}
});
test("already-applied classification rejects unrelated ledger SQL",()=>{
  const state={schema:{},ledgerShape:{owner:"postgres"},ledger:[{version:"1",name:"one",statements:["SELECT 1;"]}]};
  const bundle={migrations:[{version:"1",name:"one",sha256:hash("SELECT 2;")}],states:["0".repeat(64),hash(JSON.stringify({schema:state.schema,ledgerShape:state.ledgerShape}))]};
  assert.throws(()=>classifyState(state,bundle),/STAGE_B_LEDGER_SCHEMA_DIVERGENCE/);
});
test("authorization rejects a different clone before any connection",async()=>{
  const good=await syntheticReceipt();
  await assert.rejects(loadCatalogBundle({root,receipt:good,now,inspectSource:()=>({...source(),checkoutIdentitySha256:"b".repeat(64)})}),/STAGE_B_CHECKOUT_IDENTITY_MISMATCH/);
});
test("identity failure remains a safe receipt when connection close also fails",async()=>{
  const bundle=await loadCatalogBundle({root,receipt:await syntheticReceipt(),now,inspectSource:source});
  const result=await executeCatalogMigrations({bundle,claim:async()=>{},now:()=>now,open:async()=>({query:async()=>({rows:[{wrong:"identity"}]}),close:async()=>{throw new Error("OWNED_SYNTHETIC_CLOSE_LOSS");}})});
  assert.equal(result.status,"BLOCKED");assert.equal(result.firstFailure,"STAGE_B_DATABASE_IDENTITY_MISMATCH");assert.equal(result.connectionClose,"FAILED");
});
test("window expiration during durable claim cannot open a connection",async()=>{
  const bundle=await loadCatalogBundle({root,receipt:await syntheticReceipt(),now,inspectSource:source});
  let time=now,opened=0;
  const result=await executeCatalogMigrations({bundle,now:()=>time,claim:async()=>{time=bundle.deadline;},open:async()=>{opened++;throw new Error("EXPIRED_OPEN");}});
  assert.equal(opened,0);assert.equal(result.firstFailure,"STAGE_B_WINDOW_EXPIRED");
});
