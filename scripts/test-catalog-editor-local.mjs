import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { prepareCanonicalCatalogImport } from "./lib/catalog-canonical-import.mjs";
import {renderReleaseBAuthorizedOperation} from "./devices/schema-v1/disposable-postgres-transaction-client.mjs";
import {proveCatalogCore} from "./lib/catalog-core-local-proof.mjs";
import {proveCatalogBrowser} from "./lib/catalog-browser-acceptance.mjs";
import { preparePreferenceRunEnvironment } from "./test-user-preferences-rls-local.mjs";
import { assertLocalReplayTarget, runCommand, runLocalDisposableReplay, withCanonicalBaselineDirectory } from "./qa/local-disposable-supabase-replay.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const id = randomUUID();
const receipt = { format: "catalog-editor-local-v1", runId: id, status: "BLOCKED", assertions: [], productionRequests: 0 };
const check = (condition, name) => { assert.ok(condition, name); receipt.assertions.push(name); };
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
try {
  const publication = JSON.parse(await readFile(path.join(root,"artifacts/qa/product-publication-cohort-v1/publication-contract.json"),"utf8"));
  const prepared = await prepareCanonicalCatalogImport({ root, publication });
  const publicSql = await readFile(path.join(root,"supabase/migrations/20261004003349_public_device_detail_v1.sql"),"utf8");
  const editorSql = await readFile(path.join(root,"supabase/migrations/20261004014637_catalog_editor_presentation_v1.sql"),"utf8");
  check(!/security\s+definer/i.test(editorSql), "EDITOR_INVOKER_ONLY");
  const allowed = ["PATH","SystemRoot","WINDIR","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","HOME","COMSPEC"];
  const environment = preparePreferenceRunEnvironment(Object.fromEntries(allowed.filter(k=>process.env[k]).map(k=>[k,process.env[k]])));
  // Windows browser libraries otherwise expand %SystemDrive% relative to cwd.
  for(const key of ["SystemDrive","ProgramData"])if(process.env[key])environment[key]=process.env[key];
  Object.assign(environment,{WRANGLER_SEND_METRICS:"false",CLOUDFLARE_CF_FETCH_ENABLED:"false",ASTRO_TELEMETRY_DISABLED:"1",ASTRO_DISABLE_UPDATE_CHECK:"true"});
  for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,environment);
  let anonKey;
  const execute = async(command,args,options)=>{
    const result=await runCommand(command,args,options);
    if(args.includes("status")&&args.includes("json")){const status=JSON.parse(result.stdout);assertLocalReplayTarget(status.API_URL);anonKey=status.ANON_KEY??status.PUBLISHABLE_KEY;}
    return result;
  };
  await withCanonicalBaselineDirectory({root,environment},async canonicalBaselineDirectory=>runLocalDisposableReplay({
    root,environment,execute,migrationLimit:50,canonicalBaselineDirectory,
    afterMigrationLedgerValidated:async({target,executeSql})=>{
      assertLocalReplayTarget(target);
      const request=async(route,token,method="GET",body)=>{
        const url=new URL(route,target);assertLocalReplayTarget(url.href);assert.equal(url.origin,new URL(target).origin);
        return fetch(url,{method,redirect:"error",signal:AbortSignal.timeout(10000),headers:{apikey:anonKey,authorization:`Bearer ${token??anonKey}`,"content-type":"application/json",Prefer:"return=representation"},...(body===undefined?{}:{body:JSON.stringify(body)})});
      };
      const actor=async label=>{
        const email=`local-editor-${label}-${randomBytes(6).toString("hex")}@example.invalid`,password=randomBytes(24).toString("base64url");
        const signup=await request("/auth/v1/signup",null,"POST",{email,password});check(signup.status===200,`${label}_LOCAL_SIGNUP`);
        const user=await signup.json(),userId=user.user?.id??user.id;assert.match(userId,/^[a-f0-9-]{36}$/);
        await executeSql(`UPDATE auth.users SET email_confirmed_at=now() WHERE id=${quote(userId)}::uuid;`);
        const login=await request("/auth/v1/token?grant_type=password",null,"POST",{email,password});check(login.status===200,`${label}_LOCAL_LOGIN`);
        const session=await login.json();const identity=await request("/auth/v1/user",session.access_token);
        check(identity.status===200&&(await identity.json()).id===userId,`${label}_GENUINE_LOCAL_ACTOR`);
        return{id:userId,token:session.access_token,session};
      };
      const a=await actor("A"),b=await actor("B"),admin=await actor("ADMIN");
      await executeSql(`UPDATE public.profiles SET role='admin' WHERE id=${quote(admin.id)}::uuid;`);
      const legacy=prepared.devices.find(device=>device.slug==='xreal-air');
      await executeSql(renderReleaseBAuthorizedOperation({entity:'device',row:{...legacy,short_description:'Owned richer existing description'}}));
      await executeSql("UPDATE public.devices SET schema_type=null WHERE slug='xreal-air';");
      const baseline=await request("/rest/v1/rpc/save_catalog_spec",admin.token,"POST",{p_device_id:randomUUID(),p_spec_id:null,p_input:{}});
      check(baseline.status===404,"BASELINE_ADMIN_EDITOR_RPC_MISSING_RED");
      await executeSql(`BEGIN;${publicSql}\n${editorSql}\nCOMMIT;NOTIFY pgrst,'reload schema';`);
      receipt.stage="EXISTING_LEGACY_NULL_SCHEMA_IMPORT";
      await executeSql(prepared.sql);
      const legacyResult=await request('/rest/v1/devices?select=schema_type,short_description&slug=eq.xreal-air',admin.token);
      const legacyRows=await legacyResult.json();
      check(legacyResult.status===200&&legacyRows[0].schema_type===legacy.schema_type&&legacyRows[0].short_description==='Owned richer existing description','LEGACY_NULL_SCHEMA_INITIALIZED_WITHOUT_OVERWRITING_RICHER_COPY');
      if(process.argv.includes('--legacy-import-only')){receipt.evidenceClass='GENUINE_LOCAL_EXISTING_LEGACY_IMPORT_FOCUSED_ONLY';return{status:'PASS'};}
      await executeSql(await readFile(path.join(root,"supabase/migrations/20261001075335_user_preferences.sql"),"utf8"));
      await executeSql(prepared.activationSql);
      await executeSql(prepared.hardeningSql);
      await new Promise(resolve=>setTimeout(resolve,1000));
      const read=async(route,token)=>{const response=await request(route,token);check(response.status===200,"LOCAL_DATA_API_READ");return response.json();};
      const devices=await read("/rest/v1/devices?select=id,slug&slug=in.(xreal-air,rayneo-air-2)",admin.token);
      check(devices.length===2,"MULTIPLE_CANONICAL_DEVICES");
      for(const candidate of publication.candidates.filter(row=>row.decision==='PUBLISHED')){
        const known=await read(`/rest/v1/public_device_detail_specs?select=presentation&device_slug=eq.${candidate.slug}&state=eq.KNOWN`,null);
        check(known.filter(spec=>spec.presentation.keySpec===true).length===Math.min(known.length,6),'MIGRATIONS_BEFORE_IMPORT_ALL_COHORT_INITIAL_KEY_SPECS');
      }
      for(const token of [null,a.token,b.token]){
        const stale=await request('/rest/v1/devices?select=full_specs,key_specs&slug=eq.xreal-air',token);
        check(stale.status>=400||(await stale.json()).length===0,'NONADMIN_LEGACY_SPEC_JSON_READ_DENIED');
      }
      if(process.argv.includes('--visibility-only')){receipt.evidenceClass='GENUINE_LOCAL_PUBLIC_LEGACY_VISIBILITY_FOCUSED_ONLY';return{status:'PASS'};}
      for(const owner of [a,b]){
        const denied=await request("/rest/v1/device_specs?select=id",owner.token);
        check(denied.status>=400||(await denied.json()).length===0,"ORDINARY_NORMALIZED_PRIVATE_READ_DENIED");
      }
      for(const column of ["raw_value","internal_notes","updated_by"]){
        const denied=await request(`/rest/v1/public_device_detail_specs?select=${column}`,null);
        check(denied.status>=400,"ANONYMOUS_PRIVATE_PROJECTION_COLUMN_DENIED");
      }
      for(const device of devices){
        const specs=await read(`/rest/v1/device_specs?select=id,value_type:device_spec_definitions(value_type,key),state,value_text,presentation&device_id=eq.${device.id}&state=eq.KNOWN`,admin.token);
        const row=specs.find(s=>s.value_type?.value_type==="text"&&s.state==="KNOWN");check(Boolean(row),"EXISTING_PARAMETER_VISIBLE");
        const save=async(input,specId=row.id,expectedStatus=200,token=admin.token)=>{
          const response=await request("/rest/v1/rpc/save_catalog_spec",token,"POST",{p_device_id:device.id,p_spec_id:specId,p_input:input});
          if(response.status!==expectedStatus){const body=await response.json().catch(()=>({}));receipt.failedResponse={status:response.status,code:/^[A-Z0-9_]{1,32}$/.test(body.code??"")?body.code:"UNKNOWN"};}
          check(response.status===expectedStatus,"ADMIN_ATOMIC_SPEC_SAVE");return response.json();
        };
        await save({valueText:"LOCAL_ADMIN_CHANGED_FACT"});check(true,"ADMIN_PARAMETER_VALUE_EDIT");
        const presentation={labelZh:"验收参数",labelEn:"Acceptance specification",groupKey:"acceptance",groupZh:"验收分组",groupEn:"Acceptance group",groupOrder:1,order:2,keySpec:true,keySpecOrder:1,format:"text",displayUnit:"",publicDisplay:true};
        await save({presentation});check(true,"ADMIN_BILINGUAL_LABEL_FORMAT_GROUP_ORDER_KEY_SPEC_EDIT");
        const publicRows=await read(`/rest/v1/public_device_detail_specs?device_slug=eq.${device.slug}&id=eq.${row.id}`,null);
        check(publicRows.length===1&&publicRows[0].value_text==="LOCAL_ADMIN_CHANGED_FACT"&&publicRows[0].presentation.labelZh==="验收参数","PUBLIC_READER_SAME_CANONICAL_EDITED_ROW");
        const extraId=await save({key:`custom.acceptance_${device.slug.replaceAll("-","_")}`,valueType:"number",state:"KNOWN",valueNumber:12,presentation:{labelZh:"新增参数",labelEn:"Added specification",format:"number",precision:1,keySpec:false}},null);
        check(typeof extraId==="string","ADMIN_PARAMETER_ADD");
        const shared=await save({key:"custom.shared_local",valueType:"number",state:"KNOWN",valueNumber:12,presentation:{labelZh:"共享参数",labelEn:"Shared specification",format:"number",displayUnit:"g",groupKey:"acceptance",groupZh:"验收",groupEn:"Acceptance"}},null);
        check(typeof shared==="string","SAME_STABLE_CUSTOM_DEFINITION_MULTIPLE_DEVICES");
        await save({presentation:{labelZh:"共享参数",labelEn:"Shared specification",groupKey:"acceptance",groupZh:"验收",groupEn:"Acceptance",format:"number",displayUnit:"kg",precision:3,keySpec:true,keySpecOrder:0,order:0,publicDisplay:true}},shared);
        check((await read(`/rest/v1/public_device_detail_specs?id=eq.${shared}`,null))[0].canonical_unit==="g","UNIT_EDIT_PRESERVES_CANONICAL_FACT_UNIT");
        const incompatible=await request("/rest/v1/rpc/save_catalog_spec",admin.token,"POST",{p_device_id:device.id,p_spec_id:shared,p_input:{valueNumber:999,presentation:{displayUnit:"mm"}}});
        check(incompatible.status===400,"INCOMPATIBLE_UNIT_SAVE_REJECTED_ATOMICALLY");
        check((await read(`/rest/v1/device_specs?select=value_number&id=eq.${shared}`,admin.token))[0].value_number===12,"INCOMPATIBLE_UNIT_NO_PARTIAL_FACT_WRITE");
        const groupSaved=await request("/rest/v1/rpc/save_catalog_group",admin.token,"POST",{p_device_id:device.id,p_group_key:"acceptance",p_presentation:{groupKey:"acceptance",groupZh:"整组验收",groupEn:"Entire acceptance group",groupOrder:4}});
        check(groupSaved.status===200&&(await groupSaved.json())>=2,"ADMIN_GROUP_LABEL_ORDER_ATOMIC_SAVE");
        await save({presentation:{publicDisplay:false}},shared);
        await save({presentation:{labelZh:"新增参数",labelEn:"Added specification",publicDisplay:false}},extraId);
        check((await read(`/rest/v1/public_device_detail_specs?id=eq.${extraId}`,null)).length===0,"ADMIN_PARAMETER_DEACTIVATE_PUBLIC_DENIED");
        for(const owner of [a,b]){
          const denied=await request("/rest/v1/rpc/save_catalog_spec",owner.token,"POST",{p_device_id:device.id,p_spec_id:row.id,p_input:{valueText:"UNAUTHORIZED_SENTINEL"}});
          check([401,403].includes(denied.status),"ORDINARY_USER_RPC_WRITE_DENIED");
          const direct=await request(`/rest/v1/device_specs?id=eq.${row.id}`,owner.token,"PATCH",{value_text:"UNAUTHORIZED_SENTINEL"});
          check(direct.status>=400||(await direct.json()).length===0,"ORDINARY_USER_DIRECT_WRITE_DENIED");
        }
        const anonymous=await request("/rest/v1/rpc/save_catalog_spec",null,"POST",{p_device_id:device.id,p_spec_id:row.id,p_input:{valueText:"UNAUTHORIZED_SENTINEL"}});
        check([401,403].includes(anonymous.status),"ANONYMOUS_RPC_WRITE_DENIED");
        const invalid=await request("/rest/v1/rpc/save_catalog_spec",admin.token,"POST",{p_device_id:device.id,p_spec_id:row.id,p_input:{valueText:"ATOMIC_ROLLBACK_SENTINEL",presentation:{format:"arbitrary-html"}}});
        check(invalid.status===400,"UNSAFE_FORMAT_REJECTED");
        const unchanged=await read(`/rest/v1/device_specs?select=value_text&id=eq.${row.id}`,admin.token);
        check(unchanged[0].value_text==="LOCAL_ADMIN_CHANGED_FACT","INVALID_LOGICAL_SAVE_NO_PARTIAL_WRITE");
        await save({valueText:row.value_text,presentation:row.presentation});
        check(true,"REVERSIBLE_PARAMETER_FIXTURE_CLEANUP");
      }
      const locked=await request(`/rest/v1/devices?id=eq.${devices[0].id}`,admin.token,"PATCH",{brand_key:"local-wrong-brand"});
      check(locked.status===400,"PUBLISHED_BRAND_IDENTITY_LOCKED");
      const disposableId=randomUUID();
      const disposable={id:disposableId,slug:"local-editor-disposable",brand_key:"xreal",brand_name:"XREAL",name:"Local disposable product",short_description:"Local only",long_description:"Local only",image_alt:"Local fixture",category:"smart_glasses",route_label:"Local",route_description:"Local",publication_status:"draft"};
      const createdDevice=await request("/rest/v1/devices",admin.token,"POST",disposable);
      check(createdDevice.status===201,"ADMIN_DISPOSABLE_DEVICE_CREATE");
      const imageA={url:"/assets/catalog-local-a.png",altZh:"图片甲",altEn:"Image A",hero:true},imageB={url:"/assets/catalog-local-b.png",altZh:"图片乙",altEn:"Image B",hero:false};
      for(const [images,name] of [[[imageA,imageB],"ADD_SELECT"],[[{...imageB,hero:true},{...imageA,hero:false}],"REORDER_HERO"],[[{...imageB,url:"/assets/catalog-local-c.png",altZh:"新替代文本",altEn:"New alt text",hero:true},imageA],"REPLACE_ALT"],[[imageA],"REMOVE"]]){
        const media=await request(`/rest/v1/devices?id=eq.${disposableId}`,admin.token,"PATCH",{media:{images}});
        check(media.status===200,`ADMIN_IMAGE_${name}_CANONICAL_SAVE`);
        assert.deepEqual((await media.json())[0].media.images,images,`ADMIN_IMAGE_${name}_CANONICAL_READBACK`);check(true,`ADMIN_IMAGE_${name}_CANONICAL_READBACK`);
      }
      const publish=await request(`/rest/v1/devices?id=eq.${disposableId}`,admin.token,"PATCH",{publication_status:"published"});
      check(publish.status===200,"ADMIN_DISPOSABLE_PUBLICATION_CONTROL");
      check((await read(`/rest/v1/devices?select=slug,media&slug=eq.${disposable.slug}`,null))[0].media.images[0].altEn==="Image A","PUBLIC_READER_IMAGE_SAME_CANONICAL_ROW");
      for(const owner of [a,b]){
        const denied=await request(`/rest/v1/devices?id=eq.${disposableId}`,owner.token,"PATCH",{media:{images:[]},publication_status:"hidden"});
        check(denied.status>=400||(await denied.json()).length===0,"ORDINARY_DEVICE_MEDIA_PUBLICATION_WRITE_DENIED");
        check((await read("/rest/v1/catalog_audit_events?select=entity_type",owner.token)).length===0,"ORDINARY_PRIVATE_AUDIT_READ_DENIED");
      }
      const audit=await read(`/rest/v1/catalog_audit_events?select=action,changed_fields,created_at&entity_id=eq.${disposableId}`,admin.token);
      check(audit.some(e=>e.changed_fields.fields.includes("media"))&&audit.some(e=>e.changed_fields.fields.includes("publication_status"))&&audit.every(e=>Number.isFinite(Date.parse(e.created_at))),"ADMIN_PRIVATE_WHAT_WHEN_DEVICE_AUDIT");
      const hidden=await request(`/rest/v1/devices?id=eq.${disposableId}`,admin.token,"PATCH",{publication_status:"hidden"});check(hidden.status===200,"ADMIN_DISPOSABLE_HIDE");
      check((await read(`/rest/v1/devices?select=slug&slug=eq.${disposable.slug}`,null)).length===0,"ANONYMOUS_UNPUBLISHED_DEVICE_DENIED");
      check((await request(`/rest/v1/devices?id=eq.${disposableId}`,admin.token,"DELETE")).status===200,"DISPOSABLE_DEVICE_CLEANUP");
      receipt.core=await proveCatalogCore({root,directory:path.join(root,"artifacts/qa/catalog-editor-v1",id,"ssr"),target,anonKey,prepared,publication});
      check(receipt.core.dropped===0&&receipt.core.sourceRetained===829,"TASK6_CANONICAL_DATABASE_PUBLIC_MODEL_SSR_829_ZERO_DROPS");
      if(process.argv.includes("--browser-acceptance"))receipt.browser=await proveCatalogBrowser({root,directory:path.join(root,"artifacts/qa/catalog-editor-v1",id,"browser"),target,anonKey,environment,admin,a,deviceId:devices.find(d=>d.slug==="xreal-air").id,executeSql});
      return{status:"PASS"};
    },
  }));
  receipt.status="PASS";receipt.cleanup="PASS";
}catch(error){receipt.firstFailure=error instanceof assert.AssertionError?error.message:"LOCAL_EDITOR_OR_REPLAY_FAILED";process.exitCode=1;}
finally{const directory=path.join(root,"artifacts/qa/catalog-editor-v1");await mkdir(directory,{recursive:true});const file=path.join(directory,`${id}.json`);await writeFile(file,JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});console.log(`CATALOG_EDITOR_LOCAL=${receipt.status}`);console.log(`ASSERTIONS=${receipt.assertions.length}`);if(receipt.firstFailure)console.log(`FIRST_FAIL=${receipt.firstFailure}`);console.log(`RECEIPT=${file}`);}
