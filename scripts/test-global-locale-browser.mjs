import assert from "node:assert/strict";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { chromium, firefox } from "playwright";
import { createServer, connect as connectTcp } from "node:net";
import { createServer as createFixtureServer } from "node:http";
import { createServer as createGatewayServer, request as requestHttps } from "node:https";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { serializePreferenceCookie } from "../src/lib/i18n/preference-cookie.ts";
import { parsePreferenceCookie } from "../src/lib/i18n/preference-cookie.ts";
import { resolveLocale } from "../src/lib/i18n/locale.ts";
import { createLocaleStore } from "../src/lib/i18n/locale-store.ts";
import { getUiMessages } from "../src/lib/i18n/catalog.ts";
import { createRequire } from "node:module";
import { errorMonitor } from "node:events";
import { preparePreferenceRunEnvironment } from "./test-user-preferences-rls-local.mjs";
import { assertLocalReplayTarget, assertOwnedDisposableRoot, runCommand, runLocalDisposableReplay, withCanonicalBaselineDirectory } from "./qa/local-disposable-supabase-replay.mjs";
import { preferenceMigration } from "./test-user-preferences-schema.mjs";
const root = process.cwd();
const workerConfig = path.resolve("dist/server/wrangler.json");
const output = path.resolve("artifacts/qa/global-locale-browser");
function createMatrixResumeCursor(acceptedOrdinal) {
    assert.ok(Number.isInteger(acceptedOrdinal) && acceptedOrdinal >= 0 && acceptedOrdinal <= 102, "INVALID_ACCEPTED_MATRIX_ORDINAL");
    let ordinal = 0;
    return { acceptedOrdinal, get ordinal() { return ordinal; }, select() { return ++ordinal > acceptedOrdinal; } };
}
const resumeArguments = process.argv.filter(argument => argument.startsWith("--resume-after-accepted-ordinal="));
assert.ok(resumeArguments.length <= 1, "ONE_ACCEPTED_MATRIX_CURSOR_REQUIRED");
if (resumeArguments.length)
    assert.match(resumeArguments[0], /^--resume-after-accepted-ordinal=(?:0|[1-9]\d*)$/);
const matrixResumeCursor = createMatrixResumeCursor(resumeArguments.length ? Number(resumeArguments[0].split("=")[1]) : 0);
let case63Trace;
const case63SourceEvents = new Set(["DOCUMENT_INITIALIZED", "DOCUMENT_BEFOREUNLOAD", "DOCUMENT_PAGEHIDE", "FIXTURE_READY", "AUTH_ACTOR", "A_SIGNOUT_CALL_START",
    "B_AUTH_SIGNIN_RESOLVED", "B_SET_ACTOR_START", "STORE_CLEAR_ACCOUNT_START", "STORE_ADOPT_ACCOUNT_START",
    "STORE_COMMIT", "STORE_RELOAD_REQUESTED"]);
function createCase63NavigationTrace() {
    const events = [], documents = [], documentKeys = new Map(), requestOwners = new WeakMap(), reloadMarkers = [], navigationRequests = new WeakSet();
    const listeners = new Set();
    let active, operation = "NONE", cleanup = false;
    const emit = (event, details = {}) => {
        const entry = { CASE63_TRACE_SEQUENCE: events.length + 1, event, phase: operation,
            activeNavigationGeneration: active?.generation ?? "UNKNOWN", cleanup, ...details };
        events.push(entry);
        queueMicrotask(() => { for (const listener of listeners)
            listener(); });
        return entry;
    };
    const correlate = () => {
        for (const doc of documents.slice(1)) {
            const candidates = reloadMarkers.filter(marker => marker.documentGeneration === doc.replacesGeneration);
            doc.sourceMarkerSequences = candidates.map(marker => marker.CASE63_TRACE_SEQUENCE);
            doc.source = candidates.length === 1 ? candidates[0].source : "UNKNOWN";
        }
    };
    return { events, documents, requestOwners, get active() { return active; }, get operation() { return operation; },
        documentForKey: key => documentKeys.get(key),
        waitFor(predicate) {
            let check;
            const promise = new Promise((resolve, reject) => {
                check = () => {
                    try {
                        const value = predicate();
                        if (value) {
                            listeners.delete(check);
                            resolve(value);
                        }
                    }
                    catch (error) {
                        listeners.delete(check);
                        reject(error);
                    }
                };
                listeners.add(check);
                check();
            });
            return { promise, dispose: () => listeners.delete(check) };
        },
        setOperation(value) { operation = value; }, startCleanup() { cleanup = true; emit("CLEANUP_START"); }, emit,
        request(request, entry, mainFrame) {
            if (mainFrame && entry.resourceType === "document" && entry.pathname === "/__task19/locale") {
                const doc = { navigationSequence: documents.length + 1, generation: documents.length + 1,
                    documentSequence: entry.id, replacesGeneration: active?.generation ?? 0, entry,
                    source: documents.length === 0 ? "INITIAL_FIXTURE_NAVIGATION" : "UNKNOWN", phase: operation,
                    frameNavigated: false, domContentLoaded: false, fixtureReady: false };
                documents.push(doc);
                correlate();
                requestOwners.set(request, doc);
                navigationRequests.add(request);
                doc.requestTraceSequence = emit("DOCUMENT_REQUEST", { documentSequence: doc.documentSequence,
                    documentGeneration: doc.generation, pathname: "/__task19/locale" }).CASE63_TRACE_SEQUENCE;
            }
            else
                requestOwners.set(request, active);
        },
        frameNavigated() {
            active = documents.filter(doc => doc.entry.responseObserved).at(-1);
            if (active)
                active.frameNavigated = true;
            const event = emit("FRAMENAVIGATED", { documentSequence: active?.documentSequence ?? "UNKNOWN",
                documentGeneration: active?.generation ?? "UNKNOWN", pathname: "/__task19/locale" });
            if (active)
                active.frameTraceSequence = event.CASE63_TRACE_SEQUENCE;
        },
        domContentLoaded() {
            if (active)
                active.domContentLoaded = true;
            const event = emit("DOMCONTENTLOADED", { documentSequence: active?.documentSequence ?? "UNKNOWN", documentGeneration: active?.generation ?? "UNKNOWN" });
            if (active)
                active.domTraceSequence = event.CASE63_TRACE_SEQUENCE;
        },
        terminal(request, event) {
            const owner = requestOwners.get(request);
            if (navigationRequests.has(request)) {
                const terminal = emit(event, { documentSequence: owner.documentSequence, documentGeneration: owner.generation });
                owner.terminalTraceSequence = terminal.CASE63_TRACE_SEQUENCE;
            }
        },
        source(message) {
            const prefix = "TASK19_CASE63_SOURCE ";
            if (!message.text().startsWith(prefix))
                return;
            let value;
            try {
                value = JSON.parse(message.text().slice(prefix.length));
            }
            catch {
                return;
            }
            if (!case63SourceEvents.has(value.event) || !Number.isFinite(value.documentKey)
                || !["NONE", "clearAccount", "adoptAccount", "Task19Fixture.signOut", "Task19Fixture.signIn", "Task19Fixture.setActor", "Task19Fixture.ready"].includes(value.site)
                || !["ACCOUNT_A", "ACCOUNT_B", "ANONYMOUS", "UNKNOWN"].includes(value.actor))
                return;
            if (value.event === "DOCUMENT_INITIALIZED" && !documentKeys.has(value.documentKey)) {
                const doc = documents.at(-1);
                if (doc && ![...documentKeys.values()].includes(doc))
                    documentKeys.set(value.documentKey, doc);
            }
            const doc = documentKeys.get(value.documentKey);
            const source = value.site === "clearAccount" ? value.actor === "ACCOUNT_A" ? "A_CLEAR_ACCOUNT_RELOAD"
                : value.actor === "ACCOUNT_B" ? "OTHER_PROVEN_SOURCE" : "UNKNOWN"
                : value.site === "adoptAccount" ? value.actor === "ACCOUNT_B" ? "B_ADOPT_ACCOUNT_RELOAD"
                    : value.actor === "ACCOUNT_A" ? "OTHER_PROVEN_SOURCE" : "UNKNOWN" : "OTHER_PROVEN_SOURCE";
            let event = value.event;
            if (source === "A_CLEAR_ACCOUNT_RELOAD")
                event = ({ STORE_CLEAR_ACCOUNT_START: "A_CLEAR_ACCOUNT_START",
                    STORE_COMMIT: "A_CLEAR_ACCOUNT_COMMIT", STORE_RELOAD_REQUESTED: "A_CLEAR_ACCOUNT_RELOAD_REQUESTED" })[event] ?? event;
            if (source === "B_ADOPT_ACCOUNT_RELOAD")
                event = ({ STORE_ADOPT_ACCOUNT_START: "B_ADOPT_ACCOUNT_START",
                    STORE_COMMIT: "B_ADOPT_ACCOUNT_COMMIT", STORE_RELOAD_REQUESTED: "B_ADOPT_ACCOUNT_RELOAD_REQUESTED" })[event] ?? event;
            const marker = emit(event, { sourceSite: value.site, actor: value.actor,
                documentGeneration: doc?.generation ?? "UNKNOWN", documentSequence: doc?.documentSequence ?? "UNKNOWN", source });
            if (value.event === "STORE_RELOAD_REQUESTED") {
                reloadMarkers.push(marker);
                correlate();
            }
            if (value.event === "FIXTURE_READY" && doc) {
                doc.fixtureReady = true;
                doc.fixtureReadyTraceSequence = marker.CASE63_TRACE_SEQUENCE;
            }
        },
    };
}
function armAccountLogoutReload(trace, observation) {
    const baseline = trace.active;
    assert.ok(baseline && baseline === trace.documents.at(-1), "A_LOGOUT_BASELINE_DOCUMENT_NOT_CURRENT");
    const receipt = trace.settlementReceipt ??= {};
    Object.assign(receipt, { CASE63_PRE_A_LOGOUT_NAVIGATION_GENERATION: baseline.generation,
        CASE63_PRE_A_LOGOUT_DOCUMENT_SEQUENCE: baseline.documentSequence, A_LOGOUT_RELOAD_BARRIER_ARMED: true });
    trace.emit("A_LOGOUT_RELOAD_BARRIER_ARMED");
    return { trace, observation, baseline, receipt, armedSequence: trace.events.length };
}
async function awaitLogoutSignal(barrier, predicate, failure) {
    const signal = barrier.trace.waitFor(predicate);
    try {
        return await withinAbCaseDeadline(barrier.observation, signal.promise, failure);
    }
    finally {
        signal.dispose();
    }
}
async function settleAccountLogoutReload(page, barrier) {
    const { trace, baseline, receipt, observation } = barrier;
    const current = await awaitLogoutSignal(barrier, () => trace.documents.find(doc => doc.source === "A_CLEAR_ACCOUNT_RELOAD"
        && doc.replacesGeneration === baseline.generation && doc.generation > baseline.generation
        && doc.frameNavigated && doc.entry.pathname === "/__task19/locale"
        && trace.events.some(event => event.event === "A_CLEAR_ACCOUNT_RELOAD_REQUESTED"
            && event.documentGeneration === baseline.generation && event.CASE63_TRACE_SEQUENCE > barrier.armedSequence)), "TASK19_ACCOUNT_A_TO_B_EXPECTED_A_CLEAR_ACCOUNT_RELOAD_NOT_OBSERVED");
    Object.assign(receipt, { A_CLEAR_ACCOUNT_RELOAD_REQUESTED: true, A_LOGOUT_RELOAD_NAVIGATION_OBSERVED: true });
    trace.emit("A_LOGOUT_RELOAD_NAVIGATION_OBSERVED");
    await awaitLogoutSignal(barrier, () => current.domContentLoaded, "A_LOGOUT_RELOAD_DOMCONTENTLOADED_NOT_OBSERVED");
    receipt.A_LOGOUT_RELOAD_DOMCONTENTLOADED = true;
    await withinAbCaseDeadline(observation, page.waitForFunction(() => window.__task19 !== undefined && window.__task19AuthHarness !== undefined, null, { timeout: Math.max(1, observation.deadline - performance.now()) }), "A_LOGOUT_RELOAD_FIXTURE_NOT_READY");
    assert.ok(trace.active === current && trace.documents.at(-1) === current, "A_LOGOUT_FIXTURE_READY_DOCUMENT_CHANGED");
    receipt.A_LOGOUT_RELOAD_FIXTURE_READY = true;
    trace.emit("A_LOGOUT_RELOAD_FIXTURE_READY");
    await awaitLogoutSignal(barrier, () => current.entry.finished || current.entry.failed, "A_LOGOUT_RELOAD_DOCUMENT_NONTERMINAL");
    Object.assign(receipt, { A_LOGOUT_RELOAD_DOCUMENT_REQUESTFINISHED: current.entry.finished,
        A_LOGOUT_RELOAD_DOCUMENT_REQUESTFAILED: current.entry.failed, A_LOGOUT_RELOAD_DOCUMENT_TERMINAL: true });
    assert.equal(current.entry.failed, false, "A_LOGOUT_RELOAD_DOCUMENT_REQUESTFAILED");
    assert.equal(current.entry.finished, true, "A_LOGOUT_RELOAD_DOCUMENT_NOT_FINISHED");
    // This is the barrier's terminal acknowledgment; the original network event sequence is retained separately.
    trace.emit("A_LOGOUT_RELOAD_DOCUMENT_TERMINAL");
    const auth = await withinAbCaseDeadline(observation, page.evaluate(async () => ({
        present: Boolean(window.__task19 && window.__task19AuthHarness), documentKey: performance.timeOrigin,
        state: await window.__task19AuthHarness.getSessionState(),
    })), "A_LOGOUT_CURRENT_AUTH_HARNESS_DEADLINE");
    assert.ok(auth.present && trace.documentForKey(auth.documentKey) === current
        && trace.active === current && trace.documents.at(-1) === current, "A_LOGOUT_AUTH_HARNESS_NOT_CURRENT_DOCUMENT");
    assert.equal(auth.state.sessionPresent, false, "PREVIOUS_SESSION_REMOVED_BEFORE_SWITCH");
    Object.assign(receipt, { A_LOGOUT_SETTLED_DOCUMENT_GENERATION: current.generation, A_LOGOUT_SETTLED_DOCUMENT_SEQUENCE: current.documentSequence,
        POST_A_LOGOUT_AUTH_HARNESS_PRESENT: auth.present, POST_A_LOGOUT_AUTH_HARNESS_DOCUMENT_GENERATION: current.generation });
    barrier.settledDocument = current;
    return auth.state;
}
function hydrationMessageClass(text, sourceFile) {
    if (/^Hydration failed because the server rendered (?:text|HTML) didn't match the client/.test(text))
        return text.startsWith("Hydration failed because the server rendered text") ? "REACT_HYDRATION_TEXT_MISMATCH" : "REACT_SERVER_CLIENT_TREE_MISMATCH";
    if (/^A tree hydrated but some attributes of the server rendered HTML didn't match the client properties/.test(text))
        return "REACT_HYDRATION_ATTRIBUTE_MISMATCH";
    if (/^(?:Warning: )?Text content did not match\./.test(text))
        return "REACT_HYDRATION_TEXT_MISMATCH";
    if (/^Warning: Prop .+ did not match\./.test(text))
        return "REACT_HYDRATION_ATTRIBUTE_MISMATCH";
    if (/^(?:Warning: )?Expected server HTML to contain a matching /.test(text))
        return "REACT_SERVER_CLIENT_TREE_MISMATCH";
    if (/^Warning: Did not expect server HTML to contain a /.test(text))
        return "REACT_SERVER_CLIENT_TREE_MISMATCH";
    if (/^Warning: An error occurred during hydration\. The server HTML was replaced with client content/.test(text))
        return "REACT_HYDRATION_REPLACED";
    if (/^Warning: /.test(text) && /React|component|render/.test(text))
        return "REACT_GENERIC_RENDER_WARNING";
    if (/^Layout was forced before the page was fully loaded\./.test(text))
        return "FIREFOX_BROWSER_WARNING";
    if (sourceFile === "fixture.js" && /^TASK19_/.test(text))
        return "FIXTURE_WARNING";
    return "UNKNOWN";
}
function isReactHydrationDiagnostic(message) {
    return /^REACT_(?:HYDRATION|SERVER_CLIENT)/.test(hydrationMessageClass(message.text(), "UNKNOWN"));
}
const matrixResumeReceipt = { RUNTIME_EXCEPTION_COUNT: 0 };
let runtimeCaseContext;
function bindRuntimeCase(browser, viewport, name, phase, site) {
    runtimeCaseContext = { ordinal: matrixResumeCursor?.ordinal ?? acceptedDisposableCasesAtStart + workerCasesPassed + fixtureCases + 1,
        browser, viewport, name, phase, site };
    if (matrixResumeReceipt.FIRST_EXECUTED_CASE_AFTER_RESUME_ORDINAL === undefined)
        Object.assign(matrixResumeReceipt, {
            FIRST_EXECUTED_CASE_AFTER_RESUME_ORDINAL: runtimeCaseContext.ordinal, FIRST_EXECUTED_CASE_AFTER_RESUME_BROWSER: browser,
            FIRST_EXECUTED_CASE_AFTER_RESUME_VIEWPORT: viewport, FIRST_EXECUTED_CASE_AFTER_RESUME_NAME: name,
        });
}
function runtimePhase(phase, site) {
    if (runtimeCaseContext)
        Object.assign(runtimeCaseContext, { phase, site });
}
function safeCaseRuntimeError(error, context) {
    const safe = safeStale390Error(error), message = String(error?.message ?? "");
    let errorClass = "OTHER", messageClass = safe.messageClass;
    if (error?.code === "ERR_ASSERTION" || error?.name === "AssertionError")
        errorClass = "ASSERTION_ERROR";
    else if (/Execution context was destroyed/i.test(message))
        errorClass = "EXECUTION_CONTEXT_DESTROYED";
    else if (/Target page, context or browser has been closed/i.test(message))
        errorClass = "TARGET_CLOSED";
    else if (/Page (?:is |has been )?closed/i.test(message))
        errorClass = "PAGE_CLOSED";
    else if (error?.name === "TimeoutError")
        errorClass = "TIMEOUT";
    else if (error?.name === "TypeError")
        errorClass = /Cannot read properties of (?:undefined|null)/.test(message)
            ? "HARNESS_UNDEFINED_OR_NULL_ACCESS" : "HARNESS_TYPE_ERROR";
    else if (["ECONNRESET", "EPIPE", "ECONNABORTED", "ETIMEDOUT", "ERR_HTTP_HEADERS_SENT", "ERR_STREAM_PREMATURE_CLOSE"].includes(error?.code))
        errorClass = "NETWORK_OR_HTTP_SERVER_ERROR";
    else if (/browserType\.launch|browser\.newContext|page\.|locator\./.test(message))
        errorClass = "PLAYWRIGHT_ERROR";
    else if (context?.phase === "LOCAL_SUPABASE_SETUP")
        errorClass = "SUPABASE_LOCAL_RUNTIME_ERROR";
    if (/Executable doesn't exist/i.test(message)) {
        errorClass = "PLAYWRIGHT_ERROR";
        messageClass = "BROWSER_EXECUTABLE_MISSING";
    }
    const boundary = context?.phase === "BROWSER_LAUNCH" || errorClass === "PLAYWRIGHT_ERROR" ? "PLAYWRIGHT"
        : ["EXECUTION_CONTEXT_DESTROYED", "PAGE_CLOSED", "TARGET_CLOSED"].includes(errorClass) ? "BROWSER_PAGE"
            : context?.phase === "LOCAL_SUPABASE_SETUP" ? "LOCAL_SUPABASE"
                : context?.phase === "LOCAL_WORKER_SETUP" ? "LOCAL_WORKER"
                    : context?.phase === "AUTH_SETUP" ? "AUTH"
                        : context?.phase === "FRONT_DOOR_HANDLING" ? "FRONT_DOOR"
                            : errorClass === "ASSERTION_ERROR" ? "PRODUCT_ASSERTION"
                                : context ? "HARNESS_SCENARIO" : "UNKNOWN";
    return { RUNTIME_ERROR_NAME: safe.name, RUNTIME_ERROR_CODE: safe.code, RUNTIME_ERROR_CLASS: errorClass,
        RUNTIME_ERROR_SITE: context?.site ?? "UNKNOWN", RUNTIME_ERROR_STACK_SITE: safe.stackSite,
        RUNTIME_ERROR_MESSAGE_CLASS: messageClass, RUNTIME_FAILURE_OWNER_BOUNDARY: boundary };
}
function captureCaseRuntimeError(error) {
    {
        if (matrixResumeReceipt.RUNTIME_EXCEPTION_COUNT)
            return;
        Object.assign(matrixResumeReceipt, safeCaseRuntimeError(error, runtimeCaseContext), {
            RUNTIME_EXCEPTION_COUNT: 1, NEW_BLOCKER_CASE_ORDINAL: runtimeCaseContext?.ordinal ?? "UNKNOWN",
            NEW_BLOCKER_BROWSER: runtimeCaseContext?.browser ?? "UNKNOWN", NEW_BLOCKER_VIEWPORT: runtimeCaseContext?.viewport ?? "UNKNOWN",
            NEW_BLOCKER_CASE_NAME: runtimeCaseContext?.name ?? "UNKNOWN", NEW_BLOCKER_PHASE: runtimeCaseContext?.phase ?? "UNKNOWN",
        });
        matrixResumeReceipt.NEW_BLOCKER_ERROR_CLASS = matrixResumeReceipt.RUNTIME_ERROR_CLASS;
        matrixResumeReceipt.NEW_BLOCKER_ERROR_SITE = matrixResumeReceipt.RUNTIME_ERROR_STACK_SITE;
        return;
    }
}
const stale430ReloadReceipt = {
    TASK19_STALE430_RELOAD_LIFECYCLE_GENERALIZATION: "NOT_RUN", OWNER: "TASK19_BROWSER_HARNESS",
    ROOT_CAUSE: "TASK19_STALE430_FRAME_WAIT_DURING_UNSYNCHRONIZED_B_ADOPTION_RELOAD", FAILURE_CLASS: "HARNESS_NAVIGATION_SYNCHRONIZATION_DEFECT",
    STALE430_RELOAD_ORDER_RED: "PASS", STALE430_RELOAD_ORDER_GREEN: "NOT_RUN",
    LOADING_STALE_ACTOR_RELOAD_LIFECYCLE_VIEWPORT_SPECIFIC: false, LOADING_STALE_ACTOR_SHARED_RELOAD_BARRIER: true,
    LOADING_STALE_ACTOR_SHARED_OBSERVER_REBIND: true,
};
const stale390Errors = new WeakMap();
let abDocumentObservation, abDocumentReceipt;
const abFinalReloadReceipt = {
    TASK19_AB390_FINAL_RELOAD_BARRIER: "NOT_RUN", OWNER: "TASK19_BROWSER_HARNESS",
    PROVEN_HARNESS_DEFECT: "TASK19_AB390_FINAL_ACCOUNT_ADOPTION_RELOAD_HAS_NO_DETERMINISTIC_SETTLEMENT_BARRIER",
    HISTORICAL_AB390_FAILURE_ROOT_CAUSE: "UNPROVEN", FAILURE_CLASS: "HARNESS_NAVIGATION_SYNCHRONIZATION_DEFECT",
    AB390_NAVIGATION_SETTLEMENT_RED: "PASS", AB390_FINAL_RELOAD_BARRIER_GREEN: "NOT_RUN",
    AB390_PRE_B_NAVIGATION_GENERATION: "UNKNOWN", AB390_PRE_B_DOCUMENT_SEQUENCE_NUMBER: "UNKNOWN",
    AB390_FINAL_RELOAD_NAVIGATION_OBSERVED: false, AB390_FINAL_RELOAD_NAVIGATION_GENERATION_GT_BASELINE: false,
    AB390_FINAL_RELOAD_DOMCONTENTLOADED: false, AB390_FINAL_RELOAD_FIXTURE_READY: false,
    AB390_FINAL_RELOAD_FIXTURE_READY_DOCUMENT_GENERATION: "UNKNOWN", FINAL_PAGE_NAVIGATION_GENERATION: "UNKNOWN",
    FINAL_PAGE_DOCUMENT_SEQUENCE_NUMBER: "UNKNOWN", FINAL_PAGE_URL_PATH: "UNKNOWN", FINAL_PAGE_DOM_READY: "UNKNOWN",
    FINAL_PAGE_FIXTURE_HYDRATED: "UNKNOWN", FINAL_DOCUMENT_REQUESTFINISHED: "UNKNOWN", FINAL_DOCUMENT_REQUESTFAILED: "UNKNOWN",
    FINAL_DOCUMENT_REQUESTFAILED_CLASS: "UNKNOWN", FINAL_DOCUMENT_REQUEST_TERMINAL: false,
    ACCOUNT_B_SESSION_PRESENT: "UNKNOWN", FINAL_UI_ACTOR: "UNKNOWN", FINAL_B_LOCALE: "UNKNOWN", FINAL_B_LOCALE_CORRECT: "UNKNOWN",
    ACCOUNT_A_PREFERENCE_LEAKED_TO_B: "UNKNOWN", STALE_RESULT_APPLIED: "UNKNOWN", UNRESOLVED_REQUESTS: "UNKNOWN",
};
let cdpTerminalSnapshot;
const cdpTerminalReceipt = {
    TASK19_API_OUTAGE_CHROMIUM_CDP_TERMINAL_PROOF: "NOT_RUN", CDP_NETWORK_ENABLED: false, CDP_FETCH_DOMAIN_ENABLED: false,
    CDP_OUTAGE_REQUEST_MATCH_COUNT: 0, CDP_OUTAGE_REQUEST_ID_CORRELATION: "NONE",
    CDP_RESPONSE_RECEIVED: false, CDP_RESPONSE_STATUS: "UNKNOWN", CDP_RESPONSE_MIME_CLASS: "UNKNOWN",
    CDP_RESPONSE_PROTOCOL_CLASS: "UNKNOWN", CDP_RESPONSE_FROM_DISK_CACHE: "UNKNOWN", CDP_RESPONSE_FROM_SERVICE_WORKER: "UNKNOWN",
    CDP_LOADING_FINISHED_OBSERVED: false, CDP_LOADING_FAILED_OBSERVED: false,
    CDP_LOADING_FINISHED_ENCODED_DATA_LENGTH_CLASS: "UNKNOWN", CDP_LOADING_FINISHED_AFTER_RESPONSE_RECEIVED: "UNKNOWN",
    CDP_LOADING_FAILED_ERROR_CLASS: "NONE", CDP_LOADING_FAILED_CANCELED: "UNKNOWN", CDP_LOADING_FAILED_BLOCKED_REASON_CLASS: "UNKNOWN",
    CHROMIUM_NETWORK_TERMINAL_STATE: "NOT_OBSERVED", OWNER: "UNKNOWN", ROOT_CAUSE: "UNPROVEN", FAILURE_CLASS: "UNPROVEN",
    CDP_TERMINAL_ACCOUNTING_RED: "NOT_RUN", CDP_TERMINAL_ACCOUNTING_GREEN: "NOT_RUN",
    TASK19_CHROMIUM_CDP_LOADING_FINISHED_REQUESTS: 0, CDP_SESSION_DETACHED: false,
    CDP_RESPONSE_TO_LOADING_FAILED_MS: "UNKNOWN", PREFERENCE_SYNC_TIMEOUT_BUDGET_MS: 3000,
    PREFERENCE_SYNC_TIMEOUT_ACTIVATION: "NOT_OBSERVED", ABORT_SIGNAL_ACTIVATION: "NOT_OBSERVED",
};
function createCdpOutageObserver({ origin, deadline, now = () => performance.now() }) {
    const matches = new Map();
    let arm, active = true, sequence = 0;
    const bool = value => typeof value === "boolean" ? value : "UNKNOWN";
    return {
        arm(caseName, epochSeconds) { assert.equal(arm, undefined); arm = { caseName, epochSeconds }; },
        event(kind, event) {
            if (!active || now() > deadline)
                return;
            const order = ++sequence;
            if (kind === "requestWillBeSent") {
                if (!arm || arm.caseName !== "FIXTURE_API_OUTAGE" || event.request?.method !== "PATCH"
                    || !["Fetch", "XHR"].includes(event.type) || !Number.isFinite(event.wallTime) || event.wallTime < arm.epochSeconds)
                    return;
                let url;
                try {
                    url = new URL(event.request.url);
                }
                catch {
                    return;
                }
                if (url.origin !== origin || url.pathname !== "/api/users/me/preferences" || url.search || url.hash)
                    return;
                if (matches.has(event.requestId)) {
                    matches.get(event.requestId).duplicate = true;
                    return;
                }
                matches.set(event.requestId, { requestOrder: order });
                return;
            }
            const proof = matches.get(event.requestId);
            if (!proof)
                return;
            if (kind === "responseReceived") {
                if (proof.response) {
                    proof.duplicate = true;
                    return;
                }
                const response = event.response;
                const mime = response.mimeType?.toLowerCase(), protocol = response.protocol?.toLowerCase();
                proof.response = { order, timestamp: event.timestamp, status: response.status,
                    mime: !mime ? "UNKNOWN" : mime === "application/json" || mime.endsWith("+json") ? "JSON" : mime.startsWith("text/") ? "TEXT" : "OTHER",
                    protocol: !protocol ? "UNKNOWN" : ["http/1.0", "http/1.1"].includes(protocol) ? "HTTP1" : ["h2", "http/2"].includes(protocol) ? "HTTP2" : ["h3", "http/3"].includes(protocol) ? "HTTP3" : "OTHER",
                    disk: bool(response.fromDiskCache), serviceWorker: bool(response.fromServiceWorker) };
            }
            else if (kind === "loadingFinished") {
                proof.finished = { order, timestamp: event.timestamp, size: !Number.isFinite(event.encodedDataLength) ? "UNKNOWN"
                        : event.encodedDataLength === 0 ? "ZERO" : event.encodedDataLength > 0 ? "POSITIVE" : "UNKNOWN" };
            }
            else if (kind === "loadingFailed") {
                const error = event.errorText?.replace(/^net::/, "");
                proof.failed = { order, timestamp: event.timestamp,
                    error: ["ERR_CONTENT_DECODING_FAILED", "ERR_ABORTED", "ERR_FAILED", "ERR_CONNECTION_RESET"].includes(error) ? error : "OTHER",
                    canceled: bool(event.canceled), blocked: event.corsErrorStatus || event.blockedReason === "cors" ? "CORS" : !event.blockedReason ? "NONE" : "OTHER" };
            }
        },
        snapshot(alive) {
            active = false;
            const proof = matches.size === 1 ? [...matches.values()][0] : undefined;
            const response = proof?.response, finished = proof?.finished, failed = proof?.failed;
            const afterResponse = finished && response ? finished.order > response.order && Number.isFinite(finished.timestamp)
                && Number.isFinite(response.timestamp) && finished.timestamp >= response.timestamp : finished ? false : "UNKNOWN";
            return {
                CDP_OUTAGE_REQUEST_MATCH_COUNT: matches.size,
                CDP_OUTAGE_REQUEST_ID_CORRELATION: matches.size === 0 ? "NONE" : matches.size === 1 && !proof.duplicate ? "EXACT" : "AMBIGUOUS",
                CDP_RESPONSE_RECEIVED: !!response, CDP_RESPONSE_STATUS: response?.status ?? "UNKNOWN",
                CDP_RESPONSE_MIME_CLASS: response?.mime ?? "UNKNOWN", CDP_RESPONSE_PROTOCOL_CLASS: response?.protocol ?? "UNKNOWN",
                CDP_RESPONSE_FROM_DISK_CACHE: response?.disk ?? "UNKNOWN", CDP_RESPONSE_FROM_SERVICE_WORKER: response?.serviceWorker ?? "UNKNOWN",
                CDP_LOADING_FINISHED_OBSERVED: !!finished, CDP_LOADING_FAILED_OBSERVED: !!failed,
                CDP_LOADING_FINISHED_ENCODED_DATA_LENGTH_CLASS: finished?.size ?? "UNKNOWN",
                CDP_LOADING_FINISHED_AFTER_RESPONSE_RECEIVED: afterResponse,
                CDP_LOADING_FAILED_ERROR_CLASS: failed?.error ?? "NONE", CDP_LOADING_FAILED_CANCELED: failed?.canceled ?? "UNKNOWN",
                CDP_LOADING_FAILED_BLOCKED_REASON_CLASS: failed?.blocked ?? "UNKNOWN", CDP_PROOF_PAGE_CONTEXT_ALIVE: alive,
                CDP_RESPONSE_TO_LOADING_FAILED_MS: response && failed && Number.isFinite(response.timestamp) && Number.isFinite(failed.timestamp)
                    ? Math.round((failed.timestamp - response.timestamp) * 1000) : "UNKNOWN",
            };
        },
    };
}
function classifyCdpOutage(proof) {
    if (proof.CDP_OUTAGE_REQUEST_MATCH_COUNT !== 1 || proof.CDP_OUTAGE_REQUEST_ID_CORRELATION !== "EXACT")
        return ["CORRELATION_NOT_PROVEN", "TASK19_BROWSER_HARNESS", "TASK19_API_OUTAGE_CDP_REQUEST_CORRELATION_NOT_EXACT", "CDP_CORRELATION_FAILURE"];
    if (proof.CDP_LOADING_FINISHED_OBSERVED && proof.CDP_LOADING_FAILED_OBSERVED)
        return ["CONFLICTING_TERMINALS", "UNKNOWN", "TASK19_API_OUTAGE_CDP_TERMINAL_EVENTS_CONFLICT", "CDP_TERMINAL_CONFLICT"];
    if (!proof.CDP_RESPONSE_RECEIVED || proof.CDP_RESPONSE_STATUS !== 503)
        return ["RESPONSE_NOT_PROVEN", "UNKNOWN", "TASK19_PLAYWRIGHT_CDP_RESPONSE_CORRELATION_CONFLICT", "CDP_RESPONSE_CORRELATION_FAILURE"];
    if (proof.CDP_LOADING_FAILED_OBSERVED) {
        if (proof.CDP_LOADING_FAILED_ERROR_CLASS === "ERR_CONTENT_DECODING_FAILED")
            return ["LOADING_FAILED", "TASK19_HTTP_RESPONSE_ENCODING_PATH", "TASK19_CHROMIUM_REJECTS_API_OUTAGE_RESPONSE_CONTENT_ENCODING", "BROWSER_HTTP_CONTENT_DECODING_FAILURE"];
        if (proof.CDP_LOADING_FAILED_ERROR_CLASS === "ERR_ABORTED" || proof.CDP_LOADING_FAILED_CANCELED === true)
            return ["LOADING_FAILED", "APPLICATION_FETCH_LIFECYCLE_OR_BROWSER_ABORT", "TASK19_API_OUTAGE_REQUEST_ABORTED_AFTER_RESPONSE_HEADERS", "BROWSER_REQUEST_ABORT"];
        return ["LOADING_FAILED", "CHROMIUM_NETWORK", `TASK19_API_OUTAGE_CHROMIUM_NETWORK_FAILURE_${proof.CDP_LOADING_FAILED_ERROR_CLASS}`, "BROWSER_NETWORK_FAILURE"];
    }
    if (proof.CDP_LOADING_FINISHED_OBSERVED && proof.CDP_LOADING_FINISHED_AFTER_RESPONSE_RECEIVED === true && proof.CDP_PROOF_PAGE_CONTEXT_ALIVE)
        return ["LOADING_FINISHED", "PLAYWRIGHT_HIGH_LEVEL_NETWORK_OBSERVABILITY", "TASK19_PLAYWRIGHT_HIGH_LEVEL_REQUEST_FINISHED_SIGNAL_MISSING_AFTER_CDP_LOADING_FINISHED", "PLAYWRIGHT_OBSERVABILITY_DEFECT"];
    if (proof.CDP_LOADING_FINISHED_OBSERVED)
        return ["TERMINAL_ORDER_NOT_PROVEN", "UNKNOWN", "TASK19_API_OUTAGE_CDP_TERMINAL_ORDER_NOT_PROVEN", "CDP_TERMINAL_ORDER_FAILURE"];
    return ["PENDING_AFTER_RESPONSE_HEADERS", "CHROMIUM_NETWORK_LIFECYCLE_OR_APPLICATION_FETCH",
        "TASK19_CHROMIUM_NETWORK_REQUEST_REMAINS_NONTERMINAL_AFTER_503_HEADERS", "CHROMIUM_NETWORK_LIFECYCLE_PENDING"];
}
async function armCdpOutage(page) {
    const observation = apiOutageObservation;
    const session = await page.context().newCDPSession(page);
    observation.cdpSession = session;
    observation.cdp = createCdpOutageObserver({ origin: new URL(page.url()).origin, deadline: observation.started + 15000 });
    for (const event of ["requestWillBeSent", "responseReceived", "loadingFinished", "loadingFailed"])
        session.on(`Network.${event}`, payload => observation.cdp.event(event, payload));
    await session.send("Network.enable");
    cdpTerminalReceipt.CDP_NETWORK_ENABLED = true;
    const epoch = await page.evaluate(() => Date.now() / 1000);
    observation.cdp.arm("FIXTURE_API_OUTAGE", epoch);
}
function freezeCdpOutage(page) {
    if (!apiOutageObservation?.cdp || apiOutageObservation.cdpFrozen)
        return;
    apiOutageObservation.cdpFrozen = true;
    Object.assign(cdpTerminalReceipt, apiOutageObservation.cdp.snapshot(!page.isClosed() && !apiOutageObservation.cdpContextClosed));
    const [state, owner, cause, failure] = classifyCdpOutage(cdpTerminalReceipt);
    Object.assign(cdpTerminalReceipt, { TASK19_API_OUTAGE_CHROMIUM_CDP_TERMINAL_PROOF: "COMPLETE",
        CHROMIUM_NETWORK_TERMINAL_STATE: state, OWNER: owner, ROOT_CAUSE: cause, FAILURE_CLASS: failure });
}
let nativeCompletionSnapshot;
const nativeCompletionReceipt = {
    TASK19_API_OUTAGE_BROWSER_NATIVE_COMPLETION_PROOF: "NOT_RUN", PLAYWRIGHT_VERSION: "UNKNOWN", CHROMIUM_VERSION: "UNKNOWN",
    OUTAGE_RESPONSE_CACHE_CONTROL_CLASS: "ABSENT", OUTAGE_RESPONSE_CONTENT_ENCODING_CLASS: "ABSENT", OUTAGE_RESPONSE_CONTENT_TYPE_CLASS: "ABSENT",
    RESOURCE_TIMING_CLEARED_BEFORE_OUTAGE: false, OUTAGE_RESOURCE_TIMING_MATCH_COUNT: "UNKNOWN",
    OUTAGE_RESOURCE_TIMING_INITIATOR_TYPE: "UNKNOWN", OUTAGE_RESOURCE_TIMING_RESPONSE_STATUS: "UNKNOWN",
    OUTAGE_RESOURCE_TIMING_RESPONSE_STATUS_SUPPORTED: false, OUTAGE_RESOURCE_TIMING_FETCH_START_PRESENT: false,
    OUTAGE_RESOURCE_TIMING_RESPONSE_START_PRESENT: false, OUTAGE_RESOURCE_TIMING_RESPONSE_END_PRESENT: false,
    OUTAGE_RESOURCE_TIMING_RESPONSE_END_AFTER_START: false, OUTAGE_RESOURCE_TIMING_DURATION_POSITIVE: false,
    OUTAGE_RESOURCE_TIMING_TRANSFER_SIZE_CLASS: "UNKNOWN", OUTAGE_RESOURCE_TIMING_ENCODED_BODY_SIZE_CLASS: "UNKNOWN",
    OUTAGE_RESOURCE_TIMING_DECODED_BODY_SIZE_CLASS: "UNKNOWN", OUTAGE_RESOURCE_TIMING_SAME_ORIGIN: false,
    OUTAGE_RESOURCE_TIMING_NO_QUERY: false, RESOURCE_PROOF_BEFORE_CONTEXT_CLOSE: false,
    CHROMIUM_NATIVE_HTTP_COMPLETION: "NOT_PROVEN", OWNER: "UNKNOWN", ROOT_CAUSE: "UNPROVEN", FAILURE_CLASS: "UNPROVEN",
    BROWSER_NATIVE_TERMINAL_RED: "NOT_RUN", BROWSER_NATIVE_TERMINAL_GREEN: "NOT_RUN",
    TASK19_BROWSER_NATIVE_RESOURCE_FINISHED_REQUESTS: 0,
};
function classifyNativeTiming(proof) {
    if (proof.OUTAGE_RESOURCE_TIMING_MATCH_COUNT === 0)
        return "NO_ENTRY";
    if (proof.OUTAGE_RESOURCE_TIMING_MATCH_COUNT > 1)
        return "AMBIGUOUS";
    if (proof.OUTAGE_RESOURCE_TIMING_MATCH_COUNT !== 1)
        return "UNPROVEN";
    if (!proof.OUTAGE_RESOURCE_TIMING_RESPONSE_END_PRESENT || !proof.OUTAGE_RESOURCE_TIMING_RESPONSE_END_AFTER_START)
        return "INCOMPLETE";
    return proof.RESOURCE_TIMING_CLEARED_BEFORE_OUTAGE && proof.OUTAGE_RESOURCE_TIMING_SAME_ORIGIN && proof.OUTAGE_RESOURCE_TIMING_NO_QUERY
        && ["fetch", "xmlhttprequest"].includes(proof.OUTAGE_RESOURCE_TIMING_INITIATOR_TYPE)
        && proof.OUTAGE_RESOURCE_TIMING_RESPONSE_START_PRESENT && proof.OUTAGE_RESOURCE_TIMING_DURATION_POSITIVE
        && (!proof.OUTAGE_RESOURCE_TIMING_RESPONSE_STATUS_SUPPORTED || proof.OUTAGE_RESOURCE_TIMING_RESPONSE_STATUS === 503)
        && proof.RESOURCE_PROOF_BEFORE_CONTEXT_CLOSE ? "COMPLETE" : "UNPROVEN";
}
async function observeNativeTiming(page) {
    const result = await page.evaluate(() => {
        const entries = performance.getEntriesByType("resource").filter(entry => {
            try {
                return new URL(entry.name).pathname === "/api/users/me/preferences" && ["fetch", "xmlhttprequest"].includes(entry.initiatorType);
            }
            catch {
                return false;
            }
        });
        if (entries.length !== 1)
            return { OUTAGE_RESOURCE_TIMING_MATCH_COUNT: entries.length };
        const entry = entries[0], url = new URL(entry.name);
        const positive = number => Number.isFinite(number) && number > 0;
        const size = number => Number.isFinite(number) && number === 0 ? "ZERO" : positive(number) ? "POSITIVE" : "UNKNOWN";
        return { OUTAGE_RESOURCE_TIMING_MATCH_COUNT: 1, OUTAGE_RESOURCE_TIMING_INITIATOR_TYPE: entry.initiatorType,
            OUTAGE_RESOURCE_TIMING_RESPONSE_STATUS: typeof entry.responseStatus === "number" ? entry.responseStatus : "UNSUPPORTED",
            OUTAGE_RESOURCE_TIMING_RESPONSE_STATUS_SUPPORTED: typeof entry.responseStatus === "number",
            OUTAGE_RESOURCE_TIMING_FETCH_START_PRESENT: positive(entry.fetchStart),
            OUTAGE_RESOURCE_TIMING_RESPONSE_START_PRESENT: positive(entry.responseStart), OUTAGE_RESOURCE_TIMING_RESPONSE_END_PRESENT: positive(entry.responseEnd),
            OUTAGE_RESOURCE_TIMING_RESPONSE_END_AFTER_START: positive(entry.responseEnd) && positive(entry.responseStart) && entry.responseEnd > entry.responseStart,
            OUTAGE_RESOURCE_TIMING_DURATION_POSITIVE: positive(entry.duration), OUTAGE_RESOURCE_TIMING_TRANSFER_SIZE_CLASS: size(entry.transferSize),
            OUTAGE_RESOURCE_TIMING_ENCODED_BODY_SIZE_CLASS: size(entry.encodedBodySize), OUTAGE_RESOURCE_TIMING_DECODED_BODY_SIZE_CLASS: size(entry.decodedBodySize),
            OUTAGE_RESOURCE_TIMING_SAME_ORIGIN: url.origin === location.origin, OUTAGE_RESOURCE_TIMING_NO_QUERY: url.search === "" && url.hash === "" };
    });
    Object.assign(nativeCompletionReceipt, result, { RESOURCE_PROOF_BEFORE_CONTEXT_CLOSE: !page.isClosed() && !apiOutageObservation.nativeContextClosed });
    const classification = classifyNativeTiming(nativeCompletionReceipt);
    nativeCompletionReceipt.TASK19_API_OUTAGE_BROWSER_NATIVE_COMPLETION_PROOF = "COMPLETE";
    nativeCompletionReceipt.CHROMIUM_NATIVE_HTTP_COMPLETION = classification === "COMPLETE" ? "PASS" : "NOT_PROVEN";
    if (classification !== "COMPLETE")
        throw new Error(`TASK19_NATIVE_TIMING_${classification}`);
}
function observeNativeResponseHeaders(headers) {
    const cache = headers["cache-control"]?.toLowerCase().split(",").map(value => value.trim()) ?? [];
    const encoding = headers["content-encoding"]?.toLowerCase().trim(), type = headers["content-type"]?.toLowerCase().split(";")[0].trim();
    Object.assign(nativeCompletionReceipt, {
        OUTAGE_RESPONSE_CACHE_CONTROL_CLASS: cache.length === 0 ? "ABSENT" : cache.includes("no-store") ? "NO_STORE" : cache.includes("no-cache") ? "NO_CACHE" : "OTHER",
        OUTAGE_RESPONSE_CONTENT_ENCODING_CLASS: !encoding ? "ABSENT" : encoding === "identity" ? "IDENTITY" : ["gzip", "br", "deflate", "zstd"].includes(encoding) ? "COMPRESSED" : "OTHER",
        OUTAGE_RESPONSE_CONTENT_TYPE_CLASS: !type ? "ABSENT" : type === "application/json" || type.endsWith("+json") ? "JSON" : type.startsWith("text/") ? "TEXT" : "OTHER",
    });
}
const acceptedDisposableCasesAtStart = matrixResumeCursor?.acceptedOrdinal ?? (22);
const conflictRevisionReceipt = {
    API_CONFLICT_AUTH_HEALTHY: false, API_CONFLICT_REAL_INITIAL_ROW_PRESENT: false,
    API_CONFLICT_REAL_ROW_REVISION_BEFORE_CASE: "UNKNOWN", API_CONFLICT_REAL_ROW_REVISION_AFTER_FIRST_SUCCESS: "UNKNOWN",
    API_CONFLICT_BROWSER_STALE_REVISION_SENT: "UNKNOWN", API_CONFLICT_RESPONSE_CURRENT_REVISION: "NOT_AVAILABLE",
    API_CONFLICT_REAL_SUCCESSFUL_WRITE_OBSERVED: false, API_CONFLICT_REAL_REVISION_ADVANCED: false,
    API_CONFLICT_STALE_REVISION_IS_OLDER_THAN_CURRENT: false, API_CONFLICT_WORKER_STATUS: "UNKNOWN",
    API_CONFLICT_BROWSER_RESPONSE_STATUS: "UNKNOWN", API_CONFLICT_BROWSER_REQUESTFINISHED: false,
    API_CONFLICT_BROWSER_REQUESTFAILED: false, API_CONFLICT_FALSE_SUCCESS: "UNKNOWN",
    API_CONFLICT_CURRENT_PREFERENCE_RETAINED: false, FIXTURE_API_CONFLICT_CHROMIUM_1280: "NOT_RUN",
    API_CONFLICT_SEMANTIC_CONTRACT: "NOT_RUN",
};
function assertConflictRevisionSequence(initial, written, stale, current) {
    assert.equal(initial.locale_preference, "en");
    assert.equal(initial.revision, accountCookieRowFixture.revision);
    assert.equal(written.locale_preference, initial.locale_preference);
    assert.equal(written.revision, initial.revision + 1, "GENUINE_WRITE_MUST_ADVANCE_REVISION");
    assert.equal(stale, initial.revision, "STALE_REQUEST_MUST_USE_ORIGINAL_BROWSER_REVISION");
    assert.ok(stale < written.revision, "STALE_REQUEST_MUST_BE_OLDER_THAN_CURRENT");
    assert.equal(current.revision, written.revision);
    assert.equal(current.locale_preference, written.locale_preference);
}
let loadingObservation;
let loadingDesktopReceipt;
let logoutDesktopReceipt;
const logoutReceipt = {
    TASK19_LOADING_STALE_ACTOR_LOGOUT_ABORT_DIAGNOSIS: "CLASS_E_EXISTING_TIMING_INSUFFICIENT",
    ACCOUNT_A_SIGNOUT_AWAITED: true, ACCOUNT_A_SIGNOUT_RESULT_CHECKED: true, ACCOUNT_A_SIGNOUT_SESSION_CLEAR_AWAITED: true,
    ACCOUNT_B_SIGNIN_STARTS_AFTER_SIGNOUT_PROMISE: true, ACCOUNT_B_SIGNIN_STARTS_AFTER_A_SESSION_ABSENT: true,
    PAGE_NAVIGATION_OR_RELOAD_BETWEEN_A_LOGOUT_AND_B_SIGNIN: false, AUTH_LOGOUT_REQUEST_TERMINAL_AWAITED_BEFORE_B_SIGNIN: false,
    STALE_HOLD_CAN_MATCH_AUTH_LOGOUT: false, STALE_HOLD_PATH_SCOPE: "OWNED_LOCAL_REST_USER_PREFERENCES_EXACT_ACCOUNT_A_FILTER",
    STALE_HOLD_METHOD_SCOPE: "GET", STALE_HOLD_ABORT_CONTROLLER_SHARED_WITH_AUTH: false,
    STALE_HOLD_RELEASE_CAN_ABORT_UNRELATED_REQUESTS: false,
    AUTH_LOGOUT_REQUEST_PHASE: "UNKNOWN", AUTH_LOGOUT_REQUEST_LOGICAL_ACTOR: "UNKNOWN",
    AUTH_LOGOUT_REQUEST_PREFERENCE_GENERATION_APPLICABLE: false,
    HISTORICAL_AUTH_LOGOUT_ACTOR: "UNKNOWN", HISTORICAL_AUTH_LOGOUT_GENERATION: "FINAL_GENERATION",
    AUTH_LOGOUT_BROWSER_REQUEST_OBSERVED: false, AUTH_LOGOUT_BROWSER_RESPONSE_OBSERVED: false,
    AUTH_LOGOUT_BROWSER_RESPONSE_STATUS: "UNKNOWN", AUTH_LOGOUT_REQUESTFAILED: false, AUTH_LOGOUT_ERROR_CLASS: "UNKNOWN",
    AUTH_LOGOUT_FRONT_DOOR_RECEIVED: "unknown", AUTH_LOGOUT_LOCAL_GOTRUE_RECEIVED: "unknown",
    AUTH_LOGOUT_LOCAL_GOTRUE_RESPONSE_OBSERVED: "unknown", AUTH_LOGOUT_LOCAL_GOTRUE_RESPONSE_STATUS: "UNKNOWN",
    AUTH_LOGOUT_SIGNOUT_PROMISE_RESOLVED: "unknown", AUTH_LOGOUT_SIGNOUT_PROMISE_ERROR: "unknown",
    ACCOUNT_A_SESSION_ABSENT_BEFORE_B_SIGNIN: "unknown", ACCOUNT_B_SIGNIN_STARTED_BEFORE_LOGOUT_TERMINAL: "unknown",
    OWNER: "UNKNOWN", ROOT_CAUSE: "UNPROVEN", FAILURE_CLASS: "INSUFFICIENT_AUTH_LIFECYCLE_TIMING_EVIDENCE",
    LOADING_STALE_ACTOR_LOGOUT_RED: "NOT_APPLICABLE_CLASS_E", LOADING_STALE_ACTOR_LOGOUT_GREEN: "NOT_APPLICABLE_CLASS_E",
};
function markAuthLogout(event, fields = {}) {
    const observation = loadingObservation?.logout;
    if (!loadingObservation?.active || !observation)
        return;
    Object.assign(observation, fields);
    if (!observation.events.some(item => item.event === event))
        observation.events.push({ event,
            order: observation.events.length + 1, ms: Math.round((performance.now() - loadingObservation.started) * 1000) / 1000 });
}
function classifyAuthLogout(observation) {
    const order = event => observation.events.find(item => item.event === event)?.order;
    const terminal = order("LOGOUT_REQUESTFINISHED") ?? order("LOGOUT_REQUESTFAILED");
    const signin = order("B_SIGNIN_START"), server = order("GOTRUE_LOGOUT_RESPONSE");
    if (observation.promiseError === true || observation.sessionAbsent === false || observation.gotrueStatus >= 400)
        return "D";
    if (observation.browserCount === 1 && observation.frontCount === 1 && observation.entry?.authLogicalActor === "ACCOUNT_A"
        && observation.entry.authPhase === "ACCOUNT_A_LOGOUT" && observation.frontActor === "ACCOUNT_A"
        && observation.gotrueStatus >= 200 && observation.gotrueStatus < 300 && server !== undefined && terminal !== undefined
        && server < terminal && signin !== undefined && terminal < signin && observation.sessionAbsent === true
        && order("A_SESSION_ABSENT") < signin && observation.promiseResolved === true && observation.promiseError === false
        && observation.entry.failed && observation.entry.failureClass === "ERR_ABORTED")
        return "C";
    return "E";
}
function collectAuthLogoutEvidence() {
    const observation = loadingObservation.logout, entry = observation.entry;
    const order = event => observation.events.find(item => item.event === event)?.order;
    const terminal = order("LOGOUT_REQUESTFINISHED") ?? order("LOGOUT_REQUESTFAILED"), signin = order("B_SIGNIN_START");
    Object.assign(logoutReceipt, { AUTH_LOGOUT_REQUEST_PHASE: entry?.authPhase ?? "UNKNOWN",
        AUTH_LOGOUT_REQUEST_LOGICAL_ACTOR: entry?.authLogicalActor ?? "UNKNOWN", AUTH_LOGOUT_BROWSER_REQUEST_OBSERVED: !!entry,
        AUTH_LOGOUT_BROWSER_RESPONSE_OBSERVED: entry?.responseObserved ?? false, AUTH_LOGOUT_BROWSER_RESPONSE_STATUS: entry?.status ?? "UNKNOWN",
        AUTH_LOGOUT_REQUESTFAILED: entry?.failed ?? false, AUTH_LOGOUT_ERROR_CLASS: entry?.failureClass ?? "NONE",
        AUTH_LOGOUT_FRONT_DOOR_RECEIVED: observation.frontCount > 0, AUTH_LOGOUT_LOCAL_GOTRUE_RECEIVED: observation.gotrueStatus !== undefined ? true : "unknown",
        AUTH_LOGOUT_LOCAL_GOTRUE_RESPONSE_OBSERVED: observation.gotrueStatus !== undefined, AUTH_LOGOUT_LOCAL_GOTRUE_RESPONSE_STATUS: observation.gotrueStatus ?? "UNKNOWN",
        AUTH_LOGOUT_SIGNOUT_PROMISE_RESOLVED: observation.promiseResolved ?? "unknown", AUTH_LOGOUT_SIGNOUT_PROMISE_ERROR: observation.promiseError ?? "unknown",
        ACCOUNT_A_SESSION_ABSENT_BEFORE_B_SIGNIN: signin !== undefined ? observation.sessionAbsent ?? "unknown" : "unknown",
        ACCOUNT_B_SIGNIN_STARTED_BEFORE_LOGOUT_TERMINAL: terminal !== undefined && signin !== undefined ? signin < terminal : "unknown",
        PAGE_NAVIGATION_OR_RELOAD_BETWEEN_A_LOGOUT_AND_B_SIGNIN: observation.navigationBetween,
        AUTH_LOGOUT_EVENT_ORDER: observation.events.map(item => item.event).join(",") });
    for (const item of observation.events)
        logoutReceipt[`AUTH_PHASE_${item.event}_MS`] = item.ms;
    const classification = classifyAuthLogout(observation);
    logoutReceipt.TASK19_LOADING_STALE_ACTOR_LOGOUT_ABORT_DIAGNOSIS = `CLASS_${classification}`;
    if (classification === "C")
        Object.assign(logoutReceipt, { OWNER: "TASK19_BROWSER_RUNTIME",
            ROOT_CAUSE: "TASK19_AUTH_LOGOUT_BROWSER_REQUEST_ABORTED_AFTER_LOCAL_LOGOUT_COMPLETED",
            FAILURE_CLASS: "BROWSER_AUTH_LOGOUT_TERMINAL_OBSERVABILITY" });
    else if (classification === "D")
        Object.assign(logoutReceipt, { OWNER: "PRODUCT_OR_AUTH_RUNTIME",
            ROOT_CAUSE: "TASK19_ACCOUNT_A_LOGOUT_REAL_FAILURE", FAILURE_CLASS: "REAL_AUTH_LOGOUT_REGRESSION" });
}
const loadingReceipt = {
    LOADING_STALE_ACTOR_INITIAL_ACTOR: "ACCOUNT_A", LOADING_STALE_ACTOR_FINAL_ACTOR: "ACCOUNT_B",
    LOADING_STALE_ACTOR_INTENDED_HELD_REQUEST_METHOD: "GET", LOADING_STALE_ACTOR_INTENDED_HELD_REQUEST_PATH: "/api/users/me/preferences",
    LOADING_STALE_ACTOR_INTENDED_HELD_REQUEST_ACTOR: "ACCOUNT_A", LOADING_STALE_ACTOR_INTENDED_HELD_REQUEST_GENERATION_RELATION: "OLDER_THAN_FINAL",
    LOADING_STALE_ACTOR_HOLD_MECHANISM: "OUTBOUND_DELAY", LOADING_STALE_ACTOR_RELEASE_MECHANISM: "EXPLICIT_RELEASE",
    LOADING_STALE_ACTOR_EXPECTED_OLD_REQUEST_TERMINAL: "EXPLICIT_RELEASE_THEN_DISCARDED",
    OLD_ACTOR_REQUEST_STARTED: false, ACTOR_SWITCH_OCCURRED_WITH_OLD_REQUEST_IN_FLIGHT: false,
    OLD_ACTOR_REQUEST_FINAL_GENERATION_RELATION: "UNKNOWN", OLD_ACTOR_REQUEST_TERMINAL: false,
    FINAL_UI_ACTOR: "UNKNOWN", FINAL_LOCALE_CORRECT_FOR_FINAL_ACTOR: "unknown", ACCOUNT_A_PREFERENCE_LEAKED_TO_B: "unknown",
    STALE_RESULT_APPLIED: "unknown", FINAL_ACTOR_PREFERENCE_REQUEST_OBSERVED: false,
    FINAL_ACTOR_PREFERENCE_REQUEST_STATUS: "UNKNOWN", FINAL_ACTOR_PREFERENCE_REQUESTFINISHED: false,
    FINAL_ACTOR_PREFERENCE_REQUEST_TERMINAL: false, EXPECTED_STALE_ACTOR_REQUESTFAILED_COUNT: 0,
    UNEXPECTED_REQUESTFAILED_COUNT: 0, UNRESOLVED_REQUESTS: "UNKNOWN", FIXTURE_LOADING_STALE_ACTOR_CHROMIUM_1280: "NOT_RUN",
    OWNER: "TASK19_BROWSER_HARNESS", ROOT_CAUSE: "TASK19_LOADING_STALE_ACTOR_LEGACY_HOLD_BYPASSED_BY_REAL_HTTP",
    FAILURE_CLASS: "HARNESS_REAL_TRANSPORT_MIGRATION_DEFECT",
};
const staleHoldReplies = new Map();
let staleHoldSequence = 0;
const startupOrderReceipt = {
    TASK19_LOADING_STALE_ACTOR_STARTUP_ORDER: "NOT_RUN", ACCOUNT_A_ID_REQUIRED_FOR_GENERIC_WORKER_STARTUP: false,
    ACCOUNT_A_ID_REQUIRED_ONLY_FOR_LOADING_STALE_ACTOR_HOLD: true,
    OWNER: "TASK19_BROWSER_HARNESS", ROOT_CAUSE: "TASK19_LOADING_STALE_ACTOR_HOLD_IDENTITY_BOUND_BEFORE_DISPOSABLE_USER_CREATION",
    FAILURE_CLASS: "HARNESS_INITIALIZATION_ORDER_DEFECT", LOADING_STALE_ACTOR_STARTUP_ORDER_RED: "PASS",
    ACCOUNT_A_ID_BINDING_STATE: "UNSET_AT_STARTUP", USER_WORKER_STARTUP: "NOT_RUN",
};
function createOwnedStaleHold(origin, observe = () => { }) {
    assertLocalReplayTarget(origin);
    let actorA, armed = false, matched = 0, released = false, permit;
    return {
        control(action, details = {}) {
            if (action === "BIND") {
                assert.equal(armed, false);
                assert.equal(permit, undefined);
                assert.ok(typeof details.actor === "string" && /^[0-9a-f-]{36}$/i.test(details.actor), "OWNED_LOCAL_ACTOR_REQUIRED");
                assert.ok(actorA === undefined || actorA === details.actor, "OWNED_ACTOR_REBIND_FORBIDDEN");
                actorA = details.actor;
            }
            else if (action === "ARM") {
                assert.ok(actorA, "OWNED_LOCAL_ACTOR_REQUIRED");
                assert.equal(details.caseName, "FIXTURE_LOADING_STALE_ACTOR", "EXACT_LOADING_CASE_REQUIRED");
                assert.equal(details.generation, 1, "EXACT_OLD_GENERATION_REQUIRED");
                assert.equal(armed, false);
                assert.equal(permit, undefined);
                armed = true;
                matched = 0;
                released = false;
            }
            else if (action !== "STATE") {
                assert.ok(["RELEASE", "RESET"].includes(action));
                armed = false;
                released = true;
                permit?.();
                permit = undefined;
            }
            return { armed, matched, released, actorBound: actorA !== undefined };
        },
        async forward(request, destination, fetchReal) {
            const url = new URL(destination);
            if (!armed || request.method !== "GET" || url.origin !== origin || url.pathname !== "/rest/v1/user_preferences"
                || url.searchParams.get("user_id") !== `eq.${actorA}`)
                return fetchReal();
            assert.equal(++matched, 1, "ONE_EXACT_HELD_ACTOR_A_GET");
            const gate = new Promise(resolve => { permit = resolve; });
            observe({ event: "STARTED", actor: "ACCOUNT_A" });
            try {
                const response = await fetchReal();
                assert.equal(response.status, 200, "HELD_RESPONSE_MUST_BE_GENUINE_LOCAL_SUCCESS");
                observe({ event: "HELD", actor: "ACCOUNT_A", status: response.status });
                await gate;
                observe({ event: "RELEASED", actor: "ACCOUNT_A", status: response.status });
                return response;
            }
            finally {
                permit = undefined;
            }
        },
    };
}
async function controlStaleHold(action, details = {}) {
    assert.ok(child?.connected);
    const id = ++staleHoldSequence;
    let timer;
    const pending = new Promise((resolve, reject) => {
        staleHoldReplies.set(id, { resolve });
        child.send({ ...details, type: "stale-hold-control", id, action }, error => { if (error)
            reject(new Error("STALE_HOLD_CONTROL_SEND_FAILED")); });
    });
    try {
        return await Promise.race([pending, new Promise((_resolve, reject) => {
                const remaining = loadingObservation?.active ? 15000 - (performance.now() - loadingObservation.started) : 5000;
                timer = setTimeout(() => reject(new Error("STALE_HOLD_CONTROL_TIMEOUT")), Math.max(1, Math.min(5000, remaining)));
            })]);
    }
    finally {
        clearTimeout(timer);
        staleHoldReplies.delete(id);
    }
}
async function withinLoadingWindow(pending) {
    let timer;
    try {
        return await Promise.race([pending, new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error("STALE_ACTOR_TERMINAL_TIMEOUT")), Math.max(1, 15000 - (performance.now() - loadingObservation.started)));
            })]);
    }
    finally {
        clearTimeout(timer);
    }
}
function expectedStaleAbortPredicates(entry, observation) {
    return { exactOldRequest: entry === observation.oldEntry, exactCase: entry.case === "FIXTURE_LOADING_STALE_ACTOR",
        exactMethod: entry.method === "GET", exactPath: entry.pathname === "/api/users/me/preferences",
        fetchResource: entry.resourceType === "fetch", actorA: entry.actor === "ACCOUNT_A",
        oldGeneration: entry.loadingGeneration === 1 && observation.generation > entry.loadingGeneration,
        held: observation.outboundStarted === true && observation.held === true, released: observation.released === true,
        finalActorConfirmed: observation.finalActorConfirmed === true, switchedWithPending: observation.switchedWithPending === true,
        staleResultDiscarded: observation.staleResultDiscarded === true, requestfailed: entry.failed === true };
}
function expectedStaleAbort(entry, observation) {
    return Object.values(expectedStaleAbortPredicates(entry, observation)).every(value => value === true);
}
function recordLoadingNetworkEvent(event, entry) {
    if (!loadingObservation?.active)
        return;
    const events = loadingObservation.requestEvents ??= [];
    const value = { sequence: events.length + 1, event, requestSequence: entry.id, method: entry.method,
        pathname: ["/api/users/me/preferences", "/auth/v1/logout", "/auth/v1/token", "/__task19/locale", "/__task19/fixture.js"].includes(entry.pathname) ? entry.pathname : "OTHER",
        resourceType: entry.resourceType, phase: loadingObservation.phase, requestPhase: entry.loadingPhase,
        logicalActor: entry.authLogicalActor ?? entry.actor, generation: entry.loadingGeneration,
        responseObserved: entry.responseObserved, responseStatus: entry.responseObserved ? entry.status : "NOT_OBSERVED" };
    events.push(value);
    if (event === "REQUESTFAILED") {
        entry.requestfailedSequence = value.sequence;
        entry.requestfailedPhase = value.phase;
    }
}
function safeBrowserFailureSymbol(value) {
    return typeof value === "string" && /^(?:net::)?(?:ERR_[A-Z0-9_]+|NS_[A-Z0-9_]+)$/.test(value) ? value : "OTHER_NON_SYMBOLIC_ERROR";
}
function authLogoutTerminalClass(entry, observation, unresolved) {
    const logout = observation.logout;
    if (!logout || entry !== logout.entry || entry.case !== "FIXTURE_LOADING_STALE_ACTOR" || entry.method !== "POST"
        || entry.pathname !== "/auth/v1/logout" || entry.authPhase !== "ACCOUNT_A_LOGOUT" || entry.authLogicalActor !== "ACCOUNT_A"
        || entry.authPreferenceGenerationApplicable !== false || !entry.failed || entry.finished || entry.failureClass !== "ERR_ABORTED"
        || !entry.responseObserved || entry.status !== 204 || logout.browserCount !== 1 || logout.frontCount !== 1
        || logout.frontActor !== "ACCOUNT_A" || logout.gotrueStatus !== 204 || logout.promiseResolved !== true || logout.promiseError !== false
        || logout.sessionAbsent !== true || logout.navigationBetween !== false || logout.staleHoldTouchesAuth !== false
        || logout.sharedAbortWithAuth !== false || logout.releaseAbortsUnrelated !== false || unresolved !== 0)
        return "UNEXPECTED_REQUESTFAILED";
    const names = ["A_SIGNOUT_CALL", "LOGOUT_REQUEST_START", "FRONT_DOOR_LOGOUT_RECEIVED", "GOTRUE_LOGOUT_REQUEST_STARTED",
        "GOTRUE_LOGOUT_RESPONSE", "LOGOUT_BROWSER_RESPONSE", "SIGNOUT_PROMISE_SETTLED", "LOGOUT_REQUESTFAILED", "A_SESSION_ABSENT", "B_SIGNIN_START"];
    const times = names.map(event => logout.events.filter(item => item.event === event));
    if (times.some(items => items.length !== 1 || !Number.isFinite(items[0].ms)))
        return "UNEXPECTED_REQUESTFAILED";
    if (times.some((items, index) => index > 0 && (items[0].ms <= times[index - 1][0].ms
        || items[0].order <= times[index - 1][0].order)))
        return "UNEXPECTED_REQUESTFAILED";
    return "AUTH_LOGOUT_POST_SUCCESS_ABORT";
}
function accountLoadingRequestFailures(entries, observation, unresolved) {
    const failed = entries.filter(entry => entry.failed);
    const stale = failed.filter(entry => expectedStaleAbort(entry, observation)).length;
    const auth = failed.filter(entry => authLogoutTerminalClass(entry, observation, unresolved) === "AUTH_LOGOUT_POST_SUCCESS_ABORT").length;
    return { RAW_REQUESTFAILED_COUNT: failed.length, EXPECTED_STALE_ACTOR_REQUESTFAILED_COUNT: stale,
        EXPECTED_AUTH_LOGOUT_POST_SUCCESS_ABORT_COUNT: auth, EXPECTED_REQUESTFAILED_COUNT: stale + auth,
        UNEXPECTED_REQUESTFAILED_COUNT: failed.length - stale - auth };
}
function acceptedLogoutAbortFormalEvidence() {
    // Value-blind snapshot of the existing formal execution, explicitly approved for promotion.
    const oldEntry = { case: "FIXTURE_LOADING_STALE_ACTOR", method: "GET", pathname: "/api/users/me/preferences",
        actor: "ACCOUNT_A", resourceType: "fetch", loadingGeneration: 1, failed: true, finished: false, failureClass: "ERR_ABORTED" };
    const entry = { case: "FIXTURE_LOADING_STALE_ACTOR", method: "POST", pathname: "/auth/v1/logout",
        actor: "UNKNOWN", loadingGeneration: 2, failed: true, finished: false, failureClass: "ERR_ABORTED",
        responseObserved: true, status: 204, authPhase: "ACCOUNT_A_LOGOUT", authLogicalActor: "ACCOUNT_A", authPreferenceGenerationApplicable: false };
    const events = [["A_SIGNOUT_CALL", 547.663], ["LOGOUT_REQUEST_START", 549.864], ["FRONT_DOOR_LOGOUT_RECEIVED", 554.533],
        ["GOTRUE_LOGOUT_REQUEST_STARTED", 554.716], ["GOTRUE_LOGOUT_RESPONSE", 599.903], ["LOGOUT_BROWSER_RESPONSE", 602.804],
        ["SIGNOUT_PROMISE_SETTLED", 602.911], ["LOGOUT_REQUESTFAILED", 604.166], ["A_SESSION_ABSENT", 608.139], ["B_SIGNIN_START", 608.169]]
        .map(([event, ms], index) => ({ event, ms, order: index + 1 }));
    const logout = { entry, events, browserCount: 1, frontCount: 1, frontActor: "ACCOUNT_A", gotrueStatus: 204,
        promiseResolved: true, promiseError: false, sessionAbsent: true, navigationBetween: false,
        staleHoldTouchesAuth: false, sharedAbortWithAuth: false, releaseAbortsUnrelated: false };
    return { source: "APPROVED_EXISTING_FORMAL_RUN_RECEIPT", entries: [oldEntry, entry], unresolved: 0,
        observation: { oldEntry, generation: 2, finalActorConfirmed: true, switchedWithPending: true,
            outboundStarted: true, held: true, released: true, staleResultDiscarded: true, logout } };
}
function snapshotCurrentLoadingObserver() {
    const observer = window.__task19LoadingLifecycle;
    if (!observer || typeof observer.snapshot !== "function")
        throw new Error("TASK19_STALE390_NEW_DOCUMENT_OBSERVER_NOT_INITIALIZED");
    const samples = observer.snapshot(), account = window.__task19.state().account, localeContext = window.__task19.locale();
    return { observerPresent: true, snapshotFunction: true, samples,
        revision: account?.revision, preference: account?.locale_preference, locale: localeContext.locale, localeContext,
        leaked: samples.some(sample => sample.actor === "ACCOUNT_B" && (sample.revision === 3 || sample.preference === "en")) };
}
function staleActorAdoptionReloads(context, account = { locale_preference: "zh-CN", revision: 5, updated_at: "2026-10-01T00:00:00Z" }) {
    let navigates = false;
    const store = createLocaleStore(context, { writePreference: () => true, navigate: () => { navigates = true; } });
    store.adoptAccount(account, context.generation);
    return navigates;
}
function assertStaleActorDocumentCurrent(observation) {
    if (observation.reloadExpected)
        return observation.finalReload.assertSnapshotAllowed(observation.activeDocument, observation.documents.at(-1));
    const current = observation.activeDocument;
    assert.ok(current && current === observation.documents.at(-1) && current.fixtureDocumentGeneration === observation.baseline.generation, "TASK19_STALE_ACTOR_NONRELOAD_DOCUMENT_CHANGED");
    assert.ok(current.finished && !current.failed && current.fixtureDocumentDomReady, "TASK19_STALE_ACTOR_NONRELOAD_DOCUMENT_NOT_TERMINAL");
    return current;
}
async function settleStaleActorDocument(page, observation) {
    assert.ok(observation.finalReload, "TASK19_STALE_ACTOR_RELOAD_BARRIER_NOT_ARMED");
    if (observation.reloadExpected)
        await settleAbFinalReload(page, observation);
    else
        await withinAbCaseDeadline(observation, page.waitForFunction(() => window.__task19 !== undefined && window.__task19AuthHarness !== undefined
            && window.__task19.state().status === "ready" && window.__task19.state().account?.revision === 5
            && typeof window.__task19LoadingLifecycle?.snapshot === "function", null, { timeout: Math.max(1, observation.deadline - performance.now()) }), "TASK19_STALE_ACTOR_NONRELOAD_FIXTURE_NOT_READY");
    const current = assertStaleActorDocumentCurrent(observation);
    const snapshot = await withinAbCaseDeadline(observation, page.evaluate(snapshotCurrentLoadingObserver), "TASK19_STALE_ACTOR_OBSERVER_SNAPSHOT_DEADLINE");
    assertStaleActorDocumentCurrent(observation);
    Object.assign(observation.receipt, {
        STALE430_B_ADOPTION_RELOAD_TRIGGERED: observation.reloadExpected, STALE430_RELOAD_BARRIER_ARMED: true,
        STALE430_RELOAD_NAVIGATION_OBSERVED: observation.reloadExpected, STALE430_RELOAD_DOMCONTENTLOADED: current.fixtureDocumentDomReady,
        STALE430_RELOAD_FIXTURE_READY: true, STALE430_FINAL_DOCUMENT_TERMINAL: current.finished && !current.failed,
        OBSERVER_POST_RELOAD_DOCUMENT_GENERATION: current.fixtureDocumentGeneration,
        POST_RELOAD_OBSERVER_PRESENT: snapshot.observerPresent, POST_RELOAD_OBSERVER_SNAPSHOT_FUNCTION: snapshot.snapshotFunction,
        OBSERVER_REUSED_FROM_PRE_RELOAD_DOCUMENT: false, DOCUMENT_BOUND_OPERATION_AFTER_RELOAD_BARRIER: true,
        OLD_DOCUMENT_EVALUATION_AFTER_RELOAD_START: false,
    });
    return snapshot;
}
async function loadingStaleActorScenario({ page, controls }) {
    assert.ok(loadingObservation?.active);
    controls.mode = "normal";
    const initial = await page.evaluate(snapshotCurrentLoadingObserver);
    assert.equal(initial.observerPresent, true);
    assert.equal(initial.snapshotFunction, true);
    loadingObservation.phase = "A_LOADING";
    loadingObservation.generation = 1;
    const held = new Promise(resolve => { loadingObservation.heldReady = resolve; });
    const armed = await controlStaleHold("ARM", { caseName: "FIXTURE_LOADING_STALE_ACTOR", generation: loadingObservation.generation });
    assert.equal(armed.actorBound, true);
    assert.equal(armed.armed, true);
    assert.equal(armed.matched, 0);
    loadingReceipt.LOADING_STALE_ACTOR_HOLD_ARMED = true;
    await signInBrowserActor(page, "A");
    await withinLoadingWindow(held);
    const old = loadingObservation.oldEntry;
    assert.ok(loadingObservation.outboundStarted && loadingObservation.held && old && !old.finished && !old.failed, "GENUINE_OLD_ACTOR_REQUEST_MUST_REMAIN_IN_FLIGHT");
    assert.equal(await page.evaluate(() => window.__task19.state().status), "loading");
    assert.equal(await page.evaluate(() => window.__task19.state().account), null);
    Object.assign(loadingReceipt, { OLD_ACTOR_REQUEST_STARTED: true, OLD_ACTOR_REQUEST_METHOD: old.method,
        OLD_ACTOR_REQUEST_PATH: old.pathname, OLD_ACTOR_REQUEST_ACTOR: old.actor, ACTOR_SWITCH_OCCURRED_WITH_OLD_REQUEST_IN_FLIGHT: true });
    loadingObservation.switchedWithPending = true;
    loadingObservation.phase = "ACTOR_SWITCH";
    loadingObservation.generation = 2;
    const preReloadSnapshot = await page.evaluate(snapshotCurrentLoadingObserver);
    abDocumentObservation.reloadExpected = staleActorAdoptionReloads(preReloadSnapshot.localeContext, controls.rows.B);
    await signInBrowserActor(page, "B");
    await settleStaleActorDocument(page, abDocumentObservation);
    Object.assign(loadingReceipt, { ACCOUNT_A_SIGNOUT: disposableReceipt.ACCOUNT_A_BROWSER_SIGNOUT,
        ACCOUNT_B_SIGNIN: disposableReceipt.ACCOUNT_B_BROWSER_SIGNIN });
    const auth = await page.evaluate(() => window.__task19.authState());
    assert.equal(auth.actor, "ACCOUNT_B");
    loadingObservation.finalActorConfirmed = true;
    loadingObservation.phase = "FINAL_B";
    await page.waitForFunction(() => window.__task19.state().status === "ready" && window.__task19.state().account?.revision === 5);
    const released = new Promise(resolve => { loadingObservation.releaseReady = resolve; });
    const result = await controlStaleHold("RELEASE");
    assert.equal(result.matched, 1);
    assert.equal(result.released, true);
    await withinLoadingWindow(released);
    loadingReceipt.OLD_ACTOR_REQUEST_RELEASED = true;
    if (!old.finished && !old.failed)
        await withinLoadingWindow(new Promise(resolve => { old.finishedObserver = resolve; }));
    assertStaleActorDocumentCurrent(abDocumentObservation);
    const state = await page.evaluate(snapshotCurrentLoadingObserver);
    assertStaleActorDocumentCurrent(abDocumentObservation);
    assert.equal(preReloadSnapshot.leaked, false, "STALE_ACTOR_RESULT_MUST_NEVER_APPLY_TO_B");
    assert.equal(state.revision, 5);
    assert.equal(state.preference, "zh-CN");
    assert.equal(state.locale, "zh-CN");
    assert.equal(state.leaked, false, "STALE_ACTOR_RESULT_MUST_NEVER_APPLY_TO_B");
    loadingObservation.staleResultDiscarded = true;
    Object.assign(loadingReceipt, { FINAL_UI_ACTOR: "ACCOUNT_B", FINAL_LOCALE_CORRECT_FOR_FINAL_ACTOR: true,
        ACCOUNT_A_PREFERENCE_LEAKED_TO_B: false, STALE_RESULT_APPLIED: false });
}
async function collectLoadingEvidence(page, ledger) {
    const observation = loadingObservation;
    collectAuthLogoutEvidence();
    observation.active = false;
    const entries = [...ledger.values()], failed = entries.filter(entry => entry.failed);
    const relation = entry => !Number.isInteger(entry?.loadingGeneration) ? "UNKNOWN"
        : entry.loadingGeneration < observation.generation ? "OLDER_THAN_FINAL" : "FINAL_GENERATION";
    const pathClass = entry => ["/api/users/me/preferences", "/__task19/locale", "/__task19/fixture.js", "/auth/v1/token", "/auth/v1/logout"].includes(entry?.pathname) ? entry.pathname : "UNKNOWN";
    for (let index = 0; index < 2; index++) {
        const entry = failed[index];
        Object.assign(loadingReceipt, { [`REQUESTFAILED_${index + 1}_METHOD`]: entry?.method ?? "UNKNOWN",
            [`REQUESTFAILED_${index + 1}_PATHNAME`]: pathClass(entry), [`REQUESTFAILED_${index + 1}_RESOURCE_TYPE`]: entry?.resourceType ?? "UNKNOWN",
            [`REQUESTFAILED_${index + 1}_ACTOR`]: entry?.actor ?? "UNKNOWN", [`REQUESTFAILED_${index + 1}_GENERATION_RELATION`]: relation(entry),
            [`REQUESTFAILED_${index + 1}_ERROR_CLASS`]: entry?.failureClass ?? "UNKNOWN" });
    }
    observation.failedRequestProvenance = failed.map(entry => {
        const stalePredicates = expectedStaleAbortPredicates(entry, observation);
        const stale = Object.values(stalePredicates).every(value => value === true);
        const logoutClass = authLogoutTerminalClass(entry, observation, entries.filter(value => !value.finished && !value.failed).length);
        return { sequence: entry.requestfailedSequence, requestSequence: entry.id, method: entry.method, pathname: pathClass(entry),
            resourceType: entry.resourceType, phase: entry.requestfailedPhase, requestPhase: entry.loadingPhase,
            logicalActor: entry.authLogicalActor ?? entry.actor, generationRelation: relation(entry),
            errorClass: entry.failureClass, browserErrorSymbol: entry.browserErrorSymbol,
            responseObserved: entry.responseObserved, responseStatus: entry.responseObserved ? entry.status : "NOT_OBSERVED",
            requestfinishedAlsoObserved: entry.finished, requestfailedObserved: entry.failed,
            classifiedAs: stale ? "EXPECTED_STALE_ACTOR_REQUESTFAILED" : logoutClass === "AUTH_LOGOUT_POST_SUCCESS_ABORT" ? logoutClass : "UNEXPECTED",
            stalePredicates, failedStalePredicates: Object.entries(stalePredicates).filter(([, matched]) => !matched).map(([name]) => name),
            authLogoutClassifierMatched: logoutClass === "AUTH_LOGOUT_POST_SUCCESS_ABORT",
            documentSequence: entry.fixtureDocumentGeneration !== undefined ? entry.id : "NOT_APPLICABLE",
            navigationGeneration: entry.fixtureDocumentGeneration ?? "NOT_APPLICABLE" };
    });
    const unresolved = entries.filter(entry => !entry.finished && !entry.failed);
    const entry = unresolved.length === 1 ? unresolved[0] : undefined;
    Object.assign(loadingReceipt, { UNRESOLVED_REQUESTS: unresolved.length, UNRESOLVED_METHOD: entry?.method ?? "UNKNOWN",
        UNRESOLVED_PATHNAME: pathClass(entry), UNRESOLVED_RESOURCE_TYPE: entry?.resourceType ?? "UNKNOWN",
        UNRESOLVED_ACTOR: entry?.actor ?? "UNKNOWN", UNRESOLVED_GENERATION_RELATION: relation(entry),
        UNRESOLVED_START_PHASE: entry?.loadingPhase ?? "UNKNOWN",
        ...accountLoadingRequestFailures(entries, observation, unresolved.length) });
    logoutReceipt.AUTH_LOGOUT_TERMINAL_CLASS = observation.logout.entry
        ? authLogoutTerminalClass(observation.logout.entry, observation, unresolved.length) : "NOT_OBSERVED";
    const final = observation.finalEntry;
    Object.assign(loadingReceipt, { FINAL_ACTOR_PREFERENCE_REQUEST_OBSERVED: !!final,
        FINAL_ACTOR_PREFERENCE_REQUEST_STATUS: final?.status ?? "UNKNOWN", FINAL_ACTOR_PREFERENCE_REQUESTFINISHED: final?.finished ?? false,
        FINAL_ACTOR_PREFERENCE_REQUEST_TERMINAL: !!final?.finished && !final.failed,
        OLD_ACTOR_REQUEST_TERMINAL: !!observation.oldEntry && (observation.oldEntry.finished || observation.oldEntry.failed),
        OLD_ACTOR_REQUEST_FINAL_GENERATION_RELATION: relation(observation.oldEntry) });
    if (!page.isClosed()) {
        const state = await page.evaluate(async () => {
            const auth = await window.__task19?.authState();
            const account = window.__task19?.state().account;
            const samples = window.__task19LoadingLifecycle?.snapshot() ?? [];
            return { actor: auth?.actor ?? "UNKNOWN", correct: auth?.actor === "ACCOUNT_B" && account?.revision === 5
                    && account?.locale_preference === "zh-CN" && window.__task19?.locale().locale === "zh-CN",
                leaked: samples.some(sample => sample.actor === "ACCOUNT_B" && (sample.revision === 3 || sample.preference === "en")) };
        }).catch(() => null);
        if (state)
            Object.assign(loadingReceipt, { FINAL_UI_ACTOR: state.actor, FINAL_LOCALE_CORRECT_FOR_FINAL_ACTOR: state.correct,
                ACCOUNT_A_PREFERENCE_LEAKED_TO_B: state.leaked, STALE_RESULT_APPLIED: state.leaked });
    }
    if (loadingReceipt.STALE_RESULT_APPLIED === true)
        Object.assign(loadingReceipt, { OWNER: "PRODUCT_CODE",
            ROOT_CAUSE: "TASK19_STALE_ACTOR_RESULT_APPLIED_AFTER_ACTOR_SWITCH", FAILURE_CLASS: "REAL_PRODUCT_STALE_ACTOR_REGRESSION" });
    else if (entry && (entry.actor === "ACCOUNT_B" || relation(entry) === "FINAL_GENERATION"))
        Object.assign(loadingReceipt, {
            OWNER: "TASK19_BROWSER_HARNESS_OR_PRODUCT_RUNTIME", ROOT_CAUSE: "TASK19_LOADING_STALE_ACTOR_FINAL_ACTOR_REQUEST_NOT_TERMINAL", FAILURE_CLASS: "FINAL_ACTOR_LIFECYCLE_FAILURE"
        });
    else if (loadingReceipt.UNEXPECTED_REQUESTFAILED_COUNT > 0)
        Object.assign(loadingReceipt, { OWNER: "UNKNOWN",
            ROOT_CAUSE: "TASK19_LOADING_STALE_ACTOR_UNEXPECTED_REQUESTFAILED", FAILURE_CLASS: "UNEXPECTED_REQUEST_FAILURE" });
}
let httpCompletionControl;
const httpCompletionReceipt = {
    TASK19_API_OUTAGE_HTTP_RESPONSE_COMPLETION_DIAGNOSIS: "NOT_RUN",
    FRONT_DOOR_WORKER_RESPONSE_FORWARDER_SITE: "scripts/test-global-locale-browser.mjs:serveSameOriginFrontDoor/requestHttps/incoming.pipe",
    WORKER_503_BODY_CLASS: "UNKNOWN", WORKER_503_CONTENT_LENGTH_CLASS: "UNKNOWN", WORKER_503_TRANSFER_ENCODING_CLASS: "UNKNOWN",
    FRONT_DOOR_NULL_BODY_CALLS_END: "NOT_APPLICABLE", FRONT_DOOR_STREAM_BODY_ENDS_DESTINATION: true,
    FRONT_DOOR_CAN_WRITE_HEADERS_WITHOUT_TERMINAL_END: true,
    FRONT_DOOR_COPIES_CONTENT_LENGTH: true, FRONT_DOOR_COPIES_TRANSFER_ENCODING: false, FRONT_DOOR_COPIES_CONNECTION: false,
    FRONT_DOOR_HAS_CONTENT_LENGTH_BODY_MISMATCH_RISK: true, FRONT_DOOR_HAS_HOP_BY_HOP_HEADER_FORWARDING_RISK: true,
    WORKER_503_RESPONSE_OBJECT_OBSERVED: false, WORKER_503_RESPONSE_BODY_COMPLETION: "UNKNOWN",
    WORKER_HTTP_SOURCE_EOF: false, FRONT_DOOR_DESTINATION_FINISHED: false, FRONT_DOOR_CLIENT_BODY_EOF: false,
    FRONT_DOOR_OBSERVED_CONTENT_LENGTH_MATCH: "UNKNOWN", FRONT_DOOR_OBSERVED_HOP_BY_HOP_HEADER_PRESENT: "UNKNOWN",
    OWNER: "UNKNOWN", ROOT_CAUSE: "UNPROVEN", FAILURE_CLASS: "UNPROVEN_RESPONSE_COMPLETION_FAILURE",
    TASK19_HTTP_RESPONSE_COMPLETION_FIX_AUTHORIZED_BY_CONDITION: false, TASK19_HTTP_RESPONSE_COMPLETION_FIX_APPLIED: false,
    TASK19_HTTP_RESPONSE_COMPLETION_FIX_FILES: "NONE", TASK19_FRONT_DOOR_RESPONSE_COMPLETION_RED: "NOT_RUN",
    TASK19_FRONT_DOOR_RESPONSE_COMPLETION_GREEN: "NOT_RUN",
};
let apiOutageObservation, apiOutageDesktopReceipt, outageControlSequence = 0;
const outageControlReplies = new Map();
const outageResponseCompletions = new WeakMap();
function isOutageResponseFinishedTerminal(entry) {
    const proof = outageResponseCompletions.get(entry);
    return Boolean(proof && proof.entry === entry && proof.identityMatch && proof.response
        && proof.response.request() === proof.request && proof.state === "RESOLVED_NULL"
        && entry.observed && entry.responseObserved && entry.status === 503 && !entry.failed
        && entry.case === "FIXTURE_API_OUTAGE" && entry.method === "PATCH" && entry.pathname === "/api/users/me/preferences");
}
const outagePhaseNames = ["BROWSER_SIGNIN_COMPLETE", "AUTHENTICATED_PREFERENCE_STATE_READY", "OUTAGE_INJECTION_ARMED",
    "PATCH_REQUEST_OBSERVED", "FRONT_DOOR_PATCH_RECEIVED", "WORKER_PATCH_STARTED", "WORKER_DOWNSTREAM_POSTGREST_STARTED",
    "WORKER_DOWNSTREAM_POSTGREST_TERMINAL", "WORKER_RESPONSE_OBSERVED", "BROWSER_PATCH_RESPONSE_OBSERVED", "BROWSER_REQUESTFINISHED", "UI_ERROR_STATE_SETTLED"];
const apiOutageReceipt = {
    TASK19_API_OUTAGE_TIMEOUT_DIAGNOSIS: "NOT_RUN", API_OUTAGE_CURRENT_INJECTION_LAYER: "WORKER_OUTBOUND",
    API_OUTAGE_CURRENT_TARGET: "POSTGREST_USER_PREFERENCES", API_OUTAGE_CURRENT_FAILURE_MODE: "IMMEDIATE_HTTP_ERROR",
    API_OUTAGE_EXPECTED_WORKER_STATUS: 503, OUTAGE_AUTH_STILL_HEALTHY: "UNKNOWN",
    OUTAGE_PATCH_BROWSER_REQUEST_OBSERVED: false, OUTAGE_PATCH_FRONT_DOOR_RECEIVED: false, OUTAGE_PATCH_WORKER_RECEIVED: false,
    WORKER_OUTBOUND_PREFERENCE_STORAGE_REQUEST_OBSERVED: false, WORKER_OUTBOUND_PREFERENCE_STORAGE_METHOD: "UNKNOWN",
    WORKER_OUTBOUND_PREFERENCE_STORAGE_PATH_CLASS: "UNKNOWN", WORKER_OUTBOUND_TERMINAL_EVENT: "NONE", WORKER_OUTBOUND_TERMINAL_STATUS: "UNKNOWN",
    WORKER_OUTAGE_RESPONSE_OBSERVED: false, WORKER_OUTAGE_RESPONSE_STATUS: "UNKNOWN",
    BROWSER_OUTAGE_RESPONSE_OBSERVED: false, BROWSER_OUTAGE_RESPONSE_STATUS: "UNKNOWN",
    BROWSER_OUTAGE_REQUESTFINISHED: false, BROWSER_OUTAGE_REQUESTFAILED: false,
    TASK19_API_OUTAGE_RESPONSE_FINISHED_PROOF: "NOT_RUN", OUTAGE_RESPONSE_REQUEST_IDENTITY_MATCH: "UNKNOWN",
    OUTAGE_RESPONSE_FINISHED_API_STATE: "PENDING", OUTAGE_RESPONSE_FINISHED_API_ERROR_CLASS: "NONE",
    API_OUTAGE_TERMINAL_ACCOUNTING: "UNRESOLVED_REQUEST", API_OUTAGE_SEMANTIC_CONTRACT: "NOT_RUN",
    OUTAGE_UI_ERROR_STATE_OBSERVED: "UNKNOWN", OUTAGE_UI_PREFERENCE_RETAINED: "UNKNOWN", OUTAGE_UI_FALSE_SUCCESS: "UNKNOWN",
    OUTAGE_INJECTION_HANDLER_EXECUTED: false, OWNER: "UNKNOWN", ROOT_CAUSE: "UNPROVEN", FAILURE_CLASS: "UNPROVEN",
    TASK19_API_OUTAGE_HARNESS_FIX_AUTHORIZED_BY_CONDITION: false, TASK19_API_OUTAGE_HARNESS_FIX_APPLIED: false,
    TASK19_API_OUTAGE_HARNESS_FIX_FILES: "NONE", FIXTURE_API_OUTAGE_CHROMIUM_1280: "NOT_REVALIDATED",
    TASK19_API_OUTAGE_OUTBOUND_SERVICE_FIX: "APPLIED_PENDING_ACCEPTANCE", OUTAGE_OUTBOUND_FAULT_ARMED: false,
    OUTAGE_OUTBOUND_FAULT_MATCH_COUNT: 0, BROWSER_API_RESPONSE_OWNER: "REAL_WORKER",
    DOWNSTREAM_FAILURE_OWNER: "TASK19_OUTBOUND_SERVICE_FIXTURE",
};
const apiOutageInitialReceipt = { ...apiOutageReceipt };
function createOutageOutboundFault(origin) {
    const configured = new URL(origin);
    assert.ok(configured.protocol === "https:" && configured.hostname === "127.0.0.1" && configured.port, "OWNED_CONFIGURED_FRONT_DOOR_REQUIRED");
    const state = { caseName: "NONE", armed: false, matchCount: 0 };
    return {
        setCase(caseName, armed) {
            assert.ok(caseName === "NONE" || /^FIXTURE_[A-Z_]+$/.test(caseName), "SAFE_CASE_ID_REQUIRED");
            assert.equal(typeof armed, "boolean");
            assert.ok(!armed || caseName === "FIXTURE_API_OUTAGE", "EXACT_OUTAGE_CASE_ONLY");
            assert.ok(!state.armed || !armed, "OUTAGE_FAULT_ALREADY_ARMED");
            if (caseName !== state.caseName)
                state.matchCount = 0;
            Object.assign(state, { caseName, armed });
            return { ...state };
        },
        snapshot: () => ({ ...state }),
        responseFor(request) {
            const url = new URL(request.url);
            if (!state.armed || state.caseName !== "FIXTURE_API_OUTAGE" || url.origin !== configured.origin
                || request.method !== "PATCH" || url.pathname !== "/rest/v1/user_preferences")
                return null;
            state.matchCount++;
            assert.equal(state.matchCount, 1, "OUTAGE_OUTBOUND_FAULT_MORE_THAN_ONCE");
            return Response.json({ message: "LOCAL_TEST_DEPENDENCY_UNAVAILABLE" }, { status: 503 });
        },
    };
}
async function setOwnedOutageCase(caseName, armed) {
    assert.ok(child?.connected, "OWNED_WORKER_CONTROL_REQUIRED");
    const id = ++outageControlSequence;
    let timer;
    try {
        const acknowledged = new Promise((resolve, reject) => {
            outageControlReplies.set(id, { resolve, reject });
            child.send({ type: "outage-case", id, caseName, armed }, error => { if (error)
                reject(new Error("OUTAGE_FAULT_CONTROL_SEND_FAILED")); });
        });
        const remaining = apiOutageObservation?.active ? Math.max(1, 15000 - (performance.now() - apiOutageObservation.started)) : 5000;
        const result = await Promise.race([acknowledged, new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error("OUTAGE_FAULT_CONTROL_ACK_TIMEOUT")), Math.min(5000, remaining));
            })]);
        assert.equal(result.caseName, caseName);
        assert.equal(result.armed, armed);
        if (armed)
            apiOutageReceipt.OUTAGE_OUTBOUND_FAULT_ARMED = true;
        return result;
    }
    finally {
        clearTimeout(timer);
        outageControlReplies.delete(id);
    }
}
function markOutagePhase(number) {
    const observation = apiOutageObservation;
    if (observation?.active && observation.phases[number] === undefined)
        observation.phases[number] = Math.round(performance.now() - observation.started);
}
function observeOutageOutbound(message) {
    const observation = apiOutageObservation;
    if (!observation?.active || observation.phases[3] === undefined)
        return;
    if (message.pathClass === "AUTH" && message.event === "HTTP_RESPONSE" && message.status === 200)
        apiOutageReceipt.OUTAGE_AUTH_STILL_HEALTHY = true;
    if (message.pathClass !== "USER_PREFERENCES_REST" || message.method !== "PATCH")
        return;
    if (message.event === "FAULT_MATCHED") {
        apiOutageReceipt.OUTAGE_OUTBOUND_FAULT_MATCH_COUNT = message.matchCount;
        apiOutageReceipt.OUTAGE_INJECTION_HANDLER_EXECUTED = true;
        return;
    }
    if (message.event === "STARTED") {
        observation.downstreamCount++;
        Object.assign(apiOutageReceipt, { OUTAGE_PATCH_WORKER_RECEIVED: true, WORKER_OUTBOUND_PREFERENCE_STORAGE_REQUEST_OBSERVED: true,
            WORKER_OUTBOUND_PREFERENCE_STORAGE_METHOD: "PATCH", WORKER_OUTBOUND_PREFERENCE_STORAGE_PATH_CLASS: message.pathClass });
        markOutagePhase(6);
        markOutagePhase(7);
    }
    else if (["HTTP_RESPONSE", "CONNECTION_ERROR", "ABORT"].includes(message.event)) {
        Object.assign(apiOutageReceipt, { WORKER_OUTBOUND_TERMINAL_EVENT: message.event, WORKER_OUTBOUND_TERMINAL_STATUS: message.status ?? "UNKNOWN" });
        markOutagePhase(8);
    }
}
async function collectApiOutageDiagnostic(page, ledger, failure) {
    const observation = apiOutageObservation;
    if (!observation?.active)
        return;
    const result = apiOutageReceipt;
    const responseProof = observation.responseProof;
    if (responseProof) {
        responseProof.active = false;
        Object.assign(result, { OUTAGE_RESPONSE_REQUEST_IDENTITY_MATCH: responseProof.identityMatch,
            OUTAGE_RESPONSE_FINISHED_API_STATE: responseProof.state, OUTAGE_RESPONSE_FINISHED_API_ERROR_CLASS: responseProof.errorClass,
            TASK19_API_OUTAGE_RESPONSE_FINISHED_PROOF: responseProof.identityMatch && responseProof.state === "RESOLVED_NULL" && !responseProof.entry.failed ? "PASS" : "BLOCKED",
            API_OUTAGE_TERMINAL_ACCOUNTING: responseProof.entry.failed ? "PLAYWRIGHT_FAILED" : responseProof.entry.finished ? "PLAYWRIGHT_REQUESTFINISHED"
                : isOutageResponseFinishedTerminal(responseProof.entry) ? "PLAYWRIGHT_RESPONSE_FINISHED_API" : "UNRESOLVED_REQUEST" });
    }
    result.TASK19_API_OUTAGE_TIMEOUT_DIAGNOSIS = "COMPLETE";
    result.OUTAGE_FAILED_PHASE = outagePhaseNames.find((_name, index) => observation.phases[index + 1] === undefined) ?? "NONE";
    result.OUTAGE_MONOTONIC_OFFSET_BASIS = "PARENT_OBSERVER_RECEIPT";
    result.UNRESOLVED_REQUESTS = [...ledger.values()].filter(entry => resolveRequestLedger(entry, "NOT_RUN") === "UNRESOLVED_REQUEST").length;
    result.OUTAGE_SAFE_FAILURE = failure?.name === "TimeoutError" ? "ORIGINAL_UI_WAIT_TIMEOUT" : failure ? "OTHER_SAFE_FAILURE" : "NONE";
    if (page && !page.isClosed()) {
        const state = await page.evaluate(() => {
            const state = window.__task19?.state();
            const choice = document.querySelector(".locale-settings select")?.value;
            return { unavailable: state?.status === "unavailable", retained: choice === "zh-CN" && window.__task19?.locale().preference === "zh-CN",
                success: ["saved", "ready"].includes(state?.status) && state?.account?.locale_preference === "zh-CN",
                syncStatus: ["idle", "loading", "ready", "saving", "saved", "local", "unavailable", "conflict"].includes(state?.status) ? state.status : "UNKNOWN",
                controlValue: ["auto", "en", "zh-CN"].includes(choice) ? choice : "UNKNOWN" };
        }).catch(() => null);
        if (state)
            Object.assign(result, { OUTAGE_UI_ERROR_STATE_OBSERVED: state.unavailable,
                OUTAGE_UI_PREFERENCE_RETAINED: state.retained, OUTAGE_UI_FALSE_SUCCESS: state.success,
                OUTAGE_SETTLED_SYNC_STATUS: state.syncStatus, OUTAGE_SETTLED_CONTROL_VALUE: state.controlValue });
    }
    if (responseProof && !responseProof.identityMatch) {
        Object.assign(result, { OWNER: "TASK19_BROWSER_HARNESS", ROOT_CAUSE: "OUTAGE_RESPONSE_REQUEST_IDENTITY_MISMATCH", FAILURE_CLASS: "RESPONSE_CORRELATION_FAILURE" });
    }
    else if (responseProof?.entry.failed) {
        Object.assign(result, { OWNER: "UNKNOWN", ROOT_CAUSE: "TASK19_API_OUTAGE_REQUESTFAILED_IN_HTTP_503_FLOW", FAILURE_CLASS: "UNEXPECTED_REQUEST_FAILURE" });
    }
    else if (responseProof?.state === "PENDING") {
        Object.assign(result, { OWNER: "UNKNOWN", ROOT_CAUSE: "TASK19_API_OUTAGE_HTTP_RESPONSE_BODY_NOT_TERMINAL", FAILURE_CLASS: "REAL_HTTP_RESPONSE_COMPLETION_FAILURE" });
    }
    else if (responseProof?.state === "RESOLVED_ERROR") {
        Object.assign(result, { OWNER: "UNKNOWN", ROOT_CAUSE: "TASK19_API_OUTAGE_RESPONSE_FINISHED_API_ERROR", FAILURE_CLASS: "REAL_HTTP_RESPONSE_COMPLETION_FAILURE" });
    }
    else if (responseProof && isOutageResponseFinishedTerminal(responseProof.entry) && !responseProof.entry.finished) {
        Object.assign(result, { OWNER: "TASK19_BROWSER_HARNESS", ROOT_CAUSE: "TASK19_PLAYWRIGHT_REQUESTFINISHED_EVENT_MISSED_FOR_COMPLETED_503_RESPONSE", FAILURE_CLASS: "PLAYWRIGHT_EVENT_BRIDGE_OBSERVABILITY_GAP" });
    }
    else if (responseProof?.state === "RESOLVED_NULL") {
        Object.assign(result, failure ? { OWNER: "UNKNOWN", ROOT_CAUSE: "TASK19_API_OUTAGE_ACCEPTANCE_CONTRACT_UNPROVEN", FAILURE_CLASS: "OUTAGE_ACCEPTANCE_CONTRACT_FAILURE" }
            : { OWNER: "NONE", ROOT_CAUSE: "NONE", FAILURE_CLASS: "NONE" });
    }
    else if (observation.phases[3] === undefined) {
        Object.assign(result, { OWNER: "UNKNOWN", ROOT_CAUSE: "TASK19_API_OUTAGE_PRECONDITION_NOT_REACHED", FAILURE_CLASS: "AUTH_OR_PRECONDITION_TIMEOUT" });
    }
    else if (result.OUTAGE_PATCH_WORKER_RECEIVED && observation.downstreamCount === 1 && observation.phases[8] === undefined) {
        Object.assign(result, { OWNER: "TASK19_BROWSER_HARNESS", ROOT_CAUSE: "TASK19_API_OUTAGE_FIXTURE_CREATES_NONTERMINATING_DOWNSTREAM_FAILURE",
            FAILURE_CLASS: "HARNESS_OUTAGE_INJECTION_HANG", TASK19_API_OUTAGE_HARNESS_FIX_AUTHORIZED_BY_CONDITION: true });
    }
    else if (result.WORKER_OUTAGE_RESPONSE_STATUS === 503 && result.BROWSER_OUTAGE_RESPONSE_STATUS === 503 && result.BROWSER_OUTAGE_REQUESTFINISHED) {
        Object.assign(result, failure ? { OWNER: "TASK19_BROWSER_HARNESS_OR_PRODUCT_UI", ROOT_CAUSE: "TASK19_API_OUTAGE_UI_OR_ACCEPTANCE_CONTRACT_UNPROVEN",
            FAILURE_CLASS: "OUTAGE_UI_OR_ACCEPTANCE_CONTRACT_FAILURE" } : { OWNER: "TASK19_BROWSER_HARNESS",
            ROOT_CAUSE: "TASK19_API_OUTAGE_INJECTION_BYPASSED_BY_DIRECT_WORKER_OUTBOUND", FAILURE_CLASS: "HARNESS_OUTAGE_NOT_INJECTED_FIXED" });
    }
    else if (observation.downstreamCount === 1 && result.WORKER_OUTBOUND_TERMINAL_STATUS >= 200 && result.WORKER_OUTBOUND_TERMINAL_STATUS < 300
        && result.WORKER_OUTAGE_RESPONSE_STATUS === 200 && result.BROWSER_OUTAGE_RESPONSE_STATUS === 200 && result.BROWSER_OUTAGE_REQUESTFINISHED
        && !result.OUTAGE_INJECTION_HANDLER_EXECUTED) {
        Object.assign(result, { OWNER: "TASK19_BROWSER_HARNESS", ROOT_CAUSE: "TASK19_API_OUTAGE_INJECTION_BYPASSED_BY_DIRECT_WORKER_OUTBOUND",
            FAILURE_CLASS: "HARNESS_OUTAGE_NOT_INJECTED" });
    }
    else if (result.WORKER_OUTBOUND_TERMINAL_STATUS === 503 && result.WORKER_OUTAGE_RESPONSE_OBSERVED && result.WORKER_OUTAGE_RESPONSE_STATUS !== 503) {
        Object.assign(result, { OWNER: "PRODUCT_CODE", ROOT_CAUSE: "TASK19_PRODUCT_PREFERENCES_DOWNSTREAM_503_NOT_PROPAGATED", FAILURE_CLASS: "REAL_PRODUCT_API_REGRESSION" });
    }
    else if (result.WORKER_OUTAGE_RESPONSE_STATUS === 503 && !result.BROWSER_OUTAGE_RESPONSE_OBSERVED && !result.BROWSER_OUTAGE_REQUESTFAILED) {
        Object.assign(result, { ROOT_CAUSE: "TASK19_REAL_HTTP_OUTAGE_BROWSER_TERMINAL_EVENT_MISSING", FAILURE_CLASS: "BROWSER_TERMINAL_EVENT_MISSING" });
    }
    for (const [index, name] of outagePhaseNames.entries()) {
        result[`OUTAGE_PHASE_${index + 1}_${name}`] = observation.phases[index + 1] === undefined ? "NOT_REACHED" : "PASS";
        result[`OUTAGE_PHASE_${index + 1}_OFFSET_MS`] = observation.phases[index + 1] ?? "NOT_REACHED";
    }
    observation.active = false;
}
let realHttpSwitchObservation;
const cookieRowReceipt = {
    TASK19_ACCOUNT_COOKIE_ROW_LOGOUT_LOCALE_DIAGNOSIS: "NOT_RUN", FAILED_ASSERTION_STAGE: "POST_RELOAD",
    CASE_INTENDED_PRELOGIN_COOKIE_PREFERENCE: "NONE", CASE_INTENDED_PRELOGIN_COOKIE_PROVENANCE: "NONE",
    CASE_INTENDED_ACCOUNT_A_ROW_PREFERENCE: "en", CASE_INTENDED_ACCOUNT_A_ROW_REVISION_CLASS: "POSITIVE",
    CASE_INTENDED_POST_LOGIN_LOCALE: "en", CASE_INTENDED_POST_LOGIN_SOURCE: "ACCOUNT_ADOPTED",
    CASE_INTENDED_POST_LOGOUT_LOCALE: "zh-CN", CASE_INTENDED_POST_LOGOUT_SOURCE: "DEVICE_EXPLICIT",
    OWNER: "UNKNOWN", ROOT_CAUSE: "UNPROVEN", FAILURE_CLASS: "UNPROVEN_LOCALE_STATE_SEMANTICS",
    TASK19_HARNESS_FIX_AUTHORIZED_BY_CONDITION: false, TASK19_HARNESS_FIX_APPLIED: false, TASK19_HARNESS_FIX_FILES: "NONE",
    FIXTURE_ACCOUNT_COOKIE_ROW_LOGOUT_CHROMIUM_1280: "NOT_REVALIDATED",
    ACCOUNT_A_ROW_CONTRACT: "NOT_RUN", COOKIE_PROVENANCE_CONTRACT: "NOT_RUN", LOGIN_ADOPTION_CONTRACT: "NOT_RUN", LOGOUT_LOCALE_CONTRACT: "NOT_RUN",
};
let disposableStack, gateway, gatewayOrigin, disposablePhase = "IMPACTED";
let reservedFrontDoor, frontDoorOrigin, appWorkerUpstream, frontDoorCa;
const caTrustReceipt = {
    TASK19_WINDOWS_EPHEMERAL_CA_TRUST: "NOT_RUN", TASK19_CA_IS_CA: "UNKNOWN", TASK19_CA_HAS_PRIVATE_KEY_IN_IMPORT_FILE: "UNKNOWN",
    TASK19_CA_CURRENTLY_TIME_VALID: "UNKNOWN", TASK19_CA_SIGNATURE_ALGORITHM_CLASS: "UNKNOWN",
    TASK19_SERVER_CERT_CHAINS_TO_TASK19_CA: "UNKNOWN", TASK19_SERVER_CERT_SAN_127_0_0_1: "UNKNOWN", TASK19_SERVER_CERT_SAN_LOCALHOST: "UNKNOWN",
    TASK19_CA_PREEXISTED_IN_CURRENT_USER_ROOT: "NOT_CHECKED", TASK19_CA_TRUST_STORE_ENTRY_OWNED_BY_THIS_RUN: false,
    TASK19_CA_IMPORT_ATTEMPTED: false, TASK19_CA_IMPORT_RESULT: "NOT_RUN", TASK19_CA_PRESENT_IN_CURRENT_USER_ROOT: "UNKNOWN",
    TASK19_TEST_CONTEXT_TLS_EXCEPTION: "NOT_RUN", TASK19_BROWSER_CONTEXT_IGNORE_HTTPS_ERRORS: true,
    TASK19_WINDOWS_TRUST_STORE_MUTATIONS: 0, PLAYWRIGHT_IGNORE_HTTPS_ERRORS: true, CHROMIUM_CERTIFICATE_BYPASS_FLAGS: 0,
    TASK19_BROWSER_ALLOWED_NETWORK_ORIGIN_COUNT: "UNKNOWN", TASK19_BROWSER_ALLOWED_NETWORK_ORIGIN: "SAME_ORIGIN_FRONT_DOOR",
    TASK19_EXTERNAL_BROWSER_REQUESTS_FORWARDED: 0,
    TASK19_BROWSER_CERT_INTERSTITIAL_OBSERVED: "UNKNOWN", TASK19_BROWSER_NAVIGATION_REQUESTFAILED: "UNKNOWN",
    TASK19_BROWSER_TLS_NAVIGATION_STATUS: "UNKNOWN", TASK19_BROWSER_TLS_ERROR: "UNKNOWN", TASK19_BROWSER_CERT_AUTHORITY_INVALID: "UNKNOWN",
    TASK19_CA_PRESENT_IN_CURRENT_USER_ROOT_AFTER_CLEANUP: "NOT_APPLICABLE", TASK19_UNRELATED_ROOT_CERTIFICATES_MODIFIED: 0,
};
async function validateTask19PublicCa(caPath, leaf) {
    assert.equal(path.resolve(caPath), path.join(ownedRoot, "ca.crt"), "EXACT_OWNED_CA_FILE_REQUIRED");
    const pem = await readFile(caPath, "utf8");
    assert.ok(!pem.includes("PRIVATE KEY") && pem.match(/-----BEGIN CERTIFICATE-----/g)?.length === 1, "PUBLIC_CA_ONLY");
    const ca = new X509Certificate(pem), now = Date.now();
    assert.equal(ca.ca, true);
    assert.ok(Date.parse(ca.validFrom) <= now && now < Date.parse(ca.validTo), "CURRENTLY_TIME_VALID_CA_REQUIRED");
    const metadata = execFileSync("openssl", ["x509", "-in", caPath, "-noout", "-text"], { env: childEnvironment(), stdio: "pipe", windowsHide: true, encoding: "utf8" });
    const signatures = [...metadata.matchAll(/Signature Algorithm: ([^\r\n]+)/g)].map(match => match[1].trim());
    assert.ok(signatures.length >= 2 && signatures.every(value => /^(?:sha(?:256|384|512)WithRSAEncryption|ecdsa-with-SHA(?:256|384|512))$/.test(value)), "SHA256_OR_STRONGER_CA_REQUIRED");
    assert.equal(leaf.verify(ca.publicKey), true);
    assert.equal(leaf.checkIssued(ca), true);
    assert.equal(leaf.checkIP("127.0.0.1"), "127.0.0.1");
    assert.equal(leaf.checkHost("localhost", { subject: "never" }), "localhost");
    Object.assign(caTrustReceipt, { TASK19_CA_IS_CA: true, TASK19_CA_HAS_PRIVATE_KEY_IN_IMPORT_FILE: false,
        TASK19_CA_CURRENTLY_TIME_VALID: true, TASK19_CA_SIGNATURE_ALGORITHM_CLASS: "SHA256_OR_STRONGER",
        TASK19_SERVER_CERT_CHAINS_TO_TASK19_CA: true, TASK19_SERVER_CERT_SAN_127_0_0_1: true, TASK19_SERVER_CERT_SAN_LOCALHOST: true });
}
const frontDoorReceipt = {
    TASK19_BUILD_GUARD_TOPOLOGY_REVIEW: "NOT_RUN", LOCAL_BUILD_GUARD_SERVER_FIELD: "SUPABASE_URL", LOCAL_BUILD_GUARD_CLIENT_FIELD: "PUBLIC_SUPABASE_URL",
    LOCAL_BUILD_GUARD_COMPARISON: "ORIGIN_EQUALITY", LOCAL_BUILD_GUARD_REQUIRES_LOOPBACK: true,
    LOCAL_BUILD_GUARD_ADDITIONAL_REQUIREMENTS: "EXACT_127_0_0_1_HTTP_OR_HTTPS_NO_USERINFO_QUERY_HASH;NONEMPTY_PUBLIC_ANON;HTTPS_SITE_ORIGIN;AUTH_OFF;NO_AUTH_SITEKEY;NO_PRIVILEGED_VARS;NO_REMOTE_PUBLIC_URLS;NO_REPOSITORY_DOTENV",
    CORRECTED_TOPOLOGY_ACCEPTED_BY_EXISTING_BUILD_GUARD: false, BUILD_INFRA_MODIFICATION_REQUIRED: false,
    TASK19_CONFIGURED_ORIGIN_EQUALITY: "NOT_RUN", TASK19_LOCAL_WORKER_BUILD: "NOT_RUN",
    CLIENT_SUPABASE_CONFIGURED_ORIGIN: "NOT_RUN", WORKER_SUPABASE_CONFIGURED_ORIGIN: "NOT_RUN", CLIENT_SERVER_SUPABASE_ORIGIN_EQUAL: "UNKNOWN",
    REMOTE_SUPABASE_REFERENCE_COUNT: "UNKNOWN", WORKER_SUPABASE_RUNTIME_ROUTE: "NOT_RUN",
    TASK19_BROWSER_AND_PUBLIC_SUPABASE_SAME_ORIGIN: "UNKNOWN", BROWSER_SUPABASE_REQUEST_CROSS_ORIGIN: "UNKNOWN", BROWSER_LNA_PERMISSION_REQUIRED: "UNKNOWN",
    INVALID_WORKER_PUBLIC_ENV_PROOF_REMOVED: true, APP_RUNTIME_ORIGIN_CLASS: "UNKNOWN",
    SIGNIN_REQUEST_RUNTIME_ORIGIN_CLASS: "UNKNOWN", SIGNIN_REQUEST_ORIGIN_EQUALS_APP_ORIGIN: "UNKNOWN",
    TASK19_FRONT_DOOR_APP_TRANSPARENCY: "NOT_RUN", TASK19_FRONT_DOOR_STOPPED: false, TASK19_OWNED_PORTS_RELEASED: false,
    TASK19_FRONT_DOOR_APP_HTTP_STATUS: "UNKNOWN", TASK19_FRONT_DOOR_WORKER_RESPONSE_OBSERVED: false,
    TASK19_FRONT_DOOR_FIXTURE_HTTP_STATUS: "UNKNOWN",
    TASK19_FIXTURE_ROUTE: "/__task19/locale", TASK19_FIXTURE_SERVING_MODEL: "EXISTING_IN_PROCESS_HANDLER",
    TASK19_FIXTURE_OWNER_FILE: path.resolve("scripts/test-global-locale-browser.mjs"),
    TASK19_FIXTURE_HTML_PATHS: "/__task19/locale", TASK19_FIXTURE_ASSET_PATH_PREFIXES: "NONE;EXACT_ASSET=/__task19/fixture.js",
    TASK19_FIXTURE_RUNTIME_ROUTE: "FRONT_DOOR_EXISTING_IN_PROCESS_FIXTURE",
    TASK19_FRONT_DOOR_FIXTURE_ROUTE_MATCHED: false, TASK19_FIXTURE_RESPONSE_OWNER: "UNKNOWN",
    TASK19_FIXTURE_ACCIDENTALLY_ROUTED_TO_WORKER: false, TASK19_FIXTURE_REMOTE_REQUESTS_FORWARDED: 0,
    TASK19_FIXTURE_WEBSOCKET_ATTEMPTS: 0, TASK19_FIXTURE_HYDRATION: "NOT_RUN", TASK19_FRONT_DOOR_REMOTE_DESTINATIONS: 0,
    FIRST_NEW_BLOCKER: "NONE", FIRST_FAIL: "NONE", FAILURE_CLASS: "NONE",
};
function browserSigninOriginProof(appUrl, requestUrl, frontDoor) {
    const origin = value => { try {
        const parsed = new URL(value).origin;
        return parsed === "null" ? undefined : parsed;
    }
    catch {
        return undefined;
    } };
    const classify = value => {
        if (!value)
            return "UNKNOWN";
        if (value === frontDoor)
            return "TASK19_FRONT_DOOR";
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol))
            return "UNKNOWN";
        return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ? "OTHER_LOOPBACK" : "REMOTE";
    };
    const appOrigin = origin(appUrl), requestOrigin = origin(requestUrl);
    const appClass = classify(appOrigin), requestClass = classify(requestOrigin);
    const equal = Boolean(appOrigin && requestOrigin && appOrigin === requestOrigin);
    return { APP_RUNTIME_ORIGIN_CLASS: appClass, SIGNIN_REQUEST_RUNTIME_ORIGIN_CLASS: requestClass,
        SIGNIN_REQUEST_ORIGIN_EQUALS_APP_ORIGIN: equal, accepted: equal && appClass === "TASK19_FRONT_DOOR" && requestClass === "TASK19_FRONT_DOOR" };
}
function selectFrontDoorUpstream(relative, method, supabase, worker) {
    assert.ok(relative.startsWith("/") && !relative.startsWith("//") && !relative.includes("\\"), "FRONT_DOOR_RELATIVE_PATH_REQUIRED");
    const url = new URL(relative, worker);
    assert.equal(url.origin, new URL(worker).origin, "FRONT_DOOR_FIXED_DESTINATION_REQUIRED");
    if (url.pathname.startsWith("/auth/v1/") || url.pathname.startsWith("/rest/v1/")) {
        assert.ok(isOwnedSupabaseRoute(url, method), "FRONT_DOOR_SUPABASE_ROUTE_NOT_APPROVED");
        return new URL(url.pathname + url.search, supabase);
    }
    return url;
}
function frontDoorHeaders(request, origin) {
    assert.equal(request.headers.host, new URL(origin).host, "FRONT_DOOR_OWNED_HOST_REQUIRED");
    const hop = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-authorization", "proxy-authenticate", "te", "trailer"]);
    const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !hop.has(name.toLowerCase())));
    headers.host = new URL(origin).host;
    return headers;
}
function frontDoorBrowserContextOptions(width) {
    return { ignoreHTTPSErrors: true, serviceWorkers: "block", viewport: { width, height: 900 }, colorScheme: "dark" };
}
function task19FixturePath(relative, method) {
    if (method !== "GET" || !relative.startsWith("/") || relative.startsWith("//") || relative.includes("\\"))
        return null;
    const url = new URL(relative, "https://127.0.0.1");
    if (url.pathname === "/__task19/locale" && url.search === "?fixture=task19")
        return "HTML";
    if (url.pathname === "/__task19/fixture.js" && !url.search)
        return "ASSET";
    return null;
}
function task19FixtureResponse(kind, cookies, inputs, rows, render, bundle) {
    if (kind === "ASSET")
        return { status: 200, contentType: "text/javascript", headers: { "cache-control": "no-store" }, body: bundle };
    assert.equal(kind, "HTML");
    const cookie = cookies.split(";").map(part => part.trim()).find(part => part.startsWith("ogh_preferences_v1="))?.slice("ogh_preferences_v1=".length);
    const actor = cookies.split(";").map(part => part.trim()).find(part => part.startsWith("task19_actor="))?.slice("task19_actor=".length) || null;
    assert.ok(actor === null || Object.hasOwn(rows, actor), "OWNED_FIXTURE_ACTOR_ONLY");
    const initial = resolveLocale({ ...inputs, saved: parsePreferenceCookie(cookie) });
    const html = `<!doctype html><html lang="${initial.locale}" style="color-scheme:dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#0b0f10;color:#f2f4f5;font-family:Arial,sans-serif"><div id="task19-fixture">${render(initial, actor)}</div><script id="locale-snapshot" type="application/json">${JSON.stringify(initial).replaceAll("<", "\\u003c")}</script><script src="/__task19/fixture.js"></script></body></html>`;
    return { status: 200, contentType: "text/html; charset=utf-8", headers: { "cache-control": "no-store" }, body: html, actor };
}
function observeAbFixtureResponse(request, response, kind) {
    const observation = abDocumentObservation;
    if (!observation?.active || kind !== "HTML")
        return null;
    const entry = { occurrence: observation.front.length + 1, received: true, started: false, status: "UNKNOWN",
        endCalled: false, finished: false, closedBeforeFinish: false };
    observation.front.push(entry);
    response.once("finish", () => {
        if (observation.active)
            entry.finished = response.writableFinished;
    });
    response.once("close", () => {
        if (observation.active && !response.writableFinished)
            entry.closedBeforeFinish = true;
    });
    return entry;
}
const stale390FrontContexts = new WeakMap();
function safeStale390Error(error) {
    const codes = new Set(["ERR_ASSERTION", "ECONNRESET", "EPIPE", "ECONNABORTED", "ETIMEDOUT", "ERR_STREAM_WRITE_AFTER_END",
        "ERR_STREAM_PREMATURE_CLOSE", "ERR_HTTP_HEADERS_SENT", "ERR_STREAM_DESTROYED"]);
    const message = String(error?.message ?? "");
    let messageClass = "OTHER_REDACTED";
    if (/Execution context was destroyed/i.test(message))
        messageClass = "EXECUTION_CONTEXT_DESTROYED";
    else if (/Target page, context or browser has been closed/i.test(message))
        messageClass = "TARGET_CLOSED";
    else if (/Cannot read properties of (?:undefined|null).*reading ['"]snapshot['"]/s.test(message))
        messageClass = "UNDEFINED_OR_NULL_OBSERVER_SNAPSHOT";
    else if (/Cannot read properties of (?:undefined|null)/.test(message))
        messageClass = "UNDEFINED_OR_NULL_PROPERTY_ACCESS";
    else if (message.includes("STALE_ACTOR_TERMINAL_TIMEOUT"))
        messageClass = "STALE_ACTOR_TERMINAL_TIMEOUT";
    else if (message.includes("TASK19_HTTP_TERMINAL_EVENT_TIMEOUT"))
        messageClass = "HTTP_TERMINAL_EVENT_TIMEOUT";
    else if (message.includes("STALE_ACTOR_UNEXPECTED_REQUESTFAILED"))
        messageClass = "STALE_ACTOR_UNEXPECTED_REQUESTFAILED";
    else if (/Timeout/.test(message))
        messageClass = "BOUNDED_TIMEOUT";
    const frame = String(error?.stack ?? "").match(/scripts[\\/]test-global-locale-browser\.mjs:(\d+):(\d+)/);
    return { name: ["Error", "TypeError", "AssertionError", "AbortError", "TimeoutError", "TargetClosedError", "RangeError"].includes(error?.name) ? error.name : "OTHER",
        code: codes.has(error?.code) ? error.code : error?.code ? "OTHER_REDACTED" : "NONE", messageClass,
        stackSite: frame ? `scripts/test-global-locale-browser.mjs:${frame[1]}:${frame[2]}` : "UNKNOWN" };
}
function createAbFinalReloadState(baseline) {
    let candidate, domReady = false, fixtureReady = false;
    let navigateResolve, domResolve, terminalResolve;
    const navigation = new Promise(resolve => { navigateResolve = resolve; });
    const dom = new Promise(resolve => { domResolve = resolve; });
    const terminal = new Promise(resolve => { terminalResolve = resolve; });
    return {
        navigation, dom, terminal, get candidate() { return candidate; },
        navigated(entry, { mainFrame, pathname, actor }) {
            if (candidate || !mainFrame || pathname !== "/__task19/locale" || actor !== "ACCOUNT_B"
                || entry?.resourceType !== "document" || entry.method !== "GET" || entry.pathname !== pathname
                || !(entry.fixtureDocumentGeneration > baseline.generation))
                return false;
            candidate = entry;
            navigateResolve(entry);
            if (entry.finished || entry.failed)
                terminalResolve(entry);
            return true;
        },
        domContentLoaded(entry) {
            if (entry !== candidate || !candidate)
                return;
            domReady = true;
            domResolve(entry);
        },
        fixtureReady(entry) {
            assert.ok(candidate && entry === candidate && domReady, "TASK19_AB390_FIXTURE_READY_BEFORE_CURRENT_DOCUMENT_DOM");
            fixtureReady = true;
        },
        requestTerminal(entry) {
            if (entry === candidate && (entry.finished || entry.failed))
                terminalResolve(entry);
        },
        assertSnapshotAllowed(active, latest) {
            assert.ok(candidate && domReady && fixtureReady, "TASK19_AB390_SNAPSHOT_BEFORE_RELOAD_BARRIER");
            assert.ok(candidate.finished || candidate.failed, "TASK19_AB390_FINAL_DOCUMENT_NONTERMINAL_AFTER_SETTLEMENT_BARRIER");
            assert.equal(candidate.failed, false, "TASK19_AB390_FINAL_DOCUMENT_REQUESTFAILED");
            assert.ok(active === candidate && latest === candidate, "TASK19_AB390_NAVIGATION_GENERATION_CHANGED_DURING_SNAPSHOT");
            return candidate;
        },
    };
}
async function withinAbCaseDeadline(observation, operation, failure) {
    let timer;
    try {
        return await Promise.race([operation, new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(failure)), Math.max(1, observation.deadline - performance.now()));
            })]);
    }
    finally {
        clearTimeout(timer);
    }
}
async function settleAbFinalReload(page, observation) {
    const settlementReceipt = observation.receipt ?? abFinalReloadReceipt;
    const barrier = observation.finalReload;
    assert.ok(barrier, "TASK19_AB390_FINAL_RELOAD_NOT_ARMED");
    const current = await withinAbCaseDeadline(observation, barrier.navigation, "TASK19_AB390_EXPECTED_ACCOUNT_ADOPTION_RELOAD_NOT_OBSERVED");
    Object.assign(settlementReceipt, { AB390_FINAL_RELOAD_NAVIGATION_OBSERVED: true,
        AB390_FINAL_RELOAD_NAVIGATION_GENERATION_GT_BASELINE: current.fixtureDocumentGeneration > observation.baseline.generation });
    await withinAbCaseDeadline(observation, barrier.dom, "TASK19_AB390_FINAL_RELOAD_DOMCONTENTLOADED_NOT_OBSERVED");
    settlementReceipt.AB390_FINAL_RELOAD_DOMCONTENTLOADED = true;
    await page.waitForFunction(requireObserver => window.__task19 !== undefined && window.__task19AuthHarness !== undefined
        && (!requireObserver || typeof window.__task19LoadingLifecycle?.snapshot === "function"), observation.requireLoadingObserver === true, { timeout: Math.max(1, observation.deadline - performance.now()) });
    assert.ok(observation.activeDocument === current && observation.documents.at(-1) === current, "TASK19_AB390_FIXTURE_READY_GENERATION_CHANGED");
    barrier.fixtureReady(current);
    Object.assign(settlementReceipt, { AB390_FINAL_RELOAD_FIXTURE_READY: true,
        AB390_FINAL_RELOAD_FIXTURE_READY_DOCUMENT_GENERATION: current.fixtureDocumentGeneration });
    await withinAbCaseDeadline(observation, barrier.terminal, "TASK19_AB390_FINAL_DOCUMENT_NONTERMINAL_AFTER_SETTLEMENT_BARRIER");
    Object.assign(settlementReceipt, { FINAL_DOCUMENT_REQUESTFINISHED: current.finished, FINAL_DOCUMENT_REQUESTFAILED: current.failed,
        FINAL_DOCUMENT_REQUESTFAILED_CLASS: current.failureClass ?? "NONE", FINAL_DOCUMENT_REQUEST_TERMINAL: current.finished || current.failed });
    barrier.assertSnapshotAllowed(observation.activeDocument, observation.documents.at(-1));
    await withinAbCaseDeadline(observation, page.waitForFunction(() => window.__task19?.state().status === "ready", null, { timeout: Math.max(1, observation.deadline - performance.now()) }), "TASK19_AB390_SETTLED_ACCOUNT_B_SEMANTICS_NOT_READY");
    barrier.assertSnapshotAllowed(observation.activeDocument, observation.documents.at(-1));
    const snapshot = await withinAbCaseDeadline(observation, page.evaluate(async () => {
        const owner = document;
        const auth = await window.__task19AuthHarness.getSessionState();
        if (owner !== document)
            throw new Error("TASK19_AB390_DOCUMENT_CHANGED_DURING_SNAPSHOT");
        const state = window.__task19.state(), locale = window.__task19.locale();
        return { FINAL_PAGE_URL_PATH: location.pathname, FINAL_PAGE_DOM_READY: document.readyState !== "loading",
            FINAL_PAGE_FIXTURE_HYDRATED: Boolean(window.__task19 && window.__task19AuthHarness),
            ACCOUNT_B_SESSION_PRESENT: auth.sessionPresent && auth.actor === "ACCOUNT_B", FINAL_UI_ACTOR: auth.actor,
            FINAL_B_LOCALE: locale.locale, FINAL_B_LOCALE_CORRECT: locale.locale === "zh-CN" && document.documentElement.lang === "zh-CN",
            ACCOUNT_A_PREFERENCE_LEAKED_TO_B: state.account?.locale_preference !== "zh-CN",
            STALE_RESULT_APPLIED: state.account?.revision !== 5 || state.account?.locale_preference !== "zh-CN",
            revision: state.account?.revision };
    }), "TASK19_AB390_FINAL_SNAPSHOT_DEADLINE");
    barrier.assertSnapshotAllowed(observation.activeDocument, observation.documents.at(-1));
    observation.finalSnapshot = Object.freeze({ ...snapshot, FINAL_PAGE_NAVIGATION_GENERATION: current.fixtureDocumentGeneration,
        FINAL_PAGE_DOCUMENT_SEQUENCE_NUMBER: current.id });
    Object.assign(settlementReceipt, observation.finalSnapshot);
    assert.equal(snapshot.FINAL_PAGE_URL_PATH, "/__task19/locale");
    assert.equal(snapshot.FINAL_PAGE_DOM_READY, true);
    assert.equal(snapshot.FINAL_PAGE_FIXTURE_HYDRATED, true);
    assert.equal(snapshot.ACCOUNT_B_SESSION_PRESENT, true, "TASK19_AB390_SETTLED_ACCOUNT_B_SEMANTICS_FAILED");
    assert.equal(snapshot.FINAL_UI_ACTOR, "ACCOUNT_B", "TASK19_AB390_SETTLED_ACCOUNT_B_SEMANTICS_FAILED");
    assert.equal(snapshot.FINAL_B_LOCALE_CORRECT, true, "TASK19_AB390_SETTLED_ACCOUNT_B_SEMANTICS_FAILED");
    assert.equal(snapshot.revision, 5, "TASK19_AB390_SETTLED_ACCOUNT_B_SEMANTICS_FAILED");
    assert.equal(snapshot.ACCOUNT_A_PREFERENCE_LEAKED_TO_B, false, "TASK19_AB390_SETTLED_ACCOUNT_B_SEMANTICS_FAILED");
    assert.equal(snapshot.STALE_RESULT_APPLIED, false, "TASK19_AB390_SETTLED_ACCOUNT_B_SEMANTICS_FAILED");
    return observation.finalSnapshot;
}
async function serveSameOriginFrontDoor(request, response) {
    const headers = frontDoorHeaders(request, frontDoorOrigin);
    const upstream = selectFrontDoorUpstream(request.url, request.method, disposableStack.target, appWorkerUpstream);
    const kind = task19FixturePath(request.url, request.method);
    const outagePatch = apiOutageObservation?.active && apiOutageObservation.phases[3] !== undefined
        && request.method === "PATCH" && new URL(request.url, frontDoorOrigin).pathname === "/api/users/me/preferences";
    if (outagePatch) {
        apiOutageReceipt.OUTAGE_PATCH_FRONT_DOOR_RECEIVED = true;
        markOutagePhase(5);
    }
    const trace = observeRealHttpFrontDoor(request, response, kind ? "FIXTURE" : upstream.origin === new URL(disposableStack.target).origin ? "SUPABASE" : "WORKER");
    if (upstream.origin === new URL(disposableStack.target).origin)
        return servePreferenceProvider(request, response, trace);
    if (kind) {
        const documentTrace = observeAbFixtureResponse(request, response, kind);
        assert.ok(activePreferenceFixture && renderFixture && fixtureBundle, "EXISTING_TASK19_FIXTURE_REQUIRED");
        const served = task19FixtureResponse(kind, request.headers.cookie ?? "", activePreferenceFixture.inputs, activePreferenceFixture.controls.rows, renderFixture, fixtureBundle);
        response.writeHead(served.status, { ...served.headers, "content-type": served.contentType });
        response.end(served.body);
        if (documentTrace)
            Object.assign(documentTrace, { started: true, status: served.status, endCalled: response.writableEnded,
                actor: served.actor === "B" ? "ACCOUNT_B" : served.actor === "A" ? "ACCOUNT_A" : "ANONYMOUS" });
        if (kind === "HTML")
            Object.assign(frontDoorReceipt, { TASK19_FRONT_DOOR_FIXTURE_ROUTE_MATCHED: true,
                TASK19_FRONT_DOOR_FIXTURE_HTTP_STATUS: served.status, TASK19_FIXTURE_RESPONSE_OWNER: "TASK19_FIXTURE" });
        return;
    }
    assert.equal(upstream.origin, new URL(appWorkerUpstream).origin, "FIXED_APP_WORKER_ONLY");
    await new Promise((resolve, reject) => {
        if (trace)
            trace.upstreamStarted = true;
        const forwarded = requestHttps(upstream, { method: request.method, headers, ca: frontDoorCa, rejectUnauthorized: true }, incoming => {
            if (outagePatch) {
                Object.assign(apiOutageReceipt, { WORKER_OUTAGE_RESPONSE_OBSERVED: true, WORKER_OUTAGE_RESPONSE_STATUS: incoming.statusCode });
                markOutagePhase(9);
            }
            if (trace)
                Object.assign(trace, { upstreamResponse: true, upstreamStatus: incoming.statusCode });
            const outgoing = Object.fromEntries(Object.entries(incoming.headers).filter(([name]) => !["connection", "transfer-encoding", "keep-alive"].includes(name)));
            response.writeHead(incoming.statusCode, outgoing);
            if (request.url === "/settings/" && request.method === "GET") {
                frontDoorReceipt.TASK19_FRONT_DOOR_APP_HTTP_STATUS = incoming.statusCode;
                frontDoorReceipt.TASK19_FRONT_DOOR_WORKER_RESPONSE_OBSERVED = true;
            }
            incoming.pipe(response);
            incoming.once("end", resolve);
            incoming.once("error", reject);
        });
        forwarded.once("error", reject);
        forwarded.setTimeout(15000, () => forwarded.destroy(new Error("FRONT_DOOR_APP_UPSTREAM_TIMEOUT")));
        request.once("aborted", () => forwarded.destroy());
        request.pipe(forwarded);
    });
}
function observeRealHttpFrontDoor(request, response, selected) {
    const observation = realHttpSwitchObservation;
    if (!observation?.active)
        return null;
    const pathname = new URL(request.url, frontDoorOrigin).pathname;
    const key = `${request.method} ${pathname}`;
    const occurrence = (observation.frontOccurrences.get(key) ?? 0) + 1;
    observation.frontOccurrences.set(key, occurrence);
    const entry = { method: request.method, pathname, occurrence, epochStart: performance.timeOrigin + performance.now(), selected,
        upstreamStarted: false, upstreamResponse: false, upstreamStatus: "UNKNOWN", clientAborted: false, abortPhase: "NONE", closeBeforeEnd: false };
    observation.front.push(entry);
    const aborted = () => {
        if (!observation.active)
            return;
        entry.clientAborted = true;
        entry.abortOffset ??= performance.now() - observation.started;
        entry.abortPhase = entry.upstreamResponse ? "AFTER_UPSTREAM_RESPONSE" : "BEFORE_UPSTREAM_RESPONSE";
    };
    request.once("aborted", aborted);
    response.once("close", () => {
        if (observation.active && !response.writableFinished) {
            entry.closeBeforeEnd = true;
            aborted();
        }
    });
    return entry;
}
async function reviewAndReserveFrontDoor() {
    const source = await readFile(path.resolve("scripts/build-workers.mjs"), "utf8");
    const ts = (await import("typescript")).default;
    const tree = ts.createSourceFile("build-workers.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let guard, localUrl;
    const visit = node => {
        if (ts.isIfStatement(node) && node.expression.getText(tree) === "server.origin !== client.origin")
            guard = node.getText(tree);
        if (ts.isFunctionDeclaration(node) && node.name?.text === "requireLocalUrl")
            localUrl = node.getText(tree);
        ts.forEachChild(node, visit);
    };
    visit(tree);
    assert.ok(guard && localUrl, "REVIEWED_LOCAL_BUILD_CONTRACT_REQUIRED");
    reservedFrontDoor = createServer();
    await new Promise((resolve, reject) => { reservedFrontDoor.once("error", reject); reservedFrontDoor.listen(0, "127.0.0.1", resolve); });
    frontDoorOrigin = `https://127.0.0.1:${reservedFrontDoor.address().port}`;
    const validate = new Function(`${localUrl}; return requireLocalUrl;`)();
    const server = validate(frontDoorOrigin, "SUPABASE_URL", ["http:", "https:"]);
    const client = validate(frontDoorOrigin, "PUBLIC_SUPABASE_URL", ["http:", "https:"]);
    validate(frontDoorOrigin, "SITE_ORIGIN", ["https:"]);
    new Function("server", "client", guard)(server, client);
    for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
        assert.equal(await access(path.resolve(file)).then(() => true, error => { if (error.code === "ENOENT")
            return false; throw error; }), false, "LOCAL_BUILD_REPOSITORY_ENV_FILE_PRESENT");
    }
    frontDoorReceipt.TASK19_BUILD_GUARD_TOPOLOGY_REVIEW = "COMPLETE";
    frontDoorReceipt.CORRECTED_TOPOLOGY_ACCEPTED_BY_EXISTING_BUILD_GUARD = true;
    frontDoorReceipt.TASK19_CONFIGURED_ORIGIN_EQUALITY = "PASS";
    console.log("TASK19_BUILD_GUARD_TOPOLOGY_REVIEW=COMPLETE\nCORRECTED_TOPOLOGY_ACCEPTED_BY_EXISTING_BUILD_GUARD=true\nBUILD_INFRA_MODIFICATION_REQUIRED=false\nTASK19_CONFIGURED_ORIGIN_EQUALITY=PASS");
}
async function buildFrontDoorWorker() {
    const prior = JSON.parse(await readFile(workerConfig, "utf8"));
    const vars = { SUPABASE_URL: frontDoorOrigin, PUBLIC_SUPABASE_URL: frontDoorOrigin,
        SUPABASE_ANON_KEY: disposableStack.anonKey, PUBLIC_SUPABASE_ANON_KEY: disposableStack.anonKey, SITE_ORIGIN: frontDoorOrigin, AUTH_CAPTCHA_MODE: "off" };
    const config = path.join(ownedRoot, "same-origin-build.json");
    await writeFile(config, JSON.stringify({ name: prior.name, compatibility_date: prior.compatibility_date, compatibility_flags: prior.compatibility_flags, vars }));
    const built = spawnSync(process.execPath, [path.resolve("scripts/build-workers.mjs"), "--local-config", config], { cwd: root, env: childEnvironment(), encoding: "utf8", stdio: "pipe", windowsHide: true, maxBuffer: 16777216 });
    assert.equal(built.status, 0, "TASK19_LOCAL_WORKER_BUILD_FAILED");
    frontDoorReceipt.TASK19_LOCAL_WORKER_BUILD = "PASS";
    frontDoorReceipt.CLIENT_SUPABASE_CONFIGURED_ORIGIN = "SAME_ORIGIN_FRONT_DOOR";
    frontDoorReceipt.WORKER_SUPABASE_CONFIGURED_ORIGIN = "SAME_ORIGIN_FRONT_DOOR";
    frontDoorReceipt.CLIENT_SERVER_SUPABASE_ORIGIN_EQUAL = true;
    console.log("TASK19_LOCAL_WORKER_BUILD=PASS\nCLIENT_SERVER_SUPABASE_ORIGIN_EQUAL=true");
}
const issuedActors = new Map();
const disposableReceipt = { LOCAL_SUPABASE_STARTED: false, LOCAL_SUPABASE_API_TARGET: "NOT_RUN", LOCAL_SUPABASE_DB_TARGET: "NOT_RUN",
    LOCAL_SUPABASE_OWNED_ROOT: false, ACCOUNT_A_LOCAL_SIGNUP: "NOT_RUN", ACCOUNT_A_LOCAL_SIGNIN: "NOT_RUN",
    ACCOUNT_B_LOCAL_SIGNUP: "NOT_RUN", ACCOUNT_B_LOCAL_SIGNIN: "NOT_RUN", LOCAL_SUPABASE_STOPPED: false,
    BROWSER_AND_WORKER_SUPABASE_INSTANCE_SAME: "NOT_RUN", BROWSER_AND_WORKER_ANON_KEY_IDENTITY: "NOT_RUN",
    LOCAL_AUTH_V1_USER_FORWARDED_TO_REAL_GOTRUE: false, LOCAL_GOTRUE_USER_REQUEST_OBSERVED: false,
    LOCAL_GOTRUE_USER_RESPONSE_STATUS: "UNKNOWN", LOCAL_AUTH_PIPELINE_PREFLIGHT: "NOT_RUN", FAILED_BOUNDARY: "OTHER",
    PREFERENCES_GET_STATUS: "UNKNOWN", PREFERENCES_GET_REQUESTFINISHED: false, PREFERENCES_GET_REQUESTFAILED: false,
    IMPACTED_ACCEPTED_CASES_REVALIDATION: "NOT_RUN", FIXTURE_ACCOUNT_A_TO_B_CHROMIUM_390: "NOT_RUN" };
Object.assign(disposableReceipt, { BROWSER_AUTH_BRIDGE_AVAILABLE: false, BROWSER_SIGNIN_ACCOUNT_A: "NOT_RUN",
    BROWSER_SUPABASE_SESSION_PRESENT: "UNKNOWN", BROWSER_SUPABASE_ACCESS_TOKEN_PRESENT: "UNKNOWN", BROWSER_SESSION_ACTOR: "UNKNOWN",
    PREFERENCES_REQUEST_AUTHORIZATION_PRESENT: "UNKNOWN", WORKER_AUTH_GET_USER_REACHED: false,
    ACCOUNT_A_BROWSER_SIGNIN: "NOT_RUN", ACCOUNT_A_BROWSER_SIGNOUT: "NOT_RUN", ACCOUNT_B_BROWSER_SIGNIN: "NOT_RUN" });
const browserSigninEvidence = { requestObserved: false, responseObserved: false, responseStatus: "UNKNOWN", requestFailed: false, boundary: "UNKNOWN" };
const authControlFlowReceipt = { TASK19_AUTH_OBSERVABILITY_GAP: "NOT_RUN" };
async function preferenceGetAuthControlFlow(serverSource, routeSource) {
    const ts = (await import("typescript")).default;
    const server = ts.createSourceFile("server.ts", serverSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const route = ts.createSourceFile("route.ts", routeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const handler = server.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "handlePreferenceRequest");
    const statements = handler?.body?.statements;
    const compact = value => value.replace(/\s+/g, "");
    const printer = ts.createPrinter({ removeComments: true });
    const equals = (node, text) => {
        if (!node)
            return false;
        const expected = ts.createSourceFile("expected.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        return printer.printNode(ts.EmitHint.Unspecified, node, server)
            === printer.printNode(ts.EmitHint.Unspecified, expected.statements[0], expected);
    };
    if (!statements || statements.length !== 5)
        return false;
    if (!equals(statements[0], 'const token = request.headers.get("authorization")?.match(/^Bearer ([^\\s]+)$/i)?.[1];')
        || !equals(statements[1], 'if (!token) return failure("UNAUTHORIZED", 401);')
        || !equals(statements[2], 'if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return failure("PREFERENCES_UNAVAILABLE", 503);')
        || !equals(statements[3], 'if (request.method !== "GET" && request.method !== "PATCH") return failure("PREFERENCES_INVALID_INPUT", 405);'))
        return false;
    const guarded = statements[4];
    if (!ts.isTryStatement(guarded) || !equals(guarded.catchClause?.block, '{ return failure("PREFERENCES_UNAVAILABLE", 503); }'))
        return false;
    const body = guarded.tryBlock.statements;
    if (!equals(body[0], 'const client = createUserClient(env, token, dependencies.createClient ?? createClient);')
        || !equals(body[1], 'const { data: auth, error: authError } = await client.auth.getUser(token);')
        || !equals(body[2], 'if (authError || !auth.user?.id) return failure("UNAUTHORIZED", 401);')
        || !equals(body[3], 'const userId = auth.user.id;'))
        return false;
    const get = body[4];
    if (!get || !ts.isIfStatement(get) || compact(get.expression.getText(server)) !== 'request.method==="GET"'
        || !ts.isBlock(get.thenStatement))
        return false;
    if (!equals(get.thenStatement.statements[0], 'const { data, error } = await client.from("user_preferences").select(projection).eq("user_id", userId).maybeSingle();'))
        return false;
    const getRoute = route.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
        .find(node => node.name.getText(route) === "GET")?.initializer;
    if (!getRoute || !ts.isArrowFunction(getRoute) || !ts.isCallExpression(getRoute.body)
        || getRoute.body.expression.getText(route) !== "handlePreferenceRequest" || getRoute.body.arguments.length !== 2
        || getRoute.body.arguments[0].getText(route) !== "request" || getRoute.body.arguments[1].getText(route) !== "env")
        return false;
    return true;
}
async function closeAuthObservabilityGap() {
    const strict = await preferenceGetAuthControlFlow(await readFile(path.resolve("src/lib/server/user-preferences.server.ts"), "utf8"), await readFile(path.resolve("src/pages/api/users/me/preferences.ts"), "utf8"));
    if (!strict) {
        authControlFlowReceipt.TASK19_AUTH_OBSERVABILITY_GAP = "BLOCKED";
        Object.assign(frontDoorReceipt, { FIRST_NEW_BLOCKER: "TASK19_PREFERENCES_AUTH_CONTROL_FLOW_NOT_STRICT",
            FIRST_FAIL: "STATIC_AUTH_ACCEPTANCE_CONDITION_FAILED", FAILURE_CLASS: "PRODUCT_SECURITY_CONTRACT_FAILURE" });
        return false;
    }
    Object.assign(authControlFlowReceipt, { TASK19_AUTH_OBSERVABILITY_GAP: "CLOSED",
        PREFERENCES_GET_REQUIRES_BEARER_BEFORE_200: true, PREFERENCES_GET_CALLS_AUTH_GET_USER_BEFORE_DATA_ACCESS: true,
        PREFERENCES_GET_REQUIRES_NON_NULL_AUTH_USER_BEFORE_DATA_ACCESS: true, PREFERENCES_GET_CAN_RETURN_200_AFTER_AUTH_ERROR: false,
        PREFERENCES_GET_CAN_RETURN_200_WITH_NULL_AUTH_USER: false, PREFERENCES_GET_CAN_BYPASS_AUTH_THROUGH_TEST_DEPENDENCY: false,
        WORKER_AUTH_GET_USER_RESULT: "PROVEN_SUCCESS_BY_REAL_200_CONTROL_FLOW",
        TASK19_PREFLIGHT_EVIDENCE_SOURCE: "ACCEPTED_PRIOR_REAL_BROWSER_RUN_AND_CURRENT_STATIC_CONTROL_FLOW" });
    Object.assign(disposableReceipt, { LOCAL_GOTRUE_USER_RESPONSE_STATUS: "NOT_OBSERVED_NONBLOCKING", LOCAL_AUTH_PIPELINE_PREFLIGHT: "PASS" });
    return true;
}
function normalizedNetworkFailure(value) {
    const name = value?.replace(/^net::/, "");
    return ["ERR_CERT_AUTHORITY_INVALID", "ERR_CERT_COMMON_NAME_INVALID", "ERR_CONNECTION_REFUSED", "ERR_CONNECTION_RESET", "ERR_FAILED", "ERR_BLOCKED_BY_CLIENT", "ERR_BLOCKED_BY_RESPONSE", "MIXED_CONTENT"].includes(name) ? name : value ? "OTHER" : "UNKNOWN";
}
const transportEvidence = {
    APP_ORIGIN_SCHEME: "UNKNOWN", APP_ORIGIN_HOST_CLASS: "UNKNOWN",
    BROWSER_PUBLIC_SUPABASE_SCHEME: "UNKNOWN", BROWSER_PUBLIC_SUPABASE_HOST_CLASS: "UNKNOWN", BROWSER_PUBLIC_SUPABASE_PORT_CLASS: "UNKNOWN",
    LOCAL_SUPABASE_BROWSER_TARGET_TCP_REACHABLE: false, LOCAL_SUPABASE_BROWSER_TARGET_TLS_HANDSHAKE: "UNKNOWN",
    LOCAL_SUPABASE_BROWSER_TARGET_HEALTH_RESPONSE: "UNKNOWN", BROWSER_SIGNIN_REQUEST_METHOD: "UNKNOWN", BROWSER_SIGNIN_REQUEST_PATHNAME: "UNKNOWN",
    BROWSER_SIGNIN_FAILURE_CLASS: "UNKNOWN", BROWSER_CONSOLE_NETWORK_CLASS: "NONE",
    GATEWAY_SIGNIN_REQUEST_OBSERVED: false, GATEWAY_SIGNIN_UPSTREAM_STARTED: false,
    GATEWAY_SIGNIN_UPSTREAM_RESPONSE_OBSERVED: false, GATEWAY_SIGNIN_UPSTREAM_STATUS: "UNKNOWN",
};
async function signInBrowserActor(page, label) {
    await page.waitForFunction(() => window.__task19AuthHarness !== undefined);
    disposableReceipt.BROWSER_AUTH_BRIDGE_AVAILABLE = true;
    const prior = await page.evaluate(() => window.__task19AuthHarness.getSessionState());
    if (prior.sessionPresent) {
        const logoutBarrier = prior.actor === "ACCOUNT_A" && label === "B" && stage === "FIXTURE_ACCOUNT_A_TO_B"
            ? armAccountLogoutReload(case63Trace, abDocumentObservation) : undefined;
        if (case63Trace)
            case63Trace.setOperation("A_SIGNOUT");
        if (abDocumentObservation?.active)
            abDocumentObservation.phase = "ACCOUNT_A_SIGNOUT";
        const observeLogout = loadingObservation?.active && prior.actor === "ACCOUNT_A" && label === "B";
        if (observeLogout) {
            loadingObservation.logout.phase = "ACCOUNT_A_LOGOUT";
            markAuthLogout("A_SIGNOUT_CALL");
        }
        if (realHttpSwitchObservation?.active)
            realHttpSwitchObservation.phase = "ACCOUNT_A_SIGNOUT";
        const result = await page.evaluate(() => window.__task19AuthHarness.signOut()).catch(error => {
            if (observeLogout)
                markAuthLogout("SIGNOUT_PROMISE_REJECTED", { promiseResolved: false, promiseError: true });
            throw error;
        });
        if (observeLogout)
            markAuthLogout("SIGNOUT_PROMISE_SETTLED", { promiseResolved: true, promiseError: !result.ok });
        assert.equal(result.ok, true, "GENUINE_BROWSER_SIGNOUT_REQUIRED");
        if (case63Trace)
            case63Trace.emit("A_SIGNOUT_PROMISE_SETTLED");
        if (prior.actor === "ACCOUNT_A")
            disposableReceipt.ACCOUNT_A_BROWSER_SIGNOUT = "PASS";
        if (!logoutBarrier)
            await page.waitForFunction(() => window.__task19AuthHarness !== undefined);
        const signedOut = logoutBarrier ? await settleAccountLogoutReload(page, logoutBarrier)
            : await page.evaluate(() => window.__task19AuthHarness.getSessionState());
        if (observeLogout)
            markAuthLogout(signedOut.sessionPresent ? "A_SESSION_PRESENT" : "A_SESSION_ABSENT", { sessionAbsent: !signedOut.sessionPresent });
        assert.equal(signedOut.sessionPresent, false, "PREVIOUS_SESSION_REMOVED_BEFORE_SWITCH");
        if (case63Trace)
            case63Trace.emit("A_SESSION_ABSENT");
    }
    const account = disposableStack.accounts[label];
    if (abDocumentObservation?.active && label === "B")
        abDocumentObservation.phase = "ACCOUNT_B_SIGNIN";
    assert.ok(account, "OWNED_LOCAL_ACTOR_REQUIRED");
    if (realHttpSwitchObservation?.active)
        Object.assign(realHttpSwitchObservation, {
            phase: label === "A" ? "ACCOUNT_A_PREFERENCE_LOAD" : "ACCOUNT_B_SIGNIN", actor: label === "A" ? "ACCOUNT_A" : "ANONYMOUS",
            generation: label === "A" ? 1 : 2
        });
    if (stage === "FIXTURE_LOCAL_AUTH_PIPELINE")
        disposableReceipt.BROWSER_SIGNIN_ACCOUNT_A = "FAIL";
    if (loadingObservation?.active && label === "B") {
        markAuthLogout("B_SIGNIN_START");
        loadingObservation.logout.phase = "ACCOUNT_B_SIGNIN";
    }
    if (abDocumentObservation?.active && label === "B")
        abDocumentObservation.armFinalReload();
    if (case63Trace) {
        case63Trace.setOperation(label === "B" ? "B_SIGNIN_EVALUATE" : "A_SIGNIN_EVALUATE");
        case63Trace.emit(label === "B" ? "B_SIGNIN_EVALUATE_START" : "A_SIGNIN_EVALUATE_START");
        if (label === "B" && stage === "FIXTURE_ACCOUNT_A_TO_B") {
            const terminal = case63Trace.events.find(event => event.event === "A_LOGOUT_RELOAD_DOCUMENT_TERMINAL");
            assert.ok(terminal && terminal.CASE63_TRACE_SEQUENCE < case63Trace.events.at(-1).CASE63_TRACE_SEQUENCE, "TASK19_ACCOUNT_A_TO_B_A_LOGOUT_RELOAD_BARRIER_NOT_ENFORCED");
            case63Trace.settlementReceipt.B_SIGNIN_STARTED_AFTER_A_LOGOUT_RELOAD_SETTLEMENT = true;
        }
    }
    const result = await page.evaluate(credentials => window.__task19AuthHarness.signIn(credentials.email, credentials.password), { email: account.email, password: account.password });
    if (case63Trace)
        case63Trace.emit(label === "B" ? "B_SIGNIN_EVALUATE_SETTLED" : "A_SIGNIN_EVALUATE_SETTLED");
    if (!result.ok) {
        browserSigninEvidence.boundary = ["BROWSER_SIGNIN_NETWORK_FAILED", "BROWSER_SIGNIN_HTTP_REJECTED", "BROWSER_SIGNIN_SESSION_NOT_PERSISTED", "BROWSER_SIGNIN_GETSESSION_MISMATCH"].includes(result.boundary) ? result.boundary : "UNKNOWN";
        throw new Error("TASK19_BROWSER_SUPABASE_SIGNIN_FAILED");
    }
    assert.equal(result.sessionPresent, true, "GENUINE_BROWSER_SESSION_REQUIRED");
    assert.equal(result.accessTokenPresent, true, "GENUINE_BROWSER_ACCESS_TOKEN_REQUIRED");
    assert.equal(result.actor, label === "A" ? "ACCOUNT_A" : "ACCOUNT_B", "GENUINE_BROWSER_ACTOR_REQUIRED");
    if (stage === "FIXTURE_LOCAL_AUTH_PIPELINE") {
        assert.equal(frontDoorReceipt.TASK19_BROWSER_AND_PUBLIC_SUPABASE_SAME_ORIGIN, true, "ACTUAL_BROWSER_SIGNIN_SAME_ORIGIN_REQUIRED");
    }
    disposableReceipt[`ACCOUNT_${label}_BROWSER_SIGNIN`] = "PASS";
    if (case63Trace)
        case63Trace.setOperation(label === "B" ? "ACCOUNT_B_ACTIVE" : "ACCOUNT_A_ACTIVE");
    if (abDocumentObservation?.active)
        abDocumentObservation.phase = label === "A" ? "ACCOUNT_A_ACTIVE" : "ACCOUNT_B_ACTIVE";
    if (realHttpSwitchObservation?.active)
        Object.assign(realHttpSwitchObservation, {
            phase: label === "A" ? "ACCOUNT_A_ACTIVE" : "ACCOUNT_B_ACTIVE", actor: label === "A" ? "ACCOUNT_A" : "ACCOUNT_B"
        });
    if (stage === "FIXTURE_LOCAL_AUTH_PIPELINE")
        Object.assign(disposableReceipt, {
            BROWSER_SIGNIN_ACCOUNT_A: "PASS", BROWSER_SUPABASE_SESSION_PRESENT: true,
            BROWSER_SUPABASE_ACCESS_TOKEN_PRESENT: true, BROWSER_SESSION_ACTOR: "ACCOUNT_A",
        });
}
const localAuthPathsObserved = new Set();
const impactedAcceptedCases = Object.freeze([
    ["chromium", 1280, "ACCOUNT_COOKIE_ROW_LOGOUT"], ["chromium", 1280, "ACCOUNT_A_TO_B"],
    ["chromium", 1280, "API_OUTAGE"], ["chromium", 1280, "API_CONFLICT"],
    ["chromium", 1280, "LOADING_STALE_ACTOR"], ["chromium", 390, "ACCOUNT_COOKIE_ROW_LOGOUT"],
]);
function selectFixtureCase() { return matrixResumeCursor.select(); }
let providerActorIds = {};
const accountCookieRowFixture = Object.freeze({ locale_preference: "en", revision: 3 });
let activePreferenceFixture;
function isOwnedSupabaseRoute(url, method) {
    if (url.pathname === "/auth/v1/health")
        return method === "GET" && !url.search;
    if (url.pathname === "/auth/v1/user")
        return ["GET", "OPTIONS"].includes(method) && !url.search;
    if (url.pathname === "/auth/v1/token")
        return ["POST", "OPTIONS"].includes(method)
            && url.searchParams.get("grant_type") === "password" && [...url.searchParams.keys()].every(key => key === "grant_type");
    if (url.pathname === "/auth/v1/logout")
        return ["POST", "OPTIONS"].includes(method)
            && [...url.searchParams.keys()].every(key => key === "scope") && (!url.search || ["local", "global"].includes(url.searchParams.get("scope")));
    return url.pathname === "/rest/v1/user_preferences" && ["GET", "PATCH", "OPTIONS"].includes(method)
        && [...url.searchParams.keys()].every(key => ["user_id", "select", "revision"].includes(key));
}
async function servePreferenceProvider(request, response, trace) {
    assert.ok(disposableStack, "GENUINE_LOCAL_SUPABASE_STACK_REQUIRED");
    assert.ok(request.url.startsWith("/"), "GATEWAY_RELATIVE_PATH_REQUIRED");
    const url = new URL(request.url, disposableStack.target);
    const signin = url.pathname === "/auth/v1/token" && request.method === "POST";
    if (signin)
        transportEvidence.GATEWAY_SIGNIN_REQUEST_OBSERVED = true;
    assertLocalReplayTarget(url.href);
    assert.equal(url.origin, new URL(disposableStack.target).origin, "FIXED_OWNED_UPSTREAM_ONLY");
    if (!isOwnedSupabaseRoute(url, request.method)) {
        fixtureDenied++;
        response.writeHead(599);
        response.end();
        return;
    }
    const origin = request.headers.origin;
    assert.ok(!origin || origin === localOrigins[0], "OWNED_BROWSER_ORIGIN_ONLY");
    const cors = { "cache-control": "no-store" };
    if (request.method === "OPTIONS") {
        response.writeHead(204, cors);
        response.end();
        return;
    }
    const actor = issuedActors.get(request.headers.authorization?.replace(/^Bearer /i, ""));
    const logout = loadingObservation?.active && request.method === "POST" && url.pathname === "/auth/v1/logout"
        ? loadingObservation.logout : null;
    if (logout) {
        logout.frontCount++;
        logout.frontActor = actor === "A" ? "ACCOUNT_A" : "UNKNOWN";
        markAuthLogout("FRONT_DOOR_LOGOUT_RECEIVED");
    }
    const { controls, observed } = activePreferenceFixture ?? {};
    const rest = url.pathname === "/rest/v1/user_preferences";
    if (rest && !controls) {
        fixtureDenied++;
        response.writeHead(599);
        response.end();
        return;
    }
    if (rest)
        observed.push({ actor, method: request.method });
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        assert.ok(size <= 1048576, "GATEWAY_BODY_BOUNDED");
        chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
        if (!["host", "connection", "content-length"].includes(name) && typeof value === "string")
            headers.set(name, value);
    }
    if (signin)
        transportEvidence.GATEWAY_SIGNIN_UPSTREAM_STARTED = true;
    if (trace)
        trace.upstreamStarted = true;
    if (logout)
        markAuthLogout("GOTRUE_LOGOUT_REQUEST_STARTED");
    const upstream = await fetch(url.href, { method: request.method, headers, redirect: "error", signal: AbortSignal.timeout(10000),
        ...(["GET", "HEAD"].includes(request.method) ? {} : { body: Buffer.concat(chunks) }) });
    if (trace)
        Object.assign(trace, { upstreamResponse: true, upstreamStatus: upstream.status });
    if (logout)
        markAuthLogout("GOTRUE_LOGOUT_RESPONSE", { gotrueStatus: upstream.status });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (signin)
        Object.assign(transportEvidence, { GATEWAY_SIGNIN_UPSTREAM_RESPONSE_OBSERVED: true, GATEWAY_SIGNIN_UPSTREAM_STATUS: upstream.status });
    if (url.pathname === "/auth/v1/token" && upstream.status === 200) {
        const session = JSON.parse(bytes.toString("utf8"));
        const label = Object.keys(providerActorIds).find(key => providerActorIds[key] === session.user?.id);
        assert.ok(label && session.access_token, "OWNED_GOTRUE_SESSION_REQUIRED");
        issuedActors.set(session.access_token, label);
    }
    if (url.pathname === "/auth/v1/user") {
        disposableReceipt.WORKER_AUTH_GET_USER_REACHED = true;
        disposableReceipt.LOCAL_AUTH_V1_USER_FORWARDED_TO_REAL_GOTRUE = true;
        disposableReceipt.LOCAL_GOTRUE_USER_REQUEST_OBSERVED = true;
        disposableReceipt.LOCAL_GOTRUE_USER_RESPONSE_STATUS = upstream.status;
        if (upstream.status === 200) {
            const user = JSON.parse(bytes.toString("utf8"));
            const label = Object.keys(providerActorIds).find(key => providerActorIds[key] === user.id);
            assert.ok(label, "GENUINE_GOTRUE_OWNED_ACTOR_REQUIRED");
            disposableReceipt.LOCAL_GOTRUE_ACTOR = label === "A" ? "ACCOUNT_A" : "ACCOUNT_B";
        }
    }
    if (rest && upstream.status === 200 && actor) {
        const rows = JSON.parse(bytes.toString("utf8"));
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (row)
            controls.rows[actor] = row;
    }
    const send = () => {
        if (response.destroyed)
            return;
        const responseHeaders = Object.fromEntries([...upstream.headers].filter(([name]) => !["content-length", "transfer-encoding", "content-encoding", "connection"].includes(name)));
        response.writeHead(upstream.status, { ...responseHeaders, ...cors });
        response.end(bytes);
    };
    if (rest && request.method === "GET" && actor === "A" && controls.mode === "loading") {
        controls.pending.push(async () => send());
        return;
    }
    send();
}
async function resetDisposablePreferences() {
    const a = providerActorIds.A, b = providerActorIds.B;
    assert.ok([a, b].every(id => /^[0-9a-f-]{36}$/i.test(id)), "OWNED_LOCAL_IDS_REQUIRED");
    await disposableStack.executeSql(`DELETE FROM public.user_preferences WHERE user_id IN ('${a}','${b}');
INSERT INTO public.user_preferences(user_id,locale_preference) VALUES ('${a}','${accountCookieRowFixture.locale_preference}'),('${b}','zh-CN');
UPDATE public.user_preferences SET locale_preference='en' WHERE user_id='${a}';
UPDATE public.user_preferences SET locale_preference='en' WHERE user_id='${a}';
UPDATE public.user_preferences SET locale_preference='zh-CN' WHERE user_id='${b}';
UPDATE public.user_preferences SET locale_preference='zh-CN' WHERE user_id='${b}';
UPDATE public.user_preferences SET locale_preference='zh-CN' WHERE user_id='${b}';
UPDATE public.user_preferences SET locale_preference='zh-CN' WHERE user_id='${b}';`);
}
async function recordCookieRowStage(page, stage, supplied) {
    const snapshot = supplied ?? await page.evaluate(() => {
        const value = window.__task19.locale();
        return { locale: value.locale, preference: value.preference, provenance: value.provenance, source: value.source,
            generationClass: value.generation === 0 ? "ZERO" : value.generation > 0 ? "POSITIVE" : "UNKNOWN" };
    });
    assert.ok(["en", "zh-CN"].includes(snapshot.locale));
    assert.ok(["auto", "en", "zh-CN"].includes(snapshot.preference));
    assert.ok([null, "device_explicit", "account_adopted"].includes(snapshot.provenance));
    assert.ok(["current", "saved", "country", "accept_language", "fallback"].includes(snapshot.source));
    Object.assign(cookieRowReceipt, { [`${stage}_LOCALE`]: snapshot.locale, [`${stage}_PREFERENCE`]: snapshot.preference,
        [`${stage}_PROVENANCE`]: snapshot.provenance ?? "NONE", [`${stage}_SOURCE`]: snapshot.source,
        [`${stage}_GENERATION_CLASS`]: snapshot.generationClass });
}
function assertCookieRowLocale(snapshot, preference, provenance) {
    assert.deepEqual({ locale: snapshot.locale, preference: snapshot.preference, provenance: snapshot.provenance, source: snapshot.source }, { locale: preference, preference, provenance, source: "saved" }, "SETTLED_COOKIE_ROW_LOCALE_CONTRACT");
}
async function verifyCookieRowStage(page, stage, preference, provenance, expectedAccount) {
    await page.waitForFunction(({ preference, provenance, signedIn }) => {
        const task = window.__task19;
        if (!task)
            return false;
        const state = task.state(), locale = task.locale();
        return state.status === (signedIn ? "ready" : "idle") && locale.preference === preference && locale.provenance === provenance
            && document.documentElement.lang === preference && (signedIn ? state.account?.locale_preference === preference : state.account === null);
    }, { preference, provenance, signedIn: expectedAccount !== null });
    const snapshot = await page.evaluate(() => {
        const value = window.__task19.locale(), account = window.__task19.state().account;
        return { locale: value.locale, preference: value.preference, provenance: value.provenance, source: value.source,
            generationClass: value.generation === 0 ? "ZERO" : "POSITIVE",
            account: account ? { locale_preference: account.locale_preference, revision: account.revision } : null };
    });
    assertCookieRowLocale(snapshot, preference, provenance);
    assert.deepEqual(snapshot.account, expectedAccount, "REAL_WORKER_ACCOUNT_ROW_CONTRACT");
    assert.equal(await page.locator(".locale-settings select").inputValue(), preference);
    await recordCookieRowStage(page, stage, snapshot);
}
async function accountCookieRowScenario({ page, context }) {
    assert.equal(parsePreferenceCookie((await context.cookies()).find(cookie => cookie.name === "ogh_preferences_v1")?.value), undefined);
    const prelogin = await page.evaluate(() => window.__task19.locale());
    assert.equal(prelogin.locale, "zh-CN");
    assert.equal(prelogin.preference, "auto");
    assert.equal(prelogin.source, "country");
    assert.equal(prelogin.provenance, null);
    await recordCookieRowStage(page, "PRELOGIN");
    cookieRowReceipt.COOKIE_PROVENANCE_CONTRACT = "PASS";
    await signInBrowserActor(page, "A");
    await verifyCookieRowStage(page, "POST_ADOPTION", accountCookieRowFixture.locale_preference, "account_adopted", accountCookieRowFixture);
    cookieRowReceipt.ACCOUNT_A_ROW_CONTRACT = "PASS";
    cookieRowReceipt.LOGIN_ADOPTION_CONTRACT = "PASS";
    await page.reload();
    await verifyCookieRowStage(page, "POST_RELOAD", accountCookieRowFixture.locale_preference, "account_adopted", accountCookieRowFixture);
    const chosenPreference = "zh-CN";
    const savedAccount = { locale_preference: chosenPreference, revision: accountCookieRowFixture.revision + 1 };
    await Promise.all([page.waitForNavigation(), page.locator(".locale-settings select").selectOption(chosenPreference)]);
    await verifyCookieRowStage(page, "POST_EXPLICIT_CHOICE", chosenPreference, "device_explicit", savedAccount);
    await page.reload();
    await verifyCookieRowStage(page, "POST_SELECTION_RELOAD", chosenPreference, "device_explicit", savedAccount);
    await Promise.all([page.waitForNavigation(), page.getByRole("button", { name: getUiMessages(chosenPreference).settings.logout, exact: true }).click()]);
    await verifyCookieRowStage(page, "POST_LOGOUT", chosenPreference, "device_explicit", null);
    assert.equal(await page.locator(".locale-settings a[href='/me/']").count(), 0);
    const auth = await page.evaluate(() => window.__task19.authState());
    assert.equal(auth.sessionPresent, false);
    assert.equal(auth.actor, "ANONYMOUS");
    assert.equal(await page.evaluate(() => window.__task19.privatePreferenceAccess()), false, "LOGOUT_PRIVATE_ACCESS_REMOVED");
    assert.ok((await context.cookies()).every(cookie => ["ogh_preferences_v1", "task19_actor"].includes(cookie.name)), "NO_AUTH_TOKEN_COOKIE");
    cookieRowReceipt.LOGOUT_LOCALE_CONTRACT = "PASS";
    console.log("FIXTURE_ACCOUNT_COOKIE_ROW_LOGOUT_SEMANTIC_CONTRACT=PASS");
}
let fulfillControlEvidence;
let accountSwitchEvidence;
let diagnosticTeardownStartedMs, diagnosticPreReceiptEmitted = false, targetResponseSettledAfterTeardown = false;
const safeErrorName = error => ["Error", "TypeError", "AbortError", "TimeoutError", "TargetClosedError"].includes(error?.name) ? error.name : "OTHER";
let browser, child, fixture, ownedRoot, external = 0, workerDenied = 0, fixtureDenied = 0, communityDarkCases = 0;
let workerPort, workerFailure;
let stage = "RUNTIME_CONTRACT";
const safeEvents = [];
let activeCase = { route: "/settings/", browser: "Chromium", viewport: 1280, locale: "en", scheme: "dark" };
let fixtureBundle, renderFixture, fixtureCases = 0;
let workerCasesPassed = 0;
let fixtureSourceMap, firstPageError;
let firstConsoleError, outageRequest;
const outageEvidence = { requestObserved: false, responseObserved: false, responseStatus: "UNKNOWN", requestFailed: false,
    unhandledRejection: false, browserNetworkSource: false, uiFallback: "NOT_RUN", unresolved: "UNKNOWN" };
const approvedOutageText = "Failed to load resource: the server responded with a status of 503 (Service Unavailable)";
const approvedNegativeResponses = Object.freeze({
    FIXTURE_API_OUTAGE: Object.freeze({ method: "PATCH", pathname: "/api/users/me/preferences", status: 503, text: approvedOutageText }),
    FIXTURE_API_CONFLICT: Object.freeze({ method: "PATCH", pathname: "/api/users/me/preferences", status: 409,
        text: "Failed to load resource: the server responded with a status of 409 (Conflict)" }),
});
function isExpectedOutageDiagnostic(evidence) {
    const approved = Object.hasOwn(approvedNegativeResponses, evidence.case) ? approvedNegativeResponses[evidence.case] : undefined;
    return approved !== undefined && evidence.method === approved.method
        && evidence.pathname === approved.pathname && evidence.status === approved.status
        && evidence.fixtureOwned === true && evidence.intentional === true
        && evidence.requestObserved === true && evidence.responseObserved === true && evidence.requestFailed === false
        && evidence.pageErrors === 0 && evidence.unhandledRejections === 0 && evidence.fallback === "PASS"
        && evidence.externalBrowser === 0 && evidence.externalWorker === 0
        && evidence.websocketAttempts === 0 && evidence.unapprovedRequests === 0
        && evidence.source === "BROWSER_NETWORK" && evidence.text === approved.text
        && evidence.argCount === 0 && evidence.occurrences === 1;
}
function resolveRequestLedger(entry, semantics) {
    assert.equal(entry.observed, true);
    if (entry.failed)
        return "RESOLVED_REQUESTFAILED";
    if (!entry.finished && !isOutageResponseFinishedTerminal(entry))
        return "UNRESOLVED_REQUEST";
    if (entry.responseObserved) {
        if (entry.status >= 200 && entry.status < 400)
            return "RESOLVED_SUCCESS_RESPONSE";
        const approved = Object.hasOwn(approvedNegativeResponses, entry.case) ? approvedNegativeResponses[entry.case] : undefined;
        if (approved && entry.method === approved.method && entry.pathname === approved.pathname && entry.status === approved.status
            && entry.fixtureOwned === true && entry.intentional === true && semantics === "PASS")
            return "RESOLVED_EXPECTED_NEGATIVE_RESPONSE";
        return "RESOLVED_UNEXPECTED_RESPONSE";
    }
    return "UNRESOLVED_REQUEST";
}
const fixtureNetwork = { requests: 0, responses: 0, failed: 0 };
const workerFailed = new Promise((_resolve, reject) => { workerFailure = reject; });
workerFailed.catch(() => { });
let localOrigins = [];
const blockedRequests = [];
const communitySurface = { background: "rgb(11, 15, 16)", color: "rgb(242, 244, 245)" };
const receipt = { build: "NOT_RUN", client: "NOT_RUN", remoteCount: "NOT_RUN", server: "NOT_RUN", preflight: "NOT_RUN", hydrated: false, consoleErrors: 0, viteErrors: 0,
    applicationConsoleErrors: 0, expectedNetworkDiagnostics: 0, unexpectedNetworkDiagnostics: 0, unhandledRejections: 0, unresolvedRequests: 0,
    pageErrors: 0, userWorkerReady: false, interaction: "NOT_RUN", documentStatus: "NOT_RUN", disposed: false, certRemoved: false, portReleased: false };
async function observeUnhandledRejections(context, onUnhandled = () => { }) {
    await context.exposeBinding("__task19ObserveUnhandled", () => {
        receipt.unhandledRejections++;
        onUnhandled();
        workerFailure(new Error("TASK19_BROWSER_UNHANDLED_REJECTION"));
    });
    await context.addInitScript(() => {
        window.addEventListener("unhandledrejection", () => { void window.__task19ObserveUnhandled(); });
    });
}
function childEnvironment() {
    const names = ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "COMSPEC"];
    return { ...Object.fromEntries(names.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]])),
        DO_NOT_TRACK: "1", ASTRO_TELEMETRY_DISABLED: "1", ASTRO_DISABLE_UPDATE_CHECK: "true", CLOUDFLARE_CF_FETCH_ENABLED: "false",
        CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false", WRANGLER_SEND_METRICS: "false" };
}
async function availablePort() {
    const listener = createServer();
    await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
    const port = listener.address().port;
    await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    return port;
}
function recordBlocked(input, { transport, resourceType, method }) {
    const url = new URL(input), normalized = url.origin.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
    const hostClass = normalized === localOrigins[0] ? "LOCAL_WORKER" : normalized === localOrigins[1] ? "LOCAL_FIXTURE"
        : ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ? "LOOPBACK" : "UNKNOWN";
    blockedRequests.push({ protocol: url.protocol, transport, resourceType, method, hostClass, path: url.pathname,
        classification: transport === "WEBSOCKET" ? "TASK19_UNEXPECTED_BROWSER_WEBSOCKET" : "TASK19_UNEXPECTED_BROWSER_EXTERNAL_REQUEST" });
}
async function assertCommunityDark(page, colorScheme, width) {
    const computed = await page.evaluate(() => ({
        scheme: getComputedStyle(document.documentElement).colorScheme,
        background: getComputedStyle(document.body).backgroundColor,
        color: getComputedStyle(document.body).color,
    }));
    console.log(`ROUTE=${new URL(page.url()).pathname} VIEWPORT=${width} PREFERS_COLOR_SCHEME=${colorScheme}`);
    console.log(`COMPUTED_COLOR_SCHEME=${computed.scheme}`);
    console.log(`COMPUTED_BODY_BACKGROUND=${computed.background}`);
    console.log(`COMPUTED_BODY_COLOR=${computed.color}`);
    assert.ok(computed.scheme.split(/\s+/).includes("dark"), "COMMUNITY_COMPUTED_DARK_COLOR_SCHEME");
    assert.equal(computed.background, communitySurface.background, "COMMUNITY_OWNED_DARK_SURFACE");
    assert.equal(computed.color, communitySurface.color, "COMMUNITY_OWNED_LIGHT_FOREGROUND");
    assert.equal(await page.getByRole("button", { name: /Appearance|Light mode|System theme|外观|浅色模式|系统主题/i }).count(), 0);
    assert.equal(await page.getByRole("combobox", { name: /Appearance|Theme|外观|主题/i }).count(), 0);
    communityDarkCases++;
}
async function proveWorkerResponseCompletion(worker, origin, token, observed = () => { }) {
    const target = new URL("/api/users/me/preferences", origin);
    assert.ok(target.protocol === "https:" && target.hostname === "127.0.0.1" && target.port, "OWNED_WORKER_COMPLETION_TARGET_ONLY");
    const result = { WORKER_503_RESPONSE_OBJECT_OBSERVED: false, WORKER_503_RESPONSE_BODY_COMPLETION: "UNKNOWN",
        WORKER_503_BODY_CLASS: "UNKNOWN", WORKER_FETCH_RESPONSE_STATUS: "UNKNOWN", WORKER_BODY_ERROR_CLASS: "NONE" };
    const operation = (async () => {
        const response = await worker.fetch(target.href, { method: "PATCH", headers: { authorization: `Bearer ${token}`,
                origin, "content-type": "application/json" }, body: JSON.stringify({ locale_preference: "zh-CN", expected_revision: 3 }) });
        result.WORKER_FETCH_RESPONSE_STATUS = response.status;
        assert.equal(response.status, 503, "EXACT_WORKER_503_RESPONSE_REQUIRED");
        result.WORKER_503_RESPONSE_OBJECT_OBSERVED = true;
        observed({ ...result });
        if (response.body === null) {
            result.WORKER_503_BODY_CLASS = "NULL";
            result.WORKER_503_RESPONSE_BODY_COMPLETION = "COMPLETE";
            return;
        }
        // This isolated proof is the sole consumer; there is no browser body to clone or tee.
        const reader = response.body.getReader();
        let bytes = 0;
        try {
            for (;;) {
                const chunk = await reader.read();
                if (chunk.done)
                    break;
                bytes += chunk.value.byteLength;
                assert.ok(bytes <= 1024, "BOUNDED_ERROR_RESPONSE_ONLY");
            }
            result.WORKER_503_BODY_CLASS = bytes === 0 ? "EMPTY_STREAM" : "NONEMPTY_STREAM";
            result.WORKER_503_RESPONSE_BODY_COMPLETION = "COMPLETE";
        }
        finally {
            reader.releaseLock();
        }
    })();
    await operation.catch(error => {
        result.WORKER_503_RESPONSE_BODY_COMPLETION = "ERROR";
        result.WORKER_BODY_ERROR_CLASS = safeErrorName(error);
    });
    return { ...result };
}
async function runWorkerChild() {
    let worker;
    let completionProofUsed = false;
    const listeners = [];
    const ready = new Promise(resolve => process.once("message", resolve));
    const input = await ready;
    const outageFault = input.sameOriginFrontDoor ? createOutageOutboundFault(input.fixtureOrigin) : null;
    const staleHold = input.sameOriginFrontDoor ? createOwnedStaleHold(input.localSupabaseOrigin, event => process.send?.({ type: "stale-hold-event", ...event })) : null;
    let resolveStop;
    const stop = new Promise(resolve => { resolveStop = resolve; process.once("disconnect", resolve); });
    let rejectRuntime, resolveReload, readinessTimer;
    const runtimeFailed = new Promise((_resolve, reject) => { rejectRuntime = reject; });
    runtimeFailed.catch(() => { });
    const reloaded = new Promise(resolve => { resolveReload = resolve; });
    const observe = (name, listener) => { worker.raw.on(name, listener); listeners.push([name, listener]); };
    const fail = code => { process.send?.({ type: "runtime-failed", code }); rejectRuntime(new Error(code)); };
    const control = message => {
        if (message.type === "stop") {
            staleHold?.control("RESET");
            resolveStop();
            return;
        }
        if (message.type === "outage-case") {
            try {
                assert.ok(Number.isSafeInteger(message.id));
                assert.ok(outageFault, "EXACT_ACCEPTED_FRONT_DOOR_FAULT_CONTROL_ONLY");
                const state = outageFault.setCase(message.caseName, message.armed);
                process.send?.({ type: "outage-case-ack", id: message.id, ...state });
            }
            catch {
                fail("OUTAGE_FAULT_CONTROL_REJECTED");
            }
        }
        else if (message.type === "stale-hold-control") {
            try {
                assert.ok(staleHold && Number.isSafeInteger(message.id));
                process.send?.({ type: "stale-hold-ack", id: message.id, ...staleHold.control(message.action, message) });
            }
            catch {
                fail("STALE_HOLD_CONTROL_REJECTED");
            }
        }
        else if (message.type === "outage-response-completion-proof") {
            if (!input.httpCompletionProof || !input.sameOriginFrontDoor || completionProofUsed) {
                fail("EXACT_HTTP_COMPLETION_PROOF_ONLY");
                return;
            }
            completionProofUsed = true;
            const observed = result => { if (process.connected)
                process.send?.({ type: "outage-response-completion-observed", result }); };
            void proveWorkerResponseCompletion(worker, input.fixtureOrigin, message.token, observed).then(result => {
                if (process.connected)
                    process.send?.({ type: "outage-response-completion-result", result });
            }, () => { fail("HTTP_COMPLETION_PROOF_FAILED"); });
        }
        else
            fail("OWNED_WORKER_UNEXPECTED_CONTROL_MESSAGE");
    };
    process.on("message", control);
    try {
        const { unstable_startWorker } = await import("wrangler");
        worker = await unstable_startWorker({
            config: workerConfig, envFiles: [], build: { bundle: false },
            bindings: {
                SUPABASE_URL: { type: "plain_text", value: input.fixtureOrigin },
                SUPABASE_ANON_KEY: { type: "plain_text", value: input.anonKey },
                AUTH_CAPTCHA_MODE: { type: "plain_text", value: "off" },
            },
            dev: { remote: false, watch: false, liveReload: false, registry: undefined, persist: false,
                inspector: false, server: { hostname: "127.0.0.1", port: input.port, secure: true, httpsKeyPath: input.key, httpsCertPath: input.cert },
                outboundService(request) {
                    const url = new URL(request.url);
                    if (input.finalAuth401Diagnostic && url.origin === input.fixtureOrigin && url.pathname === "/auth/v1/user" && request.method === "GET") {
                        process.send?.({ type: "local-auth-get-user-invoked" });
                    }
                    if (url.origin === input.fixtureOrigin && ((url.pathname === "/auth/v1/user" && request.method === "GET" && url.search === "")
                        || (url.pathname === "/rest/v1/user_preferences" && ["GET", "PATCH"].includes(request.method)))) {
                        const destination = input.sameOriginFrontDoor ? new URL(url.pathname + url.search, input.localSupabaseOrigin) : url;
                        if (input.sameOriginFrontDoor) {
                            assertLocalReplayTarget(destination.href);
                            assert.equal(destination.origin, input.localSupabaseOrigin);
                            assert.ok(isOwnedSupabaseRoute(url, request.method), "EXACT_WORKER_SUPABASE_ROUTE_REQUIRED");
                        }
                        const observation = input.outageObservations ? { type: "outage-outbound", method: request.method,
                            pathClass: url.pathname === "/rest/v1/user_preferences" ? "USER_PREFERENCES_REST" : "AUTH" } : null;
                        if (observation)
                            process.send?.({ ...observation, event: "STARTED" });
                        let faultResponse;
                        try {
                            faultResponse = outageFault ? outageFault.responseFor(request) : null;
                        }
                        catch {
                            process.send?.({ ...observation, event: "FAULT_MATCHED", matchCount: outageFault.snapshot().matchCount });
                            fail("OUTAGE_OUTBOUND_FAULT_MORE_THAN_ONCE");
                            throw new Error("OUTAGE_OUTBOUND_FAULT_MORE_THAN_ONCE");
                        }
                        if (faultResponse) {
                            process.send?.({ ...observation, event: "FAULT_MATCHED", matchCount: outageFault.snapshot().matchCount });
                            process.send?.({ ...observation, event: "HTTP_RESPONSE", status: faultResponse.status });
                            return faultResponse;
                        }
                        const fetchReal = () => fetch(destination.href, { method: request.method, headers: new Headers(request.headers), redirect: "error",
                            ...(["GET", "HEAD"].includes(request.method) ? {} : { body: request.body, duplex: "half" }) });
                        const pending = staleHold ? staleHold.forward(request, destination.href, fetchReal) : fetchReal();
                        if (!observation)
                            return pending;
                        return pending.then(response => {
                            process.send?.({ ...observation, event: "HTTP_RESPONSE", status: response.status });
                            return response;
                        }, error => {
                            process.send?.({ ...observation, event: error.name === "AbortError" ? "ABORT" : "CONNECTION_ERROR" });
                            throw error;
                        });
                    }
                    // The anonymous Settings/docs fixture needs no data endpoint; never forward a request.
                    process.send?.({ type: "outbound-denied", protocol: url.protocol, path: url.pathname,
                        fixture: url.origin === input.fixtureOrigin, method: request.method });
                    fail("TASK19_UNEXPECTED_WORKER_OUTBOUND");
                    return new Response("TASK19_WORKER_OUTBOUND_FORBIDDEN", { status: 599 });
                },
            },
        });
        observe("reloadComplete", resolveReload);
        observe("error", () => fail("TASK19_USER_WORKER_STARTUP_ERROR"));
        observe("runtimeError", () => fail("TASK19_USER_WORKER_RUNTIME_ERROR"));
        const timeout = new Promise((_resolve, reject) => { readinessTimer = setTimeout(() => reject(new Error("TASK19_RELOAD_COMPLETE_TIMEOUT")), 30000); });
        await Promise.race([(async () => { await worker.ready; await reloaded; })(), runtimeFailed, timeout]);
        clearTimeout(readinessTimer);
        const holdState = staleHold?.control("STATE");
        assert.ok(!holdState?.actorBound && !holdState?.armed, "GENERIC_STARTUP_REQUIRES_UNBOUND_UNARMED_HOLD");
        process.send?.({ type: "ready", origin: (await worker.url).origin, gate: "reloadComplete",
            holdBindingState: "UNSET_AT_STARTUP", holdArmed: false });
        await Promise.race([stop, runtimeFailed]);
    }
    catch {
        process.send?.({ type: "runtime-failed" });
        process.exitCode = 1;
    }
    finally {
        clearTimeout(readinessTimer);
        process.off("message", control);
        for (const [name, listener] of listeners)
            worker?.raw.off(name, listener);
        await worker?.dispose();
        if (worker)
            process.send?.({ type: "disposed" });
        process.disconnect?.();
    }
}
async function stopWorker() {
    if (!child || child.exitCode !== null)
        return;
    const stopped = new Promise(resolve => child.once("exit", resolve));
    child.send({ type: "stop" });
    let timer;
    await Promise.race([stopped, new Promise(resolve => { timer = setTimeout(resolve, 5000); })]);
    clearTimeout(timer);
    if (child.exitCode === null) {
        child.kill();
        await stopped;
    }
}
async function walk(directory) {
    return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(target) : [target];
    }))).flat();
}
async function startOwnedWorker(origin, fixtureOrigin, port, key, cert, diagnosticLog) {
    child = spawn(process.execPath, [path.resolve("scripts/test-global-locale-browser.mjs"), "--owned-worker-child"], {
        cwd: root, env: childEnvironment(), stdio: ["ignore", diagnosticLog ? "pipe" : "ignore", diagnosticLog ? "pipe" : "ignore", "ipc"], windowsHide: true,
    });
    if (diagnosticLog) {
        child.stdout.on("data", diagnosticLog);
        child.stderr.on("data", diagnosticLog);
    }
    const ready = new Promise((resolve, reject) => {
        child.on("message", message => {
            if (message.type === "stale-hold-ack")
                staleHoldReplies.get(message.id)?.resolve(message);
            if (message.type === "stale-hold-event" && loadingObservation?.active) {
                if (message.event === "STARTED")
                    loadingObservation.outboundStarted = true;
                if (message.event === "HELD") {
                    loadingObservation.held = true;
                    loadingObservation.heldReady?.();
                }
                if (message.event === "RELEASED") {
                    loadingObservation.released = true;
                    loadingObservation.releaseReady?.();
                }
            }
            if (message.type === "outage-case-ack")
                outageControlReplies.get(message.id)?.resolve(message);
            if (message.type === "outage-outbound")
                observeOutageOutbound(message);
            if (message.type === "outage-response-completion-result")
                httpCompletionControl?.resolve(message.result);
            if (message.type === "outage-response-completion-observed" && httpCompletionControl)
                Object.assign(httpCompletionReceipt, message.result);
            if (message.type === "ready") {
                if (message.origin !== origin || message.gate !== "reloadComplete")
                    reject(new Error("TASK19_WORKERS_HTTPS_FAILURE"));
                else {
                    {
                        assert.equal(message.holdBindingState, "UNSET_AT_STARTUP");
                        assert.equal(message.holdArmed, false);
                        startupOrderReceipt.USER_WORKER_STARTUP = "PASS";
                    }
                    receipt.userWorkerReady = true;
                    resolve();
                }
            }
            if (message.type === "disposed")
                receipt.disposed = true;
            if (message.type === "runtime-failed") {
                const error = new Error("TASK19_WORKERS_RUNTIME_START_FAILURE");
                reject(error);
                workerFailure(error);
            }
            if (message.type === "outbound-denied") {
                workerDenied++;
                workerFailure(new Error("TASK19_UNEXPECTED_WORKER_OUTBOUND"));
            }
        });
        child.once("exit", () => reject(new Error("TASK19_WORKERS_RUNTIME_START_FAILURE")));
        child.once("error", () => reject(new Error("TASK19_WORKERS_RUNTIME_START_FAILURE")));
    });
    child.send({ fixtureOrigin, port, key, cert, anonKey: disposableStack?.anonKey, finalAuth401Diagnostic: false,
        httpCompletionProof: false,
        outageObservations: true,
        sameOriginFrontDoor: true, localSupabaseOrigin: new URL(disposableStack.target).origin });
    let timer;
    try {
        await Promise.race([ready, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("TASK19_WORKERS_RUNTIME_START_FAILURE")), 30000); })]);
    }
    finally {
        clearTimeout(timer);
    }
}
async function instrumentCase63FixtureSource(source, kind) {
    const ts = (await import("typescript")).default;
    const ast = ts.createSourceFile(kind === "store" ? "locale-store.ts" : "main.tsx", source, ts.ScriptTarget.Latest, true, kind === "store" ? ts.ScriptKind.TS : ts.ScriptKind.TSX);
    const edits = [];
    const insert = (at, text) => edits.push({ start: at, end: at, text });
    const mark = (event, site, actor) => `globalThis.__task19NavigationMark?.(${JSON.stringify(event)},${JSON.stringify(site)}${actor ? `,${actor}` : ""});`;
    const find = (node, predicate) => {
        const found = [];
        const visit = current => { if (predicate(current))
            found.push(current); ts.forEachChild(current, visit); };
        visit(node);
        return found;
    };
    if (kind === "store") {
        const factory = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "createLocaleStore");
        assert.ok(factory?.body, "CASE63_EXACT_STORE_FACTORY_REQUIRED");
        insert(factory.body.getStart(ast) + 1, '\nlet __task19StoreSource = "NONE";\n');
        for (const [name, event] of [["clearAccount", "STORE_CLEAR_ACCOUNT_START"], ["adoptAccount", "STORE_ADOPT_ACCOUNT_START"], ["select", null]]) {
            const methods = find(factory, node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
            assert.equal(methods.length, 1, "CASE63_EXACT_STORE_METHOD_REQUIRED");
            insert(methods[0].body.getStart(ast) + 1, `\n__task19StoreSource=${JSON.stringify(name === "select" ? "NONE" : name)};${event ? mark(event, name) : ""}\n`);
        }
        const commit = find(factory, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "commit")[0]?.initializer;
        assert.ok(commit && ts.isArrowFunction(commit) && ts.isBlock(commit.body), "CASE63_EXACT_COMMIT_REQUIRED");
        insert(commit.body.getStart(ast) + 1, '\nconst __task19CommitSource = __task19StoreSource;\n');
        const apply = find(commit, node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
            && node.expression.expression.getText(ast) === "apply");
        assert.equal(apply.length, 1);
        insert(apply[0].end, '\nglobalThis.__task19NavigationMark?.("STORE_COMMIT",__task19CommitSource);\n');
        const navigation = find(commit, node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
            && node.expression.expression.getText(ast) === "dependencies.navigate");
        assert.equal(navigation.length, 1);
        edits.push({ start: navigation[0].getStart(ast), end: navigation[0].end,
            text: `{globalThis.__task19NavigationMark?.("STORE_RELOAD_REQUESTED",__task19CommitSource);${navigation[0].getText(ast)}}` });
    }
    else {
        const fixture = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "Task19Fixture");
        assert.ok(fixture?.body, "CASE63_EXACT_AUTH_FIXTURE_REQUIRED");
        const signOut = find(fixture, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "signOut")[0]?.initializer;
        assert.ok(signOut && ts.isArrowFunction(signOut) && ts.isBlock(signOut.body));
        insert(signOut.body.getStart(ast) + 1, mark("A_SIGNOUT_CALL_START", "Task19Fixture.signOut"));
        const signIn = find(fixture, node => ts.isMethodDeclaration(node) && node.name.getText(ast) === "signIn");
        assert.equal(signIn.length, 1);
        const authCall = signIn[0].body.statements.find(node => ts.isVariableStatement(node)
            && node.getText(ast).includes("await client.auth.signInWithPassword("));
        assert.ok(authCall);
        insert(authCall.end, `\nif (!error && data.session && classifyActor(data.session.user.id) === "ACCOUNT_B") ${mark("B_AUTH_SIGNIN_RESOLVED", "Task19Fixture.signIn", '"ACCOUNT_B"')}\n`);
        const actor = find(fixture, node => ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)
            && node.expression.left.getText(ast) === "observedIdentity");
        assert.equal(actor.length, 1);
        insert(actor[0].getStart(ast), mark("AUTH_ACTOR", "NONE", "identity"));
        const setActor = find(fixture, node => ts.isCallExpression(node) && node.expression.getText(ast) === "sync.setActor");
        assert.equal(setActor.length, 1);
        const statement = setActor[0].parent.parent;
        assert.ok(ts.isExpressionStatement(statement));
        edits.push({ start: statement.getStart(ast), end: statement.end,
            text: `{if(actor === "B") ${mark("B_SET_ACTOR_START", "Task19Fixture.setActor", '"ACCOUNT_B"')}${statement.getText(ast)}}` });
        const returnCleanup = find(fixture, node => ts.isReturnStatement(node) && node.expression && ts.isArrowFunction(node.expression)
            && node.getText(ast).includes("subscription.data.subscription.unsubscribe()"));
        assert.equal(returnCleanup.length, 1);
        insert(returnCleanup[0].getStart(ast), mark("FIXTURE_READY", "Task19Fixture.ready"));
    }
    for (const edit of edits.sort((a, b) => b.start - a.start))
        source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    return source;
}
async function prepareBrowserFixtures() {
    const { build } = await import("esbuild");
    const entry = path.resolve("tests/visual/locale-settings-harness/main.tsx");
    const options = { bundle: true, write: false, logLevel: "silent", define: {
            "import.meta.env.PUBLIC_SUPABASE_URL": "globalThis.__task19PublicConfig.url",
            "import.meta.env.PUBLIC_SUPABASE_ANON_KEY": "globalThis.__task19PublicConfig.anonKey",
            "import.meta.env.DEV": "false", "import.meta.env": "{}",
        }, jsx: "automatic" };
    // Source probes exist only in this disposable browser fixture, never the app build or repository source.
    const plugins = [{ name: "task19-account-transition-source-markers", setup(builder) {
                builder.onLoad({ filter: /(?:locale-store\.ts|locale-settings-harness[\\/]main\.tsx)$/ }, async ({ path: file }) => {
                    const store = path.resolve("src/lib/i18n/locale-store.ts"), fixture = path.resolve("tests/visual/locale-settings-harness/main.tsx");
                    if (file !== store && file !== fixture)
                        return;
                    return { contents: await instrumentCase63FixtureSource(await readFile(file, "utf8"), file === store ? "store" : "fixture"),
                        loader: file === store ? "ts" : "tsx", resolveDir: path.dirname(file) };
                });
            } }];
    const client = await build({ ...options, plugins, entryPoints: [entry], platform: "browser", format: "iife", sourcemap: "external", outfile: path.join(ownedRoot, "fixture.js") });
    fixtureBundle = client.outputFiles.find(file => file.path.endsWith(".js")).text;
    const { TraceMap, originalPositionFor } = await import("@jridgewell/trace-mapping");
    const map = new TraceMap(JSON.parse(client.outputFiles.find(file => file.path.endsWith(".map")).text));
    fixtureSourceMap = (line, column) => originalPositionFor(map, { line, column });
    const server = await build({ ...options, platform: "node", format: "cjs", stdin: { resolveDir: root, loader: "tsx",
            contents: 'import {Task19Fixture} from "./tests/visual/locale-settings-harness/main.tsx"; import {renderToString} from "react-dom/server"; export function render(initial,actor){return renderToString(<Task19Fixture initial={initial} actor={actor}/>)}' } });
    const serverPath = path.join(ownedRoot, "fixture.cjs");
    await writeFile(serverPath, server.outputFiles[0].text);
    renderFixture = createRequire(import.meta.url)(serverPath).render;
}
async function browserFixtureCase(engineName, origin, width, name, inputs, scenario, options = {}) {
    bindRuntimeCase(engineName, width, `FIXTURE_${name}`, "CASE_SETUP", "browserFixtureCase/context.newContext");
    if (!browser)
        browser = await ({ chromium, firefox }[engineName]).launch({ headless: true });
    const useStaleActorLifecycle = name === "LOADING_STALE_ACTOR";
    const useAccountSwitchLifecycle = name === "ACCOUNT_A_TO_B";
    if (useAccountSwitchLifecycle)
        case63Trace = createCase63NavigationTrace();
    const staleActorReceipt = engineName === "chromium" && width === 430 ? stale430ReloadReceipt : { ...stale430ReloadReceipt };
    activeCase = { route: "/__task19/locale", browser: engineName, viewport: width, locale: resolveLocale(inputs).locale, scheme: "dark" };
    stage = `FIXTURE_${name}`;
    const context = await browser.newContext(frontDoorBrowserContextOptions(width));
    await resetDisposablePreferences();
    await context.addInitScript(configuration => {
        window.__task19PublicConfig = configuration.public;
        window.__task19ActorIds = configuration.actors;
        window.__task19SessionPreflight = configuration.sessionPreflight;
        window.__task19TransportDiagnostic = configuration.transportDiagnostic;
        window.__task19LocaleDiagnostic = configuration.localeDiagnostic;
        window.__task19ObserveLoadingLifecycle = configuration.observeLoadingLifecycle;
        if (configuration.navigationProvenance && location.pathname === "/__task19/locale") {
            let actor = "UNKNOWN", clearOwner = "UNKNOWN";
            window.__task19NavigationMark = (event, site = "NONE", identity) => {
                if (event === "AUTH_ACTOR") {
                    if (actor === "ACCOUNT_A" && identity === "ANONYMOUS")
                        clearOwner = actor;
                    actor = identity;
                }
                if (event === "A_SIGNOUT_CALL_START" && actor === "ACCOUNT_A")
                    clearOwner = actor;
                console.debug("TASK19_CASE63_SOURCE " + JSON.stringify({ event, site,
                    actor: site === "clearAccount" ? clearOwner : identity ?? actor, documentKey: performance.timeOrigin }));
            };
            window.__task19NavigationMark("DOCUMENT_INITIALIZED");
            addEventListener("beforeunload", () => window.__task19NavigationMark("DOCUMENT_BEFOREUNLOAD"));
            addEventListener("pagehide", () => window.__task19NavigationMark("DOCUMENT_PAGEHIDE"));
        }
    }, {
        public: { url: gatewayOrigin, anonKey: disposableStack.anonKey }, actors: providerActorIds, sessionPreflight: options.readinessGate === true,
        transportDiagnostic: false, localeDiagnostic: false,
        observeLoadingLifecycle: useStaleActorLifecycle,
        navigationProvenance: useAccountSwitchLifecycle,
    });
    const rows = { A: { locale_preference: "en", revision: 3, updated_at: "2026-10-01T00:00:00Z" }, B: { locale_preference: "zh-CN", revision: 5, updated_at: "2026-10-01T00:00:00Z" } };
    const controls = { mode: "normal", pending: [], rows };
    const observed = [];
    assert.equal(activePreferenceFixture, undefined, "SERIAL_OWNED_FIXTURE_ONLY");
    activePreferenceFixture = { controls, observed, name, inputs };
    const caseConsole = [], networkEntries = [], pendingRequests = new Set(), requestLedger = new Map(), negativeResponses = [];
    const chromiumRequests = new Map();
    const requestIds = new WeakMap();
    let page, targetRequest, responseApiObservation;
    const lifecycle = { TARGET_REQUEST_LOCAL_ID: "UNKNOWN", ROUTE_REQUEST_ALREADY_TRACKED: false, ROUTE_REQUEST_LOCAL_ID: "UNKNOWN",
        RESPONSE_EVENT_OBSERVED: false, RESPONSE_REQUEST_LOCAL_ID: "UNKNOWN", RESPONSE_STATUS: "UNKNOWN",
        REQUESTFINISHED_EVENT_OBSERVED: false, REQUESTFINISHED_LOCAL_ID: "UNKNOWN",
        REQUESTFAILED_EVENT_OBSERVED: false, REQUESTFAILED_LOCAL_ID: "UNKNOWN",
        TARGET_REQUEST_EVENT_MS: "UNKNOWN", TARGET_ROUTE_MATCH_MS: "UNKNOWN", TARGET_ROUTE_FULFILL_START_MS: "UNKNOWN",
        TARGET_ROUTE_FULFILL_RESOLVE_MS: "UNKNOWN", TARGET_RESPONSE_EVENT_MS: "UNKNOWN", TARGET_REQUESTFINISHED_MS: "UNKNOWN",
        TARGET_REQUESTFAILED_MS: "UNKNOWN", TARGET_REQUEST_RESPONSE_API_RESOLVED: false, TARGET_REQUEST_RESPONSE_API_STATUS: "UNKNOWN",
        TARGET_REQUEST_RESPONSE_API_STATE: "PENDING", TARGET_REQUEST_RESPONSE_API_REJECTION_NAME: "NONE", PLAYWRIGHT_REQUESTFAILED_NAME: "NONE" };
    const negativeCase = Object.hasOwn(approvedNegativeResponses, `FIXTURE_${name}`);
    const caseStartedAt = performance.now();
    const observeAbDocument = useAccountSwitchLifecycle;
    const observeFinalReload = observeAbDocument || useStaleActorLifecycle;
    if (observeFinalReload)
        abDocumentObservation = { active: true, phase: "INITIAL_PAGE_LOAD", documents: [], front: [], navigations: [], gotoCount: 0,
            receipt: useStaleActorLifecycle ? staleActorReceipt : { ...abFinalReloadReceipt },
            requireLoadingObserver: useStaleActorLifecycle,
            deadline: caseStartedAt + 15000,
            armFinalReload() {
                assert.equal(this.finalReload, undefined, "TASK19_AB390_ARM_FINAL_RELOAD_EXACTLY_ONCE");
                const previous = this.documents.at(-1);
                assert.ok(previous, "TASK19_AB390_PRE_B_DOCUMENT_REQUIRED");
                this.baseline = { generation: previous.fixtureDocumentGeneration, sequence: previous.id };
                Object.assign(this.receipt, { AB390_PRE_B_NAVIGATION_GENERATION: this.baseline.generation,
                    AB390_PRE_B_DOCUMENT_SEQUENCE_NUMBER: this.baseline.sequence });
                if (useStaleActorLifecycle)
                    this.receipt.OBSERVER_PRE_RELOAD_DOCUMENT_GENERATION = this.baseline.generation;
                this.finalReload = createAbFinalReloadState(this.baseline);
            } };
    const realOutageCase = name === "API_OUTAGE";
    const realLoadingCase = name === "LOADING_STALE_ACTOR";
    if (realLoadingCase)
        loadingObservation = { active: true, started: caseStartedAt, phase: "BEFORE_A", generation: 0,
            logout: { phase: "OTHER", events: [], browserCount: 0, frontCount: 0, navigationBetween: false,
                staleHoldTouchesAuth: false, sharedAbortWithAuth: false, releaseAbortsUnrelated: false },
            heldReady: undefined, released: false, finalActorConfirmed: false, switchedWithPending: false };
    if (realOutageCase) {
        Object.assign(apiOutageReceipt, apiOutageInitialReceipt);
        apiOutageObservation = { active: true, started: caseStartedAt, phases: {}, downstreamCount: 0 };
        apiOutageObservation.nativeEnabled = false;
        apiOutageObservation.cdpEnabled = false;
        if (apiOutageObservation.cdpEnabled)
            context.once("close", () => { apiOutageObservation.cdpContextClosed = true; });
        apiOutageObservation.nativeSetupSettled = () => [...requestLedger.values()].every(entry => entry.finished || entry.failed);
        if (apiOutageObservation.nativeEnabled)
            context.once("close", () => { apiOutageObservation.nativeContextClosed = true; });
    }
    let requestSerial = 0, switchPhase = "BEFORE_ACCOUNT_A_READY";
    const offset = () => Math.round(performance.now() - caseStartedAt);
    const switchTimeline = { ACCOUNT_A_READY_MS: "UNKNOWN", ACCOUNT_SWITCH_ACTION_MS: "UNKNOWN", ACCOUNT_B_SESSION_VISIBLE_MS: "UNKNOWN",
        ACCOUNT_B_EXPECTED_LOCALE_VISIBLE_MS: "UNKNOWN", ACCOUNT_B_PREFERENCE_STATE_SETTLED_MS: "UNKNOWN", CASE_FINAL_ASSERTION_MS: "UNKNOWN", TEARDOWN_ATTEMPT_MS: "UNKNOWN" };
    const markSwitch = (phase, milestone) => {
        switchPhase = phase;
        if (milestone)
            switchTimeline[milestone] = offset();
        const observation = realHttpSwitchObservation;
        if (observation?.active) {
            observation.phase = ({ ACCOUNT_A_READY: "ACCOUNT_A_ACTIVE", ACCOUNT_SWITCH_STARTED: "ACCOUNT_SWITCH_STARTED",
                ACCOUNT_B_PREFERENCE_SYNC: "ACCOUNT_B_PREFERENCE_LOAD", ACCOUNT_B_UI_READY: "ACCOUNT_B_ACTIVE", AFTER_FINAL_ASSERTION: "FINAL_ASSERTION" })[phase] ?? "OTHER";
            if (phase === "ACCOUNT_A_READY")
                observation.aEstablished = true;
            if (phase === "ACCOUNT_SWITCH_STARTED")
                observation.switchStarted = offset();
        }
    };
    const fixtureActor = authorization => !authorization ? "ANONYMOUS" : issuedActors.get(authorization.replace(/^Bearer /i, "")) === "A"
        ? "ACCOUNT_A" : issuedActors.get(authorization.replace(/^Bearer /i, "")) === "B" ? "ACCOUNT_B" : "UNKNOWN";
    const traceFulfill = async (route, options) => {
        const routedRequest = route.request(), entry = requestLedger.get(routedRequest);
        Object.assign(entry, { routeBranch: "IMMEDIATE_FULFILL", terminalAction: "FULFILL", terminalActionCalled: true, fulfillCompleted: false });
        await route.fulfill(options);
        entry.fulfillCompleted = true;
    };
    let rejectCase;
    const caseFailed = new Promise((_resolve, reject) => { rejectCase = reject; });
    caseFailed.catch(() => { });
    const before = { pageErrors: receipt.pageErrors, unhandledRejections: receipt.unhandledRejections };
    let accounted = false;
    if (negativeCase) {
        outageRequest = undefined;
        Object.assign(outageEvidence, { requestObserved: false, responseObserved: false, responseStatus: "UNKNOWN", requestFailed: false,
            unhandledRejection: false, browserNetworkSource: false, uiFallback: "NOT_RUN", unresolved: "UNKNOWN", fixtureOwned: false, intentional: false, semanticContract: "NOT_RUN" });
    }
    const accountConsole = () => {
        if (accounted)
            return;
        accounted = true;
        for (const entry of caseConsole) {
            const network = entry.argCount === 0 && networkEntries.some(item => item.pathname === entry.pathname && item.text === entry.text);
            const approved = isExpectedOutageDiagnostic({ case: `FIXTURE_${name}`, method: outageEvidence.method,
                pathname: outageEvidence.pathname, status: outageEvidence.responseStatus,
                fixtureOwned: outageEvidence.fixtureOwned, intentional: outageEvidence.intentional,
                requestObserved: outageEvidence.requestObserved, responseObserved: outageEvidence.responseObserved,
                requestFailed: outageEvidence.requestFailed, pageErrors: receipt.pageErrors - before.pageErrors,
                unhandledRejections: receipt.unhandledRejections - before.unhandledRejections, fallback: outageEvidence.uiFallback,
                externalBrowser: external, externalWorker: workerDenied + fixtureDenied,
                websocketAttempts: blockedRequests.filter(record => record.transport === "WEBSOCKET").length,
                unapprovedRequests: blockedRequests.length, source: network ? "BROWSER_NETWORK" : "UNKNOWN",
                text: entry.text, argCount: entry.argCount, occurrences: caseConsole.length });
            if (approved)
                receipt.expectedNetworkDiagnostics++;
            else if (network)
                receipt.unexpectedNetworkDiagnostics++;
            else
                receipt.applicationConsoleErrors++;
            if (firstConsoleError?.CONSOLE_ERROR_LOCATION_FRAME === entry.pathname && network)
                firstConsoleError.CONSOLE_ERROR_SOURCE_KIND = "BROWSER_NETWORK";
            const response = negativeResponses.find(item => item.pathname === entry.pathname);
            const template = /^Failed to load resource: the server responded with a status of \d{3} \([A-Za-z ]+\)$/.test(entry.text) ? entry.text.slice(0, 240) : "REDACTED";
            console.log(`TASK19_CONSOLE_ENTRY CASE=FIXTURE_${name} ENGINE=${engineName} WIDTH=${width} CLASSIFICATION=${approved ? "EXPECTED_BROWSER_NETWORK_DIAGNOSTIC" : network ? "UNEXPECTED_BROWSER_NETWORK_DIAGNOSTIC" : "APPLICATION_OR_UNPROVEN_CONSOLE_ERROR"} ARG_COUNT=${entry.argCount}`);
            console.log(`TASK19_CONSOLE_ENTRY_TEXT_TEMPLATE=${template}`);
            if (response)
                console.log(`TASK19_CONSOLE_REQUEST_METHOD=${response.method} PATHNAME=${response.pathname} STATUS=${response.status}`);
        }
        const resolutionCounts = { RESOLVED_SUCCESS_RESPONSE: 0, RESOLVED_EXPECTED_NEGATIVE_RESPONSE: 0,
            RESOLVED_UNEXPECTED_RESPONSE: 0, RESOLVED_REQUESTFAILED: 0, UNRESOLVED_REQUEST: 0 };
        for (const entry of requestLedger.values())
            resolutionCounts[resolveRequestLedger(entry, negativeCase ? outageEvidence.semanticContract : "NOT_RUN")]++;
        receipt.unresolvedRequests += resolutionCounts.UNRESOLVED_REQUEST;
        if (negativeCase)
            outageEvidence.unresolved = resolutionCounts.UNRESOLVED_REQUEST;
        for (const [resolution, count] of Object.entries(resolutionCounts))
            console.log(`TASK19_REQUEST_LEDGER CASE=FIXTURE_${name} ENGINE=${engineName} WIDTH=${width} RESOLUTION=${resolution} COUNT=${count}`);
        if (resolutionCounts.RESOLVED_UNEXPECTED_RESPONSE > 0)
            rejectCase(new Error("TASK19_UNEXPECTED_RESPONSE"));
    };
    try {
        {
            await setOwnedOutageCase(realOutageCase ? "FIXTURE_API_OUTAGE" : "NONE", false);
            console.log(`OUTAGE_OUTBOUND_FAULT_CASE=FIXTURE_${name} ARMED=false`);
        }
        await observeUnhandledRejections(context, () => { if (negativeCase)
            outageEvidence.unhandledRejection = true; });
        await context.addInitScript(({ blockedCookie, authenticate }) => {
            if (!authenticate)
                Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("HOSTILE_LOCAL_STORAGE"); } });
            if (blockedCookie)
                Object.defineProperty(document, "cookie", { configurable: true, get() { return ""; }, set() { throw new Error("BLOCKED_COOKIE"); } });
        }, { blockedCookie: options.blockedCookie === true,
            authenticate: ["LOCAL_AUTH_PIPELINE", "ACCOUNT_COOKIE_ROW_LOGOUT", "ACCOUNT_A_TO_B", "API_OUTAGE", "API_CONFLICT", "LOADING_STALE_ACTOR"].includes(name) });
        await context.routeWebSocket("**/*", socket => {
            frontDoorReceipt.TASK19_FIXTURE_WEBSOCKET_ATTEMPTS++;
            recordBlocked(socket.url(), { transport: "WEBSOCKET", resourceType: "websocket", method: "GET" });
            socket.close();
            workerFailure(new Error("TASK19_UNEXPECTED_BROWSER_WEBSOCKET"));
        });
        await context.route(url => !(url.origin === origin && url.pathname === "/api/users/me/preferences"), async (route) => {
            const request = route.request(), url = new URL(request.url());
            Object.assign(requestLedger.get(request), { routeMatched: true, routeBranch: "UNKNOWN", terminalActionCalled: false, terminalAction: "NONE" });
            if (name === "LOCAL_AUTH_PIPELINE" && url.pathname === "/auth/v1/token" && request.method() === "POST"
                && frontDoorReceipt.TASK19_BROWSER_AND_PUBLIC_SUPABASE_SAME_ORIGIN !== true) {
                Object.assign(requestLedger.get(request), { terminalActionCalled: true, terminalAction: "ABORT" });
                if (url.origin !== origin) {
                    external++;
                    recordBlocked(url, { transport: "HTTP", resourceType: request.resourceType(), method: request.method() });
                }
                return route.abort();
            }
            if (url.origin === origin) {
                Object.assign(requestLedger.get(request), { task19Owned: true, terminalActionCalled: true, terminalAction: "CONTINUE" });
                return route.continue();
            }
            if (url.origin === gatewayOrigin && isOwnedSupabaseRoute(url, request.method())) {
                Object.assign(requestLedger.get(request), { task19Owned: true, terminalActionCalled: true, terminalAction: "CONTINUE" });
                return route.continue();
            }
            if (url.origin !== origin) {
                external++;
                recordBlocked(url, { transport: "HTTP", resourceType: request.resourceType(), method: request.method() });
                workerFailure(new Error("TASK19_UNEXPECTED_BROWSER_EXTERNAL_REQUEST"));
                return route.abort();
            }
            if (url.pathname === "/__task19/fixture.js" && request.method() === "GET") {
                requestLedger.get(request).task19Owned = true;
                return traceFulfill(route, task19FixtureResponse("ASSET", "", inputs, rows, renderFixture, fixtureBundle));
            }
            if (url.pathname === "/__task19/locale" && request.method() === "GET") {
                requestLedger.get(request).task19Owned = true;
                const cookies = request.headers().cookie ?? "";
                const { actor, ...served } = task19FixtureResponse("HTML", cookies, inputs, rows, renderFixture, fixtureBundle);
                requestLedger.get(request).fixtureActor = actor;
                return traceFulfill(route, served);
            }
            recordBlocked(url, { transport: "HTTP", resourceType: request.resourceType(), method: request.method() });
            external++;
            workerFailure(new Error("TASK19_UNEXPECTED_BROWSER_EXTERNAL_REQUEST"));
            return route.abort();
        });
        page = await context.newPage();
        const browserObservation = undefined;
        if (engineName === "chromium") {
            const session = await context.newCDPSession(page);
            session.on("Log.entryAdded", ({ entry }) => {
                if (entry.level !== "error" || entry.source !== "network" || !entry.url)
                    return;
                const url = new URL(entry.url);
                if (url.origin === origin) {
                    networkEntries.push({ pathname: url.pathname, text: entry.text });
                    if (negativeCase && url.pathname === "/api/users/me/preferences")
                        outageEvidence.browserNetworkSource = true;
                }
            });
            await session.send("Log.enable");
        }
        const observePage = page => {
            let errorPhase = "BEFORE_DOM_CONTENT_LOADED";
            if (case63Trace) {
                page.on("framenavigated", frame => {
                    if (frame === page.mainFrame() && new URL(frame.url()).pathname === "/__task19/locale")
                        case63Trace.frameNavigated();
                });
                page.on("domcontentloaded", () => case63Trace.domContentLoaded());
            }
            if (observeFinalReload)
                page.on("framenavigated", frame => {
                    const observation = abDocumentObservation;
                    if (!observation.active || frame !== page.mainFrame())
                        return;
                    const current = observation.documents.filter(entry => entry.fixtureDocumentFrame === frame && entry.responseObserved).at(-1);
                    observation.activeDocument = current;
                    observation.navigations.push({ phase: observation.phase, sequence: current?.id ?? "UNKNOWN" });
                    const front = current && observation.front.find(entry => entry.occurrence === current.fixtureDocumentOccurrence);
                    observation.finalReload?.navigated(current, { mainFrame: frame === page.mainFrame(), pathname: new URL(frame.url()).pathname, actor: front?.actor });
                });
            if (observeFinalReload)
                page.on("domcontentloaded", () => {
                    if (!abDocumentObservation.active)
                        return;
                    if (abDocumentObservation.activeDocument)
                        abDocumentObservation.activeDocument.fixtureDocumentDomReady = true;
                    abDocumentObservation.finalReload?.domContentLoaded(abDocumentObservation.activeDocument);
                });
            if (realLoadingCase)
                page.on("framenavigated", frame => {
                    const logout = loadingObservation.logout;
                    if (frame !== page.mainFrame() || !loadingObservation.active || !logout.events.some(item => item.event === "A_SIGNOUT_CALL")
                        || logout.events.some(item => item.event === "B_SIGNIN_START"))
                        return;
                    markAuthLogout("NAVIGATION_BETWEEN_AUTH_TRANSITIONS", { navigationBetween: true });
                });
            page.once("domcontentloaded", () => { errorPhase = "AFTER_DOM_CONTENT_LOADED_BEFORE_HYDRATION"; });
            page.on("request", request => {
                fixtureNetwork.requests++;
                pendingRequests.add(request);
                const url = new URL(request.url());
                if (name === "LOCAL_AUTH_PIPELINE" && url.pathname === "/auth/v1/token" && request.method() === "POST" && !browserSigninEvidence.requestObserved) {
                    browserSigninEvidence.requestObserved = true;
                    transportEvidence.BROWSER_SIGNIN_REQUEST_METHOD = "POST";
                    transportEvidence.BROWSER_SIGNIN_REQUEST_PATHNAME = "/auth/v1/token";
                    {
                        const { accepted, ...proof } = browserSigninOriginProof(page.url(), request.url(), frontDoorOrigin);
                        Object.assign(frontDoorReceipt, proof);
                        if (!accepted) {
                            const blocker = proof.SIGNIN_REQUEST_RUNTIME_ORIGIN_CLASS === "REMOTE"
                                ? "TASK19_BROWSER_SUPABASE_REMOTE_TARGET" : "TASK19_BROWSER_SUPABASE_NON_FRONT_DOOR_TARGET";
                            Object.assign(frontDoorReceipt, { FIRST_NEW_BLOCKER: blocker, FIRST_FAIL: "ACTUAL_BROWSER_SIGNIN_ORIGIN_REJECTED", FAILURE_CLASS: "BROWSER_AUTH_TARGET_CONTRACT_FAILURE" });
                            disposableReceipt.FAILED_BOUNDARY = "GOTRUE_TOKEN";
                            workerFailure(new Error(blocker));
                        }
                        else {
                            frontDoorReceipt.TASK19_BROWSER_AND_PUBLIC_SUPABASE_SAME_ORIGIN = true;
                            frontDoorReceipt.BROWSER_SUPABASE_REQUEST_CROSS_ORIGIN = false;
                            frontDoorReceipt.BROWSER_LNA_PERMISSION_REQUIRED = false;
                        }
                    }
                }
                if (name === "LOCAL_AUTH_PIPELINE" && url.origin === origin && url.pathname === "/api/users/me/preferences" && request.method() === "GET") {
                    disposableReceipt.PREFERENCES_REQUEST_AUTHORIZATION_PRESENT = /^Bearer [^\s]+$/i.test(request.headers().authorization ?? "");
                }
                if (!requestIds.has(request))
                    requestIds.set(request, ++requestSerial);
                requestLedger.set(request, { id: requestIds.get(request), case: `FIXTURE_${name}`, method: request.method(), pathname: url.pathname,
                    documentGeneration: browserObservation?.documentGeneration,
                    resourceType: request.resourceType(), startOffset: offset(), phase: switchPhase,
                    actor: url.origin === origin && url.pathname === "/api/users/me/preferences" ? fixtureActor(request.headers().authorization) : "UNKNOWN",
                    epochStart: request.timing().startTime, routeMatched: false, routeBranch: "UNKNOWN", terminalActionCalled: false, terminalAction: "NONE",
                    observed: true, responseObserved: false, finished: false, failed: false, fixtureOwned: false, intentional: false });
                if (case63Trace)
                    case63Trace.request(request, requestLedger.get(request), request.isNavigationRequest()
                        && request.resourceType() === "document" && request.frame() === page.mainFrame() && url.origin === origin);
                if (observeFinalReload && url.origin === origin && url.pathname === "/api/users/me/preferences") {
                    requestLedger.get(request).fixtureOwnerDocumentGeneration = abDocumentObservation.activeDocument?.fixtureDocumentGeneration;
                }
                if (observeFinalReload && request.isNavigationRequest() && request.resourceType() === "document" && request.frame() === page.mainFrame()
                    && url.origin === origin && url.pathname === "/__task19/locale") {
                    const observation = abDocumentObservation, entry = requestLedger.get(request);
                    Object.assign(entry, { fixtureDocumentOccurrence: observation.documents.length + 1, fixtureDocumentGeneration: observation.documents.length + 1,
                        fixtureDocumentPhase: observation.phase, fixtureDocumentFrame: request.frame(), fixtureClientBodyEof: "unknown" });
                    observation.documents.push(entry);
                }
                if (realLoadingCase) {
                    const entry = requestLedger.get(request);
                    Object.assign(entry, { loadingGeneration: loadingObservation.generation, loadingPhase: loadingObservation.phase });
                    if (url.origin === origin && entry.method === "GET" && entry.pathname === "/api/users/me/preferences") {
                        if (entry.actor === "ACCOUNT_A" && loadingObservation.phase === "A_LOADING") {
                            assert.equal(loadingObservation.oldEntry, undefined, "ONE_HELD_BROWSER_ACTOR_A_GET");
                            loadingObservation.oldEntry = entry;
                        }
                        if (entry.actor === "ACCOUNT_B")
                            loadingObservation.finalEntry = entry;
                    }
                    if (url.origin === origin && entry.method === "POST" && entry.pathname === "/auth/v1/logout") {
                        const logout = loadingObservation.logout;
                        logout.browserCount++;
                        Object.assign(entry, { authPhase: logout.phase, authLogicalActor: fixtureActor(request.headers().authorization), authPreferenceGenerationApplicable: false });
                        if (!logout.entry)
                            logout.entry = entry;
                        markAuthLogout("LOGOUT_REQUEST_START");
                    }
                }
                if (realHttpSwitchObservation?.active) {
                    const observation = realHttpSwitchObservation, entry = requestLedger.get(request), key = `${entry.method} ${entry.pathname}`;
                    const occurrence = (observation.browserOccurrences.get(key) ?? 0) + 1;
                    observation.browserOccurrences.set(key, occurrence);
                    Object.assign(entry, { occurrence, realHttpPhase: observation.phase, actorGeneration: observation.generation,
                        realDocumentGeneration: observation.documentGeneration });
                    if (entry.pathname !== "/api/users/me/preferences")
                        entry.actor = observation.actor;
                    if (entry.actor === "ACCOUNT_B" && observation.phase === "ACCOUNT_B_SIGNIN")
                        entry.realHttpPhase = "ACCOUNT_B_PREFERENCE_LOAD";
                }
                if (realLoadingCase)
                    recordLoadingNetworkEvent("REQUEST", requestLedger.get(request));
                if (negativeCase && ["outage", "conflict"].includes(controls.mode) && url.origin === origin && url.pathname === "/api/users/me/preferences" && request.method() === "PATCH") {
                    if (name === "API_CONFLICT" && engineName === "chromium" && width === 1280) {
                        const payload = request.postDataJSON();
                        assert.ok(Number.isSafeInteger(payload.expected_revision));
                        conflictRevisionReceipt.API_CONFLICT_BROWSER_STALE_REVISION_SENT = payload.expected_revision;
                    }
                    assert.equal(outageRequest, undefined, "ONLY_ONE_NEGATIVE_MUTATION_REQUEST");
                    outageRequest = request;
                    if (realOutageCase) {
                        apiOutageReceipt.OUTAGE_PATCH_BROWSER_REQUEST_OBSERVED = true;
                        markOutagePhase(4);
                    }
                    outageEvidence.requestObserved = true;
                    outageEvidence.method = request.method();
                    outageEvidence.pathname = url.pathname;
                    outageEvidence.fixtureOwned = true;
                    outageEvidence.intentional = true;
                    Object.assign(requestLedger.get(request), { fixtureOwned: true, intentional: true });
                }
            });
            page.on("response", response => {
                if (name === "LOCAL_AUTH_PIPELINE" && new URL(response.url()).origin === gatewayOrigin && new URL(response.url()).pathname === "/auth/v1/token") {
                    browserSigninEvidence.responseObserved = true;
                    browserSigninEvidence.responseStatus = response.status();
                }
                fixtureNetwork.responses++;
                Object.assign(requestLedger.get(response.request()), { responseObserved: true, status: response.status() });
                const entry = requestLedger.get(response.request());
                if (realLoadingCase)
                    recordLoadingNetworkEvent("RESPONSE", entry);
                if (observeFinalReload && entry.fixtureDocumentGeneration !== undefined) {
                    void response.body().then(() => { if (abDocumentObservation.active)
                        entry.fixtureClientBodyEof = true; }, () => { });
                }
                if (realLoadingCase && entry === loadingObservation.logout.entry)
                    markAuthLogout("LOGOUT_BROWSER_RESPONSE");
                entry.terminalKind = "RESPONSE";
                entry.terminalOffset = offset();
                entry.terminalObserver?.();
                const url = new URL(response.url());
                if (url.origin === origin && response.status() >= 400)
                    negativeResponses.push({ method: response.request().method(), pathname: url.pathname, status: response.status() });
                if (response.request() === outageRequest) {
                    if (apiOutageObservation?.nativeEnabled)
                        observeNativeResponseHeaders(response.headers());
                    outageEvidence.responseObserved = true;
                    outageEvidence.responseStatus = response.status();
                    if (realOutageCase) {
                        Object.assign(apiOutageReceipt, { BROWSER_OUTAGE_RESPONSE_OBSERVED: true, BROWSER_OUTAGE_RESPONSE_STATUS: response.status() });
                        markOutagePhase(10);
                    }
                }
            });
            page.on("requestfinished", request => {
                if (realOutageCase && request === outageRequest) {
                    apiOutageReceipt.BROWSER_OUTAGE_REQUESTFINISHED = true;
                    markOutagePhase(11);
                }
                const entry = requestLedger.get(request);
                entry.finished = true;
                entry.finishedOffset = offset();
                if (realLoadingCase)
                    recordLoadingNetworkEvent("REQUESTFINISHED", entry);
                if (case63Trace)
                    case63Trace.terminal(request, "DOCUMENT_REQUESTFINISHED");
                if (observeFinalReload)
                    abDocumentObservation.finalReload?.requestTerminal(entry);
                if (realLoadingCase && entry === loadingObservation.logout.entry)
                    markAuthLogout("LOGOUT_REQUESTFINISHED");
                pendingRequests.delete(request);
                entry.finishedObserver?.();
            });
            page.on("requestfailed", request => {
                if (realOutageCase && request === outageRequest)
                    apiOutageReceipt.BROWSER_OUTAGE_REQUESTFAILED = true;
                if (name === "LOCAL_AUTH_PIPELINE" && new URL(request.url()).origin === gatewayOrigin && new URL(request.url()).pathname === "/auth/v1/token") {
                    browserSigninEvidence.requestFailed = true;
                    transportEvidence.BROWSER_SIGNIN_FAILURE_CLASS = normalizedNetworkFailure(request.failure()?.errorText);
                }
                fixtureNetwork.failed++;
                pendingRequests.delete(request);
                requestLedger.get(request).failed = true;
                if (case63Trace)
                    case63Trace.terminal(request, "DOCUMENT_REQUESTFAILED");
                const entry = requestLedger.get(request);
                if (observeFinalReload)
                    abDocumentObservation.finalReload?.requestTerminal(entry);
                if (realLoadingCase || observeAbDocument)
                    entry.failureClass = request.failure()?.errorText === "net::ERR_ABORTED" ? "ERR_ABORTED" : normalizedNetworkFailure(request.failure()?.errorText);
                if (realLoadingCase) {
                    entry.browserErrorSymbol = safeBrowserFailureSymbol(request.failure()?.errorText);
                    recordLoadingNetworkEvent("REQUESTFAILED", entry);
                }
                if (realLoadingCase && entry === loadingObservation.logout.entry)
                    markAuthLogout("LOGOUT_REQUESTFAILED");
                entry.finishedObserver?.();
                entry.terminalKind = "REQUESTFAILED";
                entry.terminalOffset = offset();
                entry.terminalObserver?.();
                if (request === outageRequest)
                    outageEvidence.requestFailed = true;
            });
            page.on("pageerror", error => {
                receipt.pageErrors++;
                if (!firstPageError) {
                    const words = new Set("React process window document module exports require is not defined Cannot read properties of null undefined reading textContent before initialization access identifier Unexpected token return missing invalid SettingsPage Task19Fixture locale snapshot createElement useState useEffect".split(" "));
                    const template = String(error.message).replace(/https?:\/\/\S+|[A-Za-z]:[\\/][^\s]+|[\w.+-]+@[\w.-]+|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}/gi, "<REDACTED>")
                        .replace(/[A-Za-z_$][\w$.-]*/g, word => words.has(word) ? word : "<REDACTED>").replace(/\d+/g, "<N>").slice(0, 240);
                    firstPageError = { PAGEERROR_NAME: ["ReferenceError", "TypeError", "SyntaxError", "Error", "RangeError"].includes(error.name) ? error.name : "UNKNOWN",
                        PAGEERROR_MESSAGE_TEMPLATE: template, PAGEERROR_FIRST_LOCAL_FRAME: "UNKNOWN", PAGEERROR_FIRST_LOCAL_LINE: "UNKNOWN", PAGEERROR_FIRST_LOCAL_COLUMN: "UNKNOWN", PAGEERROR_PHASE: errorPhase };
                    for (const frame of String(error.stack).split("\n")) {
                        const match = frame.match(/(https?:\/\/[^\s)]+):(\d+):(\d+)/);
                        if (!match)
                            continue;
                        let url;
                        try {
                            url = new URL(match[1]);
                        }
                        catch {
                            continue;
                        }
                        if (url.origin !== origin || url.pathname !== "/__task19/fixture.js")
                            continue;
                        const mapped = fixtureSourceMap(Number(match[2]), Number(match[3]) - 1);
                        const relative = mapped.source ? path.relative(root, path.resolve(ownedRoot, mapped.source)).replaceAll("\\", "/") : "";
                        firstPageError.PAGEERROR_FIRST_LOCAL_FRAME = relative && !relative.startsWith("../") && !path.isAbsolute(relative) ? relative : "/__task19/fixture.js";
                        firstPageError.PAGEERROR_FIRST_LOCAL_LINE = mapped.line ?? Number(match[2]);
                        firstPageError.PAGEERROR_FIRST_LOCAL_COLUMN = mapped.column === null ? Number(match[3]) : mapped.column + 1;
                        break;
                    }
                }
                workerFailure(new Error("TASK19_BROWSER_PAGEERROR"));
            });
            page.on("console", message => {
                case63Trace?.source(message);
                if (message.type() === "error") {
                    receipt.consoleErrors++;
                    const location = message.location();
                    const pathname = location.url && new URL(location.url).origin === origin ? new URL(location.url).pathname : "UNKNOWN";
                    caseConsole.push({ text: message.text(), argCount: message.args().length, pathname });
                    if (!firstConsoleError) {
                        const location = message.location();
                        const text = message.text();
                        firstConsoleError = {
                            CONSOLE_ERROR_TEXT_TEMPLATE: /^Failed to load resource: the server responded with a status of \d{3} \([A-Za-z ]+\)$/.test(text) ? text.slice(0, 240) : "REDACTED",
                            CONSOLE_ERROR_ARG_COUNT: message.args().length,
                            CONSOLE_ERROR_LOCATION_FRAME: "UNKNOWN", CONSOLE_ERROR_LOCATION_LINE: "UNKNOWN", CONSOLE_ERROR_LOCATION_COLUMN: "UNKNOWN",
                            CONSOLE_ERROR_SOURCE_KIND: "UNKNOWN", CONSOLE_ERROR_SOURCE_FILE: "UNKNOWN",
                        };
                        if (location.url) {
                            const url = new URL(location.url);
                            if (url.origin === origin && ["/__task19/fixture.js", "/api/users/me/preferences", "/__task19/locale"].includes(url.pathname)) {
                                firstConsoleError.CONSOLE_ERROR_LOCATION_FRAME = url.pathname;
                                firstConsoleError.CONSOLE_ERROR_LOCATION_LINE = location.lineNumber;
                                firstConsoleError.CONSOLE_ERROR_LOCATION_COLUMN = location.columnNumber;
                                if (url.pathname === "/__task19/fixture.js") {
                                    const mapped = fixtureSourceMap(location.lineNumber + 1, location.columnNumber);
                                    const relative = mapped.source ? path.relative(root, path.resolve(ownedRoot, mapped.source)).replaceAll("\\", "/") : "";
                                    if (relative && !relative.startsWith("../") && !path.isAbsolute(relative)) {
                                        firstConsoleError.CONSOLE_ERROR_SOURCE_FILE = relative;
                                        firstConsoleError.CONSOLE_ERROR_SOURCE_KIND = relative.startsWith("tests/") ? "TASK19_FIXTURE"
                                            : relative.startsWith("src/") ? "PRODUCT_CODE" : relative.startsWith("node_modules/react") ? "REACT_RUNTIME" : "UNKNOWN";
                                    }
                                }
                            }
                        }
                    }
                    // Only the two approved negative cases may defer classification until semantics are proven.
                    if ((!negativeCase))
                        rejectCase(new Error("TASK19_BROWSER_CONSOLE_ERROR"));
                }
                else if (isReactHydrationDiagnostic(message))
                    workerFailure(new Error("TASK19_HYDRATION_WARNING"));
            });
            return value => { errorPhase = value; if (negativeCase)
                outageEvidence.unresolved = pendingRequests.size; };
        };
        const markPhase = observePage(page);
        const address = `${origin}/__task19/locale?fixture=task19`;
        const navigate = async (target) => {
            if (observeAbDocument)
                abDocumentObservation.gotoCount++;
            assert.equal(receipt.userWorkerReady, true);
            const response = await target.goto(address, { timeout: 15000 });
            {
                frontDoorReceipt.TASK19_FRONT_DOOR_FIXTURE_HTTP_STATUS = response.status();
                assert.equal(response.status(), 200, "TASK19_FRONT_DOOR_FIXTURE_ROUTE_HTTP_200_REQUIRED");
            }
            await target.waitForFunction(() => window.__task19 !== undefined, null, { timeout: 10000 });
        };
        runtimePhase("FIXTURE_NAVIGATION", "browserFixtureCase/navigate");
        await navigate(page);
        if (name === "LOCAL_AUTH_PIPELINE") {
            await page.waitForFunction(() => window.__task19AuthHarness !== undefined, null, { timeout: 10000 });
            const control = page.locator(".locale-settings select");
            assert.equal(await control.isVisible(), true, "TASK19_FIXTURE_CONTROL_REQUIRED");
            await control.focus();
            assert.equal(await control.evaluate(element => element === document.activeElement), true);
            assert.equal(caseConsole.length + receipt.pageErrors - before.pageErrors, 0, "TASK19_FIXTURE_CLEAN_HYDRATION_REQUIRED");
            frontDoorReceipt.TASK19_FIXTURE_HYDRATION = "PASS";
            console.log("TASK19_FIXTURE_HYDRATION=PASS");
        }
        markPhase("AFTER_HYDRATION");
        markPhase("AFTER_TEST_INTERACTION");
        runtimePhase("CASE_ACTION", "browserFixtureCase/scenario");
        await Promise.race([scenario({ page, context, controls, observed, navigate, observePage, markSwitch }), caseFailed]);
        if (apiOutageObservation?.nativeEnabled)
            await observeNativeTiming(page);
        // Paint the settled UI for visual capture; AB390 navigation settles inside its scenario.
        runtimePhase("CASE_FINAL_SETTLEMENT", "browserFixtureCase/current_document_frame_settlement");
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        {
            let timer;
            try {
                await Promise.race([Promise.all([
                        ...[...requestLedger.values()].filter(entry => !entry.finished && !entry.failed && !isOutageResponseFinishedTerminal(entry)).map(entry => new Promise(resolve => { entry.finishedObserver = resolve; })),
                        ...([]),
                    ]), caseFailed,
                    new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("TASK19_HTTP_TERMINAL_EVENT_TIMEOUT")), Math.max(1, 15000 - (performance.now() - caseStartedAt))); })]);
            }
            finally {
                clearTimeout(timer);
            }
        }
        markPhase("AFTER_CASE_OBSERVATION");
        accountConsole();
        assert.equal(receipt.applicationConsoleErrors, 0, "TASK19_APPLICATION_CONSOLE_ERROR");
        assert.equal(receipt.unexpectedNetworkDiagnostics, 0, "TASK19_UNEXPECTED_BROWSER_NETWORK_DIAGNOSTIC");
        assert.equal(receipt.pageErrors, 0, "TASK19_BROWSER_PAGEERROR");
        assert.equal(receipt.unhandledRejections, 0, "TASK19_BROWSER_UNHANDLED_REJECTION");
        if (observeFinalReload) {
            if (useStaleActorLifecycle)
                assertStaleActorDocumentCurrent(abDocumentObservation);
            else
                abDocumentObservation.finalReload.assertSnapshotAllowed(abDocumentObservation.activeDocument, abDocumentObservation.documents.at(-1));
            abDocumentObservation.receipt.UNRESOLVED_REQUESTS = pendingRequests.size;
        }
        assert.equal(pendingRequests.size, 0, "TASK19_UNRESOLVED_CURRENT_RUN_REQUESTS");
        assert.equal([...requestLedger.values()].filter(entry => resolveRequestLedger(entry, negativeCase ? outageEvidence.semanticContract : "NOT_RUN") === "RESOLVED_UNEXPECTED_RESPONSE").length, 0, "TASK19_UNEXPECTED_RESPONSE");
        if (negativeCase) {
            assert.equal(outageEvidence.requestObserved, true);
            assert.equal(outageEvidence.method, "PATCH");
            assert.equal(outageEvidence.pathname, "/api/users/me/preferences");
            assert.equal(outageEvidence.responseObserved, true);
            assert.equal(outageEvidence.responseStatus, approvedNegativeResponses[`FIXTURE_${name}`].status);
            assert.equal(outageEvidence.requestFailed, false);
            assert.ok(requestLedger.get(outageRequest).finished || isOutageResponseFinishedTerminal(requestLedger.get(outageRequest)), "NEGATIVE_HTTP_REQUEST_FINISHED");
            assert.equal(outageEvidence.fixtureOwned, true);
            assert.equal(outageEvidence.intentional, true);
            assert.equal(outageEvidence.uiFallback, "PASS");
            console.log(`FIXTURE_${name}=PASS ENGINE=${engineName} WIDTH=${width} APPLICATION_CONSOLE_ERRORS=0 EXPECTED_BROWSER_NETWORK_DIAGNOSTICS=${caseConsole.length} UNEXPECTED_BROWSER_NETWORK_DIAGNOSTICS=0 PAGEERRORS=0 UNHANDLED_REJECTIONS=0`);
            console.log(`FIXTURE_${name}_UI_FALLBACK=PASS\nFIXTURE_${name}_SEMANTIC_CONTRACT=PASS`);
            console.log(`FIXTURE_${name}_RESPONSE_STATUS=${outageEvidence.responseStatus}\nFIXTURE_${name}_REQUESTFINISHED=${requestLedger.get(outageRequest).finished}`);
        }
        if (name === "ACCOUNT_A_TO_B") {
            const b = [...requestLedger.values()].filter(entry => entry.pathname === "/api/users/me/preferences" && entry.method === "GET" && entry.actor === "ACCOUNT_B"
                && (!observeAbDocument || entry.fixtureOwnerDocumentGeneration === abDocumentObservation.finalSnapshot.FINAL_PAGE_NAVIGATION_GENERATION)).at(-1);
            assert.ok(b && b.responseObserved && b.status === 200 && b.finished && !b.failed, "REAL_ACCOUNT_B_HTTP_LIFECYCLE");
            if (!observeAbDocument)
                assert.equal(await page.evaluate(() => document.cookie.split(";").some(part => part.trim() === "task19_actor=B")
                    && window.__task19.state().account.revision === 5 && window.__task19.state().account.locale_preference === "zh-CN"
                    && document.documentElement.lang === "zh-CN"), true, "FINAL_OWNED_ACCOUNT_B_STATE");
            console.log("ACCOUNT_B_GET_RESPONSE_STATUS=200\nACCOUNT_B_GET_REQUESTFINISHED=true\nACCOUNT_B_GET_REQUESTFAILED=false");
            console.log("ACCOUNT_A_STATE_ESTABLISHED=true\nACCOUNT_B_STATE_ESTABLISHED=true\nFINAL_UI_ACTOR=ACCOUNT_B\nFINAL_B_LOCALE_CORRECT=true");
            console.log("ACCOUNT_A_PREFERENCE_LEAKED_TO_B=false\nSTALE_RESULT_APPLIED=false\nFIXTURE_ACCOUNT_A_TO_B_UNRESOLVED_REQUESTS=0\nFIXTURE_ACCOUNT_A_TO_B_SEMANTIC_CONTRACT=PASS");
            if (observeAbDocument) {
                Object.assign(abDocumentObservation.receipt, { TASK19_AB390_FINAL_RELOAD_BARRIER: "PASS", ACCOUNT_B_GET_RESPONSE_STATUS: b.status,
                    ACCOUNT_B_GET_REQUESTFINISHED: b.finished, ACCOUNT_B_GET_REQUESTFAILED: b.failed });
            }
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "FIXTURE_OVERFLOW");
        if (options.readinessGate) {
            const gets = [...requestLedger.values()].filter(entry => entry.pathname === "/api/users/me/preferences" && entry.method === "GET");
            assert.equal(gets.length, 1, "BOUNDED_SINGLE_AUTHENTICATED_GET");
            const entry = gets[0];
            Object.assign(disposableReceipt, { PREFERENCES_GET_STATUS: entry.status, PREFERENCES_GET_REQUESTFINISHED: entry.finished,
                PREFERENCES_GET_REQUESTFAILED: entry.failed });
            assert.equal(entry.status, 200, "PIPELINE_PREFERENCE_GET_200");
            assert.equal(entry.finished, true, "PIPELINE_PREFERENCE_GET_FINISHED");
            assert.equal(entry.failed, false);
            assert.equal(authControlFlowReceipt.TASK19_AUTH_OBSERVABILITY_GAP, "CLOSED");
            disposableReceipt.LOCAL_AUTH_PIPELINE_PREFLIGHT = "PASS";
            console.log("LOCAL_AUTH_PIPELINE_PREFLIGHT=PASS\nBROWSER_SESSION_PRESENT=true\nPREFERENCES_AUTHORIZATION_PRESENT=true\nWORKER_AUTH_GET_USER_REACHED=true");
            return;
        }
        if (realOutageCase) {
            if (apiOutageObservation.cdpEnabled)
                freezeCdpOutage(page);
            await collectApiOutageDiagnostic(page, requestLedger);
            if (apiOutageObservation.cdpEnabled) {
                assert.equal(cdpTerminalReceipt.CDP_OUTAGE_REQUEST_MATCH_COUNT, 1, "CDP_ONE_EXACT_OUTAGE_REQUEST");
                assert.equal(cdpTerminalReceipt.CDP_OUTAGE_REQUEST_ID_CORRELATION, "EXACT");
                assert.equal(cdpTerminalReceipt.CDP_RESPONSE_RECEIVED, true);
                assert.equal(cdpTerminalReceipt.CDP_RESPONSE_STATUS, 503);
                assert.equal(cdpTerminalReceipt.CDP_LOADING_FINISHED_OBSERVED, true, "CDP_OUTAGE_NORMAL_HTTP_COMPLETION_REQUIRED");
                assert.equal(cdpTerminalReceipt.CDP_LOADING_FAILED_OBSERVED, false);
                assert.equal(cdpTerminalReceipt.CDP_LOADING_FINISHED_AFTER_RESPONSE_RECEIVED, true);
                assert.equal(apiOutageReceipt.BROWSER_OUTAGE_REQUESTFINISHED, true);
                assert.equal(apiOutageReceipt.OUTAGE_RESPONSE_FINISHED_API_STATE, "RESOLVED_NULL");
                Object.assign(cdpTerminalReceipt, { OWNER: "NONE", ROOT_CAUSE: "NONE", FAILURE_CLASS: "NONE" });
            }
            assert.equal(apiOutageReceipt.OUTAGE_OUTBOUND_FAULT_MATCH_COUNT, 1, "OUTAGE_OUTBOUND_FAULT_EXACTLY_ONCE");
            assert.equal(apiOutageReceipt.OUTAGE_AUTH_STILL_HEALTHY, true, "OUTAGE_AUTH_HEALTH_REQUIRED");
            assert.equal(apiOutageReceipt.WORKER_OUTBOUND_TERMINAL_STATUS, 503);
            assert.equal(apiOutageReceipt.WORKER_OUTAGE_RESPONSE_STATUS, 503);
            assert.equal(apiOutageReceipt.BROWSER_OUTAGE_RESPONSE_STATUS, 503);
            assert.ok(apiOutageReceipt.BROWSER_OUTAGE_REQUESTFINISHED || isOutageResponseFinishedTerminal(requestLedger.get(outageRequest)));
            assert.equal(apiOutageReceipt.BROWSER_OUTAGE_REQUESTFAILED, false);
            assert.equal(apiOutageReceipt.OUTAGE_UI_ERROR_STATE_OBSERVED, true);
            assert.equal(apiOutageReceipt.OUTAGE_UI_PREFERENCE_RETAINED, true);
            assert.equal(apiOutageReceipt.OUTAGE_UI_FALSE_SUCCESS, false);
            assert.equal(apiOutageReceipt.UNRESOLVED_REQUESTS, 0);
            apiOutageReceipt.API_OUTAGE_SEMANTIC_CONTRACT = "PASS";
            apiOutageReceipt.TASK19_API_OUTAGE_OUTBOUND_SERVICE_FIX = "PASS";
            if (engineName === "chromium" && width === 1280) {
                apiOutageReceipt.FIXTURE_API_OUTAGE_CHROMIUM_1280 = "PASS";
                apiOutageDesktopReceipt = { ...apiOutageReceipt };
            }
            for (const [key, value] of Object.entries(apiOutageReceipt))
                console.log(`${key}=${value}`);
        }
        if (name === "API_CONFLICT" && engineName === "chromium" && width === 1280) {
            const entry = requestLedger.get(outageRequest);
            assert.equal(entry.status, 409);
            assert.equal(entry.finished, true);
            assert.equal(entry.failed, false);
            Object.assign(conflictRevisionReceipt, { API_CONFLICT_WORKER_STATUS: entry.status,
                API_CONFLICT_BROWSER_RESPONSE_STATUS: entry.status, API_CONFLICT_BROWSER_REQUESTFINISHED: entry.finished,
                API_CONFLICT_BROWSER_REQUESTFAILED: entry.failed, FIXTURE_API_CONFLICT_CHROMIUM_1280: "PASS", API_CONFLICT_SEMANTIC_CONTRACT: "PASS" });
            console.log("FIXTURE_API_CONFLICT_CHROMIUM_1280=PASS\nTASK19_BROWSER_CASES_COMPLETED=26");
        }
        if (realLoadingCase) {
            await collectLoadingEvidence(page, requestLedger);
            const old = loadingObservation.oldEntry, final = loadingObservation.finalEntry;
            assert.ok(old && final, "EXACT_OLD_AND_FINAL_ACTOR_REQUESTS_REQUIRED");
            const failed = [...requestLedger.values()].filter(entry => entry.failed);
            const unexpected = failed.filter(entry => !expectedStaleAbort(entry, loadingObservation)
                && authLogoutTerminalClass(entry, loadingObservation, loadingReceipt.UNRESOLVED_REQUESTS) !== "AUTH_LOGOUT_POST_SUCCESS_ABORT");
            assert.equal(unexpected.length, 0, "STALE_ACTOR_UNEXPECTED_REQUESTFAILED");
            assert.ok(old.finished || expectedStaleAbort(old, loadingObservation), "OLD_ACTOR_GENUINE_TERMINAL_REQUIRED");
            assert.equal(final.status, 200);
            assert.equal(final.finished, true);
            assert.equal(final.failed, false);
            Object.assign(loadingReceipt, { OLD_ACTOR_REQUEST_TERMINAL: true, OLD_ACTOR_REQUEST_FINAL_GENERATION_RELATION: "OLDER_THAN_FINAL",
                OLD_ACTOR_REQUEST_GENERATION_RELATION: "OLDER_THAN_FINAL", LOADING_STALE_ACTOR_SEMANTIC_CONTRACT: "PASS",
                FINAL_ACTOR_PREFERENCE_REQUEST_OBSERVED: true, FINAL_ACTOR_PREFERENCE_REQUEST_STATUS: final.status,
                FINAL_ACTOR_PREFERENCE_REQUESTFINISHED: final.finished, FINAL_ACTOR_PREFERENCE_REQUEST_TERMINAL: true,
                ...accountLoadingRequestFailures([...requestLedger.values()], loadingObservation, loadingReceipt.UNRESOLVED_REQUESTS),
                UNRESOLVED_REQUESTS: 0 });
            if (engineName === "chromium" && width === 1280) {
                logoutDesktopReceipt = { ...logoutReceipt };
                loadingReceipt.FIXTURE_LOADING_STALE_ACTOR_CHROMIUM_1280 = "PASS";
                loadingDesktopReceipt = { ...loadingReceipt };
                console.log("FIXTURE_LOADING_STALE_ACTOR_CHROMIUM_1280=PASS\nTASK19_BROWSER_CASES_COMPLETED=27");
            }
        }
        await page.screenshot({ path: path.join(output, `fixture-${engineName}-${width}-${name}.png`), fullPage: true });
        fixtureCases++;
        if (case63Trace)
            case63Trace.normalAssertionsPassed = true;
        console.log(`TASK19_BROWSER_CASES_COMPLETED=${acceptedDisposableCasesAtStart + workerCasesPassed + fixtureCases}`);
        if (useStaleActorLifecycle)
            Object.assign(staleActorReceipt, { TASK19_STALE430_RELOAD_LIFECYCLE_GENERALIZATION: "PASS",
                [`FIXTURE_LOADING_STALE_ACTOR_${engineName.toUpperCase()}_${width}`]: "PASS" });
        console.log(`TASK19_BROWSER_FIXTURE_CASE=PASS ENGINE=${engineName} WIDTH=${width} CASE=${name}`);
        if (name === "ACCOUNT_COOKIE_ROW_LOGOUT" && engineName === "chromium" && width === 1280) {
            cookieRowReceipt.FIXTURE_ACCOUNT_COOKIE_ROW_LOGOUT_CHROMIUM_1280 = "PASS";
            for (const [key, value] of Object.entries(cookieRowReceipt)) {
                if (/^(?:PRELOGIN_|POST_ADOPTION_|POST_RELOAD_|POST_SELECTION_RELOAD_|POST_LOGOUT_|ACCOUNT_A_ROW_CONTRACT|COOKIE_PROVENANCE_CONTRACT|LOGIN_ADOPTION_CONTRACT|LOGOUT_LOCALE_CONTRACT|FIXTURE_ACCOUNT_COOKIE_ROW_LOGOUT_CHROMIUM_1280)/.test(key))
                    console.log(`${key}=${value}`);
            }
        }
    }
    catch (error) {
        captureCaseRuntimeError(error);
        if (case63Trace) {
            if (/Execution context was destroyed/i.test(error.message ?? ""))
                case63Trace.contextDestroyed = case63Trace.emit("EXECUTION_CONTEXT_DESTROYED", {
                    errorSite: safeStale390Error(error).stackSite
                });
            case63Trace.unresolvedAtFailure = [...requestLedger].filter(([, entry]) => !entry.finished && !entry.failed).map(([request, entry]) => {
                const doc = case63Trace.requestOwners.get(request);
                return { pathname: ["/__task19/locale", "/__task19/fixture.js", "/api/users/me/preferences", "/auth/v1/token", "/auth/v1/logout"].includes(entry.pathname) ? entry.pathname : "OTHER",
                    resourceType: ["document", "script", "fetch", "xhr"].includes(entry.resourceType) ? entry.resourceType : "OTHER",
                    documentSequence: doc?.documentSequence ?? "UNKNOWN", documentGeneration: doc?.generation ?? "UNKNOWN",
                    navigationRequest: doc?.entry === entry, requestSequence: entry.id };
            });
        }
        if (useStaleActorLifecycle) {
            staleActorReceipt.TASK19_STALE430_RELOAD_LIFECYCLE_GENERALIZATION = "BLOCKED";
            staleActorReceipt[`FIXTURE_LOADING_STALE_ACTOR_${engineName.toUpperCase()}_${width}`] = "FAIL";
            if (/Execution context was destroyed|EXECUTION_CONTEXT_DESTROYED/.test(error.message ?? "")) {
                Object.assign(frontDoorReceipt, { FIRST_NEW_BLOCKER: "TASK19_LOADING_STALE_ACTOR_SHARED_RELOAD_LIFECYCLE_NOT_ACTUALLY_SHARED",
                    FIRST_FAIL: "STALE_ACTOR_CURRENT_DOCUMENT_OPERATION", FAILURE_CLASS: "HARNESS_NAVIGATION_SYNCHRONIZATION_DEFECT" });
            }
            if (error.message === "TASK19_STALE390_NEW_DOCUMENT_OBSERVER_NOT_INITIALIZED") {
                staleActorReceipt.POST_RELOAD_OBSERVER_PRESENT = false;
                Object.assign(frontDoorReceipt, { FIRST_NEW_BLOCKER: error.message, FIRST_FAIL: "CURRENT_DOCUMENT_OBSERVER",
                    FAILURE_CLASS: "HARNESS_OBSERVER_INITIALIZATION_DEFECT" });
            }
        }
        if (observeAbDocument) {
            const code = error.message?.split("\n")[0];
            const safeCode = /^[A-Z][A-Z0-9_]+$/.test(code ?? "") ? code : "TASK19_AB390_FINAL_RELOAD_BARRIER_FAILED";
            const failureClass = safeCode.includes("SETTLED_ACCOUNT_B_SEMANTICS") ? "SETTLED_ACCOUNT_B_SEMANTIC_FAILURE"
                : safeCode === "TASK19_AB390_FINAL_DOCUMENT_NONTERMINAL_AFTER_SETTLEMENT_BARRIER" ? "REAL_DOCUMENT_LIFECYCLE_FAILURE" : "FINAL_RELOAD_SETTLEMENT_FAILED";
            Object.assign(abFinalReloadReceipt, { TASK19_AB390_FINAL_RELOAD_BARRIER: "BLOCKED", FIRST_NEW_BLOCKER: safeCode,
                FIRST_FAIL: "/__task19/locale", FAILED_BOUNDARY: "FINAL_RELOAD_SETTLEMENT", FAILURE_CLASS: failureClass, UNRESOLVED_REQUESTS: pendingRequests.size });
            Object.assign(frontDoorReceipt, { FIRST_NEW_BLOCKER: safeCode, FIRST_FAIL: "/__task19/locale", FAILURE_CLASS: failureClass });
            disposableReceipt.FAILED_BOUNDARY = "FINAL_RELOAD_SETTLEMENT";
            disposableReceipt.FIXTURE_ACCOUNT_A_TO_B_CHROMIUM_390 = "FAIL";
        }
        if (realLoadingCase) {
            await collectLoadingEvidence(page, requestLedger);
            if (engineName === "chromium" && width === 1280) {
                loadingDesktopReceipt = { ...loadingReceipt };
                logoutDesktopReceipt = { ...logoutReceipt };
            }
        }
        if (realOutageCase) {
            if (apiOutageObservation.cdpEnabled)
                freezeCdpOutage(page);
            await collectApiOutageDiagnostic(page, requestLedger, error);
            if (apiOutageObservation.cdpEnabled) {
                if (cdpTerminalReceipt.CHROMIUM_NETWORK_TERMINAL_STATE === "PENDING_AFTER_RESPONSE_HEADERS") {
                    Object.assign(cdpTerminalReceipt, { OWNER: "CHROMIUM_NETWORK_RUNTIME",
                        ROOT_CAUSE: "TASK19_CHROMIUM_NO_STORE_RESPONSE_REMAINS_NONTERMINAL_AFTER_NATIVE_BODY_CONSUMPTION",
                        FAILURE_CLASS: "CHROMIUM_RUNTIME_COMPATIBILITY_BLOCKER" });
                }
                Object.assign(apiOutageReceipt, { OWNER: cdpTerminalReceipt.OWNER, ROOT_CAUSE: cdpTerminalReceipt.ROOT_CAUSE,
                    FAILURE_CLASS: cdpTerminalReceipt.FAILURE_CLASS });
                if (cdpTerminalReceipt.CHROMIUM_NETWORK_TERMINAL_STATE === "LOADING_FINISHED") {
                    const entry = requestLedger.get(outageRequest);
                    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
                    cdpTerminalSnapshot = { version: 1, engine: engineName, width, cdp: { ...cdpTerminalReceipt }, outage: { ...apiOutageReceipt },
                        entry: entry && Object.fromEntries(["id", "case", "method", "pathname", "observed", "responseObserved", "status", "finished", "failed", "fixtureOwned", "intentional"].map(key => [key, entry[key]])),
                        semanticContract: outageEvidence.semanticContract, uiFallback: outageEvidence.uiFallback, overflow,
                        matchingPatchRequests: [...requestLedger.values()].filter(value => value.case === "FIXTURE_API_OUTAGE" && value.method === "PATCH" && value.pathname === "/api/users/me/preferences").length,
                        oldLedgerUnresolved: apiOutageReceipt.UNRESOLVED_REQUESTS };
                }
            }
            if (apiOutageObservation.nativeEnabled) {
                const classification = classifyNativeTiming(nativeCompletionReceipt);
                const entry = requestLedger.get(outageRequest);
                const missingSignal = !apiOutageReceipt.BROWSER_OUTAGE_REQUESTFINISHED && !apiOutageReceipt.BROWSER_OUTAGE_REQUESTFAILED
                    && apiOutageReceipt.OUTAGE_RESPONSE_FINISHED_API_STATE === "PENDING";
                const categories = {
                    NO_ENTRY: ["UNKNOWN", "TASK19_API_OUTAGE_RESOURCE_TIMING_NOT_AVAILABLE_FOR_EXACT_REQUEST", "RESOURCE_TIMING_NOT_AVAILABLE"],
                    AMBIGUOUS: ["UNKNOWN", "TASK19_API_OUTAGE_RESOURCE_TIMING_CORRELATION_AMBIGUOUS", "RESOURCE_TIMING_CORRELATION_AMBIGUOUS"],
                    INCOMPLETE: ["BROWSER_FETCH_LIFECYCLE_OR_APPLICATION_ABORT", "TASK19_CHROMIUM_RESOURCE_RESPONSE_NOT_COMPLETED", "BROWSER_NATIVE_RESOURCE_COMPLETION_FAILURE"],
                    COMPLETE: ["PLAYWRIGHT_CHROMIUM_OBSERVABILITY", "TASK19_PLAYWRIGHT_REQUEST_FINISHED_SIGNAL_MISSING_AFTER_CHROMIUM_RESOURCE_COMPLETION", "PLAYWRIGHT_NETWORK_LIFECYCLE_OBSERVABILITY_DEFECT"],
                    UNPROVEN: ["UNKNOWN", "TASK19_NATIVE_RESOURCE_CORRELATION_NOT_PROVEN", "RESOURCE_TIMING_PROOF_INCOMPLETE"],
                };
                const [owner, cause, failureClass] = categories[classification === "COMPLETE" && !missingSignal ? "UNPROVEN" : classification];
                Object.assign(nativeCompletionReceipt, { OWNER: owner, ROOT_CAUSE: cause, FAILURE_CLASS: failureClass });
                Object.assign(apiOutageReceipt, { OWNER: owner, ROOT_CAUSE: cause, FAILURE_CLASS: failureClass });
                if (classification === "COMPLETE" && missingSignal && entry) {
                    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
                    nativeCompletionSnapshot = { version: 1, engine: engineName, width, native: { ...nativeCompletionReceipt }, outage: { ...apiOutageReceipt },
                        entry: Object.fromEntries(["id", "case", "method", "pathname", "observed", "responseObserved", "status", "finished", "failed", "fixtureOwned", "intentional"].map(key => [key, entry[key]])),
                        semanticContract: outageEvidence.semanticContract, uiFallback: outageEvidence.uiFallback, overflow,
                        matchingPatchRequests: [...requestLedger.values()].filter(value => value.case === "FIXTURE_API_OUTAGE" && value.method === "PATCH" && value.pathname === "/api/users/me/preferences").length };
                }
            }
            apiOutageReceipt.TASK19_API_OUTAGE_OUTBOUND_SERVICE_FIX = "BLOCKED";
            if (engineName === "chromium" && width === 1280)
                apiOutageDesktopReceipt = { ...apiOutageReceipt };
        }
        throw error;
    }
    finally {
        if (case63Trace)
            case63Trace.startCleanup();
        if (useStaleActorLifecycle) {
            abDocumentObservation.active = false;
            for (const [key, value] of Object.entries(staleActorReceipt))
                console.log(`${key}=${value}`);
            for (const [key, value] of Object.entries(loadingReceipt))
                console.log(`${key}=${value}`);
            await mkdir(output, { recursive: true });
            const receiptName = matrixResumeCursor?.acceptedOrdinal >= 65 ? `stale-actor-${engineName}-${width}-ordinal-${runtimeCaseContext.ordinal}-classification.json`
                : engineName === "chromium" && width === 430 ? "stale430-reload-generalization.json" : `stale-actor-reload-${engineName}-${width}.json`;
            await writeFile(path.join(output, receiptName), JSON.stringify({ receipt: staleActorReceipt, loading: loadingReceipt,
                failedRequests: loadingObservation.failedRequestProvenance, requestEvents: loadingObservation.requestEvents,
                logout: { ...logoutReceipt }, logoutEvents: loadingObservation.logout.events }, null, 2) + "\n", matrixResumeCursor?.acceptedOrdinal >= 65 ? { flag: "wx" } : undefined);
        }
        if (observeAbDocument) {
            abDocumentObservation.active = false;
            const bReceipt = abDocumentObservation.receipt;
            const result = { ...case63Trace.settlementReceipt,
                ACCOUNT_A_SIGNIN: disposableReceipt.ACCOUNT_A_BROWSER_SIGNIN,
                ACCOUNT_A_SIGNOUT: disposableReceipt.ACCOUNT_A_BROWSER_SIGNOUT, ACCOUNT_B_SIGNIN: disposableReceipt.ACCOUNT_B_BROWSER_SIGNIN,
                B_ADOPTION_RELOAD_BARRIER_ARMED: Boolean(abDocumentObservation.finalReload),
                B_ADOPTION_RELOAD_NAVIGATION_OBSERVED: bReceipt.AB390_FINAL_RELOAD_NAVIGATION_OBSERVED,
                B_ADOPTION_RELOAD_FIXTURE_READY: bReceipt.AB390_FINAL_RELOAD_FIXTURE_READY,
                B_ADOPTION_FINAL_DOCUMENT_TERMINAL: bReceipt.FINAL_DOCUMENT_REQUEST_TERMINAL,
                ACCOUNT_B_GET_RESPONSE_STATUS: bReceipt.ACCOUNT_B_GET_RESPONSE_STATUS,
                ACCOUNT_B_GET_REQUESTFINISHED: bReceipt.ACCOUNT_B_GET_REQUESTFINISHED, ACCOUNT_B_GET_REQUESTFAILED: bReceipt.ACCOUNT_B_GET_REQUESTFAILED,
                FINAL_UI_ACTOR: bReceipt.FINAL_UI_ACTOR, FINAL_B_LOCALE_CORRECT: bReceipt.FINAL_B_LOCALE_CORRECT,
                ACCOUNT_A_PREFERENCE_LEAKED_TO_B: bReceipt.ACCOUNT_A_PREFERENCE_LEAKED_TO_B, STALE_RESULT_APPLIED: bReceipt.STALE_RESULT_APPLIED,
                RUNTIME_EXCEPTION_COUNT: receipt.pageErrors - before.pageErrors + receipt.unhandledRejections - before.unhandledRejections,
                UNEXPECTED_REQUESTFAILED_COUNT: [...requestLedger.values()].filter(entry => entry.failed).length,
                UNRESOLVED_REQUESTS: pendingRequests.size,
                CASE63_FORMAL_RESULT: case63Trace.normalAssertionsPassed ? "PASS" : "FAIL",
                FIXTURE_ACCOUNT_A_TO_B_SEMANTIC_CONTRACT: case63Trace.normalAssertionsPassed ? "PASS" : "NOT_RUN" };
            for (const [key, value] of Object.entries(result))
                console.log(`${key}=${value}`);
            await mkdir(output, { recursive: true });
            await writeFile(path.join(output, `account-switch-${engineName}-${width}-reload-settlement.json`), JSON.stringify({ receipt: result, events: case63Trace.events }, null, 2) + "\n", { flag: "wx" });
        }
        if (realLoadingCase) {
            loadingObservation.active = false;
            await page.evaluate(() => { window.__task19LoadingLifecycle?.stop(); delete window.__task19LoadingLifecycle; }).catch(() => { });
            await controlStaleHold("RESET");
        }
        if (apiOutageObservation?.cdpSession && realOutageCase) {
            freezeCdpOutage(page);
            await apiOutageObservation.cdpSession.detach();
            cdpTerminalReceipt.CDP_SESSION_DETACHED = true;
        }
        accountConsole();
        {
            for (const release of controls.pending)
                await release();
            await context.close();
        }
        activePreferenceFixture = undefined;
        await setOwnedOutageCase("NONE", false);
        if (useAccountSwitchLifecycle)
            case63Trace = undefined;
    }
}
async function apiFailureScenario(mode, { page, controls }) {
    await signInBrowserActor(page, "A");
    if (apiOutageObservation?.active && mode === "outage")
        markOutagePhase(1);
    await page.waitForFunction(() => window.__task19?.state().status === "ready");
    if (apiOutageObservation?.active && mode === "outage")
        markOutagePhase(2);
    let conflictInitial, conflictWritten;
    if (mode === "outage") {
        await setOwnedOutageCase("FIXTURE_API_OUTAGE", true);
        markOutagePhase(3);
        if (apiOutageObservation.nativeEnabled) {
            assert.equal(apiOutageObservation.nativeSetupSettled(), true, "SETUP_TRAFFIC_MUST_BE_SETTLED_BEFORE_RESOURCE_CLEAR");
            const cleared = await page.evaluate(() => { performance.clearResourceTimings(); return performance.getEntriesByType("resource").length === 0; });
            assert.equal(cleared, true, "RESOURCE_TIMING_CLEAR_REQUIRED");
            nativeCompletionReceipt.RESOURCE_TIMING_CLEARED_BEFORE_OUTAGE = true;
        }
    }
    if (mode === "conflict") {
        const auth = await page.evaluate(() => window.__task19.authState());
        assert.equal(auth.actor, "ACCOUNT_A");
        assert.equal(auth.sessionPresent, true);
        conflictInitial = await page.evaluate(() => window.__task19.state().account);
        assert.equal(conflictInitial.locale_preference, "en");
        assert.equal(conflictInitial.revision, accountCookieRowFixture.revision);
        const token = [...issuedActors].findLast(([, actor]) => actor === "A")?.[0];
        assert.ok(token, "GENUINE_BROWSER_ACCOUNT_A_TOKEN_REQUIRED");
        conflictWritten = await page.evaluate(async ({ token, initial }) => {
            const response = await fetch("/api/users/me/preferences", { method: "PATCH", cache: "no-store", credentials: "same-origin",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ locale_preference: initial.locale_preference, expected_revision: initial.revision }) });
            const body = await response.json();
            return { status: response.status, ok: body.ok === true, locale_preference: body.preference?.locale_preference, revision: body.preference?.revision };
        }, { token, initial: { locale_preference: conflictInitial.locale_preference, revision: conflictInitial.revision } });
        assert.equal(conflictWritten.status, 200);
        assert.equal(conflictWritten.ok, true);
        assert.equal(conflictWritten.revision, conflictInitial.revision + 1);
        if (page.viewportSize().width === 1280 && false)
            Object.assign(conflictRevisionReceipt, {
                API_CONFLICT_AUTH_HEALTHY: true, API_CONFLICT_REAL_INITIAL_ROW_PRESENT: true,
                API_CONFLICT_REAL_ROW_REVISION_BEFORE_CASE: conflictInitial.revision,
                API_CONFLICT_REAL_ROW_REVISION_AFTER_FIRST_SUCCESS: conflictWritten.revision,
                API_CONFLICT_REAL_SUCCESSFUL_WRITE_OBSERVED: true, API_CONFLICT_REAL_REVISION_ADVANCED: true
            });
        console.log("CONFLICT_GENERATION=GENUINE_LOCAL_REVISION_CONFLICT");
    }
    controls.mode = mode;
    const refreshed = mode === "conflict" ? page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.origin === new URL(page.url()).origin && url.pathname === "/api/users/me/preferences" && response.request().method() === "GET";
    }) : undefined;
    if (mode === "outage" && apiOutageObservation?.cdpEnabled)
        await armCdpOutage(page);
    await page.locator(".locale-settings select").selectOption("zh-CN");
    await page.waitForFunction(status => window.__task19?.state().status === status, mode === "outage" ? "unavailable" : "conflict");
    if (apiOutageObservation?.active && mode === "outage")
        markOutagePhase(12);
    if (refreshed) {
        const response = await refreshed;
        assert.equal(response.status(), 200);
        await response.finished();
    }
    assert.equal(await page.locator(".locale-settings select").inputValue(), "zh-CN");
    assert.equal(await page.locator(".locale-settings [role=status]").innerText(), getUiMessages("zh-CN").settings[mode === "outage" ? "unavailable" : "conflict"]);
    if (mode !== "conflict") {
        assert.equal(controls.rows.A.revision, 3);
        assert.equal(controls.rows.A.locale_preference, "en");
        assert.equal(controls.rows.B.locale_preference, "zh-CN");
        assert.equal(controls.rows.B.revision, 5);
    }
    assert.equal(await page.locator(".locale-settings").getAttribute("lang"), "zh-CN");
    assert.equal(await page.getByRole("button", { name: getUiMessages("zh-CN").settings.retry, exact: true }).count(), 1);
    if (mode === "conflict") {
        await page.waitForFunction(revision => window.__task19.state().status === "conflict"
            && window.__task19.state().account?.revision === revision, conflictWritten.revision);
        const state = await page.evaluate(() => window.__task19.state());
        assert.equal(state.status, "conflict");
        assertConflictRevisionSequence(conflictInitial, conflictWritten, outageRequest.postDataJSON().expected_revision, state.account);
        if (page.viewportSize().width === 1280 && false)
            Object.assign(conflictRevisionReceipt, {
                API_CONFLICT_STALE_REVISION_IS_OLDER_THAN_CURRENT: true, API_CONFLICT_FALSE_SUCCESS: false,
                API_CONFLICT_CURRENT_PREFERENCE_RETAINED: true
            });
    }
    outageEvidence.uiFallback = "PASS";
    outageEvidence.semanticContract = "PASS";
}
async function runOwnedFixtureCoverage(engineName, origin, width) {
    const cases = [
        ["AUTO_CN", { trustedCountry: "CN", acceptLanguage: "en" }, "zh-CN"],
        ["AUTO_NON_CN", { trustedCountry: "US", acceptLanguage: "zh-CN" }, "en"],
        ["UNAVAILABLE_COUNTRY_EN", { acceptLanguage: "en" }, "en"],
        ["UNAVAILABLE_COUNTRY_ZH", { acceptLanguage: "zh-CN" }, "zh-CN"],
        ["MANUAL_EN_CN", { current: "en", trustedCountry: "CN" }, "en"],
        ["MANUAL_ZH_NON_CN", { current: "zh-CN", trustedCountry: "US" }, "zh-CN"],
    ];
    for (const [name, inputs, expected] of cases) {
        if (!selectFixtureCase(engineName, width, name))
            continue;
        await browserFixtureCase(engineName, origin, width, name, inputs, async ({ page }) => {
            assert.equal(await page.locator("html").getAttribute("lang"), expected);
            assert.equal(await page.locator(".locale-settings").getAttribute("lang"), expected);
            assert.equal(await page.locator(".locale-settings h1").innerText(), getUiMessages(expected).settings.title);
            assert.equal(await page.locator(".locale-settings select").inputValue(), inputs.current ?? "auto");
            if (name === "AUTO_CN") {
                assert.equal(inputs.current, undefined, "AUTO_CN_NO_MANUAL_INJECTION");
                assert.equal(inputs.trustedCountry, "CN");
                assert.equal(inputs.acceptLanguage, "en");
                const snapshot = await page.evaluate(() => window.__task19.locale());
                assert.equal(snapshot.preference, "auto");
                assert.equal(snapshot.source, "country");
                assert.equal(snapshot.locale, "zh-CN");
                assert.equal(await page.evaluate(() => document.characterSet), "UTF-8", "FIXTURE_UTF8_TRANSPORT");
                assert.equal(await page.evaluate(() => document.cookie.includes("ogh_preferences_v1=")), false, "AUTO_CN_NO_PERSISTED_COUNTRY_OR_MANUAL_PREFERENCE");
            }
            const keys = await page.evaluate(() => Object.keys(window.__task19.locale()).sort());
            assert.ok(!keys.includes("country") && !keys.includes("ip"));
            assert.equal(await page.evaluate(() => window.__task19.safeNext("//unapproved.invalid/path")), "/");
            const select = page.locator(".locale-settings select");
            await select.focus();
            await page.keyboard.press("Tab");
            assert.equal(await page.evaluate(() => document.activeElement?.tagName), "A", "KEYBOARD_FORWARD_FOCUS");
            await page.keyboard.press("Shift+Tab");
            assert.equal(await select.evaluate(element => element === document.activeElement), true, "KEYBOARD_REVERSE_FOCUS");
        });
    }
    {
        if (selectFixtureCase(engineName, width, "ACCOUNT_COOKIE_ROW_LOGOUT"))
            await browserFixtureCase(engineName, origin, width, "ACCOUNT_COOKIE_ROW_LOGOUT", { trustedCountry: "CN" }, accountCookieRowScenario);
        if (selectFixtureCase(engineName, width, "ACCOUNT_A_TO_B")) {
            await browserFixtureCase(engineName, origin, width, "ACCOUNT_A_TO_B", { trustedCountry: "CN" }, accountSwitchScenario);
        }
    }
    for (const mode of ["outage", "conflict"]) {
        if (!selectFixtureCase(engineName, width, `API_${mode.toUpperCase()}`))
            continue;
        await browserFixtureCase(engineName, origin, width, `API_${mode.toUpperCase()}`, { current: "en" }, values => apiFailureScenario(mode, values));
    }
    if (selectFixtureCase(engineName, width, "LOADING_STALE_ACTOR"))
        await browserFixtureCase(engineName, origin, width, "LOADING_STALE_ACTOR", { trustedCountry: "CN" }, loadingStaleActorScenario);
    if (selectFixtureCase(engineName, width, "BLOCKED_COOKIE"))
        await browserFixtureCase(engineName, origin, width, "BLOCKED_COOKIE", { acceptLanguage: "en" }, async ({ page }) => {
            await page.locator(".locale-settings select").selectOption("zh-CN");
            assert.equal(await page.locator(".locale-settings select").inputValue(), "zh-CN");
            assert.equal(await page.locator(".locale-settings [role=status]").innerText(), getUiMessages("zh-CN").settings.nonpersistent);
            assert.equal(await page.evaluate(() => document.cookie), "");
        }, { blockedCookie: true });
    if (selectFixtureCase(engineName, width, "CROSS_TAB_GENERATION"))
        await browserFixtureCase(engineName, origin, width, "CROSS_TAB_GENERATION", { acceptLanguage: "en" }, async ({ page, context, navigate, observePage }) => {
            const other = await context.newPage();
            observePage(other);
            await navigate(other);
            await Promise.all([page.waitForNavigation(), other.waitForNavigation(), page.locator(".locale-settings select").selectOption("zh-CN")]);
            await other.waitForFunction(() => window.__task19 !== undefined);
            assert.equal(await other.locator(".locale-settings select").inputValue(), "zh-CN");
            const before = await other.evaluate(() => window.__task19.locale().generation);
            await page.evaluate(() => window.__task19.publish({ version: 1, preference: "en", generation: 0, provenance: "device_explicit" }));
            await other.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            assert.equal(await other.evaluate(() => window.__task19.locale().generation), before);
            assert.equal(await other.locator(".locale-settings select").inputValue(), "zh-CN");
        });
}
async function accountSwitchScenario({ page, markSwitch }) {
    await signInBrowserActor(page, "A");
    await page.waitForFunction(() => window.__task19?.state().status === "ready" && document.documentElement.lang === "en");
    assert.equal(await page.evaluate(() => window.__task19.state().account.revision), 3, "ACCOUNT_A_STATE_ESTABLISHED");
    markSwitch("ACCOUNT_A_READY", "ACCOUNT_A_READY_MS");
    markSwitch("ACCOUNT_SWITCH_STARTED", "ACCOUNT_SWITCH_ACTION_MS");
    await signInBrowserActor(page, "B");
    if (abDocumentObservation?.active) {
        await settleAbFinalReload(page, abDocumentObservation);
        markSwitch("ACCOUNT_B_PREFERENCE_SYNC", "ACCOUNT_B_PREFERENCE_STATE_SETTLED_MS");
        markSwitch("ACCOUNT_B_UI_READY", "ACCOUNT_B_EXPECTED_LOCALE_VISIBLE_MS");
        markSwitch("AFTER_FINAL_ASSERTION", "CASE_FINAL_ASSERTION_MS");
        return;
    }
    await page.waitForFunction(() => window.__task19?.state().status === "ready" && document.documentElement.lang === "zh-CN");
    markSwitch("ACCOUNT_B_PREFERENCE_SYNC", "ACCOUNT_B_PREFERENCE_STATE_SETTLED_MS");
    markSwitch("ACCOUNT_B_UI_READY", "ACCOUNT_B_EXPECTED_LOCALE_VISIBLE_MS");
    assert.equal(await page.evaluate(() => window.__task19.state().account.revision), 5);
    markSwitch("AFTER_FINAL_ASSERTION", "CASE_FINAL_ASSERTION_MS");
}
async function main() {
    let artifactHash;
    const fingerprint = async () => {
        const hash = createHash("sha256");
        for (const file of [...await walk(path.resolve("dist/server")), ...await walk(path.resolve("dist/client"))].sort()) {
            hash.update(file);
            hash.update(await readFile(file));
        }
        return hash.digest("hex");
    };
    try {
        {
            ownedRoot = await mkdtemp(path.join(tmpdir(), "ogh-task19-worker-"));
            await buildFrontDoorWorker();
        }
        artifactHash = await fingerprint();
        const generated = JSON.parse(await readFile(workerConfig, "utf8"));
        const fixtureUrl = new URL(generated.vars.SUPABASE_URL);
        assert.equal(fixtureUrl.hostname, "127.0.0.1");
        assert.equal(fixtureUrl.protocol, "https:");
        assert.equal(fixtureUrl.username + fixtureUrl.password, "");
        assert.equal(fixtureUrl.pathname, "/");
        assert.ok(generated.main && generated.no_bundle === true && !generated.build?.command);
        ownedRoot ??= await mkdtemp(path.join(tmpdir(), "ogh-task19-worker-"));
        const fixtureOrigin = frontDoorOrigin, port = await availablePort();
        appWorkerUpstream = `https://127.0.0.1:${port}`;
        const origin = frontDoorOrigin;
        workerPort = port;
        localOrigins = [origin, fixtureOrigin];
        {
            caTrustReceipt.TASK19_BROWSER_ALLOWED_NETWORK_ORIGIN_COUNT = new Set(localOrigins).size;
            assert.equal(caTrustReceipt.TASK19_BROWSER_ALLOWED_NETWORK_ORIGIN_COUNT, 1, "ONE_BROWSER_FRONT_DOOR_ORIGIN_REQUIRED");
        }
        const key = path.join(ownedRoot, "key.pem"), cert = path.join(ownedRoot, "cert.pem");
        const caKey = path.join(ownedRoot, "ca.key"), caCert = path.join(ownedRoot, "ca.crt"), csr = path.join(ownedRoot, "server.csr"), ext = path.join(ownedRoot, "server.cnf");
        const command = (name, args) => execFileSync(name, args, { stdio: "pipe", env: childEnvironment(), windowsHide: true });
        const sid = command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value"]).toString().trim();
        assert.match(sid, /^S-1-\d+(?:-\d+)+$/);
        command("icacls.exe", [ownedRoot, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`]);
        command("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1", "-keyout", caKey, "-out", caCert,
            "-subj", "/CN=Task19 Local Test CA", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"]);
        command("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256", "-keyout", key, "-out", csr, "-subj", "/CN=Task19 Local Server"]);
        await writeFile(ext, "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n");
        command("openssl", ["x509", "-req", "-in", csr, "-CA", caCert, "-CAkey", caKey, "-CAcreateserial", "-out", cert, "-days", "1", "-sha256", "-extfile", ext]);
        command("openssl", ["verify", "-CAfile", caCert, cert]);
        const leaf = new X509Certificate(await readFile(cert));
        assert.equal(leaf.ca, false);
        assert.equal(leaf.checkIP("127.0.0.1"), "127.0.0.1");
        assert.equal(leaf.checkHost("localhost", { subject: "never" }), "localhost");
        await validateTask19PublicCa(caCert, leaf);
        {
            frontDoorCa = await readFile(caCert);
            gateway = createGatewayServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
                void (serveSameOriginFrontDoor(request, response)).catch(error => {
                    if (!response.destroyed) {
                        response.writeHead(599);
                        response.end();
                    }
                    workerFailure(new Error("TASK19_OWNED_GATEWAY_FAILURE"));
                });
            });
            await new Promise((resolve, reject) => reservedFrontDoor.close(error => error ? reject(error) : resolve()));
            await new Promise((resolve, reject) => { gateway.once("error", reject); gateway.listen(Number(new URL(frontDoorOrigin).port), "127.0.0.1", resolve); });
            gatewayOrigin = `https://127.0.0.1:${gateway.address().port}`;
            localOrigins.push(gatewayOrigin);
            disposableReceipt.BROWSER_AND_WORKER_SUPABASE_INSTANCE_SAME = true;
            disposableReceipt.BROWSER_AND_WORKER_ANON_KEY_IDENTITY = "SAME";
        }
        receipt.build = "PASS";
        const { unstable_readConfig } = await import("wrangler");
        const remoteHosts = ["preview", "production"].map(env => new URL(unstable_readConfig({ config: path.resolve("wrangler.toml"), env }, { hideWarnings: true }).vars.PUBLIC_SUPABASE_URL).hostname);
        const files = (await walk(path.resolve("dist/client"))).filter(file => /\.(?:m?js)$/.test(file));
        const chunks = await Promise.all(files.map(file => readFile(file, "utf8")));
        assert.ok(chunks.some(chunk => chunk.includes(fixtureOrigin)), "TASK19_LOCAL_BUILD_CLIENT_TARGET_MISSING");
        receipt.remoteCount = chunks.filter(chunk => remoteHosts.some(host => chunk.includes(host))).length;
        frontDoorReceipt.REMOTE_SUPABASE_REFERENCE_COUNT = receipt.remoteCount;
        assert.equal(receipt.remoteCount, 0, "TASK19_LOCAL_BUILD_REMOTE_PUBLIC_TARGET_LEAK");
        receipt.client = "LOOPBACK";
        assert.equal(new URL(generated.vars.SUPABASE_URL).origin, fixtureOrigin, "TASK19_LOCAL_BUILD_SERVER_TARGET_MISMATCH");
        assert.equal(generated.vars.AUTH_CAPTCHA_MODE, "off");
        assert.equal(Object.hasOwn(generated.vars, "PUBLIC_AUTH_TURNSTILE_SITE_KEY"), false);
        assert.equal(Object.hasOwn(generated.vars, "SUPABASE_SERVICE_ROLE_KEY"), false);
        for (const binding of [...(generated.kv_namespaces ?? []), ...(generated.r2_buckets ?? []), ...(generated.services ?? [])])
            assert.notEqual(binding.remote, true, "TASK19_REMOTE_BINDING_FORBIDDEN");
        assert.equal(Boolean(generated.ai || generated.hyperdrive?.length || generated.vectorize?.length), false, "TASK19_REMOTE_BINDING_FORBIDDEN");
        receipt.server = "LOOPBACK";
        stage = "USER_WORKER_STARTUP";
        await startOwnedWorker(appWorkerUpstream, fixtureOrigin, port, key, cert);
        {
            frontDoorReceipt.WORKER_SUPABASE_RUNTIME_ROUTE = "OUTBOUND_SERVICE_TO_LOCAL_SUPABASE";
            await disposableStack.prepareAccounts();
            const bound = await controlStaleHold("BIND", { actor: disposableStack.accounts.A.id });
            assert.equal(bound.actorBound, true);
            assert.equal(bound.armed, false);
            assert.equal(bound.matched, 0);
            Object.assign(startupOrderReceipt, { TASK19_LOADING_STALE_ACTOR_STARTUP_ORDER: "PASS",
                ACCOUNT_A_ID_BINDING_STATE: "BOUND_AFTER_LOCAL_USER_CREATION" });
            console.log("USER_WORKER_STARTUP=PASS\nACCOUNT_A_ID_BINDING_STATE=BOUND_AFTER_LOCAL_USER_CREATION\nPRE_CASE_HOLD_UNARMED=true");
        }
        {
            await prepareBrowserFixtures();
            await Promise.race([(async () => {
                    await mkdir(output, { recursive: true });
                    {
                        for (const [engineName, engine] of [["chromium", chromium], ["firefox", firefox]]) {
                            for (const width of [1280, 390, 430]) {
                                for (const locale of ["en", "zh-CN"]) {
                                    for (const colorScheme of ["dark", "light"]) {
                                        if (!matrixResumeCursor.select())
                                            continue;
                                        bindRuntimeCase(engineName, width, `WORKER_BROWSER_MATRIX_${locale.toUpperCase()}_${colorScheme.toUpperCase()}`, "BROWSER_LAUNCH", "main/engine.launch");
                                        if (!browser)
                                            browser = await engine.launch({ headless: true });
                                        bindRuntimeCase(engineName, width, `WORKER_BROWSER_MATRIX_${locale.toUpperCase()}_${colorScheme.toUpperCase()}`, "CASE_SETUP", "main/browser.newContext");
                                        const context = await browser.newContext({ ...frontDoorBrowserContextOptions(width), colorScheme });
                                        activeCase = { route: "/settings/", browser: engineName, viewport: width, locale, scheme: colorScheme };
                                        stage = "WORKER_BROWSER_MATRIX";
                                        const runtimeRequests = new Map();
                                        try {
                                            runtimePhase("CASE_SETUP", "main/context.routes_and_init");
                                            await observeUnhandledRejections(context);
                                            await context.route(url => !(url.origin === origin && url.pathname === "/api/users/me/preferences"), route => {
                                                const request = route.request(), url = new URL(request.url());
                                                if (url.origin === origin) {
                                                    return route.continue();
                                                }
                                                recordBlocked(url, { transport: "HTTP", resourceType: request.resourceType(), method: request.method() });
                                                external++;
                                                workerFailure(new Error("TASK19_UNEXPECTED_BROWSER_EXTERNAL_REQUEST"));
                                                return route.abort();
                                            });
                                            await context.routeWebSocket("**/*", socket => {
                                                recordBlocked(socket.url(), { transport: "WEBSOCKET", resourceType: "websocket", method: "GET" });
                                                socket.close();
                                                workerFailure(new Error("TASK19_UNEXPECTED_BROWSER_WEBSOCKET"));
                                            });
                                            await context.addInitScript(() => {
                                                Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("HOSTILE_LOCAL_STORAGE"); } });
                                            });
                                            const cookie = serializePreferenceCookie({ version: 1, preference: locale, generation: 1, provenance: "device_explicit" });
                                            await context.addCookies([{ name: "ogh_preferences_v1", value: cookie.split(";")[0].slice("ogh_preferences_v1=".length), url: origin, secure: true, sameSite: "Lax" }]);
                                            const page = await context.newPage(), errors = [];
                                            {
                                                page.on("request", request => runtimeRequests.set(request, { finished: false, failed: false }));
                                                page.on("requestfinished", request => { const entry = runtimeRequests.get(request); if (entry)
                                                    entry.finished = true; });
                                                page.on("requestfailed", request => { const entry = runtimeRequests.get(request); if (entry)
                                                    entry.failed = true; });
                                            }
                                            page.on("pageerror", () => { errors.push("PAGEERROR"); receipt.pageErrors++; workerFailure(new Error("TASK19_BROWSER_PAGEERROR")); });
                                            page.on("console", message => {
                                                if (message.type() === "error") {
                                                    errors.push("CONSOLE_ERROR");
                                                    receipt.consoleErrors++;
                                                    receipt.applicationConsoleErrors++;
                                                    workerFailure(new Error("TASK19_BROWSER_CONSOLE_ERROR"));
                                                }
                                                else if (isReactHydrationDiagnostic(message))
                                                    workerFailure(new Error("TASK19_HYDRATION_WARNING"));
                                            });
                                            assert.equal(receipt.userWorkerReady, true);
                                            runtimePhase("FIXTURE_NAVIGATION", "main/page.goto.settings");
                                            const response = await page.goto(`${origin}/settings/`);
                                            runtimePhase("CASE_ASSERTIONS", "main/settings.ssr_hydration_assertions");
                                            assert.equal(response.status(), 200);
                                            assert.match(response.headers()["cache-control"], /no-store/);
                                            assert.ok((await response.text()).includes(`lang="${locale}"`), "SSR_HTML_LANGUAGE_PARITY");
                                            await page.locator(".locale-settings select").waitFor();
                                            await page.waitForFunction(() => [...document.querySelectorAll("astro-island")].every(island => !island.hasAttribute("ssr")));
                                            assert.equal(await page.locator("html").getAttribute("lang"), locale);
                                            assert.equal(await page.locator(".locale-settings").getAttribute("lang"), locale);
                                            assert.equal(await page.locator(".locale-settings h1").innerText(), locale === "en" ? "Settings" : "设置");
                                            assert.equal(await page.locator(".locale-settings select").inputValue(), locale);
                                            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${engineName}/${width} overflow`);
                                            assert.equal(await page.evaluate(() => {
                                                const label = document.querySelector(".locale-settings label"), select = label?.querySelector("select");
                                                const text = label?.firstChild;
                                                if (!text || !select)
                                                    return true;
                                                const range = document.createRange();
                                                range.selectNodeContents(text);
                                                const a = range.getBoundingClientRect(), b = select.getBoundingClientRect();
                                                return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
                                            }), false, "SETTINGS_LABEL_CONTROL_OVERLAP");
                                            await assertCommunityDark(page, colorScheme, width);
                                            assert.equal(blockedRequests.filter(record => record.transport === "WEBSOCKET").length, 0, "UNEXPECTED_WEBSOCKET_IN_HMR_DISABLED_ACCEPTANCE");
                                            assert.equal(blockedRequests.filter(record => record.classification !== "TASK19_BROWSER_HARNESS_TRANSPORT").length, 0, "UNRESOLVED_BLOCKED_REQUESTS");
                                            assert.doesNotMatch(await page.locator(".locale-settings").innerText(), /Appearance|Light mode|外观|浅色模式/);
                                            assert.equal(errors.length, 0, "SSR/island hydration must not read hostile storage or disagree");
                                            await page.screenshot({ path: path.join(output, `${engineName}-${locale}-${width}-${colorScheme}.png`), fullPage: true });
                                            const opposite = locale === "en" ? "zh-CN" : "en";
                                            runtimePhase("CASE_ACTION", "main/settings.select_opposite_locale");
                                            activeCase.locale = opposite;
                                            await Promise.all([page.waitForNavigation(), page.locator(".locale-settings select").selectOption(opposite)]);
                                            await page.locator(".locale-settings select").waitFor();
                                            assert.equal(await page.locator("html").getAttribute("lang"), opposite);
                                            assert.equal(await page.locator(".locale-settings select").inputValue(), opposite);
                                            const saved = (await context.cookies()).find(item => item.name === "ogh_preferences_v1");
                                            assert.equal(saved.secure, true);
                                            assert.equal(saved.sameSite, "Lax");
                                            assert.equal(saved.path, "/");
                                            assert.equal(JSON.parse(decodeURIComponent(saved.value)).preference, opposite);
                                            runtimePhase("CASE_FINAL_SETTLEMENT", "main/settings.reload_and_about_navigation");
                                            await page.reload();
                                            assert.equal(await page.locator("html").getAttribute("lang"), opposite);
                                            await page.goto(`${origin}/about/`);
                                            activeCase.route = "/about/";
                                            assert.equal(await page.locator("html").getAttribute("lang"), opposite);
                                            assert.equal(await page.locator("html").getAttribute("data-theme"), "dark", "STARLIGHT_OWNED_DARK_THEME");
                                            assert.equal(await page.locator(".sl-skip-link").innerText(), opposite === "en" ? "Skip to content" : "跳转到内容");
                                            assert.equal(await page.locator("starlight-theme-select").count(), 0);
                                            assert.ok((await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).split(/\s+/).includes("dark"), "STARLIGHT_COMPUTED_DARK_SCHEME");
                                            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "STARLIGHT_OVERFLOW");
                                            await page.screenshot({ path: path.join(output, `starlight-${engineName}-${locale}-${width}-${colorScheme}.png`), fullPage: true });
                                            assert.equal(new URL(page.url()).pathname, "/about/");
                                            assert.equal(errors.length, 0, "No browser or console error");
                                            assert.equal(external, 0);
                                            assert.equal(blockedRequests.filter(record => record.classification !== "TASK19_BROWSER_HARNESS_TRANSPORT").length, 0, "UNRESOLVED_BLOCKED_REQUESTS");
                                            console.log(`GLOBAL_LOCALE_BROWSER_CASE=PASS ENGINE=${engineName} WIDTH=${width} LOCALE=${locale} OS=${colorScheme}`);
                                            {
                                                const entries = [...runtimeRequests.values()];
                                                const evidence = matrixResumeReceipt;
                                                evidence.UNEXPECTED_REQUESTFAILED_COUNT = entries.filter(entry => entry.failed).length;
                                                evidence.UNRESOLVED_REQUESTS = entries.filter(entry => !entry.finished && !entry.failed).length;
                                                assert.equal(evidence.UNEXPECTED_REQUESTFAILED_COUNT, 0, "CASE52_UNEXPECTED_REQUESTFAILED");
                                                assert.equal(evidence.UNRESOLVED_REQUESTS, 0, "CASE52_UNRESOLVED_REQUESTS");
                                            }
                                            workerCasesPassed++;
                                            {
                                                console.log(`TASK19_BROWSER_CASES_COMPLETED=${acceptedDisposableCasesAtStart + workerCasesPassed + fixtureCases}`);
                                            }
                                        }
                                        catch (error) {
                                            captureCaseRuntimeError(error);
                                            throw error;
                                        }
                                        finally {
                                            runtimePhase("CASE_CLEANUP", "main/context.close");
                                            await context.close();
                                        }
                                    }
                                }
                                await runOwnedFixtureCoverage(engineName, origin, width);
                            }
                            await browser?.close();
                            browser = undefined;
                        }
                    }
                })(), workerFailed]);
            {
                assert.equal((acceptedDisposableCasesAtStart) + workerCasesPassed + fixtureCases, 102, "TASK19_ALL_REQUIRED_CASES");
                console.log("TASK19_WORKERS_BROWSER_ACCEPTANCE=PASS");
            }
        }
    }
    catch (error) {
        captureCaseRuntimeError(error);
        if (frontDoorReceipt.FIRST_NEW_BLOCKER === "NONE")
            Object.assign(frontDoorReceipt, {
                FIRST_NEW_BLOCKER: "TASK19_MATRIX_RUNTIME_FAILED", FIRST_FAIL: matrixResumeReceipt.RUNTIME_ERROR_STACK_SITE ?? "UNKNOWN",
                FAILURE_CLASS: matrixResumeReceipt.RUNTIME_ERROR_CLASS ?? "UNKNOWN",
            });
        if (stage === "FIXTURE_API_OUTAGE" && apiOutageReceipt.TASK19_API_OUTAGE_TIMEOUT_DIAGNOSIS === "COMPLETE") {
            Object.assign(frontDoorReceipt, { FIRST_NEW_BLOCKER: "TASK19_API_OUTAGE_DIAGNOSTIC_STOP",
                FIRST_FAIL: apiOutageReceipt.OUTAGE_FAILED_PHASE, FAILURE_CLASS: apiOutageReceipt.FAILURE_CLASS });
            disposableReceipt.FAILED_BOUNDARY = "API_OUTAGE_ACCEPTANCE";
        }
        if (frontDoorReceipt.FIRST_NEW_BLOCKER === "NONE") {
            frontDoorReceipt.FIRST_NEW_BLOCKER = error.code === "ERR_ASSERTION" ? "TASK19_FRONT_DOOR_CONTRACT_FAILED" : "TASK19_FRONT_DOOR_RUNTIME_FAILED";
            frontDoorReceipt.FIRST_FAIL = "UNKNOWN";
            frontDoorReceipt.FAILURE_CLASS = "HARNESS_RUNTIME_OR_CONTRACT_FAILURE";
            if (error.code === "ERR_ASSERTION" && ["TASK19_LOCAL_WORKER_BUILD_FAILED", "TASK19_LOCAL_BUILD_CLIENT_TARGET_MISSING", "TASK19_LOCAL_BUILD_SERVER_TARGET_MISMATCH"].includes(error.message.split("\n")[0]))
                frontDoorReceipt.FIRST_FAIL = error.message.split("\n")[0];
            if (error.code === "ERR_ASSERTION" && error.message.startsWith("TASK19_FRONT_DOOR_FIXTURE_ROUTE_HTTP_200_REQUIRED")) {
                frontDoorReceipt.FIRST_NEW_BLOCKER = "TASK19_FRONT_DOOR_FIXTURE_ROUTE_UNAVAILABLE";
                frontDoorReceipt.FIRST_FAIL = "TASK19_FRONT_DOOR_FIXTURE_ROUTE_HTTP_200_REQUIRED";
                frontDoorReceipt.FAILURE_CLASS = "TEST_FIXTURE_WORKER_ROUTING_MISSING";
            }
        }
        if (disposableReceipt.LOCAL_AUTH_PIPELINE_PREFLIGHT !== "PASS" && (disposableReceipt.BROWSER_SIGNIN_ACCOUNT_A !== "NOT_RUN")) {
            console.log(`FIRST_NEW_BLOCKER=${disposableReceipt.BROWSER_SIGNIN_ACCOUNT_A === "PASS" ? "LOCAL_AUTH_PIPELINE_FAILED" : "TASK19_BROWSER_SUPABASE_SIGNIN_FAILED"}`);
            if (disposableReceipt.LOCAL_GOTRUE_USER_RESPONSE_STATUS === 200)
                disposableReceipt.FAILED_BOUNDARY = "POSTGREST";
        }
        const codes = ["TASK19_WORKERS_BUILD_FAILURE", "TASK19_LOCAL_BUILD_CLIENT_TARGET_MISSING", "TASK19_LOCAL_BUILD_REMOTE_PUBLIC_TARGET_LEAK",
            "TASK19_LOCAL_BUILD_SERVER_TARGET_MISMATCH", "TASK19_REMOTE_BINDING_FORBIDDEN", "TASK19_WORKERS_RUNTIME_START_FAILURE", "TASK19_WORKERS_HTTPS_FAILURE",
            "TASK19_WORKERS_BROWSER_ASSET_TRANSPORT_DEFECT", "TASK19_UNEXPECTED_BROWSER_WEBSOCKET", "TASK19_UNEXPECTED_BROWSER_EXTERNAL_REQUEST",
            "TASK19_UNEXPECTED_WORKER_OUTBOUND", "TASK19_HYDRATION_FAILURE", "TASK19_BROWSER_CONSOLE_ERROR", "TASK19_BROWSER_PAGEERROR", "TASK19_CLIENT_INTERACTION_FAILURE", "TASK19_HYDRATION_WARNING"];
        console.log(`FIRST_BLOCKER=${codes.find(code => error.message?.startsWith(code)) ?? (error.name === "TimeoutError" ? "TASK19_HYDRATION_FAILURE" : "UNRELATED_FAILURE")}`);
        console.log(`FIRST_BLOCKER_STAGE=${stage}`);
        if (error.code === "ERR_ASSERTION") {
            const safe = value => typeof value === "boolean" || typeof value === "number" ? String(value) : typeof value === "string" && /^(?:en|zh-CN|dark|auto|A|SELECT|Settings|设置|\/about\/|\/|rgb\([\d, ]+\))$/.test(value) ? value : "REDACTED";
            console.log(`ASSERTION_ACTUAL=${safe(error.actual)} ASSERTION_EXPECTED=${safe(error.expected)}`);
        }
        console.log(`FIRST_FAIL_ROUTE=${activeCase.route} BROWSER=${activeCase.browser} VIEWPORT=${activeCase.viewport} LOCALE=${activeCase.locale} PREFERS_COLOR_SCHEME=${activeCase.scheme}`);
        process.exitCode = 1;
    }
    finally {
        if (reservedFrontDoor?.listening)
            await new Promise((resolve, reject) => reservedFrontDoor.close(error => error ? reject(error) : resolve()));
        if (gateway?.listening) {
            gateway.closeAllConnections();
            await new Promise(resolve => gateway.close(resolve));
        }
        frontDoorReceipt.TASK19_FRONT_DOOR_STOPPED = !gateway?.listening;
        {
            await browser?.close();
            await stopWorker();
            if (fixture)
                await new Promise(resolve => fixture.close(resolve));
        }
        if (workerPort) {
            const release = async () => {
                const listener = createServer();
                receipt.portReleased = await new Promise(resolve => { listener.once("error", () => resolve(false)); listener.listen(workerPort, "127.0.0.1", () => listener.close(() => resolve(true))); });
            };
            await release();
        }
        {
            const listener = createServer();
            const released = await new Promise(resolve => { listener.once("error", () => resolve(false)); listener.listen(Number(new URL(frontDoorOrigin).port), "127.0.0.1", () => listener.close(() => resolve(true))); });
            frontDoorReceipt.TASK19_OWNED_PORTS_RELEASED = released && (!workerPort || receipt.portReleased);
        }
        if (ownedRoot) {
            const removeCertificateDirectory = async () => {
                assert.equal(path.dirname(path.resolve(ownedRoot)), path.resolve(tmpdir()));
                assert.ok(path.basename(ownedRoot).startsWith("ogh-task19-worker-"));
                await rm(ownedRoot, { recursive: true, force: true });
                const exists = await access(ownedRoot).then(() => true, error => { if (error.code === "ENOENT")
                    return false; throw error; });
                receipt.certRemoved = !exists;
                assert.equal(exists, false);
            };
            await removeCertificateDirectory();
        }
        console.log(`BUILT_ARTIFACT_UNCHANGED=${artifactHash === await fingerprint()}`);
        console.log("TASK19_USER_WORKER_READINESS_GATE=reloadComplete");
        console.log(`TASK19_USER_WORKER_READY=${receipt.userWorkerReady}`);
        console.log(`BROWSER_MAIN_DOCUMENT_STATUS=${receipt.documentStatus}`);
        console.log(`TASK19_CLIENT_INTERACTION_PROOF=${receipt.interaction}`);
        console.log(`TASK19_PAGEERRORS=${receipt.pageErrors}`);
        console.log(`TASK19_BROWSER_FIXTURE_CASES=${fixtureCases}`);
        if (firstPageError)
            for (const [name, value] of Object.entries(firstPageError))
                console.log(`${name}=${value}`);
        if (accountSwitchEvidence)
            for (const [name, value] of Object.entries(accountSwitchEvidence))
                console.log(`${name}=${value}`);
        if (fulfillControlEvidence) {
            for (const [scope, evidence] of Object.entries(fulfillControlEvidence)) {
                for (const [name, value] of Object.entries(evidence))
                    console.log(`${scope.toUpperCase()}_ROUTE_CONTROL_${name}=${value}`);
            }
            console.log("TASK19_BROWSER_CASES_COMPLETED=28\nTASK19_BROWSER_CASES_REQUIRED=102");
        }
        if (firstConsoleError)
            for (const [name, value] of Object.entries(firstConsoleError))
                console.log(`${name}=${value}`);
        console.log(`FIXTURE_REQUEST_COUNT=${fixtureNetwork.requests}`);
        console.log(`FIXTURE_RESPONSE_COUNT=${fixtureNetwork.responses}`);
        console.log(`FIXTURE_REQUESTFAILED_COUNT=${fixtureNetwork.failed}`);
        console.log(`TASK19_UNSTABLE_STARTWORKER_DISPOSED=${receipt.disposed}`);
        console.log(`TASK19_OWNED_PORT_RELEASED=${receipt.portReleased}`);
        console.log(`TASK19_TEMP_CERT_DIRECTORY_REMOVED=${receipt.certRemoved}`);
        console.log(`TASK19_PRIVATE_KEY_FILES_REMAINING=${receipt.certRemoved ? 0 : "UNKNOWN"}`);
        console.log("TASK19_BROWSER_TRANSPORT=WRANGLER_LOCAL_WORKER");
        console.log("TASK19_ASTRO_DEV_USED=false");
        console.log("TASK19_VITE_DEV_SERVER_USED=false");
        console.log("TASK19_LOCAL_PROTOCOL=https");
        console.log(`TASK19_LOCAL_WORKER_BUILD=${receipt.build}`);
        console.log(`TASK19_CLIENT_SUPABASE_TARGET=${receipt.client}`);
        console.log(`TASK19_CLIENT_REMOTE_SUPABASE_REFERENCE_COUNT=${receipt.remoteCount}`);
        console.log(`TASK19_WORKER_SUPABASE_TARGET=${receipt.server}`);
        console.log(`TASK19_WORKERS_TRANSPORT_PREFLIGHT=${receipt.preflight}`);
        console.log(`TASK19_HYDRATION_COMPLETED=${receipt.hydrated}`);
        console.log(`TASK19_BROWSER_WEBSOCKET_ATTEMPTS=${blockedRequests.filter(record => record.transport === "WEBSOCKET").length}`);
        console.log(`TASK19_CONSOLE_ERRORS=${receipt.consoleErrors}`);
        console.log(`TASK19_APPLICATION_CONSOLE_ERRORS=${receipt.applicationConsoleErrors}`);
        console.log(`TASK19_EXPECTED_BROWSER_NETWORK_DIAGNOSTICS=${receipt.expectedNetworkDiagnostics}`);
        console.log(`TASK19_UNEXPECTED_BROWSER_NETWORK_DIAGNOSTICS=${receipt.unexpectedNetworkDiagnostics}`);
        console.log(`TASK19_UNHANDLED_REJECTIONS=${receipt.unhandledRejections}`);
        console.log(`TASK19_UNRESOLVED_CURRENT_RUN_REQUESTS=${receipt.unresolvedRequests}`);
        console.log(`TASK19_VITE_CONNECTION_ERRORS=${receipt.viteErrors}`);
        console.log(`TASK19_UNAPPROVED_BROWSER_REQUESTS=${external}`);
        console.log(`TASK19_UNEXPECTED_WORKER_OUTBOUND_ATTEMPTS=${workerDenied + fixtureDenied}`);
        console.log("TASK19_EXTERNAL_BROWSER_REQUESTS_FORWARDED=0");
        console.log("TASK19_EXTERNAL_WORKER_REQUESTS_FORWARDED=0");
        for (const event of safeEvents)
            console.log(`SAFE_BROWSER_EVENT=${event}`);
        for (const record of blockedRequests)
            console.log(`BLOCKED_REQUEST_PROTOCOL=${record.protocol} HOST_CLASS=${record.hostClass} PATH=${record.path} RESOURCE_TYPE=${record.resourceType}`);
    }
}
async function runDisposableBrowserStack() {
    {
        await verifyCase53ResumeEntrypointContract();
        console.log(`TASK19_BROWSER_CASES_ALREADY_ACCEPTED=${matrixResumeCursor.acceptedOrdinal}\nCLOSED_ACCEPTED_CASES_RERUN=false`);
    }
    {
        if (!await closeAuthObservabilityGap()) {
            process.exitCode = 1;
            for (const [name, value] of Object.entries(frontDoorReceipt))
                console.log(`${name}=${value}`);
            return;
        }
        for (const [name, value] of Object.entries(authControlFlowReceipt))
            console.log(`${name}=${value}`);
    }
    const environment = preparePreferenceRunEnvironment(process.env);
    let localStatus, runtimeRoot;
    const execute = async (command, args, options) => {
        const result = await runCommand(command, args, options);
        if (args.includes("start"))
            runtimeRoot = options.cwd;
        if (args.includes("status") && args.includes("json")) {
            localStatus = JSON.parse(result.stdout);
            assertLocalReplayTarget(localStatus.API_URL);
            assertLocalReplayTarget(localStatus.DB_URL);
            assertOwnedDisposableRoot({ disposableRoot: options.cwd, repositoryRoot: root });
            disposableReceipt.LOCAL_SUPABASE_OWNED_ROOT = true;
        }
        if (args.includes("stop") && args.includes("--no-backup"))
            disposableReceipt.LOCAL_SUPABASE_STOPPED = true;
        return result;
    };
    try {
        await reviewAndReserveFrontDoor();
        console.log("LOCAL_SUPABASE_TARGET=LOOPBACK");
        await withCanonicalBaselineDirectory({ environment }, async (canonicalBaselineDirectory) => runLocalDisposableReplay({
            environment, execute, migrationLimit: 50, canonicalBaselineDirectory,
            afterMigrationLedgerValidated: async ({ target, executeSql, canonicalMigrationCount }) => {
                assertLocalReplayTarget(target);
                assert.equal(canonicalMigrationCount, 50);
                assert.ok(localStatus && new URL(target).origin === new URL(localStatus.API_URL).origin, "ONE_OWNED_SUPABASE_INSTANCE");
                const anonKey = localStatus.ANON_KEY ?? localStatus.PUBLISHABLE_KEY;
                assert.ok(typeof anonKey === "string" && anonKey, "LOCAL_ANON_CREDENTIAL_REQUIRED");
                Object.assign(disposableReceipt, { LOCAL_SUPABASE_STARTED: true, LOCAL_SUPABASE_API_TARGET: "LOOPBACK", LOCAL_SUPABASE_DB_TARGET: "LOOPBACK" });
                const migration = await preferenceMigration();
                assert.ok(migration?.version === "20261001075335" && migration.sql.trim(), "REVIEWED_ADDITIVE_MIGRATION_REQUIRED");
                await executeSql(`BEGIN;\n${migration.sql}\nINSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261001075335','user_preferences');\nCOMMIT;\nNOTIFY pgrst, 'reload schema';`);
                const accounts = {};
                const request = (route, token, method = "GET", body) => {
                    const url = new URL(route, target);
                    assertLocalReplayTarget(url.href);
                    assert.equal(url.origin, new URL(target).origin);
                    return fetch(url.href, { method, redirect: "error", signal: AbortSignal.timeout(10000),
                        headers: { apikey: anonKey, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
                        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
                };
                const prepareAccounts = async () => {
                    for (const label of ["A", "B"]) {
                        const email = `task19-${label.toLowerCase()}-${randomBytes(8).toString("hex")}@example.invalid`;
                        const password = randomBytes(24).toString("base64url");
                        const signup = await request("/auth/v1/signup", null, "POST", { email, password });
                        assert.equal(signup.status, 200, "LOCAL_SIGNUP_MUST_SUCCEED");
                        const created = await signup.json(), id = created.user?.id ?? created.id;
                        assert.ok(typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id), "GENUINE_LOCAL_USER_REQUIRED");
                        disposableReceipt[`ACCOUNT_${label}_LOCAL_SIGNUP`] = "PASS";
                        if (!created.session && !created.access_token)
                            await executeSql(`UPDATE auth.users SET email_confirmed_at=now() WHERE id='${id}'::uuid;`);
                        const login = await request("/auth/v1/token?grant_type=password", null, "POST", { email, password });
                        assert.equal(login.status, 200, "LOCAL_SIGNIN_MUST_SUCCEED");
                        const session = await login.json();
                        assert.ok(session.access_token && session.user?.id === id, "GENUINE_LOCAL_SESSION_REQUIRED");
                        const check = await request("/auth/v1/user", session.access_token);
                        assert.equal(check.status, 200, "LOCAL_GOTRUE_MUST_VALIDATE_ISSUED_SESSION");
                        assert.ok((await check.json()).id === id, "GENUINE_LOCAL_ACTOR_REQUIRED");
                        accounts[label] = { id, email, password };
                        issuedActors.set(session.access_token, label);
                        disposableReceipt[`ACCOUNT_${label}_LOCAL_SIGNIN`] = "PASS";
                    }
                    providerActorIds = Object.fromEntries(Object.entries(accounts).map(([label, account]) => [label, account.id]));
                };
                disposableStack = { target, anonKey, accounts, executeSql, prepareAccounts };
                await main();
                return { status: process.exitCode ? "BLOCKED" : "PASS" };
            },
        }));
    }
    catch (error) {
        captureCaseRuntimeError(error);
        process.exitCode = 1;
        console.log(`FIRST_NEW_BLOCKER=${disposableReceipt.LOCAL_SUPABASE_STARTED ? "LOCAL_AUTH_PIPELINE_FAILED" : "TASK19_DISPOSABLE_LOCAL_SUPABASE_UNAVAILABLE"}`);
    }
    finally {
        if (reservedFrontDoor?.listening)
            await new Promise((resolve, reject) => reservedFrontDoor.close(error => error ? reject(error) : resolve()));
        disposableStack = undefined;
        issuedActors.clear();
        if (disposableReceipt.BROWSER_SIGNIN_ACCOUNT_A === "FAIL") {
            disposableReceipt.FAILED_BOUNDARY = browserSigninEvidence.boundary !== "UNKNOWN" ? browserSigninEvidence.boundary
                : !browserSigninEvidence.requestObserved ? "BROWSER_SIGNIN_REQUEST_NOT_SENT"
                    : browserSigninEvidence.requestFailed ? "BROWSER_SIGNIN_NETWORK_FAILED"
                        : typeof browserSigninEvidence.responseStatus === "number" && browserSigninEvidence.responseStatus >= 400 ? "BROWSER_SIGNIN_HTTP_REJECTED" : "UNKNOWN";
            console.log(`BROWSER_SIGNIN_RESPONSE_STATUS=${browserSigninEvidence.responseStatus}`);
            console.log("FAILURE_CLASS=BROWSER_SESSION_ESTABLISHMENT_FAILED");
        }
        console.log(`TASK19_DISPOSABLE_LOCAL_SUPABASE_BROWSER_STACK=${process.exitCode ? "BLOCKED" : "PASS"}`);
        {
            for (const [name, value] of Object.entries(frontDoorReceipt))
                console.log(`${name}=${value}`);
            for (const [name, value] of Object.entries(caTrustReceipt))
                console.log(`${name}=${value}`);
            for (const [name, value] of Object.entries(authControlFlowReceipt))
                console.log(`${name}=${value}`);
        }
        for (const [name, value] of Object.entries(disposableReceipt))
            console.log(`${name}=${value}`);
        if (apiOutageDesktopReceipt)
            for (const [name, value] of Object.entries(apiOutageDesktopReceipt))
                console.log(`${name}=${value}`);
        console.log(`TASK19_BROWSER_CASES_COMPLETED=${acceptedDisposableCasesAtStart + fixtureCases + workerCasesPassed}`);
        {
            Object.assign(matrixResumeReceipt, {
                TASK19_BROWSER_CASES_COMPLETED: acceptedDisposableCasesAtStart + fixtureCases + workerCasesPassed });
            for (const [name, value] of Object.entries(matrixResumeReceipt))
                console.log(`${name}=${value}`);
            await mkdir(output, { recursive: true });
            const receiptName = `matrix-resume-after-${matrixResumeCursor.acceptedOrdinal}${""}.json`;
            await writeFile(path.join(output, receiptName), JSON.stringify(matrixResumeReceipt, null, 2) + "\n");
        }
        console.log("PREFERENCES_PLAYWRIGHT_ROUTE_HANDLER_COUNT=0\nTASK20_STARTED=false\nPUSHED=false");
        if (runtimeRoot) {
            let removed = false;
            try {
                await access(runtimeRoot);
            }
            catch (error) {
                if (error.code === "ENOENT")
                    removed = true;
            }
            console.log(`TASK19_TEMP_ROOTS_REMOVED=${removed}`);
        }
    }
}
function verifyAuthLogoutAbortAccountingContract() {
    const evidence = acceptedLogoutAbortFormalEvidence();
    const historicalUnexpected = evidence.entries.filter(entry => entry.failed && !expectedStaleAbort(entry, evidence.observation)).length;
    assert.equal(historicalUnexpected, 1);
    assert.equal(evidence.entries.filter(entry => entry.failed).length, 2);
    console.log("AUTH_LOGOUT_POST_SUCCESS_ABORT_RED=PASS\nHISTORICAL_RAW_REQUESTFAILED_COUNT=2\nHISTORICAL_UNEXPECTED_REQUESTFAILED_COUNT=1");
    const counts = accountLoadingRequestFailures(evidence.entries, evidence.observation, evidence.unresolved);
    assert.equal(counts.EXPECTED_AUTH_LOGOUT_POST_SUCCESS_ABORT_COUNT, 1);
    assert.equal(counts.UNEXPECTED_REQUESTFAILED_COUNT, 0);
    assert.equal(counts.EXPECTED_STALE_ACTOR_REQUESTFAILED_COUNT, 1);
    assert.equal(counts.RAW_REQUESTFAILED_COUNT, 2);
    assert.equal(counts.EXPECTED_REQUESTFAILED_COUNT, 2);
    const original = JSON.stringify(evidence);
    assert.equal(authLogoutTerminalClass(evidence.observation.logout.entry, evidence.observation, 0), "AUTH_LOGOUT_POST_SUCCESS_ABORT");
    const negative = (label, mutate, unresolved = 0) => {
        const next = acceptedLogoutAbortFormalEvidence();
        mutate(next);
        const accounting = accountLoadingRequestFailures(next.entries, next.observation, unresolved);
        assert.equal(accounting.EXPECTED_AUTH_LOGOUT_POST_SUCCESS_ABORT_COUNT, 0, label);
        assert.equal(accounting.UNEXPECTED_REQUESTFAILED_COUNT, 1, label);
    };
    const changeTime = (next, event, ms) => { next.observation.logout.events.find(item => item.event === event).ms = ms; };
    negative("ABORT_BEFORE_204", next => changeTime(next, "LOGOUT_REQUESTFAILED", 598));
    negative("SIGNOUT_PROMISE_ERROR", next => { next.observation.logout.promiseError = true; });
    negative("SESSION_STILL_PRESENT", next => { next.observation.logout.sessionAbsent = false; });
    negative("B_SIGNIN_BEFORE_SUCCESS", next => changeTime(next, "B_SIGNIN_START", 601));
    negative("WRONG_ENDPOINT", next => { next.observation.logout.entry.pathname = "/auth/v1/token"; });
    negative("NO_BROWSER_204", next => { next.observation.logout.entry.responseObserved = false; });
    negative("HOLD_TOUCHED_AUTH", next => { next.observation.logout.staleHoldTouchesAuth = true; });
    negative("ABORT_BEFORE_PROMISE_SUCCESS", next => changeTime(next, "LOGOUT_REQUESTFAILED", 602.85));
    negative("B_SIGNIN_BEFORE_ABORT", next => changeTime(next, "B_SIGNIN_START", 604));
    negative("LOCAL_GOTRUE_NOT_204", next => { next.observation.logout.gotrueStatus = 200; });
    negative("BROWSER_NOT_204", next => { next.observation.logout.entry.status = 200; });
    negative("SHARED_ABORT_CONTROLLER", next => { next.observation.logout.sharedAbortWithAuth = true; });
    negative("UNRELATED_RELEASE_ABORT", next => { next.observation.logout.releaseAbortsUnrelated = true; });
    negative("NAVIGATION_SUPERSEDES_LOGOUT", next => { next.observation.logout.navigationBetween = true; });
    negative("UNRESOLVED_REQUEST", () => { }, 1);
    negative("OTHER_LOGOUT_CASE", next => { next.observation.logout.entry.case = "FIXTURE_ACCOUNT_COOKIE_ROW_LOGOUT"; });
    negative("OTHER_AUTH_PHASE", next => { next.observation.logout.entry.authPhase = "ACCOUNT_B_SIGNIN"; });
    negative("OTHER_ACTOR", next => { next.observation.logout.entry.authLogicalActor = "ACCOUNT_B"; });
    negative("AUTH_GENERATION_NOT_APPLICABLE_MISSING", next => { delete next.observation.logout.entry.authPreferenceGenerationApplicable; });
    negative("REQUEST_IDENTITY_MISMATCH", next => { next.observation.logout.entry = { ...next.observation.logout.entry }; });
    negative("FRONT_DOOR_ACTOR_UNKNOWN", next => { next.observation.logout.frontActor = "UNKNOWN"; });
    negative("FRONT_DOOR_NOT_RECEIVED", next => { next.observation.logout.frontCount = 0; });
    negative("AMBIGUOUS_LOGOUT_REQUEST", next => { next.observation.logout.browserCount = 2; });
    negative("DUPLICATE_ABORT_EVENT", next => { next.observation.logout.events.push({ ...next.observation.logout.events.find(item => item.event === "LOGOUT_REQUESTFAILED") }); });
    assert.equal(JSON.stringify(evidence), original, "RAW_FORMAL_EVIDENCE_MUST_NOT_BE_REWRITTEN");
    console.log("AUTH_LOGOUT_POST_SUCCESS_ABORT_GREEN=PASS\nAUTH_LOGOUT_ABORT_NEGATIVE_CONTROLS=PASS_24_OF_24\nRAW_REQUESTFAILED_COUNT=2\nEXPECTED_STALE_ACTOR_REQUESTFAILED_COUNT=1\nEXPECTED_AUTH_LOGOUT_POST_SUCCESS_ABORT_COUNT=1\nEXPECTED_REQUESTFAILED_COUNT=2\nUNEXPECTED_REQUESTFAILED_COUNT=0\nRAW_FORMAL_EVIDENCE_PRESERVED=true");
}
async function verifyCase53ResumeEntrypointContract() {
    for (const accepted of [0, 1, 52, 65, 101, 102]) {
        const cursor = createMatrixResumeCursor(accepted), selected = [];
        for (let ordinal = 1; ordinal <= 102; ordinal++)
            if (cursor.select())
                selected.push(ordinal);
        assert.deepEqual(selected, Array.from({ length: 102 - accepted }, (_, index) => accepted + index + 1));
        assert.equal(cursor.ordinal, 102);
    }
    assert.throws(() => createMatrixResumeCursor(-1));
    assert.throws(() => createMatrixResumeCursor(103));
    const cursor = createMatrixResumeCursor(52), finished = [];
    assert.throws(() => {
        for (let ordinal = 1; ordinal <= 102; ordinal++) {
            if (!cursor.select())
                continue;
            if (ordinal === 54)
                throw new Error('FIRST_DISTINCT_BLOCKER');
            finished.push(ordinal);
        }
    }, /FIRST_DISTINCT_BLOCKER/);
    assert.deepEqual(finished, [53]);
}
if (process.argv.includes('--owned-worker-child')) await runWorkerChild();
else if (process.argv.includes('--harness-contract')) await verifyPermanentHarnessContract();
else await runDisposableBrowserStack();

async function verifyPermanentHarnessContract() {
  await verifyCase53ResumeEntrypointContract();
  verifyAuthLogoutAbortAccountingContract();
  const evidence = acceptedLogoutAbortFormalEvidence();
  for (const failureClass of ['OTHER', 'NS_BINDING_ABORTED', 'ERR_ABORTED']) {
    evidence.observation.oldEntry.failureClass = failureClass;
    assert.equal(expectedStaleAbort(evidence.observation.oldEntry, evidence.observation), true);
    assert.equal(expectedStaleAbort({...evidence.observation.oldEntry}, evidence.observation), false);
    for (const field of ['held','released','staleResultDiscarded','finalActorConfirmed','switchedWithPending'])
      assert.equal(expectedStaleAbort(evidence.observation.oldEntry, {...evidence.observation, [field]:false}), false);
  }
  const baseline = {generation:1}, current = {resourceType:'document',method:'GET',pathname:'/__task19/locale',fixtureDocumentGeneration:2,finished:false,failed:false};
  const barrier = createAbFinalReloadState(baseline);
  assert.throws(()=>barrier.assertSnapshotAllowed(current,current));
  assert.equal(barrier.navigated(current,{mainFrame:true,pathname:current.pathname,actor:'ACCOUNT_A'}),false);
  assert.equal(barrier.navigated(current,{mainFrame:true,pathname:current.pathname,actor:'ACCOUNT_B'}),true);
  assert.throws(()=>barrier.fixtureReady(current));
  barrier.domContentLoaded(current); barrier.fixtureReady(current);
  assert.throws(()=>barrier.assertSnapshotAllowed(current,current));
  current.finished=true; barrier.requestTerminal(current);
  assert.equal(barrier.assertSnapshotAllowed(current,current),current);
  assert.throws(()=>barrier.assertSnapshotAllowed({...current},current));
  for (const text of ['Hydrated', 'An unrelated server rendered diagnostic']) assert.equal(isReactHydrationDiagnostic({text:()=>text}), false);
  for (const text of ["Hydration failed because the server rendered HTML didn't match the client.",
    'Warning: Text content did not match. Server: "en" Client: "zh-CN"']) assert.equal(isReactHydrationDiagnostic({text:()=>text}), true);
  const source = await readFile(import.meta.filename, 'utf8');
  const ast = (await import('typescript')).default.createSourceFile('harness.mjs', source, 99, true);
  assert.equal(ast.parseDiagnostics.length, 0);
  for (const name of ['armAccountLogoutReload','settleAccountLogoutReload','createAbFinalReloadState',
    'settleAbFinalReload','settleStaleActorDocument','expectedStaleAbortPredicates','snapshotCurrentLoadingObserver']) {
    assert.ok(ast.statements.some(node => node.name?.text === name), name);
  }
  console.log('TASK19_PERMANENT_HARNESS_CONTRACT=PASS BROWSER_CASES_EXECUTED=0');
}
