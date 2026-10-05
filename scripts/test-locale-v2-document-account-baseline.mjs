import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { JSDOM } from 'jsdom';
import ts from 'typescript';

const base='630a40ceef3d93b5f2718370d29e8a8ca92ce873';
const frozen=execFileSync('git',['show',`${base}:scripts/test-global-locale-v2-acceptance-local.mjs`],{encoding:'utf8',windowsHide:true});
const current=readFileSync(new URL('./test-global-locale-v2-acceptance-local.mjs',import.meta.url),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
function bindPreparation(source) {
  const ast=ts.createSourceFile('runner.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  let block;
  const visit=node=>{
    if(ts.isBlock(node)&&node.statements.some(s=>s.getText(ast)==='receipt.adminIndependentLocaleState=false;'))block=node;
    ts.forEachChild(node,visit);
  };visit(ast);assert.ok(block,'ACTUAL_DOCUMENT_PREPARATION_BLOCK');
  const statements=[...block.statements],start=statements.findIndex(s=>s.getText(ast)==='receipt.adminIndependentLocaleState=false;');
  const end=statements.findIndex((s,i)=>i>start&&ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(ast)==='factory'));
  assert.ok(end>start);
  return new AsyncFunction('receipt','page','context','accounts','authKey','navigate','fixture','adopt','setCookie',
    statements.slice(start,end).map(s=>s.getText(ast)).join('\n'));
}

// The fixture models the proven local Auth contract: logout revokes a session;
// reseeding its storage bytes cannot make /user authenticate it again.
async function lifecycle(run) {
  const old='fixture-revoked-b',fresh='fixture-fresh-b',calls=[];
  let bSessionRevoked=false;
  const server=createServer((req,res)=>{
    calls.push(req.url);
    if(req.url==='/auth/v1/logout'){bSessionRevoked=true;res.writeHead(204);res.end();return;}
    if(req.url==='/auth/v1/token?grant_type=password'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({access_token:fresh}));return;}
    if(req.url==='/auth/v1/user'){
      const valid=req.headers.authorization===`Bearer ${fresh}`||(!bSessionRevoked&&req.headers.authorization===`Bearer ${old}`);
      res.writeHead(valid?200:403,{'content-type':'application/json'});res.end(JSON.stringify(valid?{role:'ACTOR_B'}:{code:'session_not_found'}));return;
    }
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,dom=new JSDOM('',{url:origin,runScripts:'outside-only'});
  const context={preference:'en'},accounts={b:{session:{access_token:old}}},events=[];
  const page={evaluate:async(fn,arg)=>dom.window.eval(`(${fn.toString()})`)(arg),locator:()=>({waitFor:async()=>{events.push('SETTINGS_LINK');}})};
  const authKey='sb-127-auth-token';
  const navigate=async(_page,route,locale)=>{assert.equal(route,'/settings/');assert.equal(context.preference,locale);events.push('SETTINGS_SETTLED');};
  const identity=async()=>{
    const session=JSON.parse(dom.window.localStorage.getItem(authKey));
    const response=await fetch(origin+'/auth/v1/user',{headers:{authorization:`Bearer ${session.access_token}`}});
    return response.status===200&&(await response.json()).role==='ACTOR_B';
  };
  const adopt=async(_page,_context,actor)=>{
    assert.equal(actor,accounts.b);events.push('FRESH_LOGIN');
    const response=await fetch(origin+'/auth/v1/token?grant_type=password',{method:'POST'});actor.session=await response.json();
    dom.window.localStorage.clear();dom.window.localStorage.setItem(authKey,JSON.stringify(actor.session));
    assert.equal(await identity(),true);events.push('GENUINE_B_VERIFIED');context.preference='en';events.push('B_ADOPTION_SETTLED');
  };
  const setCookie=async(_context,locale)=>{context.preference=locale;events.push('SHELL_LOCALE_RESTORED');};
  try{
    await fetch(origin+'/auth/v1/logout',{method:'POST'});calls.length=0;
    await run({page,context,accounts,authKey,navigate,adopt,setCookie,identity,events,calls});
  }finally{dom.window.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

if(process.argv.includes('--old-red')){
  test('actual old document preparation reuses the revoked B session and fails identity',async()=>{
    await lifecycle(async f=>{await bindPreparation(frozen)({},f.page,f.context,f.accounts,f.authKey,f.navigate,{locale:'en'},f.adopt,f.setCookie);assert.ok(await f.identity(),'DOCUMENT_ACCOUNT_IDENTITY');});
  });
}else{
  test('frozen lifecycle RED proves revoked snapshot is not renewed by storage reseeding',async()=>{
    await lifecycle(async f=>{await bindPreparation(frozen)({},f.page,f.context,f.accounts,f.authKey,f.navigate,{locale:'en'},f.adopt,f.setCookie);assert.equal(await f.identity(),false);assert.deepEqual(f.calls,['/auth/v1/user']);});
  });
  for(const locale of ['zh-CN','en'])test(`actual document preparation freshly adopts B before ${locale} shell baseline`,async()=>{
    await lifecycle(async f=>{
      await bindPreparation(current)({},f.page,f.context,f.accounts,f.authKey,f.navigate,{locale},f.adopt,f.setCookie);
      assert.ok(await f.identity(),'DOCUMENT_ACCOUNT_IDENTITY');
      assert.deepEqual(f.events,['FRESH_LOGIN','GENUINE_B_VERIFIED','B_ADOPTION_SETTLED','SHELL_LOCALE_RESTORED','SETTINGS_SETTLED','SETTINGS_LINK']);
      assert.equal(f.context.preference,locale);
      assert.equal(f.calls[0],'/auth/v1/token?grant_type=password');
    });
  });
}
