import React from "react";
import type {CatalogLocale} from "../../lib/catalog-presentation";
import {safeCatalogMediaUrl} from "../../lib/product-public-safety";
type Image={url:string;altZh:string;altEn:string;hero:boolean};
export default function CatalogMediaEditor({value,onChange,locale,legacyUrl,legacyAlt}:{value:string;onChange:(value:string)=>void;locale:CatalogLocale;legacyUrl?:string;legacyAlt?:string}){
  let media:Record<string,unknown>={};try{const parsed=JSON.parse(value||"{}");if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))media=parsed;}catch{/* Main form retains invalid draft until it is corrected. */}
  const images:Image[]=Array.isArray(media.images)?media.images.filter(item=>item&&typeof item.url==="string"&&typeof item.altZh==="string"&&typeof item.altEn==="string"&&typeof item.hero==="boolean"):legacyUrl?[{url:legacyUrl,altZh:legacyAlt??"",altEn:legacyAlt??"",hero:true}]:[];
  const zh=locale==="zh-CN",t=(cn:string,en:string)=>zh?cn:en;
  const save=(next:Image[])=>onChange(JSON.stringify({...media,images:next}));
  const patch=(index:number,fields:Partial<Image>)=>save(images.map((item,i)=>i===index?{...item,...fields}:item));
  const move=(index:number,delta:number)=>{const next=[...images],target=index+delta;if(target<0||target>=next.length)return;[next[index],next[target]]=[next[target],next[index]];save(next);};
  return <section className="catalog-media-editor" data-catalog-media-editor><h3>{t("产品图片","Product images")}</h3>{images.map((image,index)=><fieldset key={index} className="admin-news-form__section"><legend>{t("图片","Image")} {index+1}</legend><div className="admin-news-form__grid">
    {safeCatalogMediaUrl(image.url,import.meta.env.PUBLIC_R2_PUBLIC_BASE_URL)&&<img src={safeCatalogMediaUrl(image.url,import.meta.env.PUBLIC_R2_PUBLIC_BASE_URL)!} alt={zh?image.altZh:image.altEn} width="240" height="150" style={{objectFit:"contain",maxWidth:"100%"}}/>}
    <label className="community-form-field"><span>{t("已批准的图片地址","Approved image URL")}</span><input value={image.url} onChange={e=>patch(index,{url:e.target.value})}/></label>
    <label className="community-form-field"><span>{t("中文替代文本","Chinese alt text")}</span><input maxLength={500} value={image.altZh} onChange={e=>patch(index,{altZh:e.target.value})}/></label>
    <label className="community-form-field"><span>{t("英文替代文本","English alt text")}</span><input maxLength={500} value={image.altEn} onChange={e=>patch(index,{altEn:e.target.value})}/></label></div>
    <label><input type="radio" name="catalog-hero" checked={image.hero} onChange={()=>save(images.map((item,i)=>({...item,hero:i===index})))}/> {t("主图","Hero image")}</label>
    <div className="admin-news-form__actions"><button type="button" className="community-button--secondary" aria-label={t("上移图片","Move image up")} title={t("上移图片","Move image up")} disabled={index===0} onClick={()=>move(index,-1)}>↑</button><button type="button" className="community-button--secondary" aria-label={t("下移图片","Move image down")} title={t("下移图片","Move image down")} disabled={index===images.length-1} onClick={()=>move(index,1)}>↓</button><button type="button" className="community-button--secondary" onClick={()=>save(images.filter((_,i)=>i!==index))}>{t("移除图片","Remove image")}</button></div>
  </fieldset>)}<button type="button" className="community-button--secondary" disabled={images.length>=20} onClick={()=>save([...images,{url:"",altZh:"",altEn:"",hero:images.length===0}])}>{t("选择图片","Select image")}</button></section>;
}
