import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFile,writeFile,unlink,mkdir,copyFile} from "node:fs/promises";
import path from "node:path";
import {chromium,firefox} from "playwright";
import {unstable_startWorker} from "wrangler";
import {assertLocalReplayTarget} from "../qa/local-disposable-supabase-replay.mjs";
import {randomUUID} from "node:crypto";
import {proveQuickSearchBrowser} from "./catalog-quick-search-browser.mjs";

export async function proveCatalogBrowser({root,directory,target,anonKey,environment,admin,a,deviceId,executeSql}){
  await mkdir(directory,{recursive:true});assertLocalReplayTarget(target);
  const config=path.join(directory,"local-worker-config.json");
  const result={status:"BLOCKED",stage:"LOCAL_BUILD",evidenceClass:"ACTUAL_LOCAL_WORKER_BROWSER_REAL_LOCAL_CATALOG_ADMIN_AUTH_SEEDED_FROM_GENUINE_LOCAL_SESSION",publicContexts:[],adminContexts:[],assertions:[],deniedWorkerExternal:0,deniedBrowserExternal:0,productionRequests:0,pageErrors:0,build:"NOT_RUN"};
  const check=(condition,name)=>{assert.ok(condition,name);result.assertions.push(name);};
  let worker,readyTimer;const browsers=[];
  const vars={SITE_ORIGIN:"https://127.0.0.1",SUPABASE_URL:target,PUBLIC_SUPABASE_URL:target,SUPABASE_ANON_KEY:anonKey,PUBLIC_SUPABASE_ANON_KEY:anonKey,AUTH_CAPTCHA_MODE:"off"};
  await writeFile(config,JSON.stringify({name:"openglasshub",compatibility_date:"2026-05-17",compatibility_flags:["nodejs_compat"],vars}));
  let outage=false;
  try{
    const built=spawnSync(process.execPath,["scripts/build-workers.mjs","--local-config",config],{cwd:root,env:{...environment,ASTRO_TELEMETRY_DISABLED:"1",ASTRO_DISABLE_UPDATE_CHECK:"true",WRANGLER_SEND_METRICS:"false",CLOUDFLARE_CF_FETCH_ENABLED:"false"},encoding:"utf8",windowsHide:true,maxBuffer:16777216,timeout:120000});
    check(built.status===0,"LOCAL_CONFIG_ACTUAL_WORKER_BUILD");result.build="PASS";
    const fixtureAssets=path.join(root,"dist/client/assets");
    await mkdir(fixtureAssets,{recursive:true});
    for(const name of ["catalog-owned.png","catalog-owned-2.png","catalog-owned-replaced.png"]){
      await copyFile(path.join(root,"public/brand/openglass-nav-logo.png"),path.join(fixtureAssets,name));
    }
    result.imageFixture="EXISTING_REPOSITORY_BITMAP_COPIED_ONLY_TO_OWNED_LOCAL_BUILD_ASSETS_NOT_PRODUCT_FACT";
    worker=await unstable_startWorker({config:path.join(root,"dist/server/wrangler.json"),envFiles:[],build:{bundle:false},
      bindings:{SUPABASE_URL:{type:"plain_text",value:target},SUPABASE_ANON_KEY:{type:"plain_text",value:anonKey},AUTH_CAPTCHA_MODE:{type:"plain_text",value:"off"}},
      dev:{remote:false,watch:false,liveReload:false,registry:undefined,persist:false,inspector:false,logLevel:"none",server:{hostname:"127.0.0.1",port:0,secure:false},
        async outboundService(request){
          const url=new URL(request.url);
          if(url.origin!==new URL(target).origin||!/^\/(?:rest|auth)\/v1\//.test(url.pathname)){result.deniedWorkerExternal++;return new Response("LOCAL_OUTBOUND_DENIED",{status:599});}
          if(outage&&url.pathname==="/rest/v1/public_device_detail_specs")return new Response('{"message":"LOCAL_OUTAGE_RAW_SENTINEL"}',{status:503,headers:{"content-type":"application/json"}});
          return fetch(url,{method:request.method,headers:request.headers,redirect:"error",signal:AbortSignal.timeout(10000),...(["GET","HEAD"].includes(request.method)?{}:{body:await request.arrayBuffer()})});
        }} });
    await Promise.race([Promise.all([worker.ready,new Promise((resolve,reject)=>{worker.raw.once("reloadComplete",resolve);worker.raw.once("error",()=>reject(new Error("LOCAL_WORKER_STARTUP_ERROR")));worker.raw.once("runtimeError",()=>reject(new Error("LOCAL_WORKER_RUNTIME_ERROR")));})]),new Promise((_,reject)=>{readyTimer=setTimeout(()=>reject(new Error("LOCAL_WORKER_READY_TIMEOUT")),30000);})]);clearTimeout(readyTimer);
    const origin=(await worker.url).origin;check(new URL(origin).hostname==="127.0.0.1","OWNED_LOOPBACK_WORKER");
    const preference=locale=>encodeURIComponent(JSON.stringify({version:1,preference:locale,generation:1,provenance:"device_explicit"}));
    const contextFor=async(browser,width,locale,session)=>{
      const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:"block"});
      await context.addCookies([{name:"ogh_preferences_v1",value:preference(locale),url:origin,sameSite:"Lax"}]);
      if(session)await context.addInitScript(({key,session})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(session));},{key:`sb-${new URL(target).hostname.split(".")[0]}-auth-token`,session});
      await context.route("**/*",route=>{const url=new URL(route.request().url());if([origin,new URL(target).origin].includes(url.origin))return route.continue();result.deniedBrowserExternal++;return route.abort("blockedbyclient");});
      return context;
    };
    const layout=async page=>{check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"NO_HORIZONTAL_PAGE_OVERFLOW");};
    const headers=response=>{const h=response.headers();check(h["x-content-type-options"]==="nosniff"&&h["x-frame-options"]==="DENY"&&h["content-security-policy"]?.includes("frame-ancestors 'none'")&&h["referrer-policy"]==="strict-origin-when-cross-origin"&&Boolean(h["permissions-policy"]),`RESPONSE_OWNED_HEADERS_${response.status()}`);};
    const engines={chromium:await chromium.launch({headless:true}),firefox:await firefox.launch({headless:true})};browsers.push(...Object.values(engines));
    const sqlQuote=value=>`'${String(value).replaceAll("'","''")}'`;
    const hostile='LOCAL </script><img id="catalog-injected" src=x onerror="window.catalogExecuted=true"> " \u2028\u2029';
    const hostileId=randomUUID();
    await executeSql(`INSERT INTO public.devices(id,slug,brand_key,brand_name,name,short_description,long_description,image_alt,category,route_label,route_description,publication_status,official_product_url,media) VALUES ('${hostileId}','local-hostile-catalog','xreal','XREAL',${sqlQuote(hostile)},${sqlQuote(hostile)},${sqlQuote(hostile)},'Owned broken image','smart_glasses','Local','Local','published','javascript:alert(1)','{"images":[{"url":"/assets/local-missing.png","altZh":"本地图片","altEn":"Owned image","hero":true}]}'::jsonb);`);
    result.publicMatrixSkippedForFocusedAdminDiagnosis=process.argv.includes("--admin-only");
    result.quickSearchOnlyDiagnosis=process.argv.includes("--quick-search-only");
    for(const fixture of result.publicMatrixSkippedForFocusedAdminDiagnosis?[]:result.quickSearchOnlyDiagnosis?[{engine:"chromium",width:1280,locale:"en"}]:[{engine:"chromium",width:1280,locale:"zh-CN"},{engine:"chromium",width:1280,locale:"en"},{engine:"chromium",width:430,locale:"zh-CN"},{engine:"chromium",width:430,locale:"en"},{engine:"chromium",width:390,locale:"zh-CN"},{engine:"chromium",width:390,locale:"en"},{engine:"firefox",width:1280,locale:"en"}]){
      result.stage=`PUBLIC_${fixture.engine}_${fixture.width}_${fixture.locale}`;
      const context=await contextFor(engines[fixture.engine],fixture.width,fixture.locale),page=await context.newPage();page.setDefaultTimeout(10000);page.on("pageerror",()=>result.pageErrors++);
      try{
        const index=await page.goto(`${origin}/products/`,{waitUntil:"load"});result.indexHttpStatus=index.status();check(index.status()===200,"PRODUCT_INDEX_200");headers(index);await layout(page);
        await page.locator('a[href="/products/xreal/"]').first().click();await page.waitForURL("**/products/xreal/");
        const card=page.locator('[data-product-card][data-product-slug="xreal-air"]');check(await card.getAttribute("id")==="product-xreal-air","BRAND_ANCHOR_PRESERVED");
        await card.locator('.brand-product-card__links a[href="/products/xreal/xreal-air/"]').click();await page.waitForURL("**/products/xreal/xreal-air/");
        check(await page.locator('[data-product-detail] h1').textContent()==="XREAL Air","CANONICAL_IDENTITY");
        const labels=await page.locator('[data-parameter-key] dt').allTextContents();check(labels.includes(fixture.locale==="zh-CN"?"重量":"Weight"),"LOCALIZED_SPEC_LABEL");check(labels.every(label=>!/_|^[a-z]+\./.test(label)),"NO_RAW_PARAMETER_LABELS");
        check(await page.locator('[data-parameter-key="basic.weight_g"] dd').textContent()==="79 g","AUTHORITATIVE_UNIT_FORMAT");check(await page.locator('[data-spec-preview]').count()===1,"KEY_SPEC_SUMMARY");check(await page.locator('[data-product-sources] a').count()>0,"EXISTING_SOURCE_ACTIONS");await layout(page);
        await page.screenshot({path:path.join(directory,`${fixture.engine}-${fixture.width}-${fixture.locale}-detail.png`),fullPage:true});
        await page.screenshot({path:path.join(directory,`${fixture.engine}-${fixture.width}-${fixture.locale}-detail-viewport.png`)});
        if(fixture.width<860){const toggle=page.locator('.og-header__menu-toggle');check(await toggle.isVisible(),"MOBILE_MENU_REACHABLE");check((await toggle.boundingBox()).height>=44,"MOBILE_TOUCH_TARGET");await toggle.click();check(await toggle.getAttribute("aria-expanded")==="true","MENU_OPEN");await page.locator('.og-header__nav a').first().focus();await page.keyboard.press("Escape");check(await toggle.getAttribute("aria-expanded")==="false"&&await toggle.evaluate(node=>node===document.activeElement),"ESCAPE_MENU_FOCUS_RESTORE");}
        await page.locator('[data-detail-compare]').click();await page.waitForURL("**/products/xreal/**");
        const selection=new URLSearchParams([...["xreal-air","xreal-air-2","xreal-air-2-pro","xreal-one"].map(slug=>["compare",slug])]);
        await page.goto(`${origin}/products/xreal/?${selection}`,{waitUntil:"load"});check(await page.locator('#brand-compare-table-head a').count()===3,"COMPARE_MAX3_CANONICAL_LINKS");
        await layout(page);const wrap=page.locator('#brand-compare-table-wrap');check(await wrap.getAttribute("tabindex")==="0","COMPARE_SCROLL_REGION_KEYBOARD");await page.locator('#brand-compare-selected button').first().click();check(await page.locator('#brand-compare-table-head a').count()===2,"COMPARE_REMOVE");await page.locator('[data-product-slug="xreal-air"] [data-compare-button]').first().click();check(await page.locator('#brand-compare-table-head a').count()===3,"COMPARE_ADD");
        const wrong=await context.request.get(`${origin}/products/rayneo/xreal-air/`,{maxRedirects:0});check(wrong.status()===301&&wrong.headers().location==="/products/xreal/xreal-air/","WRONG_BRAND_301");headers(wrong);
        const missing=await context.request.get(`${origin}/products/xreal/local-missing/`);check(missing.status()===404,"UNKNOWN_404");headers(missing);
        outage=true;const unavailable=await context.request.get(`${origin}/products/xreal/xreal-air/`);outage=false;check(unavailable.status()===503,"OUTAGE_503");headers(unavailable);check(!(await unavailable.text()).includes("LOCAL_OUTAGE_RAW_SENTINEL"),"RAW_ERROR_DENIED");
        const search=await context.request.get(`${origin}/api/forum/search?q=xreal&type=devices`);const data=await search.json();check(search.status()===200&&data.results.devices.some(device=>device.href==="/products/xreal/xreal-air/"),"REAL_API_DEVICE_CANONICAL_LINK");
        if(fixture.engine==="chromium"&&fixture.width===1280&&fixture.locale==="en"){
          result.stage="PUBLIC_QUICK_SEARCH_INTERACTION";
          const searchPage=await page.goto(`${origin}/search/`,{waitUntil:"load"});
          check(searchPage.status()===200,"QUICK_SEARCH_OWNER_PAGE_200");
          result.quickSearchDiagnostic={};
          result.assertions.push(...await proveQuickSearchBrowser(page,result.quickSearchDiagnostic));
          result.stage="PUBLIC_HOSTILE_PAYLOAD";
          await page.goto(`${origin}/products/xreal/local-hostile-catalog/`,{waitUntil:"load"});
          check(await page.locator('[data-product-detail] h1').textContent()===hostile,"HOSTILE_CATALOG_LITERAL_SSR_TEXT");
          check(await page.locator('#catalog-injected').count()===0&&await page.evaluate(()=>window.catalogExecuted!==true),"HOSTILE_CATALOG_NO_DOM_OR_SCRIPT_EXECUTION");
          check(await page.locator('[data-product-detail] a[href^="javascript:"]').count()===0,"UNSAFE_OFFICIAL_URL_NOT_ACTIVE");
          await page.locator('[data-image-fallback]').waitFor({state:"visible"});check(true,"OWNED_BROKEN_IMAGE_FALLBACK");await layout(page);
          check(await page.locator('[data-parameter-provenance="ABSENT"]').count()===1,"METADATA_ONLY_EMPTY_GROUP_HONEST_STATE");
          await page.goto(`${origin}/products/xreal/?compare=local-hostile-catalog&compare=xreal-air`,{waitUntil:"load"});
          check((await page.locator('#brand-compare-table-head').textContent()).includes(hostile),"COMPARE_HOSTILE_LITERAL_TEXT");
          check(await page.locator('#catalog-injected').count()===0&&await page.evaluate(()=>window.catalogExecuted!==true),"COMPARE_JSON_NO_SCRIPT_BREAKOUT");
        }
        result.publicContexts.push({...fixture,status:"PASS"});
      }finally{outage=false;await context.close();}
    }
    for(const width of result.quickSearchOnlyDiagnosis?[]:[1280,390]){
      result.stage=`ADMIN_${width}`;
      const context=await contextFor(engines.chromium,width,"en",admin.session),page=await context.newPage();page.setDefaultTimeout(15000);page.on("pageerror",()=>result.pageErrors++);
      page.on("response",response=>{if(/^\/api\/admin\/device-specs\/?$/.test(new URL(response.url()).pathname)){(result.adminSpecResponses??=[]).push({method:response.request().method(),status:response.status()});}});
      try{
        await page.goto(`${origin}/admin/devices/`,{waitUntil:"load"});await page.locator('.admin-news-card').filter({hasText:"XREAL Air"}).filter({hasNotText:"Air 2"}).first().click();
        const editor=page.locator('[data-catalog-spec-editor]');await editor.locator('[data-catalog-spec-id]').first().waitFor();check(true,"REAL_ADMIN_DEVICE_EDITOR_REACHABLE");
        const valueField=editor.locator('label').filter({has:page.locator('span').filter({hasText:/^Value$/})}).locator('textarea');
        result.stage=`ADMIN_${width}_ADD_DRAFT`;
        result.adminEditorLanguage=await editor.locator('.catalog-spec-editor__toolbar h3').textContent();
        await page.screenshot({path:path.join(directory,`admin-${width}-before-edit.png`)});
        result.addButtonState=await editor.getByRole("button",{name:"Add specification",exact:true}).evaluate(node=>({disabled:node.disabled,rect:node.getBoundingClientRect().toJSON(),visibility:getComputedStyle(node).visibility}));
        await editor.getByRole("button",{name:"Add specification",exact:true}).click();
        await editor.getByLabel("Stable parameter key",{exact:true}).fill(`custom.browser_${width}`);
        await editor.getByLabel("Fact type").selectOption("number");
        await editor.getByLabel("Chinese label",{exact:true}).fill("浏览器验收参数");await editor.getByLabel("English label",{exact:true}).fill(`Browser specification ${width}`);
        await editor.getByLabel("Chinese group title",{exact:true}).fill("浏览器验收分组");await editor.getByLabel("English group title",{exact:true}).fill("Browser acceptance group");
        await valueField.fill("12");await editor.getByLabel("Display format").selectOption("number");await editor.getByLabel("Display unit").selectOption("g");
        await editor.getByLabel("Specification order",{exact:true}).fill("1");await editor.getByLabel("Group order",{exact:true}).fill("1");await editor.getByLabel("Include in Key Specs").check();
        result.stage=`ADMIN_${width}_SAVE_NEW_SPEC`;
        const saved=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/admin/device-specs"&&response.request().method()==="POST");await editor.getByRole("button",{name:"Save specification",exact:true}).click();check((await saved).status()===201,"ADMIN_PARAMETER_ADD_REAL_HTTP");
        result.stage=`ADMIN_${width}_WAIT_SAVED_ROW`;
        await editor.getByRole("button",{name:`Browser specification ${width}`,exact:true}).waitFor();
        const publicPage=await context.newPage();await publicPage.goto(`${origin}/products/xreal/xreal-air/`,{waitUntil:"load"});check(await publicPage.locator(`[data-parameter-key="custom.browser_${width}"] dd`).textContent()==="12 g","ADMIN_EDIT_PUBLIC_SAME_CANONICAL_ROW");await publicPage.close();
        await editor.getByRole("button",{name:`Browser specification ${width}`,exact:true}).click();
        check(await editor.getByLabel("Stable parameter key",{exact:true}).evaluate(node=>node.readOnly),"SAVED_PARAMETER_SELECTED_IDENTITY_READONLY");
        await valueField.fill("13");await editor.getByLabel("Display unit").selectOption("kg");await editor.getByLabel("Decimal places",{exact:true}).fill("3");
        result.stage=`ADMIN_${width}_EDIT_SPEC`;
        const edited=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/admin/device-specs"&&response.request().method()==="PATCH");await editor.getByRole("button",{name:"Save specification",exact:true}).click();check((await edited).status()===200,"ADMIN_CONTROLLED_UNIT_EDIT_REAL_HTTP");
        await editor.getByRole("button",{name:"Save specification",exact:true}).waitFor({state:"visible"});
        const editedPublic=await context.newPage();await editedPublic.goto(`${origin}/products/xreal/xreal-air/`,{waitUntil:"load"});check(await editedPublic.locator(`[data-parameter-key="custom.browser_${width}"] dd`).textContent()==="0.013 kg","UNIT_EDIT_ACTUAL_PUBLIC_READBACK");await editedPublic.close();
        await editor.getByRole("button",{name:`Browser specification ${width}`,exact:true}).click();
        await editor.getByLabel("English label",{exact:true}).fill(`Edited specification ${width}`);await editor.getByLabel("Chinese label",{exact:true}).fill("已编辑验收参数");
        await editor.getByLabel("Specification order",{exact:true}).fill("0");await editor.getByLabel("Key Spec order",{exact:true}).fill("0");await editor.getByLabel("Include in Key Specs").check();
        const labeled=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/admin/device-specs"&&response.request().method()==="PATCH");await editor.getByRole("button",{name:"Save specification",exact:true}).click();check((await labeled).status()===200,"ADMIN_BILINGUAL_LABEL_REORDER_KEY_SPEC_SAVE");
        await editor.getByRole("button",{name:`Edited specification ${width}`,exact:true}).click();
        const group=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/admin/device-specs"&&response.request().method()==="PATCH");await editor.getByRole("button",{name:"Save group labels and order",exact:true}).click();check((await group).status()===200,"ADMIN_GROUP_EDITOR_REAL_HTTP");
        const removed=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/admin/device-specs"&&response.request().method()==="PATCH");await editor.getByRole("button",{name:"Deactivate specification",exact:true}).click();check((await removed).status()===200,"ADMIN_PARAMETER_DEACTIVATE_REAL_HTTP");
        await editor.getByRole("button",{name:"Add specification",exact:true}).click();await editor.getByRole("button",{name:"Save specification",exact:true}).click();await editor.locator('[role="alert"]').waitFor();check(true,"ADMIN_VALIDATION_MESSAGE_VISIBLE");
        const media=page.locator('[data-catalog-media-editor]');await media.getByRole("button",{name:"Select image",exact:true}).click();
        await media.getByLabel("Approved image URL").last().fill("/assets/catalog-owned.png");await media.getByLabel("Chinese alt text").last().fill("本地验收图片");await media.getByLabel("English alt text").last().fill("Owned acceptance image");
        await media.getByRole("button",{name:"Select image",exact:true}).click();await media.getByLabel("Approved image URL").last().fill("/assets/catalog-owned-2.png");await media.getByLabel("Chinese alt text").last().fill("第二张验收图片");await media.getByLabel("English alt text").last().fill("Second owned image");
        await media.getByRole("button",{name:"Move image up",exact:true}).last().click();await media.getByLabel("Hero image").first().check();
        const imageSaved=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/admin/devices"&&response.request().method()==="PATCH");await page.getByRole("button",{name:"Save changes",exact:true}).click();check((await imageSaved).status()===200,"ADMIN_IMAGE_ADD_ORDER_ALT_HERO_REAL_HTTP");
        await media.getByLabel("Approved image URL").first().fill("/assets/catalog-owned-replaced.png");await media.getByRole("button",{name:"Remove image",exact:true}).last().click();
        const imageReplaced=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/admin/devices"&&response.request().method()==="PATCH");await page.getByRole("button",{name:"Save changes",exact:true}).click();check((await imageReplaced).status()===200,"ADMIN_IMAGE_REPLACE_REMOVE_REAL_HTTP");
        const imagePublic=await context.newPage();await imagePublic.goto(`${origin}/products/xreal/xreal-air/`,{waitUntil:"load"});check(await imagePublic.locator('[data-catalog-image]').first().getAttribute('src')==='/assets/catalog-owned-replaced.png',"ADMIN_IMAGE_PUBLIC_SAME_CANONICAL_STATE");
        const renderedImage=imagePublic.locator('[data-catalog-image]').first();
        check(await renderedImage.evaluate(node=>node.complete&&node.naturalWidth>0&&node.naturalHeight>0&&!node.hidden),"ADMIN_SELECTED_LOCAL_BITMAP_ACTUALLY_RENDERED");
        check(await renderedImage.getAttribute('alt')==='Second owned image',"ADMIN_BILINGUAL_ALT_PUBLIC_READBACK");await imagePublic.close();
        const checkboxRect=await editor.getByLabel('Public display').boundingBox();check(checkboxRect.width<=24&&checkboxRect.height<=24,'ADMIN_BINARY_CONTROL_NOT_TEXT_INPUT_SIZED');
        await layout(page);await page.screenshot({path:path.join(directory,`admin-${width}.png`),fullPage:true});
        result.adminContexts.push({width,status:"PASS"});
      }catch(error){await page.screenshot({path:path.join(directory,`admin-${width}-failed.png`)});result.adminActionDiagnostic=String(error.message).split("\n").filter(line=>/Timeout|locator|element is|intercepts pointer|scrolling|stable|visible|enabled/.test(line)).slice(0,12);throw error;}finally{await context.close();}
    }
    result.stage='ADMIN_NEW_TYPED_DEVICE';
    for(const schemaType of ['display_ar','ai_hud']){
      const ownedSlug=`local-browser-${schemaType.replace('_','-')}`;
      const created=await fetch(`${origin}/api/admin/devices`,{method:'POST',headers:{authorization:`Bearer ${admin.token}`,'content-type':'application/json'},body:JSON.stringify({slug:ownedSlug,brandKey:'xreal',brandName:'XREAL',name:'Owned new draft',shortDescription:'Local only',longDescription:'Local only',imageAlt:'Owned fixture',category:'smart_glasses',routeLabel:'Local',routeDescription:'Local',schemaType})});
      check(created.status===201,'ADMIN_NEW_TYPED_DEVICE_REAL_HTTP');const newDevice=(await created.json()).device;
      const specification=await fetch(`${origin}/api/admin/device-specs`,{method:'POST',headers:{authorization:`Bearer ${admin.token}`,'content-type':'application/json'},body:JSON.stringify({deviceId:newDevice.id,input:{key:'custom.new_device',valueType:'text',state:'KNOWN',valueText:'Owned local fact',presentation:{labelZh:'本地参数',labelEn:'Owned parameter'}}})});
      check(specification.status===201,'ADMIN_NEW_DEVICE_SPEC_REAL_HTTP');
    }
    const denied=await fetch(`${origin}/api/admin/device-specs?deviceId=${deviceId}`,{headers:{authorization:`Bearer ${a.token}`}});check(denied.status===403,"ACTUAL_API_ORDINARY_ACTOR_DENIED");
    const anon=await fetch(`${origin}/api/admin/device-specs?deviceId=${deviceId}`);check(anon.status===401,"ACTUAL_API_ANONYMOUS_DENIED");
    check(result.deniedWorkerExternal===0&&result.deniedBrowserExternal===0,"ZERO_EXTERNAL_ACTIVITY");check(result.pageErrors===0,"NO_BROWSER_PAGE_ERRORS");
    result.status="PASS";return result;
  }catch(error){result.firstFailure=error instanceof assert.AssertionError?error.message:error.name;throw error;}
  finally{clearTimeout(readyTimer);for(const browser of browsers)await browser.close();await worker?.dispose();await unlink(config).catch(error=>{if(error.code!=="ENOENT")throw error;});await writeFile(path.join(directory,"receipt.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx"});}
}
