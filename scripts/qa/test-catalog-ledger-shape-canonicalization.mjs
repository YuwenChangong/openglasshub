import assert from "node:assert/strict";
import test from "node:test";
import * as transport from "./lib/catalog-production-migration-transport.mjs";

const {classifyState,schemaDigest,sha256}=transport;
// Core metadata is asserted by the owned canonical-50 PostgreSQL rehearsal.
const core=[
  {name:"version",type:"text",notNull:true},
  {name:"statements",type:"text[]",notNull:false},
  {name:"name",type:"text",notNull:false},
];
const baselineShape={owner:"postgres",columns:core,primaryKey:"PRIMARY KEY (version)"};
// Recorded pre-Stage-B backup metadata; independently matched to the forensic capture hash.
const capturedShape={...baselineShape,columns:[...core,
  {name:"created_by",type:"text",notNull:false},
  {name:"idempotency_key",type:"text",notNull:false},
  {name:"rollback",type:"text[]",notNull:false},
]};
const migrations=["first","second"].map((sql,i)=>({version:String(i+1),name:sql,sql,sha256:sha256(sql)}));
const states=[0,1,2].map(stage=>({
  schema:{relations:[{name:"devices",acl:"baseline"}],columns:[],constraints:[],indexes:[],policies:[],views:null,triggers:[],functions:[],stage},
  ledgerShape:structuredClone(baselineShape),
  ledger:migrations.slice(0,stage).map(m=>({version:m.version,name:m.name,statements:[m.sql]})),
}));
const bundle={migrations,states:states.map(schemaDigest)};
const withShape=(stage,shape)=>({...structuredClone(states[stage]),ledgerShape:structuredClone(shape)});
const diverges=work=>assert.throws(work,error=>error.code==="STAGE_B_LEDGER_SCHEMA_DIVERGENCE"&&!(error instanceof TypeError));
const changedColumn=(name,change)=>({...baselineShape,columns:core.map(c=>c.name===name?{...c,...change}:c)});

test("recorded real ledger metadata matches the offline forensic capture",()=>{
  assert.equal(sha256(JSON.stringify(capturedShape)),"c3e6c73b7fac966679a2331fdc400c693588bc0ba7fd85274716fbdaafb5862a");
});
for(const stage of [0,1,2]){
  test(`original repository core shape classifies stage ${stage}`,()=>assert.equal(classifyState(states[stage],bundle),stage));
  test(`known captured nullable extras classify stage ${stage}`,()=>assert.equal(classifyState(withShape(stage,capturedShape),bundle),stage));
}
for(const column of core){
  test(`missing core column ${column.name} fails closed`,()=>diverges(()=>classifyState(withShape(0,{...baselineShape,columns:core.filter(c=>c.name!==column.name)}),bundle)));
  test(`duplicated core column ${column.name} fails closed`,()=>diverges(()=>classifyState(withShape(0,{...baselineShape,columns:[...core,column]}),bundle)));
  test(`wrong core type ${column.name} fails closed`,()=>diverges(()=>classifyState(withShape(0,changedColumn(column.name,{type:"integer"})),bundle)));
  test(`wrong core nullability ${column.name} fails closed`,()=>diverges(()=>classifyState(withShape(0,changedColumn(column.name,{notNull:!column.notNull})),bundle)));
}
test("new nullable extra column is accepted",()=>assert.equal(classifyState(withShape(0,{...baselineShape,columns:[...core,{name:"optional",type:"jsonb",notNull:false}]}),bundle),0));
test("new NOT NULL extra column fails closed",()=>diverges(()=>classifyState(withShape(0,{...baselineShape,columns:[...core,{name:"mandatory",type:"text",notNull:true}]}),bundle)));
test("wrong owner fails closed",()=>diverges(()=>classifyState(withShape(0,{...baselineShape,owner:"other"}),bundle)));
test("changed primary key fails closed",()=>diverges(()=>classifyState(withShape(0,{...baselineShape,primaryKey:"PRIMARY KEY (name)"}),bundle)));
test("incorrect target migration ledger row fails closed",()=>{
  const state=structuredClone(states[1]);state.ledger[0].name="wrong";diverges(()=>classifyState(state,bundle));
});
test("incorrect migration statement hash fails closed",()=>{
  const state=structuredClone(states[1]);state.ledger[0].statements=["different"];diverges(()=>classifyState(state,bundle));
});
for(const component of ["relations","columns","constraints","indexes","policies","views","triggers","functions"]){
  test(`unrelated public schema ${component} drift remains rejected`,()=>{
    const state=withShape(0,capturedShape);state.schema[component]=[{unexpected:true}];diverges(()=>classifyState(state,bundle));
  });
}
test("relation ACL drift remains rejected with nullable extras",()=>{
  const state=withShape(0,capturedShape);state.schema.relations[0].acl="changed";diverges(()=>classifyState(state,bundle));
});
test("canonical output is deterministic, detached and does not hide RAW metadata",()=>{
  const raw=structuredClone(capturedShape),before=JSON.stringify(raw);
  const canonical=transport.canonicalizeLedgerShape(raw);
  assert.deepEqual(canonical,{owner:"postgres",columns:[core[0],core[2],core[1]],primaryKey:baselineShape.primaryKey});
  assert.equal(JSON.stringify(raw),before);
  assert.deepEqual(transport.canonicalizeLedgerShape({...raw,columns:[...raw.columns].reverse()}),canonical);
  canonical.columns[0].type="changed";assert.equal(raw.columns[0].type,"text");
  const state=withShape(0,raw);
  const expected={owner:"postgres",columns:[core[0],core[2],core[1]],primaryKey:baselineShape.primaryKey};
  assert.equal(schemaDigest(state),sha256(JSON.stringify({schema:state.schema,ledgerShape:expected})));
  assert.equal(raw.columns.length,6);
});
test("malformed shapes and ambiguous extra columns fail safely",()=>{
  for(const shape of [null,[],{}, {...baselineShape,columns:null}, {...baselineShape,columns:[...core,null]},
    {...baselineShape,columns:[...core,{name:"",type:"text",notNull:false}]},
    {...baselineShape,columns:[...core,{name:"extra",type:"",notNull:false}]},
    {...baselineShape,columns:[...core,{name:"extra",type:"text"}]},
    {...baselineShape,columns:[...core,{name:"extra",type:"text",notNull:"false"}]},
    {...baselineShape,columns:[...core,{name:"extra",type:"text",notNull:false},{name:"extra",type:"text",notNull:false}]},
  ])diverges(()=>transport.canonicalizeLedgerShape(shape));
});
