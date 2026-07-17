import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/styles/community.css";
import "./harness.css";
import AuthPanel from "../../../src/components/forum/AuthPanel";
import LegalConsentPage from "../../../src/components/legal/LegalConsentPage";
import AuthCallback from "../../../src/components/auth/AuthCallback";
import { LegalConsentClientError, type LegalConsentStatus } from "../../../src/lib/legal-consent-client";
import type { AuthPanelAdapter, LegalConsentAdapter, LegalConsentAuthAdapter, LegalConsentNavigationAdapter } from "../../../src/lib/legal-consent-adapters";
import { LEGAL_CONSENT_STATE_MATRIX } from "../legal-consent-state-matrix.mjs";

type Scenario = string;
const status = (current: boolean): LegalConsentStatus => ({ current, bundleVersion: "test-policy", minimumAge: 16, consentUrl: "/legal-consent/" });

function Harness() {
  const [scenario, setScenario] = useState<Scenario>("consent-missing-unchecked");
  const [calls, setCalls] = useState<string[]>([]);
  const record = (name: string) => setCalls((items) => [...items, name]);
  const navigation: LegalConsentNavigationAdapter = useMemo(() => ({ navigate: (url) => record(`navigate:${url}`), replace: (url) => record(`replace:${url}`), getCurrentUrl: () => "http://harness.local/login/" }), []);
  const authScenario = scenario.startsWith("login") || scenario.startsWith("register");
  const signedIn = !authScenario && scenario !== "consent-signed-out";
  const auth: AuthPanelAdapter & LegalConsentAuthAdapter = useMemo(() => ({
    viewState: signedIn ? "signed_in" : "signed_out", userPresent: signedIn,
    getSession: async () => signedIn ? { accessToken: "test-session" } : null,
    signInWithPassword: async () => { record("signIn"); return scenario === "login-auth-success-consent-failure" ? { data: null, error: new Error("Invalid login credentials") } : { data: { accessToken: "test-session" }, error: null }; },
    signUp: async () => { record("signUp"); return scenario === "register-email-confirmation-no-session" ? { data: null, error: null } : { data: { accessToken: "test-session" }, error: null }; },
    signOut: async () => { record("signOut"); return null; },
  }), [scenario, signedIn]);
  const consent: LegalConsentAdapter = useMemo(() => ({
    getCurrentConsent: async () => { record("getConsent"); if (scenario === "consent-status-failure" || scenario === "callback-status-failure") throw new LegalConsentClientError("UNAVAILABLE"); if (scenario === "consent-session-expired-401") throw new LegalConsentClientError("UNAUTHORIZED"); if (scenario === "consent-rate-limited-429") throw new LegalConsentClientError("RATE_LIMITED"); return status(scenario === "consent-already-current" || scenario === "callback-current-consent"); },
    recordCurrentConsent: async () => { record("recordConsent"); return status(true); },
  }), [scenario]);
  const content = scenario.startsWith("consent") ? <LegalConsentPage authAdapter={auth} consentAdapter={consent} navigationAdapter={navigation} next="/feed/" />
    : authScenario ? <AuthPanel authAdapter={auth} consentAdapter={consent} navigationAdapter={navigation} initialMode={scenario.startsWith("register") ? "signup" : "login"} next="/feed/" />
    : <AuthCallback authAdapter={auth} consentAdapter={consent} navigationAdapter={navigation} next={scenario === "callback-external-next-rejected" ? "https://example.invalid" : "/feed/"} />;
  return <main className="legal-harness"><nav aria-label="Visual test state">{LEGAL_CONSENT_STATE_MATRIX.map(({ id }) => <button key={id} type="button" onClick={() => { setCalls([]); setScenario(id); }}>{id}</button>)}</nav><div className="legal-harness__surface">{content}</div><output aria-live="polite">{calls.join(",")}</output></main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
