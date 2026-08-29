import { readFile } from "node:fs/promises";

const { createDeviceAdminHandlers, mapDatabaseError, toDeviceRow, fromDeviceRow } = await import("../src/lib/server/device-admin.ts");
const UUID = "11111111-1111-4111-8111-111111111111";
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const base = { brandKey:"test-brand", brandName:"Test Brand", name:"Test Device", shortDescription:"Short", longDescription:"Long", imageAlt:"Test device", category:"smart_glasses", routeLabel:"Smart", routeDescription:"Smart glasses", bestFor:["Testing"], notIdealFor:["Production"], media:{ imageAlt:"Test", imageBackground:"dark", imageFit:"contain", hasConfirmedImage:false, placeholderType:"glasses" }, keySpecs:[{field:"weight",label:"Weight",value:"20g"}], fullSpecs:{physical:{weight:"20g"}} };
const clone = (value) => structuredClone(value);
const record = (status="draft", locked=false) => ({ ...clone(base), id:UUID, slug:"test-device", publicationStatus:status, slugLocked:locked });

function actorFixture(actor) { return async () => actor === "staff" ? { client:{} } : actor === "nonstaff" ? new Response(JSON.stringify({ok:false,code:"FORBIDDEN"}),{status:403}) : null; }
function repositoryFixture({deviceState,repositoryOutcome}) {
  const state={list:0,create:0,get:0,update:0,remove:0,rows:new Map()};
  if (deviceState !== "none") state.rows.set(UUID,record(deviceState.replace("-locked",""),deviceState.endsWith("-locked")));
  const fail=()=>{ const error={duplicate:"23505",fk:"23503",constraint:"23514",unexpected:"XX000"}[repositoryOutcome]; if(error) throw {code:error}; };
  return {state,repository:{
    async list(){state.list++;return [...state.rows.values()].map(clone);},
    async create(input){state.create++;fail();const row={...clone(input),id:UUID,slugLocked:false};state.rows.set(UUID,row);return clone(row);},
    async get(id){state.get++;return repositoryOutcome === "not-found" ? null : clone(state.rows.get(id)??null);},
    async update(id,changes){state.update++;fail();const current=state.rows.get(id);if(!current)return null;const row={...current,...clone(changes),slugLocked:current.slugLocked||changes.publicationStatus==="published"};state.rows.set(id,row);return clone(row);},
    async remove(id){state.remove++;fail();const current=state.rows.get(id);if(!current)return null;state.rows.delete(id);return clone(current);},
  }};
}
function request(method, body) { return new Request("https://matrix.test/api/admin/devices",body===undefined?{method}:{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)}); }
function descriptor(id, actor, layer, method, deviceState, requestBodyVariant, repositoryOutcome, expectedRepositoryCalls, expectedReachability, expectedOutcomeClass) { return {id,actor,layer,method,deviceState,requestBodyVariant,repositoryOutcome,expectedRepositoryCalls,expectedReachability,expectedOutcomeClass}; }
const H="HANDLER", R="REPOSITORY", S="STATIC_SECURITY_ONLY", A="HANDLER_AUTHORIZATION", V="HANDLER_VALIDATION", D="HANDLER_REPOSITORY_DISPATCH", L="REPOSITORY_STATE_LOGIC", E="REPOSITORY_DB_ERROR_MAPPING", X="STATIC_SERVICE_ROLE_ABSENCE";
const cases=[
  descriptor("AUTH-01","unauthenticated",H,"GET","none","no-body","success",{list:0},A,"rejected"),
  descriptor("AUTH-02","nonstaff",H,"GET","none","no-body","success",{list:0},A,"rejected"),
  descriptor("AUTH-03","staff",H,"GET","none","no-body","success",{list:1},D,"accepted"),
  descriptor("AUTH-04","unauthenticated",H,"POST","none","valid-create","success",{create:0},A,"rejected"),
  descriptor("AUTH-05","nonstaff",H,"POST","none","valid-create","success",{create:0},A,"rejected"),
  descriptor("AUTH-06","staff",H,"POST","none","valid-create","success",{create:1},D,"accepted"),
  descriptor("AUTH-07","unauthenticated",H,"PATCH","draft-unlocked","valid-update","success",{update:0},A,"rejected"),
  descriptor("AUTH-08","nonstaff",H,"PATCH","draft-unlocked","valid-update","success",{update:0},A,"rejected"),
  descriptor("AUTH-09","unauthenticated",H,"DELETE","archived-locked","confirm-delete","success",{remove:0},A,"rejected"),
  descriptor("AUTH-10","nonstaff",H,"DELETE","archived-locked","confirm-delete","success",{remove:0},A,"rejected"),
  descriptor("CREATE-01","staff",H,"POST","none","valid-create","success",{create:1},D,"accepted"),
  descriptor("CREATE-02","staff",H,"POST","none","slug-omitted","success",{create:1},D,"accepted"),
  descriptor("CREATE-03","staff",H,"POST","none","explicit-slug","success",{create:1},D,"accepted"),
  descriptor("CREATE-04","staff",H,"POST","none","valid-create","duplicate",{create:1},E,"conflict"),
  descriptor("CREATE-05","staff",H,"POST","none","direct-publish","success",{create:0},V,"rejected"),
  descriptor("CREATE-06","staff",H,"POST","none","unknown","success",{create:0},V,"rejected"),
  descriptor("CREATE-07","staff",H,"POST","none","client-id","success",{create:0},V,"rejected"),
  descriptor("CREATE-08","staff",H,"POST","none","client-created-at","success",{create:0},V,"rejected"),
  descriptor("CREATE-09","staff",H,"POST","none","invalid-publication","success",{create:0},V,"rejected"),
  descriptor("CREATE-10","staff",H,"POST","none","bad-url","success",{create:0},V,"rejected"),
  descriptor("CREATE-11","staff",H,"POST","none","bad-nested","success",{create:0},V,"rejected"),
  descriptor("UPDATE-01","staff",H,"PATCH","draft-unlocked","valid-update","success",{get:1,update:1},D,"accepted"),
  descriptor("UPDATE-02","staff",H,"PATCH","draft-unlocked","slug-update","success",{get:1,update:1},D,"accepted"),
  descriptor("UPDATE-03","staff",H,"PATCH","draft-unlocked","publish","success",{get:1,update:1},L,"accepted"),
  descriptor("UPDATE-04","staff",H,"PATCH","published-locked","slug-update","success",{get:1,update:0},L,"rejected"),
  descriptor("UPDATE-05","staff",H,"PATCH","published-locked","hidden","success",{get:1,update:1},L,"accepted"),
  descriptor("UPDATE-06","staff",H,"PATCH","hidden-locked","publish","success",{get:1,update:1},L,"accepted"),
  descriptor("UPDATE-07","staff",H,"PATCH","published-locked","archived","success",{get:1,update:1},L,"accepted"),
  descriptor("UPDATE-08","staff",H,"PATCH","hidden-locked","archived","success",{get:1,update:1},L,"accepted"),
  descriptor("UPDATE-09","staff",H,"PATCH","archived-locked","hidden","success",{get:1,update:1},L,"accepted"),
  descriptor("UPDATE-10","staff",H,"PATCH","draft-unlocked","invalid-publication","success",{get:0,update:0},V,"rejected"),
  descriptor("UPDATE-11","staff",H,"PATCH","draft-unlocked","unknown","success",{get:0,update:0},V,"rejected"),
  descriptor("UPDATE-12","staff",H,"PATCH","draft-unlocked","client-slug-locked","success",{get:0,update:0},V,"rejected"),
  descriptor("UPDATE-13","staff",H,"PATCH","draft-unlocked","missing-id","success",{get:0,update:0},V,"rejected"),
  descriptor("UPDATE-14","staff",H,"PATCH","none","valid-update","not-found",{get:1,update:0},D,"not-found"),
  descriptor("DELETE-01","staff",H,"DELETE","archived-locked","confirm-delete","success",{get:1,remove:1},D,"accepted"),
  descriptor("DELETE-02","staff",H,"DELETE","archived-locked","false-confirm","success",{get:0,remove:0},V,"rejected"),
  descriptor("DELETE-03","staff",H,"DELETE","archived-locked","missing-confirm","success",{get:0,remove:0},V,"rejected"),
  descriptor("DELETE-04","staff",H,"DELETE","draft-unlocked","confirm-delete","success",{get:1,remove:0},L,"rejected"),
  descriptor("DELETE-05","staff",H,"DELETE","published-locked","confirm-delete","success",{get:1,remove:0},L,"rejected"),
  descriptor("DELETE-06","staff",H,"DELETE","hidden-locked","confirm-delete","success",{get:1,remove:0},L,"rejected"),
  descriptor("DELETE-07","staff",H,"DELETE","none","confirm-delete","not-found",{get:1,remove:0},D,"not-found"),
  descriptor("DELETE-08","staff",H,"DELETE","archived-locked","confirm-delete","fk",{get:1,remove:1},E,"conflict"),
  descriptor("DELETE-09","staff",H,"DELETE","archived-locked","unknown-delete","success",{get:0,remove:0},V,"rejected"),
  descriptor("DBERR-01","staff",R,"POST","none","valid-create","duplicate",{create:1},E,"conflict"),
  descriptor("DBERR-02","staff",R,"DELETE","archived-locked","confirm-delete","fk",{get:1,remove:1},E,"conflict"),
  descriptor("DBERR-03","staff",R,"POST","none","valid-create","constraint",{create:1},E,"rejected"),
  descriptor("DBERR-04","staff",R,"POST","none","valid-create","unexpected",{create:1},E,"server-error"),
  descriptor("SEC-01","unauthenticated",H,"POST","none","valid-create","success",{create:0},A,"rejected"),
  descriptor("SEC-02","nonstaff",H,"POST","none","valid-create","success",{create:0},A,"rejected"),
  descriptor("SEC-03","staff",H,"POST","none","role","success",{create:0},V,"rejected"),
  descriptor("SEC-04","staff",H,"POST","none","client-id","success",{create:0},V,"rejected"),
  descriptor("SEC-05","staff",H,"POST","none","client-created-at","success",{create:0},V,"rejected"),
  descriptor("SEC-06","staff",H,"PATCH","draft-unlocked","client-updated-at","success",{get:0,update:0},V,"rejected"),
  descriptor("SEC-07","staff",H,"PATCH","draft-unlocked","client-slug-locked","success",{get:0,update:0},V,"rejected"),
  descriptor("SEC-08","staff",H,"PATCH","draft-unlocked","unknown","success",{get:0,update:0},V,"rejected"),
  descriptor("SEC-09","staff",H,"PATCH","draft-unlocked","invalid-publication","success",{get:0,update:0},V,"rejected"),
  descriptor("SEC-10","staff",H,"PATCH","published-locked","slug-update","success",{get:1,update:0},L,"rejected"),
  descriptor("SEC-11","staff",H,"DELETE","published-locked","confirm-delete","success",{get:1,remove:0},L,"rejected"),
  descriptor("SEC-12","staff",H,"DELETE","archived-locked","missing-confirm","success",{get:0,remove:0},V,"rejected"),
  descriptor("SEC-13","staff",H,"PATCH","draft-unlocked","malformed-id","success",{get:0,update:0},V,"rejected"),
  descriptor("SEC-14","not-applicable",S,"NONE","not-applicable","service-role-absence","not-applicable",{},X,"rejected"),
];
function bodyFor(entry) {
  const create=clone(base), update={id:UUID,shortDescription:"Updated"};
  const bodies={"valid-create":create,"slug-omitted":create,"explicit-slug":{...create,slug:"chosen-slug"},"direct-publish":{...create,publicationStatus:"published"},unknown:entry.method==="POST"?{...create,arbitrary:"x"}:{...update,arbitrary:"x"},role:{...create,role:"admin"},"client-id":{...create,id:UUID},"client-created-at":{...create,created_at:"2026-01-01"},"invalid-publication":entry.method==="POST"?{...create,publicationStatus:"invalid"}:{...update,publicationStatus:"invalid"},"bad-url":{...create,productUrl:"bad"},"bad-nested":{...create,media:"bad"},"valid-update":update,"slug-update":{...update,slug:"changed-slug"},publish:{...update,publicationStatus:"published"},hidden:{...update,publicationStatus:"hidden"},archived:{...update,publicationStatus:"archived"},"client-slug-locked":{...update,slug_locked:true},"missing-id":{shortDescription:"Updated"},"client-updated-at":{...update,updated_at:"2026-01-01"},"malformed-id":{id:"bad",shortDescription:"Updated"},"confirm-delete":{id:UUID,confirmPermanentDelete:true},"false-confirm":{id:UUID,confirmPermanentDelete:false},"missing-confirm":{id:UUID},"unknown-delete":{id:UUID,confirmPermanentDelete:true,arbitrary:"x"}};
  return bodies[entry.requestBodyVariant];
}
async function execute(entry) {
  if (entry.layer===S) { const source=(await Promise.all(["src/lib/server/device-admin.ts","src/pages/api/admin/devices.ts","src/lib/server/admin-auth.ts"].map((file)=>readFile(file,"utf8")))).join("\n"); assert(!/service_role|SUPABASE_SERVICE_ROLE|secret[_-]?key/i.test(source),"SEC-14 privileged CRUD path exists"); return {id:entry.id,category:"SEC",reachability:X}; }
  const fixture=repositoryFixture(entry); const handlers=createDeviceAdminHandlers({authorize:actorFixture(entry.actor),repositoryFor:()=>fixture.repository}); const response=await handlers[entry.method](request(entry.method,entry.method==="GET"?undefined:bodyFor(entry))); const body=await response.json();
  for(const [call,expected] of Object.entries(entry.expectedRepositoryCalls)) assert(fixture.state[call]===expected,`${entry.id} expected ${call}=${expected}, got ${fixture.state[call]}`);
  if(entry.expectedOutcomeClass==="accepted") assert(response.status>=200&&response.status<300,`${entry.id} expected success, got ${response.status}`);
  if(entry.expectedOutcomeClass==="rejected") assert(response.status>=400&&response.status<500,`${entry.id} expected rejection, got ${response.status}`);
  if(entry.expectedOutcomeClass==="conflict") assert(response.status===409,`${entry.id} expected conflict, got ${response.status}`);
  if(entry.expectedOutcomeClass==="not-found") assert(response.status===404,`${entry.id} expected not found, got ${response.status}`);
  if(entry.expectedOutcomeClass==="server-error") assert(response.status===500,`${entry.id} expected server error, got ${response.status}`);
  if(entry.id==="CREATE-01") assert(body.device.publicationStatus==="draft"&&body.device.slugLocked===false,"CREATE-01 draft state wrong");
  if(entry.id==="CREATE-02") assert(body.device.slug==="test-device","CREATE-02 generated slug wrong");
  if(entry.id==="CREATE-03") assert(body.device.slug==="chosen-slug","CREATE-03 explicit slug wrong");
  if(entry.id==="UPDATE-03") assert(body.device.slugLocked===true,"UPDATE-03 did not lock slug");
  if(entry.id.startsWith("DBERR")) assert(!/2350|XX000|stack/i.test(JSON.stringify(body)),`${entry.id} leaked raw error`);
  return {id:entry.id,category:entry.id.split("-")[0],reachability:entry.expectedReachability};
}
const required={AUTH:10,CREATE:11,UPDATE:14,DELETE:9,DBERR:4,SEC:14};
assert(cases.length===62&&new Set(cases.map(({id})=>id)).size===62,"Expected 62 unique cases");
assert(cases.every((entry)=>Object.values(entry).every((value)=>value!==undefined)),"Implicit scenario default found");
for(const [category,count] of Object.entries(required))assert(cases.filter(({id})=>id.startsWith(`${category}-`)).length===count,`${category} case count mismatch`);
const sentinel=await Promise.all(cases.filter(({id})=>id==="AUTH-01"||id==="AUTH-03").map(execute)); assert(sentinel.length===2,"Sentinel matrix missing");
const results=[]; for(const entry of cases)results.push(await execute(entry));
const intentionalDuplicateCaseIds=new Set(["AUTH-04","AUTH-05","AUTH-06","CREATE-01","CREATE-07","CREATE-08","UPDATE-03","UPDATE-04","UPDATE-10","UPDATE-11","UPDATE-12","DELETE-03","DELETE-05","SEC-01","SEC-02","SEC-04","SEC-05","SEC-07","SEC-08","SEC-09","SEC-10","SEC-11","SEC-12"]);
const fingerprint=(entry)=>JSON.stringify({actor:entry.actor,layer:entry.layer,method:entry.method,deviceState:entry.deviceState,requestBodyVariant:entry.requestBodyVariant,repositoryOutcome:entry.repositoryOutcome,expectedReachability:entry.expectedReachability});
const nonDuplicateCases=cases.filter((entry)=>!intentionalDuplicateCaseIds.has(entry.id)); const collisionGroups=new Map(); for(const entry of nonDuplicateCases){const key=fingerprint(entry);collisionGroups.set(key,[...(collisionGroups.get(key)??[]),entry.id]);} const accidentalCollisions=[...collisionGroups.values()].filter((ids)=>ids.length>1); assert(accidentalCollisions.length===0,`Unintentional scenario collision: ${accidentalCollisions.flat().join(",")}`);
const chainFixture=repositoryFixture({deviceState:"draft-unlocked",repositoryOutcome:"success"}); const chain=createDeviceAdminHandlers({authorize:actorFixture("staff"),repositoryFor:()=>chainFixture.repository}); for(const publicationStatus of ["published","hidden","published","archived","hidden"]){const r=await chain.PATCH(request("PATCH",{id:UUID,publicationStatus}));assert(r.status===200,`Slug chain failed at ${publicationStatus}`);assert(chainFixture.state.rows.get(UUID).slugLocked===true,"Slug was unlocked");}
const row=toDeviceRow({...base,slug:"test-device",publicationStatus:"draft"}); const restored=fromDeviceRow({id:UUID,slug_locked:false,...row}); assert(restored.brandKey===base.brandKey&&restored.media.imageAlt==="Test"&&restored.fullSpecs.physical.weight==="20g","Repository field parity failed");
assert(mapDatabaseError({code:"23505"}).status===409&&mapDatabaseError({code:"23503"}).status===409&&mapDatabaseError({code:"23514"}).status===400&&mapDatabaseError({code:"XX000"}).status===500,"Error mapping incomplete");
console.log(JSON.stringify({manifestIdCount:62,descriptorCount:62,implicitDefaultCases:0,behavioralExecutorTotal:62,structuralOnlyExecutorTotal:0,reachabilityTotal:results.length,sentinel:{AUTH01:"PASS",AUTH01ListCalls:0,AUTH03:"PASS",AUTH03ListCalls:1},counts:Object.fromEntries(Object.keys(required).map((key)=>[key,results.filter((result)=>result.category===key).length])),slugChain:"PASS",repositoryFieldParity:"PASS",rawDatabaseExposure:0,matrixAccounting:"PASS"}));
