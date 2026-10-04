export function responseSecurityHeaders(existing:Headers,path:string){
  const headers=new Headers(existing);
  headers.set("x-content-type-options","nosniff");headers.set("x-frame-options","DENY");
  const policy=(headers.get("content-security-policy")??"").split(";").map(item=>item.trim()).filter(item=>item&&!/^frame-ancestors(?:\s|$)/i.test(item));
  policy.push("frame-ancestors 'none'");headers.set("content-security-policy",policy.join("; "));
  if(/^\/(?:auth(?:\/|$)|reset-password(?:\/|$))/.test(path))headers.set("referrer-policy","no-referrer");
  else if(!headers.has("referrer-policy"))headers.set("referrer-policy","strict-origin-when-cross-origin");
  if(!headers.has("permissions-policy"))headers.set("permissions-policy","camera=(), microphone=(), geolocation=()");
  return headers;
}
