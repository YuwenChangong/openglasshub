import { useEffect, useMemo, useRef, useState } from "react";
import { getSafeConsentNext } from "../../lib/legal-consent-navigation";
import { getLegalConsentStatus, LegalConsentClientError, recordLegalConsent, type LegalConsentStatus } from "../../lib/legal-consent-client";
import { LEGAL_POLICY } from "../../lib/legal-policy";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { browserNavigationAdapter, type LegalConsentAdapter, type LegalConsentAuthAdapter, type LegalConsentNavigationAdapter } from "../../lib/legal-consent-adapters";

type PageState = "loading" | "signed_out" | "needs_consent" | "redirecting" | "error";
const REQUEST_TIMEOUT_MS = 8000;

function sourceForReason(reason: string | null) {
  if (reason === "callback") return "authenticated_callback" as const;
  if (reason === "policy-update") return "policy_update" as const;
  return "legacy_account_gate" as const;
}

function messageForError(error: unknown) {
  if (error instanceof LegalConsentClientError) {
    if (error.code === "UNAUTHORIZED") return "登录状态已失效，请重新登录后继续。";
    if (error.code === "RATE_LIMITED") return "操作过于频繁，请稍后再试。";
  }
  return "暂时无法记录政策确认。请稍后重试，或退出后重新登录。";
}

