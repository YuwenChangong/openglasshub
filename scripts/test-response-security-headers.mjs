import assert from "node:assert/strict";
import {responseSecurityHeaders} from "../src/lib/response-security-headers.ts";
for(const status of [200,301,404,503]){
  const original=new Response("body",{status,headers:{"content-security-policy":"default-src 'self'; connect-src https://auth.example.invalid; frame-ancestors 'self'","cache-control":"private, no-store"}});
  const result=new Response(original.body,{status,headers:responseSecurityHeaders(original.headers,"/products/xreal/xreal-air/")});
  assert.equal(result.status,status);assert.equal(result.headers.get("x-frame-options"),"DENY");assert.equal(result.headers.get("x-content-type-options"),"nosniff");assert.ok(result.headers.get("content-security-policy").includes("frame-ancestors 'none'"));assert.ok(result.headers.get("content-security-policy").includes("connect-src https://auth.example.invalid"));assert.equal(result.headers.get("cache-control"),"private, no-store");
}
assert.equal(responseSecurityHeaders(new Headers(),"/auth/callback/").get("referrer-policy"),"no-referrer");assert.equal(responseSecurityHeaders(new Headers(),"/reset-password/").get("referrer-policy"),"no-referrer");
assert.equal(responseSecurityHeaders(new Headers({"referrer-policy":"no-referrer"}),"/login/").get("referrer-policy"),"no-referrer");
console.log("RESPONSE_SECURITY_HEADERS=PASS");
