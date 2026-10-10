import { resolveLocale, type LocaleContext } from "../../lib/i18n/locale";
import { getUiMessages, formatUiMessage } from "../../lib/i18n/catalog";
import { buildLoginHref } from "../../lib/auth-redirect";
import { useLocale } from "../i18n/useLocale";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminApiError, adminFetch } from "../../lib/admin-api-client";
import GlassConfirmDialog from "../common/GlassConfirmDialog";
import { useAdminSession } from "./useAdminSession";

type Status = "draft" | "published" | "hidden" | "archived";
type Device = Record<string, unknown> & { id:string; slug:string; brandName:string; name:string; publicationStatus:Status; slugLocked:boolean; releaseYear?:string | null; productImageUrl?:string | null; updatedAt?:string | null };
type Form = Record<string, string> & { id:string; slug:string; brandKey:string; brandName:string; name:string; shortDescription:string; longDescription:string; imageAlt:string; category:string; routeLabel:string; routeDescription:string; releaseYear:string; productImageUrl:string; productUrl:string; officialProductUrl:string; buyUrl:string; positioning:string; availability:string; typeLabel:string; statusLabel:string; officialImageUrl:string; keyLimitations:string; bestFor:string; notIdealFor:string; keySpecs:string; fullSpecs:string; media:string };

type AdminDevicesDashboardDeps = { useSession: typeof useAdminSession; fetchAdmin: typeof adminFetch };

