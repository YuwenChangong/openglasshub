import assert from "node:assert/strict";
import {build} from "esbuild";
const compiled=await build({entryPoints:["src/lib/product-public-safety.ts"],bundle:true,write:false,platform:"node",format:"esm",logLevel:"silent"});
const {serializeCatalogJson,safeCatalogExternalUrl,safeCatalogMediaUrl}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
for(const text of ['</script><script>alert(1)</script>','<img onerror="alert(1)">',"quotes'\"\u2028\u2029"]){const json=serializeCatalogJson({text});assert.ok(!/[<>&\u2028\u2029]/.test(json));assert.deepEqual(JSON.parse(json),{text});}
for(const value of ["javascript:alert(1)","data:text/html,x","blob:https://example.invalid/id","file:///tmp/x","vbscript:msgbox(1)","//example.invalid/x","https://user:pass@example.invalid/","https://example.invalid/?token=private","https://example.invalid/\npath","https://example.invalid/%2e%2e/private","https://example.invalid/a%2fb.png","https://example.invalid/a\\b.png"]){assert.equal(safeCatalogExternalUrl(value),null);assert.equal(safeCatalogMediaUrl(value,"https://media.example.invalid"),null);}
assert.equal(safeCatalogExternalUrl("https://example.invalid/product"),"https://example.invalid/product");
assert.equal(safeCatalogMediaUrl("/images/local-product.png"),"/images/local-product.png");
assert.equal(safeCatalogMediaUrl("https://media.example.invalid/catalog/image.png","https://media.example.invalid"),"https://media.example.invalid/catalog/image.png");
assert.equal(safeCatalogMediaUrl("https://unapproved.example.invalid/image.png","https://media.example.invalid"),null);
assert.equal(safeCatalogMediaUrl("https://media.example.invalid/catalog/active.svg","https://media.example.invalid"),null);
console.log("PRODUCT_PUBLIC_SAFETY=PASS");
