import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/styles/community.css";
import "./harness.css";
import AuthPanel from "../../../src/components/forum/AuthPanel";
import LegalConsentPage from "../../../src/components/legal/LegalConsentPage";
import AuthCallback from "../../../src/components/auth/AuthCallback";
import ResetPasswordForm from "../../../src/components/auth/ResetPasswordForm";
import { createPasswordRecoveryAdapter } from "../../../src/lib/password-recovery-adapter";
import { createRecoveryEventBuffer } from "../../../src/lib/recovery-event-buffer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LegalConsentClientError, type LegalConsentStatus } from "../../../src/lib/legal-consent-client";
import type { AuthPanelAdapter, LegalConsentAdapter, LegalConsentAuthAdapter, LegalConsentNavigationAdapter } from "../../../src/lib/legal-consent-adapters";
import { LEGAL_CONSENT_STATE_MATRIX } from "../legal-consent-state-matrix.mjs";

type Scenario = string;
const status = (current: boolean): LegalConsentStatus => ({ current, bundleVersion: "2026-07", minimumAge: 16, consentUrl: "/legal-consent/" });
const additionalCases = ["consent-submit-expired-401", "consent-submit-session-missing", "consent-delayed-current", "consent-retry-success", "consent-outdated-bundle", "consent-external-next", "consent-encoded-external-next", "consent-self-loop-next", "consent-record-not-current", "consent-auth-failure", "consent-submit-auth-failure", "consent-callback-success", "consent-logout-failure", "consent-current-navigation-throw", "consent-record-navigation-throw", "consent-current-navigation-stall", "consent-record-navigation-stall", "login-reset-safe-callback", "login-reset-returned-error", "login-reset-thrown-error", "register-abuse-initial", "register-abuse-obfuscated", "register-abuse-duplicate", "register-abuse-unconfirmed", "register-abuse-required", "register-abuse-off-stale", "register-abuse-prepare-stale", "register-captcha-prepare-token", "login-abuse-required", "login-abuse-off", "login-abuse-prepare", "login-abuse-off-stale", "login-abuse-prepare-stale", "login-reset-off-stale", "login-reset-prepare-stale", "login-reset-prepare-token", "login-captcha-off", "login-captcha-prepare-missing", "login-captcha-prepare-script-failed", "login-captcha-prepare-token", "login-captcha-required-missing", "login-captcha-required-error", "login-captcha-required-expired", "login-captcha-required-widget", "callback-self-next", "callback-delayed-session", "callback-failed-code"];
const authSdkCalls: string[] = [];
(window as unknown as Window & { __authSdkCalls: string[] }).__authSdkCalls = authSdkCalls;

