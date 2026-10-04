export type QuickSearchItem={href:string;title:string;description:string;image:string|null};
export type QuickSearchGroup={key:"posts"|"circles"|"users"|"devices";items:QuickSearchItem[]};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const text=(value:unknown)=>typeof value==="string"?value:"";
function destination(value:unknown,kind:string){
  if(typeof value!=="string"||!(value.startsWith(`/${kind}/`)||kind==='u'&&value.startsWith('/users/'))||/[\s\\?#%]/.test(value)||value.includes(".."))return null;
  if(kind==='u')return /^\/(?:u\/[a-z0-9_-]{3,30}|users\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/$/.test(value)?value:null;
  const pattern=kind==="products"?/^\/products\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/:/^\/(?:posts|circles|u)\/[a-zA-Z0-9_-]+\/$/;
  return pattern.test(value)?value:null;
}
export function quickSearchGroups(value:unknown,circleScoped:boolean):QuickSearchGroup[]{
  if(!record(value)||!Array.isArray(value.posts))throw new Error("INVALID_QUICK_SEARCH_RESPONSE");
  const kinds=circleScoped?["posts"] as const:["posts","circles","users","devices"] as const;
  return kinds.map(key=>{if(!Array.isArray(value[key]))throw new Error("INVALID_QUICK_SEARCH_RESPONSE");
    const items=(value[key] as unknown[]).filter(record).slice(0,3).flatMap(row=>{
      const href=destination(key==="posts"?`/posts/${text(row.id)}/`:key==="circles"?`/circles/${text(row.slug)}/`:row.href,key==="devices"?"products":key==="users"?"u":key);
      const title=text(key==="posts"?row.title:key==="users"?row.display_name||row.username:row.name);
      return href&&title?[{href,title,description:text(row.excerpt??row.description??row.bio_excerpt??row.brand_name),image:key==="posts"?text(row.preview_image_url)||null:null}]:[];
    });return{key,items};}).filter(group=>group.items.length);
}
