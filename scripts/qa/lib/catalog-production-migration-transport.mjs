import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, open, mkdir, lstat } from "node:fs/promises";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";

const freeze=value=>{for(const child of Object.values(value))if(child&&typeof child==="object")freeze(child);return Object.freeze(value);};
export const APPROVED_ARTIFACTS = freeze({
  packet: {path:"docs/superpowers/plans/2026-10-04-catalog-production-migration-packet.md",sha256:"e8e4932631174fe8a7b5d0f08abbaef2e8f6e2241c082b69004a33b240bf81de"},
  manifest: {path:"artifacts/qa/catalog-migration-packet-v1/manifest.json",sha256:"9b3a7d27528faebd171721166ee4293c3828625c063955a5e95ebe40160dfa80"},
  migrations: [
    {path:"supabase/migrations/20261004003349_public_device_detail_v1.sql",sha256:"e74fd7031ceefab8de5ecfe1318a0709d754c603b9a1c60882020f95734499e6",version:"20261004003349",name:"public_device_detail_v1"},
    {path:"supabase/migrations/20261004014637_catalog_editor_presentation_v1.sql",sha256:"943b7a01d3cab3471fbfc36d6ca011bd13eeeee5acc2264ec996f60a4d278dd6",version:"20261004014637",name:"catalog_editor_presentation_v1"},
  ],
});
export const TOOLING_FILES = Object.freeze([
  "scripts/qa/lib/catalog-production-migration-transport.mjs",
  "scripts/qa/lib/catalog-production-migration-postgres-adapter.mjs",
  "scripts/qa/catalog-production-migration-runner.mjs",
  "scripts/qa/fixtures/catalog-stage-b-schema-proof.json",
]);
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export function fail(code) { const error=new Error(code);error.code=code;throw error; }
const connectionDiagnostics = new WeakMap();
const CONNECTION_CODES = Object.freeze({
  ENOTFOUND:"DNS_RESOLUTION_FAILURE",EAI_AGAIN:"DNS_RESOLUTION_FAILURE",
  ECONNREFUSED:"TCP_CONNECTION_REFUSED",ETIMEDOUT:"TCP_CONNECTION_TIMEOUT",
  ECONNRESET:"TCP_CONNECTION_RESET",EPIPE:"TCP_CONNECTION_RESET",
  ENETUNREACH:"NETWORK_UNREACHABLE",EHOSTUNREACH:"NETWORK_UNREACHABLE",
  SELF_SIGNED_CERT_IN_CHAIN:"TLS_CA_REJECTION",DEPTH_ZERO_SELF_SIGNED_CERT:"TLS_CA_REJECTION",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:"TLS_CA_REJECTION",UNABLE_TO_GET_ISSUER_CERT_LOCALLY:"TLS_CA_REJECTION",
  UNABLE_TO_GET_ISSUER_CERT:"TLS_CA_REJECTION",CERT_HAS_EXPIRED:"TLS_CA_REJECTION",
  CERT_NOT_YET_VALID:"TLS_CA_REJECTION",CERT_SIGNATURE_FAILURE:"TLS_CA_REJECTION",
  ERR_TLS_CERT_ALTNAME_INVALID:"TLS_HOSTNAME_REJECTION",
  ERR_SSL_WRONG_VERSION_NUMBER:"TLS_HANDSHAKE_FAILURE_OTHER",
  ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE:"TLS_HANDSHAKE_FAILURE_OTHER",
  ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION:"TLS_HANDSHAKE_FAILURE_OTHER",
  ERR_TLS_HANDSHAKE_TIMEOUT:"TLS_HANDSHAKE_FAILURE_OTHER",
  "28P01":"POSTGRES_AUTH_REJECTED","28000":"POSTGRES_AUTH_REJECTED",
  "3D000":"POSTGRES_ROLE_OR_DATABASE_REJECTED",
  ERR_INVALID_ARG_TYPE:"DRIVER_CONFIGURATION_ERROR",ERR_INVALID_ARG_VALUE:"DRIVER_CONFIGURATION_ERROR",
});
export function catalogConnectionFailure(raw) {
  const candidates=[raw];
  if(raw?.cause)candidates.push(raw.cause);
  if(Array.isArray(raw?.errors))candidates.push(...raw.errors.slice(0,8));
  const known=candidates.filter(e=>Object.hasOwn(CONNECTION_CODES,e?.code??""));
  const selected=known[0]??raw;
  let failureClass=new Set(known.map(e=>CONNECTION_CODES[e.code])).size===1?CONNECTION_CODES[selected.code]:"UNKNOWN_AFTER_SAFE_DIAGNOSTICS";
  // Pooler rejection text is inspected in memory only; never retain messages.
  if(raw?.code==="XX000"&&/tenant or user not found/i.test(raw?.message??""))failureClass="SESSION_POOLER_TARGET_REJECTED";
  if(raw?.code==="28000"&&/role .* does not exist/i.test(raw?.message??""))failureClass="POSTGRES_ROLE_OR_DATABASE_REJECTED";
  const code=Object.hasOwn(CONNECTION_CODES,selected?.code??"")||selected?.code==="XX000"?selected.code:"UNKNOWN";
  const tls=failureClass.startsWith("TLS_");
  const stage=failureClass==="DNS_RESOLUTION_FAILURE"?"DNS_RESOLUTION":failureClass.startsWith("TCP_")||failureClass==="NETWORK_UNREACHABLE"?"TCP_CONNECT":tls?"TLS_HANDSHAKE":failureClass.startsWith("POSTGRES_")||failureClass==="SESSION_POOLER_TARGET_REJECTED"?"POSTGRES_STARTUP_AUTH":failureClass==="DRIVER_CONFIGURATION_ERROR"?"DRIVER_CONFIGURATION":"CONNECTION_OPEN";
  const diagnostic=Object.freeze({
    failureClass,stage,
    errorName:["Error","TypeError","AggregateError","DatabaseError","error"].includes(selected?.name)?selected.name:"UNKNOWN",
    errorCode:code,sqlstate:["28P01","28000","3D000","XX000"].includes(code)?code:"UNKNOWN",
    errno:Number.isInteger(selected?.errno)&&selected.errno>=-4095&&selected.errno<0?selected.errno:"UNKNOWN",
    syscall:["connect","getaddrinfo","read","write"].includes(selected?.syscall)?selected.syscall:"UNKNOWN",
    tlsErrorCode:tls?code:"UNKNOWN",
    tlsVerifyReasonClass:failureClass==="TLS_CA_REJECTION"?"CERTIFICATE_CHAIN_REJECTED":failureClass==="TLS_HOSTNAME_REJECTION"?"HOSTNAME_MISMATCH":"UNKNOWN",
    networkFailureClass:stage==="DNS_RESOLUTION"||stage==="TCP_CONNECT"?failureClass:"UNKNOWN",
    timeoutClass:code==="ETIMEDOUT"?"TCP_CONNECT_TIMEOUT":code==="ERR_TLS_HANDSHAKE_TIMEOUT"?"TLS_HANDSHAKE_TIMEOUT":["timeout expired","Connection terminated due to connection timeout"].includes(raw?.message)?"CONNECTION_OPEN_TIMEOUT":"UNKNOWN",
  });
  const error=new Error("STAGE_B_CONNECTION_FAILED");error.code="STAGE_B_CONNECTION_FAILED";
  Object.defineProperty(error,"connectionDiagnostic",{value:diagnostic,enumerable:true});
  connectionDiagnostics.set(error,diagnostic);return error;
}
const approvedBundles = new WeakSet();
function keys(value,expected) {
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).some(k=>typeof k!=="string")||Object.keys(value).sort().join("|")!==[...expected].sort().join("|")||Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>!Object.hasOwn(d,"value")))fail("STAGE_B_RECEIPT_INVALID");
}
export function validateAuthorization(r,now=Date.now()) {
  keys(r,["format","authorizationId","candidateHead","executionCheckoutSha256","artifacts","toolingHashes","targetClass","serverIdentitySha256","windowStartUTC","windowEndUTC","maxAttempts","automaticRetry","readOnlyStatementBudget","writeTransactionBudget","humanGates"]);
  if(r.format!=="catalog-stage-b-authorization-v1"||!/^stage-b-[a-z0-9-]{3,80}$/.test(r.authorizationId)||!/^[a-f0-9]{40}$/.test(r.candidateHead)||!/^[a-f0-9]{64}$/.test(r.executionCheckoutSha256)||!/^[a-f0-9]{64}$/.test(r.serverIdentitySha256)||r.targetClass!=="SUPAVISOR_SESSION"||r.maxAttempts!==1||r.automaticRetry!==false||r.readOnlyStatementBudget!==30||r.writeTransactionBudget!==2)fail("STAGE_B_RECEIPT_INVALID");
  if(JSON.stringify(r.artifacts)!==JSON.stringify(APPROVED_ARTIFACTS))fail("STAGE_B_ARTIFACT_BINDING_INVALID");
  keys(r.toolingHashes,TOOLING_FILES);
  if(Object.values(r.toolingHashes).some(v=>! /^[a-f0-9]{64}$/.test(v)))fail("STAGE_B_TOOLING_BINDING_INVALID");
  keys(r.humanGates,["productionDeploymentConfirmed","backupRecoveryReady","catalogWritesPaused","currentReaderCompatible"]);
  if(Object.values(r.humanGates).some(v=>v!==true))fail("STAGE_B_HUMAN_PREFLIGHT_REQUIRED");
  const start=Date.parse(r.windowStartUTC),end=Date.parse(r.windowEndUTC);
  if(!Number.isFinite(start)||!Number.isFinite(end)||new Date(start).toISOString()!==r.windowStartUTC.replace(/Z$/,".000Z")||new Date(end).toISOString()!==r.windowEndUTC.replace(/Z$/,".000Z")||end-start<=0||end-start>45*60000||now<start||now>=end)fail("STAGE_B_WINDOW_INVALID_OR_EXPIRED");
}
export function checkoutIdentity(root) {
  const gitDir=realpathSync(path.resolve(root,execFileSync("git",["rev-parse","--git-common-dir"],{cwd:root,encoding:"utf8"}).trim()));
  const canonical=value=>process.platform==="win32"?value.toLowerCase():value;
  const stamp=statSync(gitDir);
  return sha256(JSON.stringify({root:canonical(realpathSync(root)),gitDir:canonical(gitDir),created:stamp.birthtimeMs,device:stamp.dev,inode:stamp.ino}));
}
export function inspectRepository(root) {
  try {return {head:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),clean:execFileSync("git",["status","--porcelain"],{cwd:root,encoding:"utf8"}).trim()==="",checkoutIdentitySha256:checkoutIdentity(root)};}
  catch {fail("STAGE_B_SOURCE_IDENTITY_UNAVAILABLE");}
}
export async function loadCatalogBundle({root,receipt,now=Date.now(),inspectSource=inspectRepository,readArtifact=readFile}) {
  // Detach operator input so mutation after validation cannot broaden this bundle.
  validateAuthorization(receipt,now);
  const r=JSON.parse(JSON.stringify(receipt));
  const source=inspectSource(root);
  if(!source.clean||source.head!==r.candidateHead)fail("STAGE_B_SOURCE_IDENTITY_MISMATCH");
  if(source.checkoutIdentitySha256!==r.executionCheckoutSha256)fail("STAGE_B_CHECKOUT_IDENTITY_MISMATCH");
  // Hash and execute the same detached bytes, including the schema-proof input.
  const bytes=new Map();
  for(const [file,expected] of Object.entries(r.toolingHashes)){const buffer=Buffer.from(await readArtifact(path.join(root,file)));if(sha256(buffer)!==expected)fail("STAGE_B_TOOLING_HASH_MISMATCH");bytes.set(file,buffer);}
  for(const artifact of [r.artifacts.packet,r.artifacts.manifest,...r.artifacts.migrations]){const buffer=Buffer.from(await readArtifact(path.join(root,artifact.path)));if(sha256(buffer)!==artifact.sha256)fail("STAGE_B_ARTIFACT_HASH_MISMATCH");bytes.set(artifact.path,buffer);}
  const migrations=r.artifacts.migrations.map(m=>{const sql=bytes.get(m.path).toString("utf8");if(sha256(sql)!==m.sha256)fail("STAGE_B_MIGRATION_ENCODING_INVALID");return Object.freeze({...m,sql});});
  const proof=JSON.parse(bytes.get(TOOLING_FILES[3]).toString("utf8"));
  if(proof.format!=="catalog-stage-b-schema-proof-v1"||proof.migrationHashes.join("|")!==migrations.map(m=>m.sha256).join("|")||proof.states.length!==3||proof.states.some(v=>! /^[a-f0-9]{64}$/.test(v)))fail("STAGE_B_SCHEMA_PROOF_INVALID");
  const bundle=Object.freeze({authorizationId:r.authorizationId,candidateHead:r.candidateHead,deadline:Date.parse(r.windowEndUTC),serverIdentitySha256:r.serverIdentitySha256,migrations:Object.freeze(migrations),states:Object.freeze(proof.states)});
  approvedBundles.add(bundle);return bundle;
}
export async function claimAuthorization(root,id) {
  if(!/^stage-b-[a-z0-9-]{3,80}$/.test(id))fail("STAGE_B_AUTHORIZATION_ID_INVALID");
  let gitDir;
  try {gitDir=path.resolve(root,execFileSync("git",["rev-parse","--git-common-dir"],{cwd:root,encoding:"utf8"}).trim());}catch{fail("STAGE_B_AUTHORIZATION_JOURNAL_UNAVAILABLE");}
  const directory=path.join(gitDir,"catalog-stage-b-authorizations");await mkdir(directory,{recursive:true});
  if((await lstat(directory)).isSymbolicLink())fail("STAGE_B_AUTHORIZATION_JOURNAL_UNAVAILABLE");
  try {const file=await open(path.join(directory,`${id}.json`),"wx",0o600);try{await file.writeFile(JSON.stringify({format:"catalog-stage-b-attempt-v1",authorizationId:id,consumed:true})+"\n");await file.sync();}finally{await file.close();}}
  catch{fail("STAGE_B_AUTHORIZATION_ALREADY_CONSUMED_OR_UNAVAILABLE");}
}

