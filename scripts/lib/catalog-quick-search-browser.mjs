import assert from "node:assert/strict";

export async function proveQuickSearchBrowser(page,diagnostic={}){
  const checks=[];
  const check=(value,name)=>{assert.ok(value,name);checks.push(name);};
  const root=page.locator('.og-header__search .global-search-box');
  const input=root.locator('input[type="search"]');
  const results={posts:[{id:"local-post",title:"Owned post"}],circles:[{slug:"local-circle",name:"Owned circle"}],users:[{href:"/u/local-user/",display_name:"Owned user"}],devices:[{href:"/products/xreal/xreal-air/",name:"XREAL Air"}]};
  let mode="success",release;
  const route=async intercepted=>{
    const request=new URL(intercepted.request().url());
    check(request.searchParams.get('type')==='all','GLOBAL_QUICK_SEARCH_ALL_GROUPS_REQUEST');
    if(mode==='loading')await new Promise(resolve=>{release=resolve;});
    if(mode==='error')return intercepted.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false})});
    const payload=mode==='empty'?{posts:[],circles:[],users:[],devices:[]}:results;
    await intercepted.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,results:payload})});
  };
  await page.route('**/api/forum/search?**',route);
  try{
    diagnostic.stage='RESULTS';
    await input.fill('owned');await root.locator('[data-quick-group="devices"] a').waitFor();
    check(await root.locator('[data-quick-group]').count()===4,'GLOBAL_QUICK_SEARCH_ALL_GROUPS_UI');
    check(await root.locator('[data-quick-group="devices"] a').getAttribute('href')==='/products/xreal/xreal-air/','QUICK_DEVICE_CANONICAL_HREF');
    diagnostic.stage='ESCAPE';
    await root.locator('[data-quick-group="devices"] a').focus();await page.keyboard.press('Escape');
    check(await root.locator('.global-search-box__dropdown').count()===0&&await input.evaluate(node=>node===document.activeElement),'QUICK_SEARCH_ESCAPE_FOCUS_RESTORATION');
    diagnostic.stage='EMPTY';
    mode='empty';await input.fill('empty');await root.locator('.global-search-box__empty').waitFor();
    await page.waitForFunction(()=>!document.querySelector('.og-header__search [role="status"]'));
    check(await root.locator('[role="alert"]').count()===0&&await root.locator('[data-quick-group]').count()===0,'QUICK_SEARCH_HONEST_EMPTY');
    diagnostic.stage='ERROR';
    mode='error';await input.fill('failed');await root.locator('[role="alert"]').waitFor();check(true,'QUICK_SEARCH_ERROR_NOT_EMPTY');
    diagnostic.stage='LOADING';
    mode='loading';await input.fill('pending');await root.locator('[role="status"]').waitFor();check(true,'QUICK_SEARCH_LOADING');
    diagnostic.stage='STALE';
    await input.fill('x');mode='success';release?.();
    await page.waitForFunction(()=>document.querySelector('.og-header__search input')?.getAttribute('aria-expanded')==='false');
    check(await root.locator('[data-quick-group]').count()===0,'QUICK_SEARCH_STALE_RESPONSE_ABORTED');
  }catch(error){diagnostic.completedChecks=checks;diagnostic.inputVisible=await input.isVisible();diagnostic.expanded=await input.getAttribute('aria-expanded');diagnostic.errorName=error.name;throw error;}
  finally{release?.();await page.unroute('**/api/forum/search?**',route);await input.fill('');}
  return checks;
}
