import assert from "node:assert/strict";
import { build } from "esbuild";
const compiled=await build({entryPoints:["src/lib/server/catalog-editor.ts"],bundle:true,write:false,platform:"node",format:"esm",logLevel:"silent"});
const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const {validateCatalogPresentation:p,validateCatalogSpecInput:s,createCatalogEditorHandlers}=api;
assert.equal(p({labelZh:"重量",labelEn:"Weight",format:"number",precision:1}),true);
for(const value of [{format:"html"},{template:"<script>"},{precision:8},{order:-1},{keySpec:"true"},{groupKey:"../raw"},{displayUnit:"<img>"}])assert.equal(p(value),false);
for(const value of [{admin:true},{id:"overwritten"},{valueNumber:Infinity},{state:"UNKNOWN_UNVERIFIED"},{key:"new-identity"}])assert.equal(s(value),false);
assert.equal(s({valueNumber:0,presentation:{labelEn:'</script><img onerror="alert(1)">',labelZh:"字面文本"}}),true,"Catalog text is literal, not markup");
let calls=0;
const repository={list:async()=>{calls++;return[];},save:async()=>{calls++;return"saved";}};
const request=(method,body)=>new Request("https://example.invalid/api/admin/device-specs",{method,body:JSON.stringify(body),headers:{"content-type":"application/json"}});
for(const status of [401,403]){
 const handlers=createCatalogEditorHandlers({authorize:async()=>new Response(null,{status}),repositoryFor:()=>repository});
 assert.equal((await handlers.POST(request("POST",{deviceId:"invalid"}))).status,status);
}
assert.equal(calls,0,"Unauthorized actors never reach repository");
const handlers=createCatalogEditorHandlers({authorize:async()=>({client:{}}),repositoryFor:()=>repository});
const deviceId="00000000-0000-4000-8000-000000000001",specId="00000000-0000-4000-8000-000000000002";
assert.equal((await handlers.PATCH(request("PATCH",{deviceId,specId,input:{valueNumber:0}}))).status,200);
assert.equal((await handlers.PATCH(request("PATCH",{deviceId,specId,input:{admin:true}}))).status,400);
assert.equal((await handlers.POST(request("POST",{deviceId,input:{key:"custom.zero",valueType:"number",valueNumber:0,state:"KNOWN"}}))).status,201);
console.log("CATALOG_EDITOR_API=PASS");
