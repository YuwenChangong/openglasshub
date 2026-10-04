import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse } from "./admin-auth";
import {catalogUnits} from "../catalog-presentation";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const allowedPresentation = new Set(["labelZh","labelEn","valueZh","valueEn","groupKey","groupZh","groupEn","groupOrder","order","keySpec","keySpecOrder","publicDisplay","format","displayUnit","precision"]);
export function validateCatalogPresentation(value: unknown) {
  if (!object(value) || JSON.stringify(value).length > 12000 || Object.keys(value).some(key => !allowedPresentation.has(key))) return false;
  for (const [key, item] of Object.entries(value)) {
    if (["labelZh","labelEn","groupZh","groupEn"].includes(key) && (typeof item !== "string" || !item.trim() || item.length > 240)) return false;
    if (["valueZh","valueEn"].includes(key) && (typeof item !== "string" || item.length > 4000)) return false;
    if (["groupOrder","order","keySpecOrder"].includes(key) && (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 999999)) return false;
    if (["keySpec","publicDisplay"].includes(key) && typeof item !== "boolean") return false;
    if (key === "precision" && (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 6)) return false;
    if (key === "groupKey" && (typeof item !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(item))) return false;
    if (key === "format" && !["text","number","boolean","dimensions","range","date"].includes(String(item))) return false;
    if (key === "displayUnit" && (typeof item !== "string" || (item!==""&&!catalogUnits.includes(item)))) return false;
  }
  return true;
}
export function validateCatalogSpecInput(value: unknown, adding = false) {
  if (!object(value) || JSON.stringify(value).length > 24000 || !Object.keys(value).length) return false;
  const allowed = new Set(["state","valueNumber","valueBoolean","valueText","valueJson","presentation",...(adding ? ["key","valueType","region","variant"] : [])]);
  if (Object.keys(value).some(key => !allowed.has(key))) return false;
  if (adding && (typeof value.key !== "string" || !/^custom\.[a-z][a-z0-9_]{0,63}$/.test(value.key) || !["number","boolean","text","json"].includes(String(value.valueType)))) return false;
  if (value.state !== undefined && !["KNOWN","NOT_DISCLOSED","NOT_APPLICABLE"].includes(String(value.state))) return false;
  if (value.valueNumber != null && (typeof value.valueNumber !== "number" || !Number.isFinite(value.valueNumber))) return false;
  if (value.valueBoolean != null && typeof value.valueBoolean !== "boolean") return false;
  if (value.valueText != null && (typeof value.valueText !== "string" || value.valueText.length > 4000)) return false;
  if (value.presentation !== undefined && !validateCatalogPresentation(value.presentation)) return false;
  for (const key of ["region","variant"]) if (value[key] !== undefined && (typeof value[key] !== "string" || (value[key] as string).length > 120)) return false;
  return true;
}

export function createCatalogEditorRepository(client: SupabaseClient) {
  return {
    async list(deviceId: string) {
      const { data, error } = await client.from("device_specs").select("id,device_id,state,value_number,value_boolean,value_text,value_json,canonical_unit,measurement_context,region,variant,presentation,device_spec_definitions(key,group_key,label,value_type,admin_order)").eq("device_id",deviceId).order("created_at");
      if (error) throw new Error("CATALOG_READ_FAILED");
      return data ?? [];
    },
    async save(deviceId: string,specId: string|null,input: Record<string,unknown>) {
      const { data,error } = await client.rpc("save_catalog_spec",{p_device_id:deviceId,p_spec_id:specId,p_input:input});
      if (error) throw new Error(error.code === "23514" || error.code === "23505" ? "CATALOG_VALIDATION_FAILED" : "CATALOG_SAVE_FAILED");
      return data;
    },
    async group(deviceId: string,groupKey: string,presentation: Record<string,unknown>) {
      const { data,error } = await client.rpc("save_catalog_group",{p_device_id:deviceId,p_group_key:groupKey,p_presentation:presentation});
      if (error) throw new Error("CATALOG_SAVE_FAILED");
      return data;
    },
  };
}
type Authorize = (request: Request) => Promise<{ client: SupabaseClient } | Response | null>;
type Repository = ReturnType<typeof createCatalogEditorRepository>;
const invalid = () => jsonResponse({ok:false,code:"CATALOG_INPUT_INVALID",message:"Invalid catalog fields / 目录字段无效。"},400);
export function createCatalogEditorHandlers({ authorize,repositoryFor }: {authorize:Authorize;repositoryFor:(client:SupabaseClient)=>Repository}) {
  async function handle(request:Request) {
    const access=await authorize(request);
    if(access instanceof Response)return access;
    if(!access)return jsonResponse({ok:false,code:"UNAUTHORIZED"},401);
    const repository=repositoryFor(access.client);
    try {
      if(request.method==="GET") {
        const deviceId=new URL(request.url).searchParams.get("deviceId");
        if(!deviceId||!uuid.test(deviceId))return invalid();
        return jsonResponse({ok:true,specs:await repository.list(deviceId)});
      }
      if(!["POST","PATCH"].includes(request.method))return jsonResponse({ok:false,code:"METHOD_NOT_ALLOWED"},405);
      const body=await request.json().catch(()=>null);
      if(!object(body)||typeof body.deviceId!=="string"||!uuid.test(body.deviceId))return invalid();
      if(body.action==="group") {
        if(Object.keys(body).some(k=>!["deviceId","action","groupKey","presentation"].includes(k))||typeof body.groupKey!=="string"||!/^[a-z][a-z0-9_-]{0,63}$/.test(body.groupKey)||!validateCatalogPresentation(body.presentation)||Object.keys(body.presentation as object).some(k=>!["groupKey","groupZh","groupEn","groupOrder"].includes(k)))return invalid();
        return jsonResponse({ok:true,changed:await repository.group(body.deviceId,body.groupKey,body.presentation as Record<string,unknown>)});
      }
      if(Object.keys(body).some(k=>!["deviceId","specId","input"].includes(k)))return invalid();
      const adding=request.method==="POST";
      if(!adding&&(typeof body.specId!=="string"||!uuid.test(body.specId)))return invalid();
      if(adding&&body.specId!=null)return invalid();
      if(!validateCatalogSpecInput(body.input,adding))return invalid();
      return jsonResponse({ok:true,specId:await repository.save(body.deviceId,adding?null:body.specId as string,body.input as Record<string,unknown>)},adding?201:200);
    }catch(error){const validation=error instanceof Error&&error.message==="CATALOG_VALIDATION_FAILED";return jsonResponse({ok:false,code:validation?"CATALOG_VALIDATION_FAILED":"CATALOG_SAVE_FAILED",message:validation?"Catalog values violate a saved definition / 参数与定义不符。":"Catalog operation unavailable / 目录操作暂不可用。"},validation?400:503);}
  }
  return{GET:handle,POST:handle,PATCH:handle};
}
