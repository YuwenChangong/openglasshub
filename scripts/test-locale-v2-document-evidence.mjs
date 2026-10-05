import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';

const origin = 'https://127.0.0.1:12345';
const root = 'C:/owned-test';
const oldFixture = () => ({ documents: [{ generation: 2, path: '/settings/', responseStatus: 500 }], observationFailure: { category: 'FINAL_DOCUMENT_SETTLEMENT_DEADLINE' } });
if (process.argv.includes('--old-red')) {
  test('old document 500 receipt must include request-correlated upstream/body evidence', () => {
    const old = oldFixture();
    assert.ok(old.documents[0].requestCorrelationId && old.documents[0].safe5xxBody,
      'OLD_5XX_OBSERVABILITY_INSUFFICIENT_CORRELATION');
  });
} else {
  const { createDocumentEvidence, forwardObservedLocalRequest, LOCAL_DOCUMENT_HEADER } = await import('./lib/locale-v2-document-evidence.mjs');
  function setup() {
    const receipt = {}, page = new EventEmitter(), frame = {};
    page.mainFrame = () => frame;
    let fault = null;
    const evidence = createDocumentEvidence({ origin, receipt, projectRoot: root, country: () => 'US',
      faultState: () => ({ readOutageActive: fault === 'read', writeOutageActive: fault === 'write', databaseFaultActive: false, networkSafetyBoundaryActive: true, otherTemporaryFaultActive: false }) });
    evidence.observePage(page, 'context-fixture');
    function request(pathname = '/settings/', { parent = null, navigation = true, main = true } = {}) {
      return { url: () => origin + pathname, method: () => 'GET', isNavigationRequest: () => navigation,
        frame: () => main ? frame : {}, redirectedFrom: () => parent,
        headers: () => ({ 'accept-language': 'zh-CN', cookie: 'sb-127-auth-token=private-cookie; ogh_preferences_v1=' + encodeURIComponent(JSON.stringify({ version: 1, preference: 'auto', provenance: 'account_adopted', generation: 3 })) }) };
    }
    function start(req) {
      page.emit('request', req);
      const headers = evidence.headersFor(req);
      return { headers, handle: evidence.upstreamStart({ method: req.method(), pathname: new URL(req.url()).pathname, headers }) };
    }
    return { receipt, page, frame, evidence, request, start, setFault: value => { fault = value; } };
  }

  test('frozen old observability is still explicitly insufficient, not historical PASS', () => {
    const old = oldFixture();
    assert.equal(old.documents[0].requestCorrelationId, undefined);
    assert.equal(old.documents[0].safe5xxBody, undefined);
  });
  test('application-like 500 preserves exact document ID, body class and fail-closed receipt', () => {
    const f = setup(), req = f.request('/settings/?code=do-not-store'), { handle } = f.start(req);
    f.evidence.upstreamResponse(handle, 500, 'text/html');
    f.evidence.upstreamBody(handle, Buffer.from('TypeError: Cannot read properties of undefined\n at render (C:/owned-test/src/components/settings/SettingsPage.tsx:20:3)'));
    f.evidence.upstreamFinished(handle);
    f.page.emit('response', { request: () => req, status: () => 500, headers: () => ({ 'content-type': 'text/html' }) });
    f.page.emit('framenavigated', Object.assign(f.frame, { url: () => origin + '/settings/' }));
    const doc = f.receipt.documentRequests[0], failure = f.receipt.document5xxFailures[0];
    assert.equal(failure.DOCUMENT_5XX_CORRELATION_ID, doc.requestCorrelationId);
    assert.equal(failure.DOCUMENT_5XX_PATH, '/settings/');
    assert.equal(failure.DOCUMENT_5XX_STATUS, 500);
    assert.equal(failure.DOCUMENT_5XX_SAFE_BODY_CLASS, 'APPLICATION_ERROR_LIKE');
    assert.equal(failure.DOCUMENT_5XX_UPSTREAM_RESULT, 'RESPONSE');
    assert.equal(failure.DOCUMENT_5XX_CORRELATED_THROW, false);
    assert.equal(failure.DOCUMENT_5XX_EARLIEST_PROJECT_STACK_FRAME, 'src/components/settings/SettingsPage.tsx:20:3');
    assert.equal(failure.DOCUMENT_5XX_ERROR_EVIDENCE_SOURCE, 'RESPONSE_BODY_NOT_UPSTREAM_THROW');
    assert.equal(doc.browserCommitTimestamp, 'UNKNOWN', 'FRAME_PATH_IS_NOT_REQUEST_CORRELATION');
    assert.throws(() => f.evidence.assertNo5xx(), /DOCUMENT_HTTP_5XX/);
    assert.equal(f.receipt.status, 'BLOCKED');
    assert.ok(!JSON.stringify(f.receipt).includes('do-not-store'));
  });
  test('upstream throw is correlated by its own handle, never by timestamp', () => {
    const f = setup(), { handle } = f.start(f.request());
    const error = new TypeError('fetch failed');
    error.stack = 'TypeError: fetch failed\n at render (C:/owned-test/src/pages/settings/index.astro:14:2)\n at proxy (C:/deps/node_modules/wrangler/wrangler-dist/ProxyWorker.js:142:7)';
    f.evidence.upstreamThrow(handle, error);
    f.evidence.upstreamResponse(handle, 599, null);
    f.evidence.upstreamFinished(handle);
    const fail = f.receipt.document5xxFailures[0];
    assert.equal(fail.DOCUMENT_5XX_UPSTREAM_RESULT, 'THROW');
    assert.equal(fail.DOCUMENT_5XX_CORRELATED_THROW, true);
    assert.equal(fail.DOCUMENT_5XX_CORRELATED_ERROR_CLASS, 'TypeError');
    assert.equal(fail.DOCUMENT_5XX_EARLIEST_PROJECT_STACK_FRAME, 'src/pages/settings/index.astro:14:2');
    assert.equal(f.receipt.documentRequests[0].upstreamError.earliestDependencyStackFrame, 'node_modules/wrangler/wrangler-dist/ProxyWorker.js:142:7');
  });
  test('two active requests make runtime error non-unique and never produce correlated throws', () => {
    const f = setup(); f.start(f.request()); f.start(f.request('/products/'));
    f.evidence.workerError(new Error('Network connection lost.'), 'WORKER_RUNTIME');
    const event = f.receipt.workerErrors[0];
    assert.equal(event.WORKER_ERROR_ACTIVE_REQUEST_UNIQUE, false);
    assert.equal(event.activeRequestCorrelationIds.length, 2);
    assert.ok(f.receipt.documentRequests.every(d => !d.upstreamError));
  });
  test('one active runtime relationship is recorded without claiming exact throw correlation', () => {
    const f = setup(); const { handle } = f.start(f.request());
    f.evidence.workerError(new Error('Network connection lost.'), 'WORKER_RUNTIME');
    const event = f.receipt.workerErrors[0];
    assert.equal(event.WORKER_ERROR_ACTIVE_REQUEST_UNIQUE, true);
    assert.deepEqual(event.activeRequestCorrelationIds, [handle.id]);
    assert.equal(event.UPSTREAM_THROW_CORRELATED, false);
    assert.equal(f.receipt.documentRequests[0].upstreamError, undefined);
  });
  test('non-document upstream overlap also prevents a false unique Worker association', () => {
    const f = setup(); f.start(f.request());
    f.evidence.upstreamStart({ method: 'GET', pathname: '/_astro/asset.js', headers: {} });
    f.evidence.workerError(new Error('Network connection lost.'), 'WORKER_RUNTIME');
    assert.equal(f.receipt.workerErrors[0].WORKER_ERROR_ACTIVE_REQUEST_UNIQUE, false);
  });
  test('secret-like response/error content never survives canonical safe projection', () => {
    const f = setup(), { handle } = f.start(f.request());
    const secrets = ['person@example.invalid', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature', 'Authorization: Bearer private-auth', 'cookie: private-cookie', 'sb_secret_owned-sentinel', 'service_role=owned-role-value', '11111111-2222-4333-8444-555555555555', 'postgresql://user:password@127.0.0.1/db'];
    f.evidence.upstreamResponse(handle, 500, 'text/html');
    f.evidence.upstreamBody(handle, Buffer.from('Network connection lost.\n' + secrets.join('\n')));
    f.evidence.upstreamFinished(handle);
    f.evidence.workerError(Object.assign(new Error(secrets.join(' ')), { stack: secrets.join('\n') }), 'WORKER_RUNTIME');
    const persisted = JSON.stringify(f.receipt);
    for (const secret of secrets) assert.ok(!persisted.includes(secret));
    const body = f.receipt.documentRequests[0].safe5xxBody;
    assert.equal(body.SAFE_5XX_BODY_CLASS, 'NETWORK_CONNECTION_LOST');
    assert.ok(Buffer.byteLength(body.SAFE_5XX_BODY_PREFIX) <= 512);
  });
  test('unrecognized 500 body is withheld, never partially stored as raw text', () => {
    const f = setup(), { handle } = f.start(f.request());
    f.evidence.upstreamResponse(handle, 500, 'text/plain');
    f.evidence.upstreamBody(handle, Buffer.from('arbitrary secret like value goes here'));
    f.evidence.upstreamFinished(handle);
    assert.equal(f.receipt.documentRequests[0].safe5xxBody.SAFE_5XX_BODY_CLASS, 'REDACTED_UNCLASSIFIED');
    assert.ok(!JSON.stringify(f.receipt).includes('arbitrary secret'));
  });
  test('200 responses do not persist body or cookie snapshots', () => {
    const f = setup(), { handle } = f.start(f.request());
    f.evidence.upstreamResponse(handle, 200, 'text/html');
    f.evidence.upstreamBody(handle, Buffer.from('body-must-not-be-stored'));
    f.evidence.upstreamFinished(handle);f.evidence.assertNo5xx();
    const doc = f.receipt.documentRequests[0];
    assert.equal(doc.safe5xxBody, undefined); assert.equal(doc.safeRequestState, undefined);
    assert.ok(!JSON.stringify(f.receipt).includes('body-must-not-be-stored'));
  });
  test('superseded Gen 1 abort does not become Gen 2 500 throw', () => {
    const f = setup(), one = f.start(f.request()), two = f.start(f.request());
    f.evidence.upstreamThrow(one.handle, new Error('Network connection lost.'), true);
    f.evidence.upstreamFinished(one.handle);
    f.evidence.upstreamResponse(two.handle, 500, 'text/plain');f.evidence.upstreamBody(two.handle, Buffer.from('Internal Server Error'));f.evidence.upstreamFinished(two.handle);
    const [a,b] = f.receipt.documentRequests;
    assert.equal(a.upstreamResult, 'ABORT');assert.equal(b.upstreamResult, 'RESPONSE');
    assert.notEqual(a.requestCorrelationId, b.requestCorrelationId);
    assert.equal(f.receipt.document5xxFailures[0].DOCUMENT_5XX_GENERATION, 2);
    assert.equal(f.receipt.document5xxFailures[0].DOCUMENT_5XX_CORRELATED_THROW, false);
  });
  test('fault state is immutable at request start, not read later during serialization', () => {
    const f = setup();f.setFault('read');const a=f.start(f.request());f.setFault('write');const b=f.start(f.request());f.setFault(null);
    for(const x of [a,b]) {f.evidence.upstreamResponse(x.handle,503,'text/plain');f.evidence.upstreamFinished(x.handle);}
    const [first,second] = f.receipt.document5xxFailures;
    assert.equal(first.DOCUMENT_5XX_FAULT_STATE.readOutageActive,true);assert.equal(first.DOCUMENT_5XX_FAULT_STATE.writeOutageActive,false);
    assert.equal(second.DOCUMENT_5XX_FAULT_STATE.writeOutageActive,true);assert.equal(second.DOCUMENT_5XX_FAULT_STATE.readOutageActive,false);
  });
  test('5xx cookie projection contains metadata and presence only, never auth values', () => {
    const f = setup(), { handle } = f.start(f.request());f.evidence.upstreamResponse(handle,500,'text/html');f.evidence.upstreamFinished(handle);
    const fail = f.receipt.document5xxFailures[0];
    assert.equal(fail.DOCUMENT_5XX_AUTH_COOKIE_PRESENT,true);
    assert.deepEqual(fail.DOCUMENT_5XX_LOCALE_COOKIE_SAFE_VALUE,{version:1,preference:'auto',provenance:'account_adopted',generation:3});
    assert.equal(fail.DOCUMENT_5XX_ACCEPT_LANGUAGE,'zh-CN');assert.equal(fail.DOCUMENT_5XX_LOCAL_COUNTRY,'US');
    assert.ok(!JSON.stringify(f.receipt).includes('private-cookie'));
  });
  test('redirect chain retains internal identity without conflating each upstream hop', () => {
    const f=setup(), first=f.request('/devices/xreal-air'), a=f.start(first);
    f.evidence.upstreamResponse(a.handle,301,'text/html');f.evidence.upstreamFinished(a.handle);
    const second=f.request('/products/xreal/xreal-air/',{parent:first});f.page.emit('request',second);
    const b=f.evidence.upstreamStart({method:'GET',pathname:'/products/xreal/xreal-air/',headers:a.headers});
    f.evidence.upstreamResponse(b,500,'text/plain');f.evidence.upstreamFinished(b);
    assert.equal(f.receipt.document5xxFailures[0].DOCUMENT_5XX_PATH,'/products/xreal/xreal-air/');
    assert.notEqual(a.handle.id,b.id);
  });
  test('non-main-frame and external requests receive no internal document header', () => {
    const f=setup();assert.equal(f.evidence.headersFor(f.request('/settings/',{main:false}))[LOCAL_DOCUMENT_HEADER],undefined);
    const req=f.request();req.url=()=> 'https://external.invalid/settings/';assert.equal(f.evidence.headersFor(req)[LOCAL_DOCUMENT_HEADER],undefined);
    assert.equal(f.receipt.documentRequests.length,0);
  });
  test('exact forwarding lifecycle strips correlation header before app and captures 500 body', async () => {
    const f=setup(), req=f.request();f.page.emit('request',req);const headers=f.evidence.headersFor(req);
    const incoming=new PassThrough(),outgoing=new PassThrough();incoming.method='GET';incoming.headers=headers;
    let forwarded;
    const response=new PassThrough();response.statusCode=500;response.headers={'content-type':'text/plain'};
    outgoing.writeHead=status=>{outgoing.statusCode=status;outgoing.headersSent=true;};
    const upstream=new PassThrough();upstream.setTimeout=()=>{};
    const pending=forwardObservedLocalRequest({incoming,outgoing,destination:new URL(origin+'/settings/'),headers,evidence:f.evidence,pathname:'/settings/',transport:(url,options,callback)=>{forwarded=options.headers;queueMicrotask(()=>{callback(response);response.end('Network connection lost.');});return upstream;}});
    incoming.end();outgoing.resume();await pending;
    assert.equal(forwarded[LOCAL_DOCUMENT_HEADER],undefined);
    assert.equal(f.receipt.document5xxFailures[0].DOCUMENT_5XX_SAFE_BODY_CLASS,'NETWORK_CONNECTION_LOST');
  });
  test('commit requires actual CDP header/request/loader linkage, not frame/path proximity', async () => {
    const f=setup(), cdp=new EventEmitter();cdp.send=async method=>method==='Page.getFrameTree'?{frameTree:{frame:{id:'main'}}}:{};cdp.detach=async()=>{};
    await f.evidence.observeCdp(f.page,cdp);
    const req=f.request(), {headers,handle}=f.start(req);
    cdp.emit('Network.requestWillBeSent',{requestId:'native-id',loaderId:'loader',frameId:'main',type:'Document',request:{url:origin+'/settings/',method:'GET',headers:{}}});
    cdp.emit('Network.requestWillBeSentExtraInfo',{requestId:'native-id',headers});
    f.evidence.upstreamResponse(handle,500,'text/plain');f.evidence.upstreamFinished(handle);
    cdp.emit('Page.frameNavigated',{frame:{id:'main',loaderId:'loader'}});
    assert.notEqual(f.receipt.documentRequests[0].browserCommitTimestamp,'UNKNOWN');
    await f.evidence.dispose();
  });
  test('outstanding error capture is bounded and 5xx stays latched after superseding success', async () => {
    const f=setup(), one=f.start(f.request()), two=f.start(f.request());
    f.evidence.upstreamResponse(one.handle,500,'text/plain');f.evidence.upstreamFinished(one.handle);
    f.evidence.upstreamResponse(two.handle,200,'text/html');f.evidence.upstreamFinished(two.handle);
    f.evidence.track(new Promise(()=>{}));await f.evidence.finalize({timeoutMs:5});
    assert.throws(()=>f.evidence.assertNo5xx(),/DOCUMENT_HTTP_5XX/);
    assert.equal(f.receipt.documentEvidenceFinalization,'UNKNOWN_CAPTURE_DEADLINE');
  });
  test('genuine loopback HTTP forwarding correlates one 500 and strips internal identity', async () => {
    const f=setup();let headersSeen;
    const server=createServer((req,res)=>{headersSeen=req.headers;res.writeHead(500,{'content-type':'text/plain'});res.end('Network connection lost.');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const req=f.request();f.page.emit('request',req);const headers=f.evidence.headersFor(req);
      const incoming=new PassThrough(),outgoing=new PassThrough();incoming.method='GET';incoming.headers=headers;
      outgoing.writeHead=status=>{outgoing.statusCode=status;outgoing.headersSent=true;};outgoing.resume();
      const pending=forwardObservedLocalRequest({incoming,outgoing,destination:new URL(`http://127.0.0.1:${server.address().port}/settings/`),headers,pathname:'/settings/',transport:httpRequest,evidence:f.evidence});
      incoming.end();await pending;await f.evidence.finalize();
      assert.equal(headersSeen[LOCAL_DOCUMENT_HEADER],undefined);
      assert.equal(f.receipt.document5xxFailures[0].DOCUMENT_5XX_STATUS,500);
      assert.equal(f.receipt.document5xxFailures[0].DOCUMENT_5XX_SAFE_BODY_CLASS,'NETWORK_CONNECTION_LOST');
    }finally{await new Promise(resolve=>server.close(resolve));}
  });
  test('same-origin relative redirect is preserved; off-origin redirect is refused locally', async () => {
    for(const [location,want] of [['/settings/',301],['https://external.invalid/',599]]) {
      const f=setup(),req=f.request();f.page.emit('request',req);const headers={...f.evidence.headersFor(req),host:'127.0.0.1:12345'};
      const incoming=new PassThrough(),outgoing=new PassThrough();incoming.method='GET';incoming.headers=headers;incoming.url='/settings/';
      outgoing.writeHead=status=>{outgoing.statusCode=status;outgoing.headersSent=true;};outgoing.resume();
      const response=new PassThrough();response.statusCode=301;response.headers={location};const proxy=new PassThrough();proxy.setTimeout=()=>{};
      const pending=forwardObservedLocalRequest({incoming,outgoing,destination:new URL(origin+'/settings/'),headers,evidence:f.evidence,pathname:'/settings/',transport:(url,options,callback)=>{queueMicrotask(()=>{callback(response);response.end();});return proxy;}});
      incoming.end();await pending;assert.equal(outgoing.statusCode,want);
    }
  });
  test('gateway cookie presence wins over restricted Playwright headers', () => {
    const f=setup(),req=f.request();req.headers=()=>({'accept-language':'zh-CN'});f.page.emit('request',req);
    const headers={...f.evidence.headersFor(req),cookie:'sb-127-auth-token=never-persist-this'};
    const handle=f.evidence.upstreamStart({method:'GET',pathname:'/settings/',headers});f.evidence.upstreamResponse(handle,500,'text/plain');f.evidence.upstreamFinished(handle);
    assert.equal(f.receipt.document5xxFailures[0].DOCUMENT_5XX_AUTH_COOKIE_PRESENT,true);
    assert.ok(!JSON.stringify(f.receipt).includes('never-persist-this'));
  });
  test('canceled forwarding must not invent a returned 599 when final document is healthy', async () => {
    const f=setup(),req=f.request();f.page.emit('request',req);const headers=f.evidence.headersFor(req);
    const incoming=new PassThrough(),outgoing=new PassThrough();incoming.method='GET';incoming.headers=headers;outgoing.resume();
    outgoing.writeHead=status=>{outgoing.statusCode=status;outgoing.headersSent=true;};
    const proxy=new PassThrough();proxy.setTimeout=()=>{};
    const pending=forwardObservedLocalRequest({incoming,outgoing,destination:new URL(origin+'/settings/'),headers,evidence:f.evidence,pathname:'/settings/',transport:()=>proxy});
    incoming.emit('aborted');proxy.emit('error',new Error('Network connection lost.'));await pending;
    const final=f.start(f.request());f.evidence.upstreamResponse(final.handle,200,'text/html');f.evidence.upstreamFinished(final.handle);
    assert.equal(f.receipt.documentRequests[0].upstreamResult,'ABORT');
    assert.doesNotThrow(()=>f.evidence.assertNo5xx(),'CANCELED_DOCUMENT_IS_NOT_A_RETURNED_599');
  });
  test('synchronous transport throw is safely captured in the exact request lifecycle', async () => {
    const f=setup(),req=f.request();f.page.emit('request',req);const headers=f.evidence.headersFor(req);
    const incoming=new PassThrough(),outgoing=new PassThrough();incoming.method='GET';incoming.headers=headers;outgoing.resume();outgoing.writeHead=status=>{outgoing.statusCode=status;outgoing.headersSent=true;};
    await forwardObservedLocalRequest({incoming,outgoing,destination:new URL(origin+'/settings/'),headers,evidence:f.evidence,pathname:'/settings/',transport:()=>{throw new TypeError('fetch failed');}});
    assert.equal(f.receipt.document5xxFailures[0].DOCUMENT_5XX_CORRELATED_THROW,true);
    assert.equal(f.receipt.document5xxFailures[0].DOCUMENT_5XX_STATUS,599);
  });
  test('unlinked browser 500 still latches failure and never assumes omitted cookies are absent', () => {
    const f=setup(),req=f.request();req.headers=()=>({'accept-language':'zh-CN'});f.page.emit('request',req);
    f.page.emit('response',{request:()=>req,status:()=>500,headers:()=>({'content-type':'text/html'})});
    assert.equal(f.receipt.document5xxFailures[0].DOCUMENT_5XX_AUTH_COOKIE_PRESENT,'UNKNOWN');
    assert.equal(f.receipt.document5xxFailures[0].DOCUMENT_5XX_UPSTREAM_RESULT,'UNKNOWN');
    assert.throws(()=>f.evidence.assertNo5xx(),/DOCUMENT_HTTP_5XX/);
  });
  test('late browser redirect hop reuses its exact already-completed gateway 500 evidence', () => {
    const f=setup(),first=f.request('/devices/xreal-air'),a=f.start(first);
    f.evidence.upstreamResponse(a.handle,301,'text/html');f.evidence.upstreamFinished(a.handle);
    const gateway=f.evidence.upstreamStart({method:'GET',pathname:'/products/xreal/xreal-air/',headers:a.headers});
    f.evidence.upstreamResponse(gateway,500,'text/plain');f.evidence.upstreamBody(gateway,Buffer.from('Network connection lost.'));f.evidence.upstreamFinished(gateway);
    const second=f.request('/products/xreal/xreal-air/',{parent:first});f.page.emit('request',second);
    const failed=f.receipt.document5xxFailures[0];
    assert.ok(failed,'LATE_REDIRECT_MUST_RETAIN_OWNED_GATEWAY_RESPONSE');
    assert.equal(failed.DOCUMENT_5XX_GENERATION,2);assert.equal(failed.DOCUMENT_5XX_SAFE_BODY_CLASS,'NETWORK_CONNECTION_LOST');
    assert.equal(failed.DOCUMENT_5XX_CORRELATION_ID,gateway.id);assert.equal(f.receipt.documentRequests.length,2);
  });
  test('response abort preserves subsequent exact correlated error and closes downstream', async () => {
    const f=setup(),req=f.request();f.page.emit('request',req);const headers=f.evidence.headersFor(req);
    const incoming=new PassThrough(),outgoing=new PassThrough();incoming.method='GET';incoming.headers=headers;outgoing.resume();outgoing.writeHead=status=>{outgoing.statusCode=status;outgoing.headersSent=true;};
    const response=new PassThrough();response.statusCode=500;response.headers={'content-type':'text/plain'};const proxy=new PassThrough();proxy.setTimeout=()=>{};
    const pending=forwardObservedLocalRequest({incoming,outgoing,destination:new URL(origin+'/settings/'),headers,evidence:f.evidence,pathname:'/settings/',transport:(url,options,callback)=>{queueMicrotask(()=>{callback(response);response.emit('aborted');response.emit('error',new Error('Network connection lost.'));});return proxy;}});
    incoming.end();await pending;
    assert.equal(f.receipt.document5xxFailures[0].DOCUMENT_5XX_CORRELATED_THROW,true);
    assert.equal(f.receipt.documentRequests[0].upstreamError.safeMessage,'Network connection lost.');
    assert.equal(outgoing.writableEnded,true);
  });
  test('redirect with unresolved hop cannot mark its predecessor committed', async () => {
    const f=setup(),cdp=new EventEmitter();cdp.send=async method=>method==='Page.getFrameTree'?{frameTree:{frame:{id:'main'}}}:{};cdp.detach=async()=>{};await f.evidence.observeCdp(f.page,cdp);
    const first=f.request('/devices/xreal-air'),a=f.start(first);
    cdp.emit('Network.requestWillBeSent',{requestId:'native',loaderId:'same-loader',frameId:'main',type:'Document',request:{url:origin+'/devices/xreal-air',method:'GET',headers:a.headers}});
    f.evidence.upstreamResponse(a.handle,301,'text/html');f.evidence.upstreamFinished(a.handle);
    cdp.emit('Network.requestWillBeSent',{requestId:'native',loaderId:'same-loader',frameId:'main',type:'Document',redirectResponse:{status:301},request:{url:origin+'/products/xreal/xreal-air/',method:'GET',headers:a.headers}});
    cdp.emit('Page.frameNavigated',{frame:{id:'main',loaderId:'same-loader'}});
    assert.equal(f.receipt.documentRequests[0].browserCommitTimestamp,'UNKNOWN');await f.evidence.dispose();
  });
  test('unsafe encoded path and credential-like stack filenames are withheld', () => {
    const f=setup(),{handle}=f.start(f.request('/settings/%3Faccess_token%3Downed-secret'));
    const error=new TypeError('private unknown message');error.stack='TypeError: private unknown message\n at f (C:/owned-test/src/sb_secret_owned-value.ts:1:1)';
    f.evidence.upstreamThrow(handle,error);f.evidence.upstreamResponse(handle,599,'text/plain');f.evidence.upstreamFinished(handle);
    const json=JSON.stringify(f.receipt);for(const value of ['owned-secret','owned-value','private unknown message'])assert.ok(!json.includes(value));
    assert.equal(f.receipt.documentRequests[0].pathname,'/[REDACTED]');
  });
  test('already closed page does not turn diagnostic CDP teardown into failure', async () => {
    const f=setup(),cdp=new EventEmitter();cdp.send=async method=>method==='Page.getFrameTree'?{frameTree:{frame:{id:'main'}}}:{};cdp.detach=async()=>{throw new Error('must not detach closed target');};
    await f.evidence.observeCdp(f.page,cdp);f.page.isClosed=()=>true;await f.evidence.dispose();
  });
  test('worker output and raw events retain safe projections and restore their scoped owners', async () => {
    const f=setup(),worker={raw:new EventEmitter()},stream={write(){return false;}},original=stream.write;
    f.evidence.captureOutput({stderr:stream});f.evidence.attachWorker(worker);f.start(f.request());
    assert.equal(stream.write('workerd: error: person@example.invalid private-credential'),false);
    worker.raw.emit('error',{cause:new Error('Network connection lost.')});
    worker.raw.emit('runtimeError',new TypeError('fetch failed'));
    assert.equal(f.receipt.workerErrors.length,3);assert.ok(!JSON.stringify(f.receipt).includes('person@example.invalid'));assert.ok(!JSON.stringify(f.receipt).includes('private-credential'));
    await f.evidence.dispose();assert.equal(stream.write,original);assert.equal(worker.raw.listenerCount('error'),0);assert.equal(worker.raw.listenerCount('runtimeError'),0);
  });
  test('runner wires owned diagnostics and retains mandatory final 5xx rejection', async () => {
    const source=await readFile(new URL('./test-global-locale-v2-acceptance-local.mjs',import.meta.url),'utf8');
    for(const required of ['createDocumentEvidence(', 'forwardObservedLocalRequest(', 'documentEvidence.headersFor(', 'documentEvidence.observePage(', 'documentEvidence.attachWorker(', 'documentEvidence.assertNo5xx()', "WRANGLER_WRITE_LOGS: 'false'"]) assert.ok(source.includes(required),required);
  });
}
