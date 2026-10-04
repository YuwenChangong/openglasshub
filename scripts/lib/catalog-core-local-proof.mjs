import assert from "node:assert/strict";
import {build} from "esbuild";
import {parse} from "parse5";
import {createClient} from "@supabase/supabase-js";
import {createCatalogRouteSSR} from "./catalog-route-ssr.mjs";
import {assertLocalReplayTarget} from "../qa/local-disposable-supabase-replay.mjs";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";

export async function proveCatalogCore({root,directory,target,anonKey,prepared,publication}){
  assertLocalReplayTarget(target);
  let reads=0;
  const boundedFetch=(input,init)=>{const url=new URL(typeof input==="string"||input instanceof URL?input:input.url);assertLocalReplayTarget(url.href);assert.equal(url.origin,new URL(target).origin);reads++;return fetch(input,{...init,redirect:"error",signal:AbortSignal.timeout(10000)});};
  const client=createClient(target,anonKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:boundedFetch}});
  const compiled=await build({entryPoints:["src/lib/public-product-detail.ts"],absWorkingDir:root,bundle:true,write:false,platform:"node",format:"esm",logLevel:"silent"});
  const {getPublicProductDetail,buildDetailParameterGroups}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
  const ssr=await createCatalogRouteSSR({root,directory,client});
  const result={publishedExpected:publication.published_count,route200:0,route404ForExpected:0,route5xx:0,identityMismatch:0,sourceKnown:829,sourceRetained:0,dropped:0,fabricated:0,localeFactParity:true,rawParameterLabels:0,rawGroupLabels:0,anonymousLocalReads:0,evidenceClass:"GENUINE_LOCAL_DATABASE_ANONYMOUS_PUBLIC_READER_ACTUAL_ASTRO_SSR"};
  const content=node=>node.nodeName==="#text"?node.value:(node.childNodes??[]).map(content).join("");
  const sortFacts=entries=>entries.map(({key,value})=>({key,value})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const groupTitles=html=>{const titles=[];function visit(node){const attrs=Object.fromEntries((node.attrs??[]).map(a=>[a.name,a.value]));if(attrs["data-spec-group"])titles.push({key:attrs["data-spec-group"],label:content(node.childNodes.find(n=>n.tagName==="h3"))});for(const child of node.childNodes??[])visit(child);}visit(parse(html));return titles;};
  result.translationFallbacks=[];
  result.sourceHashes=Object.fromEntries(await Promise.all(["src/lib/public-product-detail.ts","src/lib/public-device-data.ts","src/lib/catalog-presentation.ts","src/components/products/ProductDetail.astro","src/pages/products/[brand]/[slug].astro","supabase/migrations/20261004014637_catalog_editor_presentation_v1.sql"].map(async file=>[file,createHash("sha256").update(await readFile(path.join(root,file))).digest("hex")])));
  const domEntries=html=>{const entries=[];function visit(node){const attrs=Object.fromEntries((node.attrs??[]).map(a=>[a.name,a.value]));if(node.tagName==="div"&&attrs["data-parameter-key"]){const dt=node.childNodes.find(n=>n.tagName==="dt"),dd=node.childNodes.find(n=>n.tagName==="dd");entries.push({key:attrs["data-parameter-key"],label:content(dt),value:dd.attrs.find(a=>a.name==="data-factual-value")?.value??null,display:content(dd)});}for(const child of node.childNodes??[])visit(child);}visit(parse(html));return entries;};
  try{
    for(const candidate of publication.candidates.filter(row=>row.decision==="PUBLISHED")){
      const detail=await getPublicProductDetail(client,candidate.slug);
      assert.ok(detail?.product.normalizedCatalog,"CANONICAL_RUNTIME_NOT_ACTIVATED");
      if(detail.product.brandKey!==candidate.brand||detail.product.slug!==candidate.slug)result.identityMismatch++;
      const groups=buildDetailParameterGroups(detail.product,detail.specs,"en"),actualModel=groups.flatMap(g=>g.items);
      const views=[];
      for(const locale of ["zh-CN","en"]){const rendered=await ssr.request(candidate.brand,candidate.slug,locale);if(locale==="en"){if(rendered.response.status===200)result.route200++;else if(rendered.response.status===404)result.route404ForExpected++;else if(rendered.response.status>=500)result.route5xx++;}assert.equal(rendered.response.status,200,`COHORT_ROUTE_FAILED:${candidate.slug}`);
        const entries=domEntries(rendered.html);assert.equal(entries.length,actualModel.length,`PUBLIC_MODEL_SSR_COUNT:${candidate.slug}`);
        for(const entry of entries){if(entry.label===entry.key||entry.label===entry.key.split(".").at(-1))result.rawParameterLabels++;}
        const expectedFacts=sortFacts(actualModel);
        const actualFacts=sortFacts(entries);
        for(const entry of actualFacts)if(!expectedFacts.some(fact=>JSON.stringify(fact)===JSON.stringify(entry)))result.fabricated++;
        assert.deepEqual(actualFacts,expectedFacts,`PUBLIC_MODEL_SSR_EXACT_FACT_SET:${candidate.slug}:${locale}`);
        for(const title of groupTitles(rendered.html)){if(title.label===title.key)result.rawGroupLabels++;}
        result.translationFallbacks.push(...buildDetailParameterGroups(detail.product,detail.specs,locale).flatMap(group=>group.items.filter(item=>item.translationMissing).map(item=>({slug:candidate.slug,key:item.key,locale}))));
        views.push(actualFacts);
      }
      assert.deepEqual(views[0],views[1],`LOCALE_FACT_PARITY:${candidate.slug}`);
      for(const source of prepared.inventory.parameterLedger.filter(e=>e.slug===candidate.slug&&e.state==="KNOWN")){
        const expected=String(source.value);
        const stored=detail.specs.find(s=>s.key===source.canonicalPath&&s.region===source.region&&s.variant==="");
        const value=stored?.value_number??stored?.value_boolean??stored?.value_text??stored?.value_json;
        const canonical=value===true?"Yes":value===false?"No":typeof value==="object"?JSON.stringify(value):String(value);
        if(!stored||canonical!==expected||!views[1].some(item=>item.key===source.canonicalPath&&item.value===canonical)){result.dropped++;throw new Error(`KNOWN_SOURCE_VALUE_DROPPED:${source.slug}:${source.canonicalPath}`);}
        result.sourceRetained++;
      }
      assert.equal(detail.specs.filter(s=>s.presentation?.publicDisplay!==false).length,actualModel.length,"NO_LEGACY_DUPLICATE_RUNTIME_ROWS");
    }
    assert.equal(result.sourceRetained,829,"829_PARAMETER_ORACLE_NOT_REDUCED");assert.equal(result.route200,publication.published_count);assert.equal(result.rawParameterLabels,0);assert.equal(result.rawGroupLabels,0);assert.equal(result.fabricated,0);assert.equal(result.identityMismatch,0);
    const unknown=await ssr.request("xreal","local-unknown-catalog");assert.equal(unknown.response.status,404);
    const wrong=await ssr.request("rayneo","xreal-air");assert.equal(wrong.response.status,301);assert.equal(wrong.response.headers.get("location"),"/products/xreal/xreal-air/");
    result.anonymousLocalReads=reads;return result;
  }finally{ssr.close();}
}
