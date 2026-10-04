import React,{useEffect,useRef,useState} from "react";
import type {Session} from "@supabase/supabase-js";
import {adminFetch} from "../../lib/admin-api-client";
import {catalogLabel,catalogGroup,catalogUnitOptions,catalogUnits,type CatalogLocale,type CatalogPresentation} from "../../lib/catalog-presentation";

type Definition={key:string;group_key:string;value_type:"number"|"boolean"|"text"|"json"};
type Row={id:string;state:string;canonical_unit:string|null;value_number:number|null;value_boolean:boolean|null;value_text:string|null;value_json:unknown;presentation:CatalogPresentation;device_spec_definitions:Definition};
type Props={deviceId:string;session:Session;locale:CatalogLocale;fetchAdmin?:typeof adminFetch};
type Draft={row:Row|null;key:string;valueType:Definition["value_type"];value:string;state:string;presentation:CatalogPresentation};
const empty=():Draft=>({row:null,key:"custom.",valueType:"text",value:"",state:"KNOWN",presentation:{labelZh:"",labelEn:"",groupKey:"custom",groupZh:"",groupEn:"",groupOrder:0,order:0,keySpec:false,keySpecOrder:0,publicDisplay:true,format:"text",displayUnit:""}});
function responseRows(result:{specs:Row[]}):Row[]{
  if(!Array.isArray(result?.specs)||result.specs.some(row=>!row?.id||!row.device_spec_definitions?.key))throw new Error("Specifications are temporarily unavailable.");
  return result.specs;
}
export default function CatalogSpecificationEditor({deviceId,session,locale,fetchAdmin=adminFetch}:Props){
  const zh=locale==="zh-CN",t=(cn:string,en:string)=>zh?cn:en;
  const [rows,setRows]=useState<Row[]>([]),[draft,setDraft]=useState<Draft>(empty),[error,setError]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const epoch=useRef(0),inFlight=useRef(false);
  useEffect(()=>{const current=++epoch.current;setLoading(true);setRows([]);setDraft(empty());setError("");
    void fetchAdmin<{specs:Row[]}>(`/api/admin/device-specs?deviceId=${encodeURIComponent(deviceId)}`,{session}).then(result=>{const next=responseRows(result);if(epoch.current===current)setRows(next);}).catch(()=>{if(epoch.current===current)setError(t("参数读取暂不可用。","Specifications are temporarily unavailable."));}).finally(()=>{if(epoch.current===current)setLoading(false);});
    return()=>{epoch.current++;};
  },[deviceId,session.access_token]);
  const edit=(row:Row)=>{const p=row.presentation??{},key=row.device_spec_definitions.key;setDraft({row,key,valueType:row.device_spec_definitions.value_type,value:row.value_text??(row.value_number!=null?String(row.value_number):row.value_boolean!=null?String(row.value_boolean):row.value_json!=null?JSON.stringify(row.value_json):""),state:row.state,
    presentation:{...p,labelZh:p.labelZh??catalogLabel(key,"zh-CN").label,labelEn:p.labelEn??catalogLabel(key,"en").label,groupKey:p.groupKey??row.device_spec_definitions.group_key,groupZh:p.groupZh??catalogGroup(row.device_spec_definitions.group_key,"zh-CN"),groupEn:p.groupEn??catalogGroup(row.device_spec_definitions.group_key,"en"),order:p.order??0,groupOrder:p.groupOrder??0,keySpec:p.keySpec??false,keySpecOrder:p.keySpecOrder??0,publicDisplay:p.publicDisplay??true,format:p.format??"text",displayUnit:p.displayUnit??""}});setError("");};
  const patch=(key:keyof CatalogPresentation,value:unknown)=>setDraft(current=>({...current,presentation:{...current.presentation,[key]:value}}));
  const save=async(inputOverride?:Record<string,unknown>)=>{
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError("");const current=epoch.current;
    try{
      const input:Record<string,unknown>=inputOverride??{presentation:draft.presentation};
      if(!inputOverride){
        if(!draft.presentation.labelZh?.trim()||!draft.presentation.labelEn?.trim()||!draft.presentation.groupZh?.trim()||!draft.presentation.groupEn?.trim())throw new Error(t("请填写中英文参数和分组名称。","Enter both specification and group labels."));
        Object.assign(input,{valueNumber:null,valueBoolean:null,valueText:null,valueJson:null});
        if(draft.state==="KNOWN"||draft.state==="CONFLICT"){
          if(draft.valueType==="number"){if(!draft.value.trim()||!Number.isFinite(Number(draft.value)))throw new Error(t("请输入有效数值。","Enter a finite number."));input.valueNumber=Number(draft.value);}
          else if(draft.valueType==="boolean")input.valueBoolean=draft.value==="true";
          else if(draft.valueType==="json")input.valueJson=JSON.parse(draft.value);
          else input.valueText=draft.value;
        }
        if(draft.state!=="CONFLICT")input.state=draft.state;
        if(!draft.row)Object.assign(input,{key:draft.key,valueType:draft.valueType});
      }
      const result=await fetchAdmin<{specId:string}>("/api/admin/device-specs",{session,method:draft.row?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify({deviceId,...(draft.row?{specId:draft.row.id}:{}),input})});
      const refreshed=await fetchAdmin<{specs:Row[]}>(`/api/admin/device-specs?deviceId=${encodeURIComponent(deviceId)}`,{session});
      const next=responseRows(refreshed);if(epoch.current!==current)return;setRows(next);const row=next.find(item=>item.id===result.specId);if(row)edit(row);
    }catch(e){if(epoch.current===current)setError(e instanceof SyntaxError?t("参数值需要有效 JSON。","Enter valid JSON for this value."):e instanceof Error?e.message:t("保存失败。","Save failed."));}
    finally{inFlight.current=false;if(epoch.current===current)setBusy(false);}
  };
  const saveGroup=async()=>{
    if(inFlight.current||!draft.row)return;inFlight.current=true;setBusy(true);setError("");const current=epoch.current;
    try{const {groupKey,groupZh,groupEn,groupOrder}=draft.presentation;
      if(!groupZh?.trim()||!groupEn?.trim())throw new Error(t("请填写中英文分组名称。","Enter both group labels."));
      await fetchAdmin("/api/admin/device-specs",{session,method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({deviceId,action:"group",groupKey:draft.row.presentation.groupKey??draft.row.device_spec_definitions.group_key,presentation:{groupKey,groupZh,groupEn,groupOrder}})});
      const next=responseRows(await fetchAdmin<{specs:Row[]}>(`/api/admin/device-specs?deviceId=${encodeURIComponent(deviceId)}`,{session}));if(epoch.current===current)setRows(next);
    }catch{if(epoch.current===current)setError(t("分组保存失败，请检查名称和顺序。","Group save failed. Check labels and order."));}
    finally{inFlight.current=false;if(epoch.current===current)setBusy(false);}
  };
  const ordered=[...rows].sort((a,b)=>(a.presentation?.order??0)-(b.presentation?.order??0));
  return <section className="catalog-spec-editor" data-catalog-spec-editor>
    <div className="catalog-spec-editor__toolbar"><h3>{t("产品参数","Product specifications")}</h3><button type="button" className="community-button--secondary" disabled={busy} onClick={()=>setDraft(empty())}>{t("新增参数","Add specification")}</button></div>
    {error&&<p className="comment-inline-error" role="alert">{error}</p>}
    {loading?<p role="status">{t("正在读取参数…","Loading specifications…")}</p>:<div className="catalog-spec-editor__rows">{ordered.map(row=><button type="button" key={row.id} data-catalog-spec-id={row.id} disabled={busy} aria-pressed={draft.row?.id===row.id} className="community-button--secondary" onClick={()=>edit(row)}>{catalogLabel(row.device_spec_definitions.key,locale,row.presentation).label}{row.presentation?.publicDisplay===false?` (${t("已停用","Inactive")})`:""}</button>)}</div>}
    <div className="admin-news-form__grid">
      <label className="community-form-field"><span>{t("稳定参数键","Stable parameter key")}</span><input value={draft.key} readOnly={Boolean(draft.row)} onChange={e=>setDraft({...draft,key:e.target.value})}/></label>
      <label className="community-form-field"><span>{t("事实类型","Fact type")}</span><select value={draft.valueType} disabled={Boolean(draft.row)} onChange={e=>setDraft({...draft,valueType:e.target.value as Draft["valueType"]})}>{["text","number","boolean","json"].map(type=><option key={type}>{type}</option>)}</select></label>
      {([['labelZh',t("中文名称","Chinese label")],['labelEn',t("英文名称","English label")],['groupZh',t("中文分组名称","Chinese group title")],['groupEn',t("英文分组名称","English group title")],['groupKey',t("分组键","Group key")]] as const).map(([key,label])=><label key={key} className="community-form-field"><span>{label}</span><input maxLength={240} value={String(draft.presentation[key]??"")} onChange={e=>patch(key,e.target.value)}/></label>)}
      <label className="community-form-field"><span>{t("显示单位","Display unit")}</span><select value={draft.presentation.displayUnit??""} onChange={e=>patch("displayUnit",e.target.value)}><option value="">{t("保留事实单位","Keep factual unit")}</option>{(draft.row?catalogUnitOptions(draft.key,draft.row.canonical_unit):catalogUnits).map(unit=><option key={unit} value={unit}>{unit}</option>)}</select></label>
      <label className="community-form-field"><span>{t("参数值","Value")}</span>{draft.valueType==="boolean"?<select value={draft.value||"false"} onChange={e=>setDraft({...draft,value:e.target.value})}><option value="true">{t("是","Yes")}</option><option value="false">{t("否","No")}</option></select>:<textarea rows={3} value={draft.value} onChange={e=>setDraft({...draft,value:e.target.value})}/>}</label>
      <label className="community-form-field"><span>{t("数据状态","Data state")}</span><select value={draft.state} disabled={draft.state==="CONFLICT"} onChange={e=>setDraft({...draft,state:e.target.value})}><option value="KNOWN">{t("已知","Known")}</option><option value="NOT_DISCLOSED">{t("官方未公布","Not disclosed")}</option><option value="NOT_APPLICABLE">{t("不适用","Not applicable")}</option>{draft.state==="CONFLICT"&&<option value="CONFLICT">{t("存在来源分歧","Conflicting sources")}</option>}</select></label>
      {draft.valueType==="text"&&([['valueZh',t("中文文本值","Chinese text value")],['valueEn',t("英文文本值","English text value")]] as const).map(([key,label])=><label key={key} className="community-form-field"><span>{label}</span><textarea rows={3} maxLength={4000} value={String(draft.presentation[key]??"")} onChange={e=>patch(key,e.target.value)}/></label>)}
      <label className="community-form-field"><span>{t("显示格式","Display format")}</span><select value={draft.presentation.format??"text"} onChange={e=>patch("format",e.target.value)}>{([['text',t("文本","Text")],['number',t("数值","Number")],['boolean',t("是/否","Yes/No")],['dimensions',t("尺寸","Dimensions")],['range',t("范围","Range")],['date',t("日期","Date")]] as const).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {([['order',t("参数顺序","Specification order")],['groupOrder',t("分组顺序","Group order")],['keySpecOrder',t("主要参数顺序","Key Spec order")],['precision',t("小数位数","Decimal places")]] as const).map(([key,label])=><label key={key} className="community-form-field"><span>{label}</span><input type="number" min={0} max={key==="precision"?6:999999} step={1} value={draft.presentation[key]??""} onChange={e=>patch(key,e.target.value===""?undefined:Number(e.target.value))}/></label>)}
    </div>
    <label className="community-form-field"><span><input type="checkbox" checked={draft.presentation.keySpec===true} onChange={e=>patch("keySpec",e.target.checked)}/> {t("列入主要参数","Include in Key Specs")}</span></label>
    <label className="community-form-field"><span><input type="checkbox" checked={draft.presentation.publicDisplay!==false} onChange={e=>patch("publicDisplay",e.target.checked)}/> {t("公开显示","Public display")}</span></label>
    <div className="admin-news-form__actions"><button type="button" className="community-button" disabled={busy||loading} onClick={()=>void save()}>{busy?t("正在保存…","Saving…"):t("保存参数","Save specification")}</button>{draft.row&&<><button type="button" className="community-button--secondary" disabled={busy} onClick={()=>void save({presentation:{...draft.presentation,publicDisplay:false,keySpec:false}})}>{t("停用参数","Deactivate specification")}</button><button type="button" className="community-button--secondary" disabled={busy} onClick={()=>void saveGroup()}>{t("保存整组名称与顺序","Save group labels and order")}</button></>}</div>
  </section>;
}