export default function LegalConsentPage({ next, reason, authAdapter, consentAdapter, navigationAdapter }: { next?: string; reason?: string; authAdapter?: LegalConsentAuthAdapter; consentAdapter?: LegalConsentAdapter; navigationAdapter?: LegalConsentNavigationAdapter }) {
  const supabase = useMemo(() => authAdapter ? null : createBrowserSupabaseClient(), [authAdapter]);
  const navigation = useMemo(() => navigationAdapter ?? browserNavigationAdapter(), [navigationAdapter]);
  const safeNext = useMemo(() => getSafeConsentNext(next ?? (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("next"))), [next]);
  const consentReturn = `/legal-consent/?next=${encodeURIComponent(safeNext)}`;
  const loginHref = `/login/?next=${encodeURIComponent(consentReturn)}`;
  const [state, setState] = useState<PageState>("loading");
  const [status, setStatus] = useState<LegalConsentStatus | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lifecycle = useRef({ mounted: false, sequence: 0, locked: false, replaced: false, timers: new Set<ReturnType<typeof setTimeout>>() });

  function beginRequest() {
    const request = ++lifecycle.current.sequence;
    const active = () => lifecycle.current.mounted && lifecycle.current.sequence === request && !lifecycle.current.replaced;
    const timer = setTimeout(() => {
      lifecycle.current.timers.delete(timer);
      if (!active()) return;
      lifecycle.current.sequence += 1;
      lifecycle.current.locked = false;
      setBusy(false);
      setError("检查或记录政策确认超时，请重试或退出后重新登录。");
      setState("error");
    }, REQUEST_TIMEOUT_MS);
    lifecycle.current.timers.add(timer);
    return { active, finish: () => { clearTimeout(timer); lifecycle.current.timers.delete(timer); } };
  }

  async function getSession() {
    if (authAdapter) return authAdapter.getSession();
    if (!supabase) return null;
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    return data.session ? { accessToken: data.session.access_token } : null;
  }

  function replaceOnce(url: string) {
    if (!lifecycle.current.mounted || lifecycle.current.replaced) return;
    lifecycle.current.replaced = true;
    setState("redirecting");
    navigation.replace(url);
  }

  function showFailure(failure: unknown, loading: boolean) {
    setError(messageForError(failure));
    if (failure instanceof LegalConsentClientError && failure.code === "UNAUTHORIZED") setState("signed_out");
    else if (loading) setState("error");
  }

  async function loadStatus() {
    if (lifecycle.current.locked || lifecycle.current.replaced) return;
    if (!supabase && !authAdapter) {
      setState("error");
      setError("登录服务暂不可用，请稍后重试。");
      return;
    }
    setState("loading");
    setError("");
    setAcknowledged(false);
    const request = beginRequest();
    try {
      const session = await getSession();
      if (!request.active()) return;
      const token = session?.accessToken;
      if (!token) { setState("signed_out"); return; }
      const nextStatus = consentAdapter ? await consentAdapter.getCurrentConsent(token) : await getLegalConsentStatus(token);
      if (!request.active()) return;
      setStatus(nextStatus);
      if (nextStatus.current) replaceOnce(safeNext);
      else setState("needs_consent");
    } catch (loadError) {
      if (request.active()) showFailure(loadError, true);
    } finally { request.finish(); }
  }

  useEffect(() => {
    lifecycle.current.mounted = true;
    lifecycle.current.replaced = false;
    lifecycle.current.locked = false;
    setBusy(false);
    void loadStatus();
    return () => {
      lifecycle.current.mounted = false;
      lifecycle.current.sequence += 1;
      for (const timer of lifecycle.current.timers) clearTimeout(timer);
      lifecycle.current.timers.clear();
    };
  }, [supabase, authAdapter, consentAdapter, navigation, safeNext]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state !== "needs_consent" || lifecycle.current.locked || lifecycle.current.replaced) return;
    if (!acknowledged) {
      setError(`请确认您已年满 ${LEGAL_POLICY.minimumAge} 周岁，并阅读相关政策后继续。`);
      return;
    }
    if (!supabase && !authAdapter) return;
    lifecycle.current.locked = true;
    setBusy(true);
    setError("");
    const request = beginRequest();
    try {
      const session = await getSession();
      if (!request.active()) return;
      const token = session?.accessToken;
      if (!token) { setState("signed_out"); return; }
      const nextStatus = consentAdapter ? await consentAdapter.recordCurrentConsent({ accessToken: token, source: sourceForReason(reason ?? null) }) : await recordLegalConsent({ accessToken: token, source: sourceForReason(reason ?? null) });
      if (!request.active()) return;
      if (!nextStatus.current) throw new LegalConsentClientError("INVALID_RESPONSE");
      setStatus(nextStatus);
      replaceOnce(safeNext);
    } catch (submitError) {
      if (request.active()) showFailure(submitError, false);
    } finally {
      request.finish();
      if (request.active()) { lifecycle.current.locked = false; setBusy(false); }
    }
  }

  async function signOut() {
    if ((!supabase && !authAdapter) || lifecycle.current.locked || lifecycle.current.replaced) return;
    lifecycle.current.locked = true;
    setBusy(true);
    const request = beginRequest();
    try {
      const result = authAdapter ? await authAdapter.signOut?.() : (await supabase!.auth.signOut()).error;
      if (!request.active()) return;
      if (result || (authAdapter && !authAdapter.signOut)) throw result ?? new Error("Sign out unavailable");
      replaceOnce(loginHref);
    } catch (logoutError) {
      if (request.active()) showFailure(logoutError, true);
    } finally {
      request.finish();
      if (request.active()) { lifecycle.current.locked = false; setBusy(false); }
    }
  }

  if (state === "loading" || state === "redirecting") return <section className="auth-card"><div className="auth-alert" role="status">{state === "loading" ? "正在检查政策确认状态..." : "正在前往目标页面..."}</div></section>;
  if (state === "signed_out") return <section className="auth-card"><div className="auth-alert">{error || "登录后才能记录政策确认。"}</div><a className="community-button auth-button" href={loginHref}>前往登录</a></section>;
  if (state === "error") return <section className="auth-card"><div className="auth-alert auth-alert--error" role="alert">{error}</div><div className="community-cta-row"><button type="button" className="community-button auth-button" onClick={() => void loadStatus()}>重试</button><button type="button" className="community-button--secondary auth-button" onClick={() => void signOut()} disabled={busy}>退出登录</button></div></section>;

  return <section className="auth-card"><div className="auth-card__top"><h1>政策确认</h1><p>请确认已满 {status?.minimumAge ?? LEGAL_POLICY.minimumAge} 周岁，并完成当前政策确认。</p></div><form className="auth-form" onSubmit={submit}><div className="auth-legal-acknowledgement"><input id="legal-consent-acknowledgement" type="checkbox" checked={acknowledged} onChange={(event) => { setAcknowledged(event.target.checked); if (event.target.checked) setError(""); }} aria-invalid={error ? true : undefined} aria-describedby={error ? "legal-consent-error" : undefined} /><label htmlFor="legal-consent-acknowledgement">我确认已年满 {LEGAL_POLICY.minimumAge} 周岁，并已阅读并同意 <a href={LEGAL_POLICY.routes.terms} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>《服务条款》</a> 和 <a href={LEGAL_POLICY.routes.guidelines} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>《社区准则》</a>，且已阅读并知悉 <a href={LEGAL_POLICY.routes.privacy} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>《隐私政策》</a>。</label></div>{error ? <div id="legal-consent-error" className="auth-alert auth-alert--error" role="alert">{error}</div> : null}<div className="community-cta-row"><button className="community-button auth-button" type="submit" disabled={busy}>{busy ? "正在记录确认..." : "确认并继续"}</button><button className="community-button--secondary auth-button" type="button" onClick={() => void signOut()} disabled={busy}>退出登录</button></div></form></section>;
}