export function createAdminDevicesDashboard(deps: AdminDevicesDashboardDeps){ return function AdminDevicesDashboard({ localeContext = resolveLocale({ acceptLanguage: "zh-CN" }) }: { localeContext?: LocaleContext } = {}){
  const { context } = useLocale(localeContext);
  const locale = context.locale;
  const text = getUiMessages(locale).admin;
  const emptyForm:Form={id:"",slug:"",brandKey:"",brandName:"",name:"",shortDescription:"",longDescription:"",imageAlt:"",category:"smart_glasses",routeLabel:"",routeDescription:"",releaseYear:"",productImageUrl:"",productUrl:"",officialProductUrl:"",buyUrl:"",positioning:"",availability:"",typeLabel:"",statusLabel:"",officialImageUrl:"",keyLimitations:"",bestFor:"",notIdealFor:"",keySpecs:"",fullSpecs:"",media:""};

  const filters:["all"|Status,string][]=[["all",text.copy.all],["published",text.copy.published],["draft",text.copy.draft],["hidden",text.copy.hidden],["archived",text.copy.archived]];

  const toList=(value:unknown)=>Array.isArray(value)?value.filter((item):item is string=>typeof item==="string").join("\n"):"";

  const toJson=(value:unknown)=>value&&typeof value==="object"?JSON.stringify(value,null,2):"";

  function toForm(device?:Device):Form { if(!device)return {...emptyForm}; const field=(name:string)=>typeof device[name]==="string"?device[name] as string:""; return {...emptyForm,id:device.id,slug:device.slug,brandKey:field("brandKey"),brandName:device.brandName,name:device.name,shortDescription:field("shortDescription"),longDescription:field("longDescription"),imageAlt:field("imageAlt"),category:field("category")||"smart_glasses",routeLabel:field("routeLabel"),routeDescription:field("routeDescription"),releaseYear:field("releaseYear"),productImageUrl:field("productImageUrl"),productUrl:field("productUrl"),officialProductUrl:field("officialProductUrl"),buyUrl:field("buyUrl"),positioning:field("positioning"),availability:field("availability"),typeLabel:field("typeLabel"),statusLabel:field("statusLabel"),officialImageUrl:field("officialImageUrl"),keyLimitations:toList(device.keyLimitations),bestFor:toList(device.bestFor),notIdealFor:toList(device.notIdealFor),keySpecs:toJson(device.keySpecs),fullSpecs:toJson(device.fullSpecs),media:toJson(device.media)}; }

  function lines(value:string){return value.split("\n").map((item)=>item.trim()).filter(Boolean);}

  function payload(form:Form){const parse=(value:string,label:string)=>{if(!value.trim())return undefined;try{return JSON.parse(value);}catch{throw new Error(formatUiMessage(text.copy.validJsonRequired, { value0: label }));}}; const data:Record<string,unknown>={brandKey:form.brandKey.trim(),brandName:form.brandName.trim(),name:form.name.trim(),shortDescription:form.shortDescription.trim(),longDescription:form.longDescription.trim(),imageAlt:form.imageAlt.trim(),category:form.category.trim(),routeLabel:form.routeLabel.trim(),routeDescription:form.routeDescription.trim()}; for(const key of ["slug","releaseYear","productImageUrl","productUrl","officialProductUrl","buyUrl","positioning","availability","typeLabel","statusLabel","officialImageUrl"] as const)if(form[key].trim())data[key]=form[key].trim(); for(const key of ["bestFor","notIdealFor","keyLimitations"] as const)if(form[key].trim())data[key]=lines(form[key]); for(const key of ["media","keySpecs","fullSpecs"] as const){const value=parse(form[key],key);if(value!==undefined)data[key]=value;}return data;}

 const admin=deps.useSession(); const inFlightMutations=useRef(new Set<string>()); const [activeMutationKeys,setActiveMutationKeys]=useState<Set<string>>(new Set()); const [devices,setDevices]=useState<Device[]>([]),[filter,setFilter]=useState<"all"|Status>("all"),[form,setForm]=useState<Form>({...emptyForm}),[loading,setLoading]=useState(true),[error,setError]=useState(""),[publishTarget,setPublishTarget]=useState<Device|null>(null),[deleteTarget,setDeleteTarget]=useState<Device|null>(null),[restoreTarget,setRestoreTarget]=useState<Status>("draft"); const selectedMutationKey=form.id?`device:${form.id}`:"create"; const saving=activeMutationKeys.has(selectedMutationKey);
 const authorized=admin.state.status==="ready"&&admin.me?.role==="admin"&&admin.me.allowed===true&&Boolean(admin.session?.access_token)&&Boolean(admin.me.user_id)&&admin.me.user_id===admin.session?.user?.id;
 const ownerId=authorized?admin.me!.user_id:null;
 const sessionKey=authorized?admin.session!.access_token:null;
 const currentSessionKey=useRef(sessionKey); currentSessionKey.current=sessionKey;
 const request=useRef<{cancel:()=>void}|null>(null);
 const [formOwnerId,setFormOwnerId]=useState<string|null>(null);
 const formOwner=useRef<string|null>(null);
 const mutationGeneration=useRef(0);
 const [loadedSessionKey,setLoadedSessionKey]=useState<string|null>(null);
 const rejectAccess=(e:unknown)=>{
   if(e instanceof AdminApiError&&e.status===401){admin.setState({status:"signed_out",message:""});return true;}
   if(e instanceof AdminApiError&&e.status===403){admin.setState({status:"forbidden",message:""});return true;}
   return false;
 };
 const load=useCallback(async()=>{
   request.current?.cancel();
   if(!sessionKey||!admin.session)return;
   const controller=new AbortController();
   let active=true;
   let timeout:ReturnType<typeof setTimeout>;
   const owned={cancel:()=>{active=false;controller.abort();clearTimeout(timeout);}};
   request.current=owned;
   setLoading(true);setError("");
   try{
     const deadline=new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{reject(new Error("DEVICE_LIST_TIMEOUT"));controller.abort();},15000);});
     const result=await Promise.race([deps.fetchAdmin<{devices?:Device[]}>("/api/admin/devices",{session:admin.session,signal:controller.signal}),deadline]);
     if(!Array.isArray(result.devices)||!result.devices.every(device=>device&&[device.id,device.slug,device.name,device.brandName].every(value=>typeof value==="string")&&["draft","published","hidden","archived"].includes(device.publicationStatus)))throw new Error("DEVICE_LIST_RESPONSE_INVALID");
     if(active&&currentSessionKey.current===sessionKey){setDevices(result.devices);setLoadedSessionKey(sessionKey);}
   }catch(e){if(active&&currentSessionKey.current===sessionKey){if(!rejectAccess(e))setError(text.copy.actionFailedPleaseTryAgainLater);}}
   finally{clearTimeout(timeout!);if(active&&currentSessionKey.current===sessionKey)setLoading(false);}
 },[sessionKey]);
 useEffect(()=>{
   const accessLost=admin.state.status==="signed_out"||admin.state.status==="forbidden"||(admin.state.status==="ready"&&!authorized);
   // A temporary session check or token renewal must not discard same-user edits.
   if((ownerId&&ownerId!==formOwner.current)||accessLost){
     formOwner.current=ownerId;setFormOwnerId(ownerId);mutationGeneration.current++;
     inFlightMutations.current=new Set();setActiveMutationKeys(new Set());
     setDevices([]);setLoadedSessionKey(null);
     setForm({...emptyForm});setPublishTarget(null);setDeleteTarget(null);setError("");
   }
 },[ownerId,admin.state.status]);
 useEffect(()=>{
   setError("");
   void load();
   return ()=>request.current?.cancel();
 },[load]);
 const visible=useMemo(()=>filter==="all"?devices:devices.filter((item)=>item.publicationStatus===filter),[devices,filter]); const counts=useMemo(()=>Object.fromEntries(filters.map(([value])=>[value,value==="all"?devices.length:devices.filter((item)=>item.publicationStatus===value).length])),[devices]);
 const select=(device:Device)=>{setForm(toForm(device));setError("");}; const patch=(key:keyof Form,value:string)=>setForm((current)=>({...current,[key]:value}));
 const mutate=async(method:"POST"|"PATCH"|"DELETE", body:Record<string,unknown>)=>{
   if(!authorized||!admin.session)return false;
   const generation=mutationGeneration.current;
   const key=typeof body.id==="string"?`device:${body.id}`:"create";
   if(inFlightMutations.current.has(key))return false;
   inFlightMutations.current.add(key);setActiveMutationKeys((current)=>new Set(current).add(key));setError("");
   try{
     const result=await deps.fetchAdmin<{device?:Device}>("/api/admin/devices",{session:admin.session,method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});
     if(currentSessionKey.current!==sessionKey||mutationGeneration.current!==generation)return false;
     if(result.device)setDevices((current)=>current.some((d)=>d.id===result.device!.id)?current.map((d)=>d.id===result.device!.id?result.device!:d):[result.device!,...current]);
     await load();
     return currentSessionKey.current===sessionKey&&mutationGeneration.current===generation;
   }catch(e){
     if(currentSessionKey.current===sessionKey&&mutationGeneration.current===generation&&!rejectAccess(e))setError(text.copy.actionFailedPleaseTryAgainLater);
     return false;
   }finally{
     if(mutationGeneration.current===generation){
       inFlightMutations.current.delete(key);
       setActiveMutationKeys((current)=>{const next=new Set(current);next.delete(key);return next;});
     }
   }
 };
 const save=async()=>{try{const data=payload(form);if(form.id)await mutate("PATCH",{id:form.id,...data});else{const ok=await mutate("POST",data);if(ok)setForm({...emptyForm});}}catch(e){setError(e instanceof Error?e.message:text.copy.invalidForm);}};
 const lifecycle=(status:Status)=>{if(!form.id)return;void mutate("PATCH",{id:form.id,publicationStatus:status});};
 if(!authorized||formOwnerId!==ownerId){
   const status=authorized?"checking":admin.state.status;
   const message=status==="checking"?text.copy.checkingSignInStatus:status==="signed_out"?text.copy.signInFirst:status==="forbidden"||status==="ready"?text.copy.thisAccountDoesNotHaveAdministratorAccess:status==="timeout"?text.copy.sessionCheckTimedOutRefreshOrSignInAgain:text.copy.failedToConfirmAdministratorAccess;
   return <section className="community-empty admin-state-message" aria-live="polite"><p>{message}</p>{status!=="checking"?<a className="community-button--secondary" href={buildLoginHref("/admin/devices/")}>{text.copy.signInFirst}</a>:null}{status==="error"||status==="timeout"?<button type="button" className="community-button--secondary" onClick={()=>void admin.refresh()}>{text.copy.retry}</button>:null}</section>;
 }
 return <section className="admin-news-dashboard" aria-label={text.copy.deviceManagement}>
  <h1 className="community-page-title">{text.pages.devices.title}</h1>
  <div className="admin-news-toolbar"><div><h2>{text.copy.deviceCatalogManagement}</h2><p>{text.copy.deviceOperationsUseTheProtectedAdminAPINewDevices}</p></div><button type="button" className="community-button" onClick={()=>{setForm({...emptyForm});setError("");}}>{text.copy.createDevice}</button></div>
  <div className="admin-news-toolbar__filters" aria-label={text.copy.publicationStatusFilters}>{filters.map(([value,label])=><button key={value} type="button" className={filter===value?"community-button":"community-button--secondary"} onClick={()=>setFilter(value)}>{label} ({loadedSessionKey===sessionKey?counts[value]??0:"-"})</button>)}</div>
  {error?<div className="comment-inline-error" role="alert">{error} <button type="button" className="community-link" onClick={()=>void load()}>{text.copy.retry}</button></div>:null}
  <div className="admin-news-dashboard__grid"><div className="admin-news-dashboard__list"><div className="admin-news-dashboard__list-head"><div><strong>{text.copy.deviceList}</strong><p>{text.copy.manageDraftPublishedHiddenAndArchivedRecords}</p></div></div>{loading?<p className="community-meta">{text.copy.loadingDevices}</p>:error?null:loadedSessionKey!==sessionKey?null:visible.length===0?<div className="community-empty"><strong>{text.copy.noDevices}</strong><p>{text.copy.changeFiltersOrCreateTheFirstDraft}</p></div>:visible.map((device)=><button key={device.id} type="button" className={`admin-news-card${form.id===device.id?" is-active":""}`} onClick={()=>select(device)}><div className="admin-news-card__meta"><span className="community-tag">{device.publicationStatus}</span><span className="community-meta">{device.slug}</span></div><strong>{device.name}</strong><p>{device.brandName}{device.releaseYear?` · ${device.releaseYear}`:""}</p></button>)}</div>
   <form className="admin-news-form" onSubmit={(event)=>{event.preventDefault();void save();}}><div className="admin-news-form__head"><div><strong>{form.id?text.copy.editDevice:text.copy.newDevice}</strong><p>{form.id?text.copy.changesTakeEffectAfterSaving:text.copy.newDevicesRemainDraftsPublishingRequiresASeparateConfirmation}</p></div></div>
   <section className="admin-news-form__section"><div className="admin-news-form__grid">{([['brandKey',text.copy.brandKey],['brandName',text.copy.brandName],['name',text.copy.deviceName],['slug',text.copy.uRLSlug],['releaseYear',text.copy.releaseYear],['category',text.copy.category],['typeLabel',text.copy.typeLabel],['statusLabel',text.copy.statusLabel],['availability',text.copy.availability],['imageAlt',text.copy.imageAltText],['productImageUrl',text.copy.productImageURL],['officialImageUrl',text.copy.officialImageURL],['productUrl',text.copy.productURL],['officialProductUrl',text.copy.officialURL],['buyUrl',text.copy.buyURL]] as [keyof Form,string][]).map(([key,label])=><label key={key} className="community-form-field"><span>{label}</span><input value={form[key]} disabled={key==='slug'&&Boolean((devices.find((d)=>d.id===form.id))?.slugLocked)} onChange={(e)=>patch(key,e.target.value)} />{key==='slug'&&form.id&&devices.find((d)=>d.id===form.id)?.slugLocked?<small className="community-meta">{text.copy.theURLIsPermanentlyLockedAfterTheFirstPublication}</small>:null}</label>)}</div></section>
   <section className="admin-news-form__section">{([['shortDescription',text.copy.shortDescription],['longDescription',text.copy.longDescription],['positioning',text.copy.positioning],['routeLabel',text.copy.routeLabel],['routeDescription',text.copy.routeDescription],['bestFor',text.copy.bestForOneItemPerLine],['notIdealFor',text.copy.notIdealForOneItemPerLine],['keyLimitations',text.copy.limitationsOneItemPerLine],['media',text.copy.mediaJSON],['keySpecs',text.copy.keySpecsJSON],['fullSpecs',text.copy.fullSpecsJSON]] as [keyof Form,string][]).map(([key,label])=><label key={key} className="community-form-field"><span>{label}</span><textarea rows={key==='longDescription'||key==='fullSpecs'?6:3} value={form[key]} onChange={(e)=>patch(key,e.target.value)} /></label>)}</section>
   <div className="admin-news-form__actions"><button type="submit" className="community-button" disabled={saving}>{saving?text.copy.savingChanges:form.id?text.copy.saveChanges:text.copy.createDraft}</button>{form.id?<><button type="button" className="community-button--secondary" disabled={saving} onClick={()=>{const selected=devices.find((d)=>d.id===form.id);if(selected)setPublishTarget(selected);}}>{text.copy.publish}</button><button type="button" className="community-button--secondary" disabled={saving} onClick={()=>lifecycle("hidden")}>{text.copy.hide}</button><button type="button" className="community-button--secondary" disabled={saving} onClick={()=>lifecycle("archived")}>{text.copy.archive}</button>{devices.find((d)=>d.id===form.id)?.publicationStatus==="archived"?<><label className="community-form-field"><span>{text.copy.restoreAs}</span><select value={restoreTarget} onChange={(e)=>setRestoreTarget(e.target.value as Status)}><option value="draft">{text.copy.draft}</option><option value="hidden">{text.copy.hide}</option><option value="published">{text.copy.published}</option></select></label><button type="button" className="community-button--secondary" disabled={saving} onClick={()=>lifecycle(restoreTarget)}>{text.copy.restore}</button><button type="button" className="community-button--secondary admin-action-danger" disabled={saving} onClick={()=>setDeleteTarget(devices.find((d)=>d.id===form.id)??null)}>{text.copy.permanentlyDelete}</button></>:null}</>:null}</div></form></div>
  <GlassConfirmDialog open={Boolean(publishTarget)} title={text.copy.publishDevice} description={text.copy.publishingPermanentlyLocksTheSlugContinue} detail={publishTarget?.name} confirmLabel={text.copy.confirmPublish} cancelLabel={text.copy.cancel} loading={saving} error={error} onCancel={()=>setPublishTarget(null)} onConfirm={()=>{if(!publishTarget)return;void mutate("PATCH",{id:publishTarget.id,publicationStatus:"published"}).then((ok)=>{if(ok)setPublishTarget(null);});}} />
  <GlassConfirmDialog open={Boolean(deleteTarget)} title={text.copy.permanentlyDeleteDevice} description={text.copy.thisPermanentlyDeletesTheDeviceRecordAndCannotBe} detail={deleteTarget?.name} confirmLabel={text.copy.confirmPermanentDeletion} cancelLabel={text.copy.cancel} danger loading={saving} error={error} onCancel={()=>setDeleteTarget(null)} onConfirm={()=>{if(!deleteTarget)return;void mutate("DELETE",{id:deleteTarget.id,confirmPermanentDelete:true}).then((ok)=>{if(ok){setDeleteTarget(null);setForm({...emptyForm});}});}} />
 </section>;
}; }

export default createAdminDevicesDashboard({ useSession: useAdminSession, fetchAdmin: adminFetch });
