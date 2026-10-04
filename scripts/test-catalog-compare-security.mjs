import assert from "node:assert/strict";
import {JSDOM} from "jsdom";
const {renderCatalogCompareTable}=await import("../src/lib/catalog-compare-dom.ts");
const dom=new JSDOM('<table><thead></thead><tbody></tbody></table>');
const document=dom.window.document,payload='</script><img src=x onerror="window.injected=true">\u2028\u2029';
renderCatalogCompareTable({head:document.querySelector("thead"),body:document.querySelector("tbody"),products:[{name:payload,brandLabel:payload,detailHref:"javascript:alert(1)",compareValues:{weight:payload}},{name:"Safe",brandLabel:"XREAL",detailHref:"/products/xreal/xreal-air/",compareValues:{weight:"79 g"}}],fields:[{key:"weight",label:payload}],itemLabel:payload,prefix:"brand"});
assert.equal(document.querySelectorAll("img,script").length,0);assert.equal(document.querySelectorAll("a").length,1);assert.ok(document.querySelector("tbody").textContent.includes(payload));assert.equal(document.querySelector("a").getAttribute("href"),"/products/xreal/xreal-air/");
console.log("CATALOG_COMPARE_SECURITY=PASS");