function Harness() {
  const [scenario, setScenario] = useState<Scenario>("consent-missing-unchecked");
  const [previewLocale, setPreviewLocale] = useState<"zh-CN" | "en">("zh-CN");
  const [calls, setCalls] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [recoveryScenario, setRecoveryScenario] = useState(false);
  const [recoveryBeforeMount, setRecoveryBeforeMount] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const recovery = useMemo(() => {
    let listener: ((event: string, session: object) => void) | null = null;
    const events = createRecoveryEventBuffer();
    if (recoveryBeforeMount) events.observe("PASSWORD_RECOVERY", true, "/auth/reset-password/");
    let exchanges = 0;
    let updates = 0;
    let resolveExchange: (() => void) | undefined;
    const emit = () => {
      events.observe("PASSWORD_RECOVERY", true, "/auth/reset-password/");
      listener?.("PASSWORD_RECOVERY", {});
    };
    const client = { auth: {
      exchangeCodeForSession: async (code: string, options?: { flowId: string }) => {
        exchanges += 1;
        record(`exchange-count:${exchanges}`);
        if (code === "flow") record(`flow-preserved:${options?.flowId === "00000000-0000-4000-8000-000000000001"}`);
        if (code === "pending") return new Promise((resolve) => { resolveExchange = () => resolve({ error: null, data: { redirectType: "recovery" } }); });
        if (code === "failed") return { data: null, error: new Error("private provider detail") };
        return { error: null, data: { redirectType: code === "signup" ? "signup" : "recovery" } };
      },
      getSession: async () => ({ data: { session: {} }, error: null }),
      onAuthStateChange: (callback: typeof listener) => { listener = callback; record("listener-added"); return { data: { subscription: { unsubscribe: () => { listener = null; record("listener-removed"); } } } }; },
      updateUser: async ({ password }: { password: string }) => { updates += 1; record(`update-count:${updates}`); record(`password-preserved:${password === (window as Window & { __expectedPassword?: string }).__expectedPassword}`); return { error: null }; },
    } };
    const adapter = createPasswordRecoveryAdapter(client as unknown as SupabaseClient, () => events.consume("/auth/reset-password/"), () => events.invalidate());
    return { adapter, emit, complete: () => { resolveExchange?.(); emit(); record("late-completion"); } };
  }, [recoveryAttempt, recoveryBeforeMount]);
  // Retain releases across remounts so tests can resolve requests after unmount.
  const pending = useMemo(() => ({ releaseSession: () => {}, releaseStatus: () => {}, releaseRecord: () => {} }), []);
  const record = (name: string) => setCalls((items) => [...items, name]);
  const navigation: LegalConsentNavigationAdapter = useMemo(() => ({
    navigate: (url) => record(`navigate:${url}`),
    replace: (url) => {
      record(`replace:${url}`);
      if (scenario.endsWith("navigation-throw") && url === "/feed/") throw new Error("fixture navigation failed");
    },
    getCurrentUrl: () => "http://harness.local/login/",
  }), [scenario, revision]);
  const authScenario = scenario.startsWith("login") || scenario.startsWith("register");
  const locale = scenario.includes("-en-") ? "en" : previewLocale;
  const signedIn = !authScenario && scenario !== "consent-signed-out" && scenario !== "callback-no-session";
  const auth: AuthPanelAdapter & LegalConsentAuthAdapter = useMemo(() => ({
    viewState: signedIn ? "signed_in" : "signed_out", userPresent: signedIn,
    getSession: (() => {
      let reads = 0;
      return async () => {
        reads += 1;
        if (scenario === "callback-no-session") { record("sessionMissing"); return null; }
        if (scenario === "consent-auth-failure") throw new Error("fixture session unavailable");
        if (scenario === "consent-submit-auth-failure" && reads > 1) throw new Error("fixture session unavailable");
        if (scenario === "consent-session-loading" || scenario === "callback-delayed-session" || (scenario === "consent-submit-pending" && reads > 1)) {
          if (scenario === "callback-delayed-session") record("sessionPending");
          await new Promise<void>((resolve) => { pending.releaseSession = resolve; });
        }
        if (scenario === "consent-submit-session-missing" && reads > 1) return null;
        return signedIn ? { accessToken: "test-session" } : null;
      };
    })(),
    signInWithPassword: async (input) => {
      authSdkCalls.push("signInWithPassword");
      if (scenario.endsWith("-stale")) return { data: null, error: new Error("captcha_failed") };
      if (scenario.startsWith("login-captcha-")) record(`tokenPresent:${"captchaToken" in input && input.captchaToken === "fixture-token"}`);
      if (scenario.startsWith("login-captcha-required-") && !("captchaToken" in input)) {
        window.setTimeout(() => record("signIn"), 500);
        return { data: null, error: new Error("fixture early rejection") };
      }
      if (scenario === "login-abuse-required") {
        window.setTimeout(() => record("signIn"), 500);
        return { data: null, error: new Error("fixture early rejection") };
      }
      record("signIn");
      return scenario === "login-no-session" ? { data: null, error: null } : scenario === "login-auth-success-consent-failure" ? { data: null, error: new Error("Invalid login credentials") } : { data: { accessToken: "test-session" }, error: null };
    },
    signUp: async (input) => {
      authSdkCalls.push("signUp");
      if (scenario === "register-captcha-prepare-token") record(`tokenPresent:${input.captchaToken === "fixture-token"}`);
      if (scenario === "register-abuse-required") {
        window.setTimeout(() => record("signUp"), 500);
        return { data: null, error: new Error("fixture early rejection") };
      }
      record("signUp");
      if (scenario.endsWith("-stale")) return { data: null, error: new Error("captcha_failed") };
      if (scenario === "register-abuse-duplicate") return { data: null, error: new Error("User already registered") };
      return ["register-email-confirmation-no-session", "register-abuse-initial", "register-abuse-obfuscated", "register-abuse-unconfirmed", "register-captcha-prepare-token"].includes(scenario) ? { data: null, error: null } : { data: { accessToken: "test-session" }, error: null };
    },
    requestPasswordReset: async ({ email, redirectTo, captchaToken }) => {
      authSdkCalls.push("requestPasswordReset");
      if (scenario === "login-reset-prepare-token") record(`tokenPresent:${captchaToken === "fixture-token"}`);
      if (scenario.endsWith("-stale")) return { error: new Error("captcha_failed") };
      if (scenario === "login-abuse-required") {
        window.setTimeout(() => record("resetCallbackSafe:true"), 500);
        return { error: new Error("fixture early rejection") };
      }
      record(`resetCallbackSafe:${email === "qa@example.invalid" && redirectTo === `${window.location.origin}/auth/reset-password/`}`);
      if (scenario === "login-reset-returned-error") return { error: new Error("fixture private provider detail") };
      if (scenario === "login-reset-thrown-error") throw new Error("fixture private provider detail");
      return { error: null };
    },
    signOut: async () => { record("signOut"); return scenario === "consent-logout-failure" ? new Error("fixture logout unavailable") : null; },
  }), [scenario, signedIn, revision]);
  const captchaAdapter = useMemo(() => ({
    acquireToken: async () => {
      record("acquireToken");
      return ["login-captcha-prepare-token", "register-captcha-prepare-token", "login-reset-prepare-token"].includes(scenario) ? "fixture-token" : null;
    },
    reset: () => record("resetToken"),
  }), [scenario, revision]);
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
        const current = ["consent-already-current", "callback-current-consent", "callback-self-next", "consent-delayed-current", "consent-retry-success", "consent-external-next", "consent-encoded-external-next", "consent-self-loop-next", "consent-current-navigation-throw", "consent-current-navigation-stall"].includes(scenario);
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
  const callbackCodeExchange = useMemo(() => async () => { record("callbackExchange"); return { error: new Error("private provider detail") }; }, [revision, scenario]);
  const content = recoveryScenario ? <ResetPasswordForm key={revision} locale={locale} recoveryAdapter={recovery.adapter} />
    : scenario.startsWith("consent") ? <LegalConsentPage key={revision} locale={locale} authAdapter={auth} consentAdapter={consent} navigationAdapter={navigation} next={next} reason={scenario === "consent-outdated-bundle" ? "policy-update" : scenario === "consent-callback-success" ? "callback" : undefined} />
    : authScenario ? <AuthPanel key={revision} locale={locale} authAdapter={auth} consentAdapter={consent} navigationAdapter={navigation} initialMode={scenario.startsWith("register") ? "signup" : "login"} next="/feed/" {...(scenario.includes("-abuse-") || scenario.includes("-captcha-") || scenario.includes("-stale") || scenario === "login-reset-prepare-token" ? { captchaMode: scenario.includes("-required") ? "required" : scenario.includes("-prepare") ? "prepare" : "off" } : {})} {...(scenario.startsWith("login-captcha-") || scenario === "register-captcha-prepare-token" || scenario === "login-reset-prepare-token" ? { authTurnstileSiteKey: ["login-captcha-off", "login-captcha-required-widget", "login-captcha-prepare-script-failed"].includes(scenario) ? "fixture-sitekey" : undefined, captchaAdapter: ["login-captcha-prepare-token", "login-captcha-required-error", "login-captcha-required-expired", "register-captcha-prepare-token", "login-reset-prepare-token"].includes(scenario) ? captchaAdapter : undefined } : {})} />
    : <AuthCallback key={revision} locale={locale} authAdapter={auth} consentAdapter={consent} navigationAdapter={navigation} codeExchange={scenario === "callback-failed-code" ? callbackCodeExchange : undefined} next={scenario === "callback-external-next-rejected" ? "https://example.invalid" : scenario === "callback-self-next" ? "/auth/callback/?next=%2Ffeed%2F" : "/feed/"} />;
  const showRecovery = (suffix: string, early = false) => {
    authSdkCalls.length = 0;
    window.history.replaceState(null, "", `/${suffix}`);
    setRecoveryBeforeMount(early);
    setRecoveryAttempt((value) => value + 1);
    setRecoveryScenario(true);
    setCalls([]);
    setRevision((value) => value + 1);
  };
  return <main className="legal-harness">
    <nav aria-label="Visual test state">
      {[...LEGAL_CONSENT_STATE_MATRIX.map(({ id }) => id), ...additionalCases, "login-no-session", "callback-no-session"].map((id) => <button key={id} type="button" onClick={() => { authSdkCalls.length = 0; setRecoveryScenario(false); setCalls([]); setScenario(id); setRevision((value) => value + 1); }}>{id}</button>)}
      <button type="button" onClick={() => { setPreviewLocale("en"); setRevision((value) => value + 1); }}>locale-en</button>
      <button type="button" onClick={() => { setPreviewLocale("zh-CN"); setRevision((value) => value + 1); }}>locale-zh</button>
      <button onClick={() => pending.releaseSession()}>release-session</button>
      <button onClick={() => pending.releaseStatus()}>release-status</button>
      <button onClick={() => pending.releaseRecord()}>release-record</button>
      <button onClick={() => showRecovery("?code=fixture-code")}>Recovery with code</button>
      <button onClick={() => showRecovery("")}>Recovery without code</button>
      <button onClick={() => showRecovery("", true)}>Recovery event before mount</button>
      <button onClick={() => showRecovery("?code=failed")}>Recovery failed code</button>
      <button onClick={() => showRecovery("?code=pending")}>Recovery pending code</button>
      <button onClick={() => showRecovery("?code=signup")}>Recovery non-recovery code</button>
      <button onClick={() => showRecovery("?code=flow&sb_flow_id=00000000-0000-4000-8000-000000000001")}>Recovery flow id</button>
      <button onClick={() => showRecovery("?error=private-provider-detail#error_description=private-provider-detail")}>Recovery provider error</button>
      <button onClick={() => recovery.emit()}>Emit recovery session</button>
      <button onClick={() => recovery.complete()}>Complete pending recovery</button>
      <button onClick={() => { setRecoveryScenario(false); setScenario("login-unchecked"); }}>Unmount recovery</button>
      <button onClick={() => { setRecoveryScenario(true); setRevision((value) => value + 1); }}>Mount recovery</button>
      <button onClick={() => { setRecoveryBeforeMount(false); setRevision((value) => value + 1); }}>Remount recovery</button>
    </nav>
    <div className="legal-harness__surface">{content}</div>
    <output aria-live="polite">{calls.join(",")}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
