import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import * as transport from "./lib/catalog-production-migration-transport.mjs";
import {createCatalogPostgresAdapter} from "./lib/catalog-production-migration-postgres-adapter.mjs";

const root=path.resolve(fileURLToPath(new URL("../..",import.meta.url)));
const now=Date.parse("2026-10-08T00:00:00Z");
const identity={database:"synthetic",role:"synthetic",port:5432,system_identifier:"synthetic"};
async function bundle(){
  const receipt={format:"catalog-stage-b-authorization-v1",authorizationId:"stage-b-diagnostic-test",candidateHead:"a".repeat(40),executionCheckoutSha256:"b".repeat(64),artifacts:transport.APPROVED_ARTIFACTS,toolingHashes:Object.fromEntries(await Promise.all(transport.TOOLING_FILES.map(async f=>[f,transport.sha256(await readFile(path.join(root,f)))]))),targetClass:"SUPAVISOR_SESSION",serverIdentitySha256:transport.sha256(JSON.stringify(identity)),windowStartUTC:"2026-10-08T00:00:00Z",windowEndUTC:"2026-10-08T00:44:00Z",maxAttempts:1,automaticRetry:false,readOnlyStatementBudget:30,writeTransactionBudget:2,humanGates:{productionDeploymentConfirmed:true,backupRecoveryReady:true,catalogWritesPaused:true,currentReaderCompatible:true}};
  return transport.loadCatalogBundle({root,receipt,now,inspectSource:()=>({head:receipt.candidateHead,clean:true,checkoutIdentitySha256:receipt.executionCheckoutSha256})});
}
const secret="SECRET_CANARY_URL_PASSWORD_PARAMETERS";
for(const [raw,origin,failureClass,sqlstate,timeoutClass] of [
  [Object.assign(new Error(secret),{code:"42501"}),"database","POSTGRES_SQL_ERROR","42501","UNKNOWN"],
  [Object.assign(new Error(secret),{code:"57014"}),"database","POSTGRES_QUERY_CANCELLED","57014","QUERY_CANCELLED_REASON_UNKNOWN"],
  [new Error("Query read timeout"),"driver","DRIVER_QUERY_TIMEOUT","UNKNOWN","DRIVER_QUERY_TIMEOUT"],
  [Object.assign(new Error(secret),{code:"ECONNRESET"}),"network","TCP_CONNECTION_RESET","UNKNOWN","UNKNOWN"],
  [Object.assign(new TypeError(secret),{code:"ERR_INVALID_ARG_TYPE"}),"driver","DRIVER_CONFIGURATION_ERROR","UNKNOWN","UNKNOWN"],
  [new TypeError(secret),"application","UNEXPECTED_APPLICATION_ERROR","UNKNOWN","UNKNOWN"],
]){
  test(`STATE_SQL failure safely preserves ${failureClass}`,async()=>{
    const queries=[];let claims=0,opens=0,closes=0;
    const result=await transport.executeCatalogMigrations({bundle:await bundle(),now:()=>now,claim:async()=>{claims++;},open:async()=>{
      opens++;return {connected:true,query:async sql=>{queries.push(sql);if(sql===transport.IDENTITY_SQL)return{rows:[identity]};if(sql===transport.STATE_SQL)throw raw;return{rows:[]};},close:async()=>{closes++;}};
    }});
    assert.equal(result.status,"BLOCKED");
    assert.equal(result.failureDiagnostic?.operation,"STATE_QUERY");
    assert.equal(result.failureDiagnostic?.origin,origin);
    assert.equal(result.failureDiagnostic?.failureClass,failureClass);
    assert.equal(result.failureDiagnostic?.sqlstate,sqlstate);
    assert.equal(result.failureDiagnostic?.timeoutClass,timeoutClass);
    assert.equal(result.failureDiagnostic?.sessionConnected,true);
    assert.ok(Number.isFinite(result.failureDiagnostic?.durationMs));
    assert.ok(Object.isFrozen(result.failureDiagnostic));
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.equal(claims,1);assert.equal(opens,1);assert.equal(closes,1);
    assert.equal(result.writeTransactions,0);assert.equal(result.committed,0);assert.equal(result.automaticRetry,false);
    assert.equal(queries.at(-1),"ROLLBACK;");
  });
}
test("BEGIN and COMMIT failures retain their exact read-only operation",async()=>{
  for(const [failedIndex,operation] of [[0,"IDENTITY_BEGIN"],[1,"IDENTITY_QUERY"],[2,"IDENTITY_COMMIT"],[3,"STATE_BEGIN"],[5,"STATE_COMMIT"]]){
    let index=0;
    const result=await transport.executeCatalogMigrations({bundle:await bundle(),now:()=>now,claim:async()=>{},open:async()=>({connected:true,query:async sql=>{
      if(index++===failedIndex)throw Object.assign(new Error(secret),{code:"08006"});
      if(sql===transport.IDENTITY_SQL)return{rows:[identity]};
      if(sql===transport.STATE_SQL)return{rows:[{state:{}}]};
      return{rows:[]};
    },close:async()=>{}})});
    assert.equal(result.failureDiagnostic?.operation,operation);
    assert.equal(result.failureDiagnostic?.sqlstate,"08006");
    assert.equal(result.writeTransactions,0);
  }
});
test("connection failure and application classification failure remain distinct",async()=>{
  const b=await bundle();
  const openFailure=await transport.executeCatalogMigrations({bundle:b,now:()=>now,claim:async()=>{},open:async()=>{throw transport.catalogConnectionFailure(Object.assign(new Error(secret),{code:"28P01"}));}});
  assert.equal(openFailure.firstFailure,"STAGE_B_CONNECTION_FAILED");
  assert.equal(openFailure.connectionDiagnostic.sqlstate,"28P01");
  assert.equal(openFailure.failureDiagnostic?.operation,"CONNECTION_OPEN");
  assert.equal(openFailure.failureDiagnostic?.origin,"database");
  const classification=await transport.executeCatalogMigrations({bundle:b,now:()=>now,claim:async()=>{},open:async()=>({connected:true,query:async sql=>({rows:sql===transport.IDENTITY_SQL?[identity]:sql===transport.STATE_SQL?[{state:{ledger:[],ledgerShape:{owner:"postgres"}}}]:[]}),close:async()=>{}})});
  assert.equal(classification.firstFailure,"STAGE_B_LEDGER_SCHEMA_DIVERGENCE");
  assert.equal(classification.failureDiagnostic?.operation,"STATE_CLASSIFY");
  assert.equal(classification.failureDiagnostic?.origin,"application");
});
test("adapter retains connection-loss provenance without exposing its message",async()=>{
  let onError;
  class Client {on(name,callback){if(name==="error")onError=callback;}async connect(){}async end(){}async query(){return{rows:[]};}}
  const session=await createCatalogPostgresAdapter({config:{},Client})();
  assert.equal(session.connected,true);
  onError(Object.assign(new Error(secret),{code:"ECONNRESET"}));
  assert.equal(session.connected,false);
  await assert.rejects(session.query(transport.STATE_SQL),error=>{
    assert.equal(error.code,"STAGE_B_CONNECTION_LOST");
    assert.equal(error.connectionDiagnostic?.failureClass,"TCP_CONNECTION_RESET");
    assert.ok(!JSON.stringify(error).includes(secret));return true;
  });
  await session.close();
});
test("sanitized connection-open timeout is a driver failure, not an application error",()=>{
  const error=transport.catalogConnectionFailure(new Error("timeout expired"));
  const diagnostic=transport.catalogFailureDiagnostic(error,{operation:"CONNECTION_OPEN"});
  assert.equal(diagnostic.origin,"driver");
  assert.equal(diagnostic.failureClass,"CONNECTION_OPEN_TIMEOUT");
  assert.equal(diagnostic.timeoutClass,"CONNECTION_OPEN_TIMEOUT");
});
test("bounded nested causes and aggregates retain safe PostgreSQL and timeout evidence",()=>{
  for(const [inner,origin,failureClass,sqlstate] of [
    [Object.assign(new Error(secret),{code:"42501"}),"database","POSTGRES_SQL_ERROR","42501"],
    [Object.assign(new Error(secret),{code:"57014"}),"database","POSTGRES_QUERY_CANCELLED","57014"],
    [new Error("Query read timeout"),"driver","DRIVER_QUERY_TIMEOUT","UNKNOWN"],
  ])for(const error of [new Error(secret,{cause:inner}),new AggregateError([inner],secret)]){
    const diagnostic=transport.catalogFailureDiagnostic(error,{operation:"STATE_QUERY"});
    assert.equal(diagnostic.origin,origin);assert.equal(diagnostic.failureClass,failureClass);assert.equal(diagnostic.sqlstate,sqlstate);
    assert.ok(!JSON.stringify(diagnostic).includes(secret));
  }
});
test("conflicting aggregate origins are unknown regardless of child order",()=>{
  const children=[Object.assign(new Error(secret),{code:"28P01"}),Object.assign(new Error(secret),{code:"ECONNRESET"})];
  const a=transport.catalogFailureDiagnostic(new AggregateError(children,secret),{operation:"STATE_QUERY"});
  const b=transport.catalogFailureDiagnostic(new AggregateError([...children].reverse(),secret),{operation:"STATE_QUERY"});
  assert.deepEqual(a,b);assert.equal(a.origin,"unknown");assert.equal(a.sqlstate,"UNKNOWN");
});
test("diagnostics expose only fixed metadata and handle cyclic causes",()=>{
  const error=Object.assign(new Error(secret),{code:"SECRET_CANARY_CODE",detail:secret,parameters:secret,host:secret});error.cause=error;
  const diagnostic=transport.catalogFailureDiagnostic(error,{operation:secret,durationMs:Infinity,sessionConnected:secret});
  assert.equal(diagnostic.operation,"UNKNOWN");assert.equal(diagnostic.durationMs,"UNKNOWN");assert.equal(diagnostic.sessionConnected,"UNKNOWN");
  assert.ok(!JSON.stringify(diagnostic).includes(secret));
});
test("truncated aggregates do not promote incomplete evidence",()=>{
  const children=Array.from({length:8},()=>Object.assign(new Error(secret),{code:"42501"}));
  children.push(Object.assign(new Error(secret),{code:"ECONNRESET"}));
  const diagnostic=transport.catalogFailureDiagnostic(new AggregateError(children,secret),{operation:"STATE_QUERY"});
  assert.equal(diagnostic.origin,"unknown");assert.equal(diagnostic.sqlstate,"UNKNOWN");
});
test("adapter sanitization preserves conservative classification of truncated aggregates",async()=>{
  const children=Array.from({length:8},()=>Object.assign(new Error(secret),{code:"ENETUNREACH"}));
  children.push(Object.assign(new Error(secret),{code:"ECONNREFUSED"}));
  for(const errors of [children,[...children].reverse()]){
    class Client {on(){}async connect(){throw new AggregateError(errors,secret);}async end(){}}
    await assert.rejects(createCatalogPostgresAdapter({config:{},Client})(),error=>{
      const diagnostic=transport.catalogFailureDiagnostic(error,{operation:"CONNECTION_OPEN"});
      assert.equal(diagnostic.origin,"unknown");assert.equal(diagnostic.failureClass,"UNKNOWN_AFTER_SAFE_DIAGNOSTICS");
      assert.equal(error.connectionDiagnostic.evidenceComplete,false);
      assert.ok(!JSON.stringify(error).includes(secret));return true;
    });
  }
});
test("adapter preserves safe SQLSTATE and conflicting evidence before discarding raw errors",async()=>{
  for(const raw of [
    new Error(secret,{cause:Object.assign(new Error(secret),{code:"42501"})}),
    new AggregateError([Object.assign(new Error(secret),{code:"ECONNRESET"}),Object.assign(new Error(secret),{code:"42501"})],secret),
    new AggregateError([Object.assign(new Error(secret),{code:"42501"}),Object.assign(new Error(secret),{code:"ECONNRESET"})],secret),
    new AggregateError([Object.assign(new Error(secret),{code:"ECONNRESET"}),new Error("Query read timeout")],secret),
  ]){
    const expected=transport.catalogFailureDiagnostic(raw,{operation:"CONNECTION_OPEN"});
    class Client {on(){}async connect(){throw raw;}async end(){}}
    await assert.rejects(createCatalogPostgresAdapter({config:{},Client})(),error=>{
      const diagnostic=transport.catalogFailureDiagnostic(error,{operation:"CONNECTION_OPEN"});
      for(const key of ["origin","failureClass","sqlstate","timeoutClass"])assert.equal(diagnostic[key],expected[key]);
      assert.ok(!JSON.stringify(error).includes(secret));return true;
    });
  }
});
