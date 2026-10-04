export function serializeCatalogJson(value: unknown) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4,"0")}`);
}
export function safeCatalogExternalUrl(value: unknown): string | null {
  if(typeof value!=="string"||!value||value.length>2048||/[\u0000-\u0020\u007f\\]/.test(value)||!value.startsWith("https://"))return null;
  try {
    const url=new URL(value);
    if(url.protocol!=="https:"||url.username||url.password)return null;
    if(/%(?:00|0a|0d|2f|5c)/i.test(url.pathname)||/%(?:2e)/i.test(value)||/(?:^|\/)\.\.?(?:\/|$)/.test(value))return null;
    if([...url.searchParams.keys()].some(key=>/^(?:token|access_token|key|signature|x-amz-.+|x-goog-.+)$/i.test(key)))return null;
    return url.href;
  }catch{return null;}
}
export function safeCatalogMediaUrl(value: unknown,r2PublicBaseUrl?: string): string|null {
  if(typeof value!=="string")return null;
  if(/^\/(?:images|assets)\/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp|avif|gif|svg)$/i.test(value)&&!value.includes("..")&&!value.includes("//"))return value;
  const safe=safeCatalogExternalUrl(value);
  const base=safeCatalogExternalUrl(r2PublicBaseUrl);
  if(!safe||!base)return null;
  const url=new URL(safe),allowed=new URL(base);
  if(url.origin!==allowed.origin||!url.pathname.startsWith(allowed.pathname.replace(/\/$/,"")+"/")||url.search||url.hash||/\.(?:svg|html?)$/i.test(url.pathname))return null;
  return safe;
}
