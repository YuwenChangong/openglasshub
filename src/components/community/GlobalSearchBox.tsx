import {useCallback,useEffect,useId,useRef,useState,type FormEvent} from "react";
import {resolveLocale,type LocaleContext} from "../../lib/i18n/locale";
import {useLocale} from "../i18n/useLocale";
import {quickSearchGroups,type QuickSearchGroup} from "../../lib/quick-search";
import {safeCatalogMediaUrl} from "../../lib/product-public-safety";

type Props={className?:string;compact?:boolean;circleSlug?:string;localeContext?:LocaleContext};
export default function GlobalSearchBox({className="",compact=false,circleSlug,localeContext=resolveLocale({})}:Props){
  const {messages,context}=useLocale(localeContext),text=messages.shell,zh=context.locale==="zh-CN";
  const [query,setQuery]=useState(""),[open,setOpen]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(false),[groups,setGroups]=useState<QuickSearchGroup[]>([]);
  const root=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),active=useRef<AbortController|null>(null),generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null),id=useId();
  const trimmed=query.trim(),eligible=trimmed.length>=2;
  const detailHref=trimmed?`/search/?q=${encodeURIComponent(trimmed)}${circleSlug?`&circle=${encodeURIComponent(circleSlug)}&type=posts`:""}`:"/search/";
  const cancel=useCallback(()=>{generation.current++;active.current?.abort();if(timer.current!==null)clearTimeout(timer.current);},[]);
  const dismiss=useCallback(()=>{cancel();setLoading(false);setOpen(false);},[cancel]);
  const fetchPreview=useCallback(async(value:string)=>{
    cancel();if(value.trim().length<2){setGroups([]);setOpen(false);setLoading(false);return;}
    const current=generation.current,controller=new AbortController();active.current=controller;
    setGroups([]);setError(false);setLoading(true);setOpen(true);
    const params=new URLSearchParams({q:value.trim(),type:circleSlug?"posts":"all",limit_posts:"3",limit_circles:"3",limit_users:"3",limit_devices:"3"});if(circleSlug)params.set("circle",circleSlug);
    try{const response=await fetch(`/api/forum/search?${params}`,{headers:{Accept:"application/json"},signal:controller.signal});const payload=await response.json();
      if(controller.signal.aborted||generation.current!==current)return;
      if(!response.ok||payload?.ok!==true)throw new Error("SEARCH_FAILED");
      setGroups(quickSearchGroups(payload.results,Boolean(circleSlug)));
    }catch{if(!controller.signal.aborted&&generation.current===current){setGroups([]);setError(true);}}
    finally{if(!controller.signal.aborted&&generation.current===current)setLoading(false);}
  },[cancel,circleSlug]);
  useEffect(()=>{
    cancel();setGroups([]);setError(false);setLoading(false);setOpen(false);
    if(eligible)timer.current=setTimeout(()=>void fetchPreview(trimmed),180);
    return cancel;
  },[eligible,trimmed,fetchPreview,cancel]);
  useEffect(()=>{
    const pointer=(event:PointerEvent)=>{if(root.current&&!root.current.contains(event.target as Node))dismiss();};
    const keyboard=(event:KeyboardEvent)=>{if(event.key==="Escape"&&root.current?.contains(document.activeElement)){input.current?.focus();dismiss();}};
    document.addEventListener("pointerdown",pointer);document.addEventListener("keydown",keyboard);
    return()=>{document.removeEventListener("pointerdown",pointer);document.removeEventListener("keydown",keyboard);cancel();};
  },[cancel,dismiss]);
  const submit=(event:FormEvent)=>{event.preventDefault();if(trimmed)window.location.assign(detailHref);};
  const visible=open&&eligible;
  const titles={posts:zh?"帖子":"Posts",circles:zh?"圈子":"Circles",users:zh?"用户":"Users",devices:zh?"设备":"Devices"};
  return <div className={["global-search-box",compact?"global-search-box--compact":"global-search-box--hero",className].filter(Boolean).join(" ")} ref={root}>
    <form className="global-search-box__form" role="search" action="/search/" onSubmit={submit}>
      <label className="global-search-box__field"><span className="sr-only">{text.search}</span><input ref={input} type="search" name="q" value={query} onChange={event=>setQuery(event.target.value)} onFocus={()=>{if(eligible)setOpen(true);}} className="glass-input global-search-box__input" placeholder={text.search} autoComplete="off" aria-expanded={visible} aria-controls={id} maxLength={80}/></label>
      <button type="button" className="community-button global-search-box__button" onClick={()=>void fetchPreview(trimmed)}>{text.search}</button>
    </form>
    {visible&&<div id={id} className="global-search-box__dropdown glass-card is-open" aria-label={text.quickResults}>
      <div className="global-search-box__dropdown-head"><strong>{text.searchResults}</strong><a href={detailHref} className="community-link">{text.viewDetails}</a></div>
      {loading?<div className="global-search-box__empty" role="status">{text.searching}</div>:error?<div className="global-search-box__empty" role="alert">{messages.catalog.searchFailed}</div>:groups.length?<div className="global-search-box__list">{groups.map(group=><section key={group.key} data-quick-group={group.key}><h3 className="global-search-box__group-title">{titles[group.key]}</h3>{group.items.map(item=><a key={item.href} href={item.href} className="global-search-box__item">{safeCatalogMediaUrl(item.image,import.meta.env.PUBLIC_R2_PUBLIC_BASE_URL)&&<img src={safeCatalogMediaUrl(item.image,import.meta.env.PUBLIC_R2_PUBLIC_BASE_URL)!} alt="" className="global-search-box__thumb" loading="lazy"/>}<div className="global-search-box__item-copy"><strong>{item.title}</strong>{item.description&&<span>{item.description}</span>}</div></a>)}</section>)}</div>:<div className="global-search-box__empty">{text.noSearchResults}</div>}
    </div>}
  </div>;
}