const TABLES="'devices','device_spec_definitions','device_specs','device_sources','device_source_links','device_spec_evidence','catalog_audit_events'";
const FUNCTIONS="'is_catalog_admin','enforce_device_spec_definition','prevent_incompatible_device_schema_change','prevent_device_spec_definition_semantic_change','serialize_device_spec_evidence_change','validate_device_spec_conflict_evidence','prevent_catalog_audit_mutation','catalog_presentation_valid','save_catalog_spec','save_catalog_group','lock_published_catalog_brand','audit_catalog_device_change'";
export const IDENTITY_SQL="SELECT current_database() AS database, current_user AS role, inet_server_port() AS port, system_identifier::text AS system_identifier FROM pg_control_system();";
export const STATE_SQL=`WITH relations AS (SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${TABLES},'public_device_detail_specs','public_device_detail_sources','public_device_detail_evidence'))
SELECT jsonb_build_object(
'schema',jsonb_build_object(
 'relations',(SELECT jsonb_agg(jsonb_build_object('name',relname,'kind',relkind,'owner',pg_get_userbyid(relowner),'rls',relrowsecurity,'forceRls',relforcerowsecurity,'options',reloptions,'acl',relacl::text) ORDER BY relname) FROM relations),
 'columns',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attnum) FROM relations c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',x.conname,'definition',pg_get_constraintdef(x.oid),'validated',x.convalidated) ORDER BY c.relname,x.conname) FROM relations c JOIN pg_constraint x ON x.conrelid=c.oid),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid) ORDER BY c.relname,pg_get_indexdef(i.indexrelid)) FROM relations c JOIN pg_index i ON i.indrelid=c.oid),
 'policies',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY r) FROM unnest(p.polroles) r),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY c.relname,p.polname) FROM relations c JOIN pg_policy p ON p.polrelid=c.oid),
 'views',(SELECT jsonb_agg(jsonb_build_object('name',relname,'definition',pg_get_viewdef(oid,true)) ORDER BY relname) FROM relations WHERE relkind='v'),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true)) ORDER BY c.relname,t.tgname) FROM relations c JOIN pg_trigger t ON t.tgrelid=c.oid AND NOT t.tgisinternal),
 'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'definition',pg_get_functiondef(p.oid),'acl',p.proacl::text) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${FUNCTIONS}))),
'ledgerShape',jsonb_build_object('owner',(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='supabase_migrations.schema_migrations'::regclass),'columns',(SELECT jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod),'notNull',attnotnull) ORDER BY attnum) FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attnum>0 AND NOT attisdropped),'primaryKey',(SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='supabase_migrations.schema_migrations'::regclass AND contype='p')),
'ledger',(SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]') FROM supabase_migrations.schema_migrations WHERE version IN ('20261004003349','20261004014637')),
'counts',jsonb_build_object('devices',(SELECT count(*) FROM public.devices),'published',(SELECT count(*) FROM public.devices WHERE publication_status='published'),'specs',(SELECT count(*) FROM public.device_specs),'definitions',(SELECT count(*) FROM public.device_spec_definitions),'audit',(SELECT count(*) FROM public.catalog_audit_events))) AS state;`;
export const LEDGER_SQL="INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ($1,$2,$3::text[]);";
export const LOCK_SQL=`LOCK TABLE supabase_migrations.schema_migrations, ${TABLES.split(",").map(t=>`public.${t.replaceAll("'","")}`).join(", ")} IN SHARE ROW EXCLUSIVE MODE;`;
// Canonical-50 PostgreSQL metadata, ordered by the executor's explicit INSERT contract.
const CORE_LEDGER_COLUMNS=freeze([
  {name:"version",type:"text",notNull:true},
  {name:"name",type:"text",notNull:false},
  {name:"statements",type:"text[]",notNull:false},
]);
export function canonicalizeLedgerShape(shape) {
  if(!shape||typeof shape!=="object"||Array.isArray(shape)||shape.owner!=="postgres"||shape.primaryKey!=="PRIMARY KEY (version)"||!Array.isArray(shape.columns))fail("STAGE_B_LEDGER_SCHEMA_DIVERGENCE");
  const columns=new Map();
  for(const column of shape.columns){
    if(!column||typeof column!=="object"||Array.isArray(column)||typeof column.name!=="string"||!column.name.trim()||typeof column.type!=="string"||!column.type.trim()||typeof column.notNull!=="boolean"||columns.has(column.name))fail("STAGE_B_LEDGER_SCHEMA_DIVERGENCE");
    const core=CORE_LEDGER_COLUMNS.find(c=>c.name===column.name);
    if(core?(column.type!==core.type||column.notNull!==core.notNull):column.notNull!==false)fail("STAGE_B_LEDGER_SCHEMA_DIVERGENCE");
    columns.set(column.name,column);
  }
  if(CORE_LEDGER_COLUMNS.some(c=>!columns.has(c.name)))fail("STAGE_B_LEDGER_SCHEMA_DIVERGENCE");
  return {owner:shape.owner,columns:CORE_LEDGER_COLUMNS.map(c=>({...c})),primaryKey:shape.primaryKey};
}
export function schemaDigest(state) {return sha256(JSON.stringify({schema:state.schema,ledgerShape:canonicalizeLedgerShape(state.ledgerShape)}));}
export function classifyState(state,bundle) {
  if(!state||!Array.isArray(state.ledger)||state.ledgerShape?.owner!=="postgres")fail("STAGE_B_LEDGER_SCHEMA_DIVERGENCE");
  const versions=bundle.migrations.map(m=>m.version);
  let stage=0;
  for(const row of state.ledger){
    const index=versions.indexOf(row.version);
    if(index!==stage||row.name!==bundle.migrations[index]?.name||!Array.isArray(row.statements)||row.statements.length!==1||typeof row.statements[0]!=="string"||sha256(row.statements[0])!==bundle.migrations[index].sha256)fail("STAGE_B_LEDGER_SCHEMA_DIVERGENCE");stage++;
  }
  if(schemaDigest(state)!==bundle.states[stage])fail("STAGE_B_LEDGER_SCHEMA_DIVERGENCE");
  return stage;
}
export async function executeCatalogMigrations({bundle,open,claim,now=Date.now}) {
  if(!approvedBundles.has(bundle))fail("STAGE_B_VALIDATED_BUNDLE_REQUIRED");
  let session,outcome,transaction=false,commitDispatched=false,readStatements=0,writeTransactions=0,committed=0;
  const migrations=[];
  const checkWindow=()=>{if(now()>=bundle.deadline)fail("STAGE_B_WINDOW_EXPIRED");};
  const query=async(sql,params=[])=>{checkWindow();return session.query(sql,params,Math.min(30000,bundle.deadline-now()));};
  const state=async()=>{if(++readStatements>30)fail("STAGE_B_READ_BUDGET_EXHAUSTED");const result=await query(STATE_SQL);if(result.rows?.length!==1)fail("STAGE_B_SCHEMA_RESPONSE_INVALID");return result.rows[0].state;};
  const readOnly=async(work)=>{await query("BEGIN READ ONLY;");transaction=true;const value=await work();await query("COMMIT;");transaction=false;return value;};
  try {
    checkWindow();await claim(bundle.authorizationId);checkWindow();session=await open();
    await readOnly(async()=>{readStatements++;const result=await query(IDENTITY_SQL);if(result.rows?.length!==1||sha256(JSON.stringify(result.rows[0]))!==bundle.serverIdentitySha256)fail("STAGE_B_DATABASE_IDENTITY_MISMATCH");});
    let before=await readOnly(state),stage=classifyState(before,bundle);
    const baselineCounts=JSON.stringify(before.counts);
    for(let index=0;index<2;index++){
      const migration=bundle.migrations[index];
      if(index<stage){migrations.push({version:migration.version,state:"ALREADY_APPLIED_CONSISTENT",executed:false});continue;}
      if(++writeTransactions>2)fail("STAGE_B_WRITE_BUDGET_EXHAUSTED");
      await query("BEGIN;");transaction=true;await query(LOCK_SQL);
      before=await state();if(classifyState(before,bundle)!==index||JSON.stringify(before.counts)!==baselineCounts)fail("STAGE_B_PREFLIGHT_DRIFT");
      await query(migration.sql);
      await query(LEDGER_SQL,[migration.version,migration.name,[migration.sql]]);
      const pending=await state();if(classifyState(pending,bundle)!==index+1||JSON.stringify(pending.counts)!==baselineCounts)fail("STAGE_B_IN_TRANSACTION_VERIFY_FAILED");
      checkWindow();commitDispatched=true;await query("COMMIT;");transaction=false;commitDispatched=false;committed++;
      const after=await readOnly(state);if(classifyState(after,bundle)!==index+1||JSON.stringify(after.counts)!==baselineCounts)fail("STAGE_B_POST_COMMIT_VERIFY_FAILED");
      stage=index+1;migrations.push({version:migration.version,state:"APPLIED_VERIFIED",executed:true});
    }
    return outcome={status:"PASS",committed,migrations,readOnlyStatements:readStatements,writeTransactions,automaticRetry:false};
  }catch(error){
    if(transaction&&!commitDispatched&&session)try{await session.query("ROLLBACK;",[],5000);}catch{}
    return outcome={status:commitDispatched?"AMBIGUOUS":committed?"BLOCKED_AFTER_COMMIT":"BLOCKED",firstFailure:/^STAGE_B_[A-Z_]+$/.test(error?.code??"")?error.code:"STAGE_B_SQL_OR_CONNECTION_FAILED",...(connectionDiagnostics.has(error)?{connectionDiagnostic:connectionDiagnostics.get(error)}:{}),committed,migrations,readOnlyStatements:readStatements,writeTransactions,automaticRetry:false};
  }finally{if(session)try{await session.close();}catch{outcome.connectionClose="FAILED";if(outcome.status==="PASS"){outcome.status=committed?"BLOCKED_AFTER_COMMIT":"BLOCKED";outcome.firstFailure="STAGE_B_CONNECTION_CLOSE_FAILED";}}}
}
