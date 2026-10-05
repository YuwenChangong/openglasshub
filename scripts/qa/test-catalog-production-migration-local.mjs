import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {withCanonicalBaselineDirectory,runLocalDisposableReplay,assertLocalReplayTarget} from "./local-disposable-supabase-replay.mjs";
import {APPROVED_ARTIFACTS,STATE_SQL,IDENTITY_SQL,LEDGER_SQL,TOOLING_FILES,schemaDigest,sha256,loadCatalogBundle,executeCatalogMigrations} from "./lib/catalog-production-migration-transport.mjs";
import {createCatalogPostgresAdapter} from "./lib/catalog-production-migration-postgres-adapter.mjs";

const root=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
const capture=process.argv.slice(2).join()==="--capture-schema-proof";
if(process.argv.length>2&&!capture)throw new Error("LOCAL_TEST_ARGUMENT_REJECTED");
const environment=Object.fromEntries(["PATH","SystemRoot","WINDIR","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","HOME","COMSPEC","SystemDrive","ProgramData"].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const receipt={format:"catalog-stage-b-local-rehearsal-v1",runId:randomUUID(),status:"BLOCKED",assertions:[],productionConnections:0,productionRequests:0};
const check=(value,label)=>{assert.ok(value,label);receipt.assertions.push(label);};
const migrations=await Promise.all(APPROVED_ARTIFACTS.migrations.map(async m=>({...m,sql:await readFile(path.join(root,m.path),"utf8")})));
try{
  await withCanonicalBaselineDirectory({root,environment},async canonicalBaselineDirectory=>runLocalDisposableReplay({root,environment,migrationLimit:50,canonicalBaselineDirectory,enforcementRunner:async()=>({status:"NOT_RUN",assertions:0}),afterMigrationLedgerValidated:async({target})=>{
    assertLocalReplayTarget(target);
    const url=new URL(target);assert.equal(url.hostname,"127.0.0.1");
    const localConfig={host:"127.0.0.1",port:Number(url.port)+1,user:"postgres",password:"postgres",database:"postgres",ssl:false,connectionTimeoutMillis:5000,statement_timeout:10000};
    const admin=new pg.Client(localConfig);await admin.connect();
    try{
      const initial=(await admin.query(STATE_SQL)).rows[0].state;
      check(initial.ledgerShape.owner==="postgres"&&initial.ledgerShape.primaryKey==="PRIMARY KEY (version)","CANONICAL_SUPABASE_LEDGER_OWNER_AND_KEY");
      check(initial.ledgerShape.columns.map(c=>c.name+":"+c.type).join()==="version:text,statements:text[],name:text","CANONICAL_LEDGER_INSERT_COLUMNS");
      if(capture){
        const states=[schemaDigest(initial)];
        for(const m of migrations){await admin.query("BEGIN;");await admin.query(m.sql);await admin.query(LEDGER_SQL,[m.version,m.name,[m.sql]]);states.push(schemaDigest((await admin.query(STATE_SQL)).rows[0].state));await admin.query("ROLLBACK;");
          // Rebuild the next state using committed exact migrations, not a mock.
          await admin.query("BEGIN;");await admin.query(m.sql);await admin.query(LEDGER_SQL,[m.version,m.name,[m.sql]]);await admin.query("COMMIT;");}
        const proof={format:"catalog-stage-b-schema-proof-v1",postgresMajor:17,ledgerOwner:"postgres",migrationHashes:migrations.map(m=>m.sha256),states};
        await mkdir(path.join(root,path.dirname(TOOLING_FILES[3])),{recursive:true});
        await writeFile(path.join(root,TOOLING_FILES[3]),JSON.stringify(proof,null,2)+"\n",{flag:"wx"});
        check(states.length===3,"ACTUAL_EXACT_MIGRATION_SCHEMA_FIXTURES_CAPTURED");return{status:"PASS"};
      }
      const identity=(await admin.query(IDENTITY_SQL)).rows[0];
      const head="bb683360b7c4bfff40a2a6da5a79f92b224a2271";
      const now=Date.parse("2026-10-06T00:00:00Z");
      const auth={format:"catalog-stage-b-authorization-v1",authorizationId:"stage-b-local-test",candidateHead:head,executionCheckoutSha256:"a".repeat(64),artifacts:APPROVED_ARTIFACTS,toolingHashes:Object.fromEntries(await Promise.all(TOOLING_FILES.map(async f=>[f,sha256(await readFile(path.join(root,f)))]))),targetClass:"SUPAVISOR_SESSION",serverIdentitySha256:sha256(JSON.stringify(identity)),windowStartUTC:"2026-10-06T00:00:00Z",windowEndUTC:"2026-10-06T00:45:00Z",maxAttempts:1,automaticRetry:false,readOnlyStatementBudget:30,writeTransactionBudget:2,humanGates:{productionDeploymentConfirmed:true,backupRecoveryReady:true,catalogWritesPaused:true,currentReaderCompatible:true}};
      const bundle=await loadCatalogBundle({root,receipt:auth,now,inspectSource:()=>({head,clean:true,checkoutIdentitySha256:auth.executionCheckoutSha256})});
      const observedStates=new Map([[0,initial]]);
      const run=async fault=>{
        const trace={connects:0,queries:[],claims:0};
        class OwnedLoopbackClient{
          constructor(config){assert.equal(config.host,"127.0.0.1");assert.equal(config.port,localConfig.port);this.client=new pg.Client(localConfig);}
          on(...args){return this.client.on(...args);}
          async connect(){trace.connects++;await this.client.connect();}
          async query(q){trace.queries.push(q.text);await fault?.(q,this.client);const result=await this.client.query(q);if(q.text===STATE_SQL)observedStates.set(result.rows[0].state.ledger.length,result.rows[0].state);return result;}
          async end(){await this.client.end();}
        }
        const result=await executeCatalogMigrations({bundle,open:createCatalogPostgresAdapter({config:localConfig,Client:OwnedLoopbackClient}),claim:async()=>{trace.claims++;},now:()=>now});
        check(trace.connects===1&&trace.claims===1,"SINGLE_CONNECTION_NO_RETRY");return{result,trace};
      };
      const baseline=schemaDigest(initial);
      // Actual PostgreSQL permission errors, not successful mocked DDL responses.
      const failure=await run(async(q,client)=>{if(q.text===migrations[0].sql)await client.query("SET LOCAL ROLE anon;");});
      check(failure.result.status==="BLOCKED"&&failure.trace.queries.includes("ROLLBACK;"),"MIGRATION_FAILURE_ROLLBACK");
      check(schemaDigest((await admin.query(STATE_SQL)).rows[0].state)===baseline,"MIGRATION_FAILURE_LEAVES_LEDGER_AND_SCHEMA_UNCHANGED");
      const ledgerFailure=await run(async(q,client)=>{if(q.text===LEDGER_SQL)await client.query("SET LOCAL ROLE anon;");});
      check(ledgerFailure.result.status==="BLOCKED"&&ledgerFailure.trace.queries.includes(migrations[0].sql),"LEDGER_FAILURE_AFTER_REAL_MIGRATION");
      check(schemaDigest((await admin.query(STATE_SQL)).rows[0].state)===baseline&&(await admin.query(STATE_SQL)).rows[0].state.ledger.length===0,"LEDGER_FAILURE_ROLLS_BACK_REAL_DDL");
      const positive=await run();
      check(positive.result.status==="PASS"&&positive.result.committed===2,"EXACT_MIGRATION_1_THEN_2_ATOMIC_ORDER_AND_POST_VERIFY");
      const final=(await admin.query(STATE_SQL)).rows[0].state;
      check(final.ledger.length===2&&final.ledger.every((row,i)=>row.statements.length===1&&sha256(row.statements[0])===migrations[i].sha256),"ATOMIC_LEDGER_RECORDS_EXACT_EXECUTED_BYTES");
      const skipped=await run();check(skipped.result.status==="PASS"&&skipped.result.writeTransactions===0&&skipped.result.migrations.every(m=>!m.executed),"ALREADY_APPLIED_CONSISTENT_SKIPS");
      let simulatedStage=0,opened=0,commits=0,rolledBack=false;
      const ambiguous=await executeCatalogMigrations({bundle,claim:async()=>{},now:()=>now,open:async()=>{opened++;return{query:async sql=>{
        if(sql===IDENTITY_SQL)return{rows:[identity]};
        if(sql===STATE_SQL)return{rows:[{state:observedStates.get(simulatedStage)}]};
        if(sql===LEDGER_SQL)simulatedStage++;
        if(sql==="ROLLBACK;")rolledBack=true;
        if(sql==="COMMIT;"&&simulatedStage===1){commits++;throw new Error("SIMULATED_LOST_COMMIT_ACK");}
        return{rows:[]};
      },close:async()=>{throw new Error("OWNED_SYNTHETIC_CLOSE_LOSS");}};}});
      check(ambiguous.status==="AMBIGUOUS"&&ambiguous.connectionClose==="FAILED"&&opened===1&&commits===1&&!rolledBack,"COMMIT_ACK_AND_CLOSE_LOSS_SYNTHETIC_CONTRACT_NO_RETRY_OR_ROLLBACK");
      await admin.query("UPDATE supabase_migrations.schema_migrations SET name='owned_test_divergence' WHERE version='20261004014637';");
      const diverged=await run();check(diverged.result.status==="BLOCKED"&&diverged.result.firstFailure==="STAGE_B_LEDGER_SCHEMA_DIVERGENCE"&&diverged.result.writeTransactions===0,"LEDGER_SCHEMA_DIVERGENCE_BLOCKS");
      return{status:"PASS"};
    }finally{await admin.end();}
  }}));
  receipt.status="PASS";receipt.cleanup="PASS";
}catch(error){receipt.firstFailure=error instanceof assert.AssertionError?error.message:"LOCAL_REHEARSAL_FAILED";process.exitCode=1;}
const directory=path.join(root,"artifacts/qa/catalog-stage-b-channel");await mkdir(directory,{recursive:true});
const file=path.join(directory,receipt.runId+".json");await writeFile(file,JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify(receipt));console.log("RECEIPT="+file);
