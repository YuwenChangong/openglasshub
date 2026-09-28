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
const status = (current: boolean): LegalConsentStatus => ({ current, bundleVersion: "2026-07", minimumAge: 16, consentUrl: "/legal-consent/" });
const additionalCases = ["consent-submit-expired-401", "consent-submit-session-missing", "consent-delayed-current", "consent-retry-success", "consent-outdated-bundle", "consent-external-next", "consent-encoded-external-next", "consent-self-loop-next", "consent-record-not-current", "consent-auth-failure", "consent-submit-auth-failure", "consent-callback-success", "consent-logout-failure"];

function Harness() {
  const [scenario, setScenario] = useState<Scenario>("consent-missing-unchecked");
  const [calls, setCalls] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  // Retain releases across remounts so tests can resolve requests after unmount.
  const pending = useMemo(() => ({ releaseSession: () => {}, releaseStatus: () => {}, releaseRecord: () => {} }), []);
  const record = (name: string) => setCalls((items) => [...items, name]);
  const navigation: LegalConsentNavigationAdapter = useMemo(() => ({ navigate: (url) => record(`navigate:${url}`), replace: (url) => record(`replace:${url}`), getCurrentUrl: () => "http://harness.local/login/" }), []);
  const authScenario = scenario.startsWith("login") || scenario.startsWith("register");
  const signedIn = !authScenario && scenario !== "consent-signed-out";
  const auth: AuthPanelAdapter & LegalConsentAuthAdapter = useMemo(() => ({
    viewState: signedIn ? "signed_in" : "signed_out", userPresent: signedIn,
    getSession: (() => {
      let reads = 0;
      return async () => {
        reads += 1;
        if (scenario === "consent-auth-failure") throw new Error("fixture session unavailable");
        if (scenario === "consent-submit-auth-failure" && reads > 1) throw new Error("fixture session unavailable");
        if (scenario === "consent-session-loading" || (scenario === "consent-submit-pending" && reads > 1)) await new Promise<void>((resolve) => { pending.releaseSession = resolve; });
        if (scenario === "consent-submit-session-missing" && reads > 1) return null;
        return signedIn ? { accessToken: "test-session" } : null;
      };
    })(),
    signInWithPassword: async () => { record("signIn"); return scenario === "login-auth-success-consent-failure" ? { data: null, error: new Error("Invalid login credentials") } : { data: { accessToken: "test-session" }, error: null }; },
    signUp: async () => { record("signUp"); return scenario === "register-email-confirmation-no-session" ? { data: null, error: null } : { data: { accessToken: "test-session" }, error: null }; },
    signOut: async () => { record("signOut"); return scenario === "consent-logout-failure" ? new Error("fixture logout unavailable") : null; },
  }), [scenario, signedIn, revision]);
  const consent: LegalConsentAdapter = useMemo(() => ({
    getCurrentConsent: (() => {
      let reads = 0;
      return async () => {
        record("getConsent"); reads += 1;
        if (scenario === "consent-delayed-current") {
          await new Promise<void>((resolve) => { pending.releaseStatus = resolve; });
          record("statusResolved");
        }
        if (scenario === "consent-status-failure" || scenario === "callback-status-failure" || (scenario === "consent-retry-success" && reads === 1)) throw new LegalConsentClientError("UNAVAILABLE");
        if (scenario === "consent-session-expired-401") throw new LegalConsentClientError("UNAUTHORIZED");
        if (scenario === "consent-rate-limited-429") throw new LegalConsentClientError("RATE_LIMITED");
        const current = ["consent-already-current", "callback-current-consent", "consent-delayed-current", "consent-retry-success", "consent-external-next", "consent-encoded-external-next", "consent-self-loop-next"].includes(scenario);
        return scenario === "consent-outdated-bundle" ? { ...status(false), bundleVersion: "2025-01" } : status(current);
      };
    })(),
    recordCurrentConsent: async ({ accessToken, source }) => {
      if (accessToken !== "test-session" || !["legacy_account_gate", "policy_update", "authenticated_callback", "login", "registration"].includes(source)) throw new Error("unexpected consent record input");
      record(`recordConsent:${source}`);
      if (scenario === "consent-submit-pending") {
        await new Promise<void>((resolve) => { pending.releaseRecord = resolve; });
        record("recordResolved");
      }
      if (scenario === "consent-post-failure") throw new LegalConsentClientError("UNAVAILABLE");
      if (scenario === "consent-submit-expired-401") throw new LegalConsentClientError("UNAUTHORIZED");
      return status(scenario !== "consent-record-not-current");
    },
  }), [scenario, revision]);
  const next = scenario === "consent-external-next" ? "https://example.invalid" : scenario === "consent-encoded-external-next" ? "/%252f%252fexample.invalid" : scenario === "consent-self-loop-next" ? "/%256cegal-consent/?next=%2Ffeed%2F" : scenario === "consent-submit-expired-401" ? "/circles/?sort=latest#reply" : "/feed/";
  const content = scenario.startsWith("consent") ? <LegalConsentPage key={revision} authAdapter={auth} consentAdapter={consent} navigationAdapter={navigation} next={next} reason={scenario === "consent-outdated-bundle" ? "policy-update" : scenario === "consent-callback-success" ? "callback" : undefined} />
    : authScenario ? <AuthPanel key={revision} authAdapter={auth} consentAdapter={consent} navigationAdapter={navigation} initialMode={scenario.startsWith("register") ? "signup" : "login"} next="/feed/" />
    : <AuthCallback key={revision} authAdapter={auth} consentAdapter={consent} navigationAdapter={navigation} next={scenario === "callback-external-next-rejected" ? "https://example.invalid" : "/feed/"} />;
  return <main className="legal-harness"><nav aria-label="Visual test state">{[...LEGAL_CONSENT_STATE_MATRIX.map(({ id }) => id), ...additionalCases].map((id) => <button key={id} type="button" onClick={() => { setCalls([]); setScenario(id); setRevision((value) => value + 1); }}>{id}</button>)}<button onClick={() => pending.releaseSession()}>release-session</button><button onClick={() => pending.releaseStatus()}>release-status</button><button onClick={() => pending.releaseRecord()}>release-record</button></nav><div className="legal-harness__surface">{content}</div><output aria-live="polite">{calls.join(",")}</output></main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
