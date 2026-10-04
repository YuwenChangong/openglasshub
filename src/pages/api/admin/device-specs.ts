import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createCatalogEditorHandlers,createCatalogEditorRepository } from "../../../lib/server/catalog-editor";
import { requireAdmin,jsonResponse } from "../../../lib/server/admin-auth";
export const prerender=false;
const execute:APIRoute=async({request})=>{
  const handlers=createCatalogEditorHandlers({repositoryFor:createCatalogEditorRepository,authorize:async current=>{
    try{return await requireAdmin(current,env);}catch(error){return error instanceof Response?error:jsonResponse({ok:false,code:"SERVER_ERROR"},503);}
  }});
  return handlers.GET(request);
};
export const GET=execute;
export const POST=execute;
export const PATCH=execute;
export const ALL:APIRoute=()=>jsonResponse({ok:false,code:"METHOD_NOT_ALLOWED"},405);
