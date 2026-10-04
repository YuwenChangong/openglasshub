import assert from "node:assert/strict";
import {readFile,mkdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {build} from "esbuild";
import {transform} from "@astrojs/compiler-rs";
import {resolvePath} from "@astrojs/internal-helpers/mdx";
import {experimental_AstroContainer as AstroContainer} from "astro/container";
import {resolveLocale} from "../../src/lib/i18n/locale.ts";

// Compile the actual route; the injected client performs real anonymous local
// database reads. This is SSR proof, not Worker/header/browser evidence.
export async function createCatalogRouteSSR({root,directory,client,runtime={}}){
  await mkdir(directory,{recursive:true});
  const rendererPath=path.join(directory,"renderer.mjs"),routePath=path.join(directory,"route.mjs");
  await build({entryPoints:[fileURLToPath(import.meta.resolve("@astrojs/react/server.js"))],outfile:rendererPath,bundle:true,platform:"node",format:"esm",packages:"external",logLevel:"silent",plugins:[{name:"renderer-options",setup(builder){
    builder.onResolve({filter:/^astro:react:opts$/},()=>({path:"options",namespace:"options"}));
    builder.onLoad({filter:/.*/,namespace:"options"},()=>({contents:"export default {};"}));
  }}]});
  const previous=globalThis.__catalogSSRClient;
  globalThis.__catalogSSRClient=()=>client;
  try{
    await build({entryPoints:[path.join(root,"src/pages/products/[brand]/[slug].astro")],outfile:routePath,bundle:true,platform:"node",format:"esm",packages:"external",jsx:"automatic",define:{"import.meta.env":"{}"},logLevel:"silent",plugins:[{name:"catalog-local-ssr",setup(builder){
      builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:"runtime",namespace:"catalog"}));
      builder.onResolve({filter:/(?:^|\/)supabase-server(?:\.ts)?$/},()=>({path:"server",namespace:"catalog"}));
      builder.onResolve({filter:/(?:^|\/)supabase-browser(?:\.ts)?$/},()=>({path:"browser",namespace:"catalog"}));
      builder.onResolve({filter:/\.css(?:\?.*)?$/},()=>({path:"css",namespace:"catalog"}));
      builder.onLoad({filter:/.*/,namespace:"catalog"},({path:name})=>({contents:name==="runtime"?`export const env=${JSON.stringify(runtime)};`:name==="server"?"export const createSSRClient=()=>globalThis.__catalogSSRClient();":name==="browser"?"export const createBrowserSupabaseClient=()=>null;export const syncBrowserRealtimeAuth=async()=>null;export const consumeBrowserRecoveryEvent=()=>false;export const invalidateBrowserRecoveryEvent=()=>{};":"export {};"}));
      builder.onLoad({filter:/\.astro$/},async({path:filename})=>{
        const compiled=transform(await readFile(filename,"utf8"),{filename,internalURL:"astro/compiler-runtime",resultScopedSlot:true,resolvePath:specifier=>resolvePath(specifier,filename)});
        assert.equal(compiled.diagnostics.filter(item=>item.severity==="error").length,0,"ACTUAL_CATALOG_ROUTE_COMPILE");
        return{contents:compiled.code,loader:"ts",resolveDir:path.dirname(filename)};
      });
    }}]});
    const {default:Route}=await import(pathToFileURL(routePath).href);
    const {default:renderer}=await import(pathToFileURL(rendererPath).href);
    const container=await AstroContainer.create({astroConfig:{site:"https://127.0.0.1"}});
    container.addServerRenderer({renderer});container.addClientRenderer({name:"@astrojs/react",entrypoint:"@astrojs/react/client.js"});
    return {async request(brand,slug,locale="en"){
      const url=new URL(`/products/${encodeURIComponent(brand)}/${encodeURIComponent(slug)}/`,"https://127.0.0.1");
      const response=await container.renderToResponse(Route,{partial:false,params:{brand,slug},request:new Request(url),locals:{localeContext:resolveLocale({saved:{version:1,preference:locale,generation:1,provenance:"device_explicit"}})}});
      return{response,html:await response.text()};
    },close(){if(previous===undefined)delete globalThis.__catalogSSRClient;else globalThis.__catalogSSRClient=previous;}};
  }catch(error){if(previous===undefined)delete globalThis.__catalogSSRClient;else globalThis.__catalogSSRClient=previous;throw error;}
}
