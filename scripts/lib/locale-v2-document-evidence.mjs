import assert from 'node:assert/strict';

export const LOCAL_DOCUMENT_HEADER = 'x-ogh-local-document-id';
const UNKNOWN = 'UNKNOWN';
const stamp = () => new Date().toISOString();
const idPattern = /^document-[1-9][0-9]*$/;
const errorClasses = new Set(['Error','TypeError','RangeError','ReferenceError','SyntaxError','AggregateError','AbortError','DOMException','AssertionError']);
const messages = ['Network connection lost.','fetch failed','Internal Server Error','This operation was aborted','The operation was aborted','UNAVAILABLE'];
const safeMessage = value => messages.find(message => String(value ?? '').includes(message)) ?? (/Cannot read properties of (?:undefined|null)/.test(String(value ?? '')) ? 'Cannot read properties of undefined or null.' : '[REDACTED_UNCLASSIFIED]');
const safePath = value => {
  try {
    const decoded=decodeURIComponent(value);
    if(/[?&#=:@]/.test(decoded))return '/[REDACTED]';
    return decoded.replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi,'[REDACTED]').replace(/eyJ[\w.-]+|sb_(?:secret|publishable)_[\w-]+|[A-Za-z0-9_-]{48,}/g,'[REDACTED]').slice(0,256);
  } catch { return '/[REDACTED]'; }
};
function safeFrames(stack, projectRoot) {
  const prefix = String(projectRoot).replaceAll('\\','/').replace(/\/$/,'') + '/';
  const frames = String(stack ?? '').split('\n').filter(line => /^\s*at /.test(line)).map(line => {
    const match = line.replaceAll('\\','/').match(/((?:[A-Za-z]:\/|\/)[^()\s]+):(\d+):(\d+)\)?$/);
    if (!match) return null;
    const file = match[1];
    const relative = file.startsWith(prefix) ? file.slice(prefix.length) : file.includes('/node_modules/') ? 'node_modules/' + file.split('/node_modules/').at(-1) : null;
    if (!relative || !/^(?:src|scripts|node_modules)\//.test(relative) || !/^[A-Za-z0-9_./-]+$/.test(relative) || relative.split('/').some(part => part.length>47) || /(?:eyJ|sb_(?:secret|publishable)_|service[_-]?role|access[_-]?token|refresh[_-]?token|[0-9a-f]{8}-[0-9a-f-]{27}|\.\.)/i.test(relative)) return null;
    return `${relative}:${match[2]}:${match[3]}`;
  }).filter(Boolean).slice(0,8);
  return { safeStackProjection: frames, earliestProjectStackFrame: frames.find(f=>/^(src|scripts)\//.test(f)) ?? UNKNOWN, earliestDependencyStackFrame: frames.find(f=>f.startsWith('node_modules/')) ?? UNKNOWN };
}
function safeError(error, root) {
  return { errorClass:errorClasses.has(error?.name)?error.name:UNKNOWN, safeMessage:safeMessage(error?.message), ...safeFrames(error?.stack,root) };
}
function safeState(headers, country) {
  const cookie = String(headers.cookie ?? ''), raw = cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('ogh_preferences_v1='));
  let locale = UNKNOWN;
  if (raw && raw.length <= 1024) {
    try {
      const value=JSON.parse(decodeURIComponent(raw.slice(raw.indexOf('=')+1)));
      if(value.version===1 && ['auto','en','zh-CN'].includes(value.preference) && ['device_explicit','account_adopted'].includes(value.provenance) && Number.isSafeInteger(value.generation) && value.generation>=0) locale={version:1,preference:value.preference,provenance:value.provenance,generation:value.generation};
    } catch { /* Never retain an unparsed cookie. */ }
  }
  const language=String(headers['accept-language']??'');
  return { AUTH_COOKIE_PRESENT:/(?:^|;\s*)(?:sb-[^=;]*(?:auth-token|session)|supabase[^=;]*(?:auth|session))=/i.test(cookie), LOCALE_COOKIE_PRESENT:!!raw,
    LOCALE_COOKIE_SAFE_VALUE:locale, ACCEPT_LANGUAGE:language.length<=128 && /^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|\*)(?:;q=0(?:\.\d{1,3})?|;q=1(?:\.0{1,3})?)?(?:,\s*(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|\*)(?:;q=0(?:\.\d{1,3})?|;q=1(?:\.0{1,3})?)?)*$/.test(language)?language:UNKNOWN,
    LOCAL_COUNTRY:/^[A-Z]{2}$/.test(country??'')?country:UNKNOWN };
}
function safeBody(buffer, projectRoot) {
  const text=buffer.toString('utf8');
  const classification=/Network connection lost\./.test(text)?'NETWORK_CONNECTION_LOST':/\b(?:TypeError|ReferenceError|RangeError|SyntaxError):/.test(text)?'APPLICATION_ERROR_LIKE':/Internal Server Error/.test(text)?'INTERNAL_SERVER_ERROR':'REDACTED_UNCLASSIFIED';
  let structured;
  try { structured=JSON.parse(text); } catch { /* A bounded text/HTML prefix need not be complete JSON. */ }
  const name=structured?.name??text.match(/\b(TypeError|ReferenceError|RangeError|SyntaxError|Error):/)?.[1];
  const responseError=errorClasses.has(name)?safeError({name,message:structured?.message??text,stack:typeof structured?.stack==='string'?structured.stack:text},projectRoot):undefined;
  return { SAFE_5XX_BODY_AVAILABLE:buffer.length>0, SAFE_5XX_BODY_CLASS:classification, SAFE_5XX_BODY_PREFIX:buffer.length?safeMessage(text):UNKNOWN, ...(responseError?{responseError}:{}) };
}

export function createDocumentEvidence({origin,receipt,projectRoot,country=()=>undefined,faultState}) {
  assert.equal(new URL(origin).hostname,'127.0.0.1','OWNED_DOCUMENT_ORIGIN_REQUIRED');
  const requests=new WeakMap(), pages=new Map(), chains=new Map(), active=new Map(), bodies=new Map(), snapshots=new Map(), pending=new Set(), removers=[];
  const records=receipt.documentRequests??=[], errors=receipt.workerErrors??=[];
  receipt.document5xxFailures??=[];
  let sequence=0, auxiliary=0;
  const unknown=(record,key,reason)=>{record.unknownReasons[key]=reason;};
  function publish(record) {
    if(!(record.responseStatus>=500))return;
    receipt.status='BLOCKED';
    const error=record.upstreamError, projectedError=error??record.safe5xxBody?.responseError, state=record.safeRequestState??snapshots.get(record.requestCorrelationId)??{};
    const failure={ DOCUMENT_5XX_CORRELATION_ID:record.requestCorrelationId,DOCUMENT_5XX_PATH:record.pathname,DOCUMENT_5XX_GENERATION:record.documentGeneration,DOCUMENT_5XX_STATUS:record.responseStatus,
      DOCUMENT_5XX_CONTENT_TYPE:record.responseContentType,DOCUMENT_5XX_SAFE_BODY_CLASS:record.safe5xxBody?.SAFE_5XX_BODY_CLASS??UNKNOWN,DOCUMENT_5XX_UPSTREAM_RESULT:record.upstreamResult,
      DOCUMENT_5XX_CORRELATED_THROW:!!error,DOCUMENT_5XX_CORRELATED_ERROR_CLASS:projectedError?.errorClass??UNKNOWN,DOCUMENT_5XX_CORRELATED_SAFE_MESSAGE:projectedError?.safeMessage??UNKNOWN,
      DOCUMENT_5XX_ERROR_EVIDENCE_SOURCE:error?'EXACT_UPSTREAM_THROW':projectedError?'RESPONSE_BODY_NOT_UPSTREAM_THROW':UNKNOWN,
      DOCUMENT_5XX_EARLIEST_PROJECT_STACK_FRAME:projectedError?.earliestProjectStackFrame??UNKNOWN,DOCUMENT_5XX_FAULT_STATE:record.faultState,DOCUMENT_5XX_AUTH_COOKIE_PRESENT:state.AUTH_COOKIE_PRESENT??UNKNOWN,
      DOCUMENT_5XX_LOCALE_COOKIE_SAFE_VALUE:state.LOCALE_COOKIE_SAFE_VALUE??UNKNOWN,DOCUMENT_5XX_ACCEPT_LANGUAGE:state.ACCEPT_LANGUAGE??UNKNOWN,DOCUMENT_5XX_LOCAL_COUNTRY:state.LOCAL_COUNTRY??UNKNOWN,
      unknownReasons:{...record.unknownReasons} };
    for(const [key,value] of Object.entries(failure))if(value===UNKNOWN)failure.unknownReasons[key]??=error?'NOT_AVAILABLE_IN_CORRELATED_THROW':'NOT_OBSERVED_OR_NO_CORRELATED_THROW';
    const existing=receipt.document5xxFailures.find(f=>f.DOCUMENT_5XX_CORRELATION_ID===record.requestCorrelationId);
    if(existing)Object.assign(existing,failure);else receipt.document5xxFailures.push(failure);
  }
  function makeEntry(pageState, chain, method, pathname, browserSeen) {
    const id=`document-${++sequence}`;
    const currentFault=faultState?.()??{};
    const record={requestCorrelationId:id,contextId:pageState.contextId,documentGeneration:browserSeen?++pageState.generation:UNKNOWN,documentScope:pageState.scope,method,pathname,requestStartTimestamp:stamp(),upstreamStartTimestamp:UNKNOWN,
      upstreamResult:UNKNOWN,responseStatus:UNKNOWN,responseContentType:UNKNOWN,responseFinishedTimestamp:UNKNOWN,browserResponseTimestamp:UNKNOWN,browserCommitTimestamp:UNKNOWN,
      faultState:Object.fromEntries(['readOutageActive','writeOutageActive','databaseFaultActive','networkSafetyBoundaryActive','otherTemporaryFaultActive'].map(k=>[k,typeof currentFault[k]==='boolean'?currentFault[k]:UNKNOWN])),
      unknownReasons:{upstreamStartTimestamp:'UPSTREAM_NOT_OBSERVED',upstreamResult:'UPSTREAM_NOT_OBSERVED',responseStatus:'RESPONSE_NOT_OBSERVED',responseContentType:'RESPONSE_NOT_OBSERVED',responseFinishedTimestamp:'RESPONSE_NOT_FINISHED',browserResponseTimestamp:'BROWSER_RESPONSE_NOT_OBSERVED',browserCommitTimestamp:'NO_REQUEST_LOADER_LINKAGE'} };
    if(!browserSeen)unknown(record,'documentGeneration','BROWSER_REDIRECT_HOP_NOT_YET_OBSERVED');
    const entry={record,chain:chain??id,pageState,upstreamSeen:false,browserSeen};
    records.push(record);(chains.get(entry.chain)??chains.set(entry.chain,[]).get(entry.chain)).push(entry);
    return entry;
  }
  function register(request,pageState) {
    if(requests.has(request))return requests.get(request);
    if(!request.isNavigationRequest() || request.frame()!==pageState.page.mainFrame() || new URL(request.url()).origin!==origin)return null;
    const parent=requests.get(request.redirectedFrom?.()), chain=parent?.chain, method=request.method(), pathname=safePath(new URL(request.url()).pathname);
    const late=(chains.get(chain)??[]).filter(e=>!e.browserSeen&&e.record.method===method&&e.record.pathname===pathname);
    const entry=late.length===1?late[0]:makeEntry(pageState,chain,method,pathname,true);
    if(!entry.browserSeen){entry.browserSeen=true;entry.record.browserRequestTimestamp=stamp();
      if(entry.record.documentScope===pageState.scope){entry.record.documentGeneration=++pageState.generation;delete entry.record.unknownReasons.documentGeneration;}
      else unknown(entry.record,'documentGeneration','BROWSER_HOP_ARRIVED_AFTER_SCOPE_CHANGED');
    }
    requests.set(request,entry);
    const {record}=entry,id=record.requestCorrelationId;
    const browserHeaders=request.headers(), snapshot=safeState(browserHeaders,country());
    if(!Object.hasOwn(browserHeaders,'cookie')){snapshot.AUTH_COOKIE_PRESENT=UNKNOWN;snapshot.LOCALE_COOKIE_PRESENT=UNKNOWN;if(!entry.upstreamSeen)unknown(record,'requestCookies','PLAYWRIGHT_HEADERS_MAY_OMIT_COOKIES');}
    if(!entry.upstreamSeen)snapshots.set(id,snapshot);
    pageState.link?.();publish(record);return entry;
  }
  const api={
    headersFor(request){const state=[...pages.values()].find(s=>request.frame()===s.page.mainFrame());const entry=state?register(request,state):null;const headers={...request.headers()};delete headers[LOCAL_DOCUMENT_HEADER];if(entry)headers[LOCAL_DOCUMENT_HEADER]=entry.chain;return headers;},
    beginScope(page){const state=pages.get(page);if(state){state.generation=0;state.scope++;}},
    observePage(page,contextId){const state={page,contextId,generation:0,scope:0};pages.set(page,state);
      const listen=(event,fn)=>{page.on(event,fn);removers.push(()=>page.off(event,fn));};
      listen('request',request=>register(request,state));
      listen('response',response=>{const entry=requests.get(response.request());if(!entry)return;const r=entry.record;r.browserResponseTimestamp=stamp();r.responseStatus=response.status();r.responseContentType=type(response.headers()['content-type']);delete r.unknownReasons.browserResponseTimestamp;delete r.unknownReasons.responseStatus;publish(r);});
      listen('requestfailed',request=>{const entry=requests.get(request);if(entry)entry.record.browserRequestFailed=true;});
    },
    async observeCdp(page,session){const state=pages.get(page), native=new Map(), extra=new Map(), loaders=new Map();await session.send('Network.enable');await session.send('Page.enable');const frameId=(await session.send('Page.getFrameTree')).frameTree.frame.id;
      function link(){for(const meta of native.values()){if(!meta.chain)continue;const candidates=(chains.get(meta.chain)??[]).filter(e=>e.pageState===state&&e.record.method===meta.method&&e.record.pathname===meta.path&&!e.loaderLinked);if(candidates.length!==1)continue;const entry=candidates[0];entry.loaderLinked=true;loaders.set(meta.loaderId,entry.record);}}
      state.link=link;
      const listen=(event,fn)=>{session.on(event,fn);removers.push(()=>session.off(event,fn));};
      listen('Network.requestWillBeSent',event=>{if(event.type!=='Document'||event.frameId!==frameId)return;const prior=native.get(event.requestId);loaders.delete(event.loaderId);native.set(event.requestId,{method:event.request.method,path:safePath(new URL(event.request.url).pathname),loaderId:event.loaderId,chain:header(event.request.headers)??extra.get(event.requestId)??(event.redirectResponse?prior?.chain:undefined)});extra.delete(event.requestId);link();});
      listen('Network.requestWillBeSentExtraInfo',event=>{const chain=header(event.headers),meta=native.get(event.requestId);if(meta){meta.chain=chain;link();}else if(chain)extra.set(event.requestId,chain);});
      listen('Page.frameNavigated',event=>{if(event.frame.id!==frameId)return;const r=loaders.get(event.frame.loaderId);if(r){r.browserCommitTimestamp=stamp();delete r.unknownReasons.browserCommitTimestamp;publish(r);}});
      removers.push(()=>{if(!page.isClosed?.())return session.detach();});
    },
    upstreamStart({method,pathname,headers}){const chain=header(headers), chainEntries=chains.get(chain)??[], candidates=chainEntries.filter(e=>!e.upstreamSeen&&e.record.method===method&&e.record.pathname===safePath(pathname));
      let entry=candidates.length===1?candidates[0]:null;
      // Redirect headers carry the known chain even if Playwright reports its hop late.
      const predecessor=chainEntries.at(-1);
      if(!entry&&candidates.length===0&&predecessor?.record.responseStatus>=300&&predecessor.record.responseStatus<400)entry=makeEntry(predecessor.pageState,chain,method,safePath(pathname),false);
      const id=entry?.record.requestCorrelationId??`auxiliary-${++auxiliary}`;
      if(entry){entry.upstreamSeen=true;entry.record.upstreamStartTimestamp=stamp();delete entry.record.unknownReasons.upstreamStartTimestamp;delete entry.record.unknownReasons.requestCookies;snapshots.set(id,safeState(headers,country()));}
      entry?.pageState.link?.();const handle={id,record:entry?.record};active.set(id,handle);return handle;},
    upstreamResponse(handle,status,contentType){const r=handle.record;if(!r)return;if(r.upstreamResult!== 'THROW' && r.upstreamResult!=='ABORT')r.upstreamResult='RESPONSE';r.responseStatus=status;r.responseContentType=type(contentType);delete r.unknownReasons.upstreamResult;delete r.unknownReasons.responseStatus;if(r.responseContentType!==UNKNOWN)delete r.unknownReasons.responseContentType;
      if(status>=500){r.safeRequestState=snapshots.get(handle.id);bodies.set(handle.id,Buffer.alloc(0));unknown(r,'safe5xxBody','BODY_NOT_FINISHED');}publish(r);},
    upstreamBody(handle,chunk){if(!bodies.has(handle.id))return;const buffer=bodies.get(handle.id),remaining=512-buffer.length;if(remaining>0)bodies.set(handle.id,Buffer.concat([buffer,Buffer.from(chunk).subarray(0,remaining)]));},
    upstreamThrow(handle,error,aborted=false){const r=handle.record;if(r){r.upstreamResult=aborted?'ABORT':'THROW';r.upstreamError={requestCorrelationId:handle.id,timestamp:stamp(),wrapperOwner:'OWNED_FRONT_DOOR_HTTP_REQUEST',UPSTREAM_THROW_CORRELATED:true,...safeError(error,projectRoot)};delete r.unknownReasons.upstreamResult;delete r.unknownReasons.upstreamError;publish(r);}},
    upstreamAborted(handle){const r=handle?.record;if(r){r.upstreamResult='ABORT';delete r.unknownReasons.upstreamResult;unknown(r,'upstreamError','ABORT_OBSERVED_NO_ERROR_EVENT_YET');publish(r);}},
    frontDoorFinished(handle){const r=handle?.record;if(r){r.responseFinishedTimestamp=stamp();delete r.unknownReasons.responseFinishedTimestamp;publish(r);}},
    upstreamFinished(handle){active.delete(handle.id);const r=handle.record;if(!r)return;r.upstreamResponseFinishedTimestamp=stamp();
      if(bodies.has(handle.id)){r.safe5xxBody=safeBody(bodies.get(handle.id),projectRoot);bodies.delete(handle.id);delete r.unknownReasons.safe5xxBody;}publish(r);},
    workerError(error,owner){const ids=[...active.keys()];errors.push({timestamp:stamp(),wrapperOwner:owner,activeRequestCorrelationIds:ids,WORKER_ERROR_ACTIVE_REQUEST_UNIQUE:ids.length===1,UPSTREAM_THROW_CORRELATED:false,...safeError(error,projectRoot)});},
    attachWorker(worker){for(const name of ['error','runtimeError']){const handler=event=>api.workerError(event?.cause?.cause??event?.cause??event?.error??event,name==='error'?'WORKER_ERROR_EVENT':'WORKER_RUNTIME_EVENT');worker.raw.on(name,handler);removers.push(()=>worker.raw.off(name,handler));}},
    captureOutput(streams){for(const [name,stream] of Object.entries(streams)){const original=stream.write;const wrapper=function(chunk,...args){const text=Buffer.isBuffer(chunk)?chunk.toString('utf8',0,4096):String(chunk).slice(0,4096);if(/\b(?:error|exception)\b|Network connection lost\./i.test(text))api.workerError({name:'Error',message:text,stack:text},name==='stderr'?'WORKER_STDERR':'WORKER_STDOUT');return original.call(this,chunk,...args);};stream.write=wrapper;removers.push(()=>{if(stream.write===wrapper)stream.write=original;});}},
    track(promise){pending.add(promise);void promise.finally(()=>pending.delete(promise)).catch(()=>{});},
    async finalize({timeoutMs=1000}={}){let timer;try{const complete=await Promise.race([Promise.allSettled([...pending]).then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);receipt.documentEvidenceFinalization=complete?'COMPLETE':'UNKNOWN_CAPTURE_DEADLINE';for(const r of records)publish(r);}finally{clearTimeout(timer);}},
    assertNo5xx(){assert.equal(receipt.document5xxFailures.length,0,'DOCUMENT_HTTP_5XX');assert.notEqual(receipt.documentEvidenceFinalization,'UNKNOWN_CAPTURE_DEADLINE','DOCUMENT_EVIDENCE_CAPTURE_DEADLINE');},
    async dispose(){for(const remove of removers.splice(0))await remove();},
  };
  function header(headers){const value=Object.entries(headers??{}).find(([key])=>key.toLowerCase()===LOCAL_DOCUMENT_HEADER)?.[1];return typeof value==='string'&&idPattern.test(value)?value:undefined;}
  function type(value){return typeof value==='string'&&/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+(?:;\s*charset=[a-zA-Z0-9-]+)?$/.test(value)?value:UNKNOWN;}
  return api;
}

export function forwardObservedLocalRequest({incoming,outgoing,destination,headers,evidence,pathname,transport,ca,onTransport=()=>{},observe=true}) {
  const forwarded = { ...headers };
  for (const name of Object.keys(forwarded)) if (name.toLowerCase() === LOCAL_DOCUMENT_HEADER) delete forwarded[name];
  const handle = observe ? evidence.upstreamStart({ method: incoming.method, pathname, headers: incoming.headers }) : null;
  let aborted = false, resolve, settled = false, proxy;
  const completed = new Promise(done => { resolve = done; });
  evidence.track(completed);
  const finish = () => {
    if (settled) return;
    settled = true;
    if (handle) evidence.upstreamFinished(handle);
    resolve();
  };
  outgoing.once('finish', () => evidence.frontDoorFinished(handle));
  outgoing.once('close', () => { if (!outgoing.writableFinished) aborted = true; });
  const fail = error => {
    if (settled) return;
    aborted ||= !!incoming.aborted || !!outgoing.destroyed;
    if (handle) {
      evidence.upstreamThrow(handle, error, aborted);
      // A canceled document did not receive the synthetic transport-error response.
      if (!aborted && !outgoing.headersSent) evidence.upstreamResponse(handle, 599, null);
    }
    if (!outgoing.headersSent) outgoing.writeHead(599);
    outgoing.end();
    finish();
  };
  try {
    proxy = transport(destination, { method: incoming.method, headers: forwarded, ...(ca ? { ca, rejectUnauthorized: true } : {}) }, response => {
      onTransport('AUTH_UPSTREAM_RESPONSE', { status: response.statusCode });
      if (handle) evidence.upstreamResponse(handle, response.statusCode, response.headers['content-type']);
      response.on('data', chunk => { if (handle) evidence.upstreamBody(handle, chunk); });
      response.once('end', () => { onTransport('AUTH_UPSTREAM_RESPONSE_FINISHED', { status: response.statusCode }); finish(); });
      response.once('aborted', () => { aborted = true; evidence.upstreamAborted(handle); outgoing.end(); });
      response.once('close', () => { if (aborted) finish(); });
      response.once('error', fail);
      let allowed = true;
      try {
        const location = response.headers.location;
        const ownedOrigin = headers.host ? 'https://' + headers.host : destination.origin;
        if (location) allowed = new URL(location, new URL(incoming.url ?? pathname, ownedOrigin)).origin === ownedOrigin;
      } catch { allowed = false; }
      if (!allowed) {
        if (handle) evidence.upstreamResponse(handle, 599, 'text/plain');
        response.resume();
        if (!outgoing.headersSent) outgoing.writeHead(599);
        outgoing.end('LOCAL_REDIRECT_DENIED');
        return;
      }
      outgoing.writeHead(response.statusCode, Object.fromEntries(Object.entries(response.headers).filter(([name]) => !['connection', 'transfer-encoding', 'keep-alive'].includes(name))));
      response.pipe(outgoing);
    });
    proxy.on('error', fail);
    proxy.setTimeout(15000, () => proxy.destroy());
    incoming.once('aborted', () => { aborted = true; proxy.destroy(); });
    incoming.pipe(proxy);
  } catch (error) { fail(error); }
  return completed;
}
