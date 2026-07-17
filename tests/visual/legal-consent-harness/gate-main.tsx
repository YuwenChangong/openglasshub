import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/styles/community.css";
import "./harness.css";
import LegalConsentGate from "../../../src/components/legal/LegalConsentGate";
import { LEGAL_CONSENT_PAGE_GATE_STATES } from "../legal-consent-page-gate-state-matrix.mjs";
import { LegalConsentClientError } from "../../../src/lib/legal-consent-client";

function App() {
 const [id,setId]=useState(LEGAL_CONSENT_PAGE_GATE_STATES[0].id); const [calls,setCalls]=useState<string[]>([]); const state=LEGAL_CONSENT_PAGE_GATE_STATES.find((item)=>item.id===id)!;
 const add=(value:string)=>setCalls((items)=>[...items,value]); const signedOut=id.includes("signed-out")||id.includes("notifications-signed-out")||id.includes("session-expired");
 const auth=useMemo(()=>({getSession:async()=>{add("session"); if(id==="gate-session-loading") return await new Promise(()=>{}); return signedOut?null:{accessToken:"memory-only"};},subscribe:()=>()=>{}}),[id,signedOut]);
 const consent=useMemo(()=>({getCurrentConsent:async()=>{add("consent"); if(id==="gate-consent-loading") return await new Promise(()=>{}); if(id.includes("failure")) throw new LegalConsentClientError("UNAVAILABLE"); if(id==="gate-rate-limited") throw new LegalConsentClientError("RATE_LIMITED"); if(id.includes("missing")||id.includes("outdated")) return {current:false,bundleVersion:"test",minimumAge:16,consentUrl:"/legal-consent/"}; return {current:true,bundleVersion:"test",minimumAge:16,consentUrl:"/legal-consent/"};},recordCurrentConsent:async()=>({current:true,bundleVersion:"test",minimumAge:16,consentUrl:"/legal-consent/"})}),[id]);
 const nav=useMemo(()=>({navigate:(url:string)=>add(`navigate:${url}`),replace:(url:string)=>add(`replace:${url}`),getCurrentUrl:()=>"http://local/"}),[]);
 return <main className="legal-harness"><nav aria-label="Gate states">{LEGAL_CONSENT_PAGE_GATE_STATES.map((item)=><button key={item.id} onClick={()=>{setCalls([]);setId(item.id)}}>{item.id}</button>)}</nav><section className="legal-harness__surface"><LegalConsentGate pathname={state.route} authAdapter={auth} consentAdapter={consent} navigationAdapter={nav}/><div data-consent-gated-main hidden><section className="auth-card"><h1>受保护页面</h1><p>社区内容已安全显示。</p></section></div></section><output>{calls.join(",")}</output></main>;
}
createRoot(document.getElementById("root")!).render(<App/>);
