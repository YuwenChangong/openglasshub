import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/styles/community.css";
import "./harness.css";
import AuthPanel from "../../../src/components/forum/AuthPanel";
import LegalConsentPage from "../../../src/components/legal/LegalConsentPage";
import AuthCallback from "../../../src/components/auth/AuthCallback";
import { LegalConsentClientError, type LegalConsentStatus } from "../../../src/lib/legal-consent-client";
import type { AuthPanelAdapter, LegalConsentAdapter, LegalConsentAuthAdapter, LegalConsentNavigationAdapter } from "../../../src/lib/legal-consent-adapters";

type Scenario = "consent-missing" | "consent-current" | "consent-error" | "consent-rate" | "auth-login" | "auth-fail" | "auth-signup" | "auth-email" | "callback-current" | "callback-missing" | "callback-error";
const status = (current: boolean): LegalConsentStatus => ({ current, bundleVersion: "test-policy", minimumAge: 16, consentUrl: "/legal-consent/" });

function Harness() {
  const [scenario, setScenario] = useState<Scenario>("consent-missing");
  const [calls, setCalls] = useState<string[]>([]);
  const record = (name: string) => setCalls((items) => [...items, name]);
  const navigation: LegalConsentNavigationAdapter = useMemo(() => ({ navigate: (url) => record(`navigate:${url}`), replace: (url) => record(`replace:${url}`), getCurrentUrl: () => "http://harness.local/login/" }), []);
  const signedIn = !["auth-login", "auth-fail", "auth-signup", "auth-email"].includes(scenario);
  const auth: AuthPanelAdapter & LegalConsentAuthAdapter = useMemo(() => ({
    viewState: signedIn ? "signed_in" : "signed_out", userPresent: signedIn,
    getSession: async () => signedIn ? { accessToken: "test-session" } : null,
    signInWithPassword: async () => { record("signIn"); return scenario === "auth-fail" ? { data: null, error: new Error("Invalid login credentials") } : { data: { accessToken: "test-session" }, error: null }; },
    signUp: async () => { record("signUp"); return scenario === "auth-email" ? { data: null, error: null } : { data: { accessToken: "test-session" }, error: null }; },
    signOut: async () => { record("signOut"); return null; },
  }), [scenario, signedIn]);
  const consent: LegalConsentAdapter = useMemo(() => ({
    getCurrentConsent: async () => { record("getConsent"); if (scenario === "consent-error" || scenario === "callback-error") throw new LegalConsentClientError("UNAVAILABLE"); if (scenario === "consent-rate") throw new LegalConsentClientError("RATE_LIMITED"); return status(scenario === "consent-current" || scenario === "callback-current"); },
    recordCurrentConsent: async () => { record("recordConsent"); return status(true); },
  }), [scenario]);
  const content = scenario.startsWith("consent") ? <LegalConsentPage authAdapter={auth} consentAdapter={consent} navigationAdapter={navigation} next="/feed/" />
    : scenario.startsWith("auth") ? <AuthPanel authAdapter={auth} consentAdapter={consent} navigationAdapter={navigation} initialMode={scenario === "auth-signup" || scenario === "auth-email" ? "signup" : "login"} next="/feed/" />
    : <AuthCallback authAdapter={auth} consentAdapter={consent} navigationAdapter={navigation} next={scenario === "callback-error" ? "https://example.invalid" : "/feed/"} />;
  return <main className="legal-harness"><nav aria-label="Visual test state">{(["consent-missing","consent-current","consent-error","consent-rate","auth-login","auth-fail","auth-signup","auth-email","callback-current","callback-missing","callback-error"] as Scenario[]).map((item) => <button key={item} type="button" onClick={() => { setCalls([]); setScenario(item); }}>{item}</button>)}</nav><div className="legal-harness__surface">{content}</div><output aria-live="polite">{calls.join(",")}</output></main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
