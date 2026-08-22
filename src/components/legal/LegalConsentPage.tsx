import { useEffect, useMemo, useState } from "react";
import { getSafeNext } from "../../lib/auth-redirect";
import { getLegalConsentStatus, LegalConsentClientError, recordLegalConsent, type LegalConsentStatus } from "../../lib/legal-consent-client";
import { LEGAL_POLICY } from "../../lib/legal-policy";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { browserNavigationAdapter, type LegalConsentAdapter, type LegalConsentAuthAdapter, type LegalConsentNavigationAdapter } from "../../lib/legal-consent-adapters";

type PageState = "loading" | "signed_out" | "needs_consent" | "current" | "error";
function sourceForReason(reason: string | null) { return reason === "callback" ? "authenticated_callback" as const : reason === "policy-update" ? "policy_update" as const : "legacy_account_gate" as const; }
function messageForError(error: unknown) { return error instanceof LegalConsentClientError && error.code === "UNAUTHORIZED" ? "登录状态已失效，请重新登录后继续。" : error instanceof LegalConsentClientError && error.code === "RATE_LIMITED" ? "操作过于频繁，请稍后再试。" : "暂时无法记录政策确认。请稍后重试，或退出后重新登录。"; }

export default function LegalConsentPage({ next, reason, authAdapter, consentAdapter, navigationAdapter }: { next?: string; reason?: string; authAdapter?: LegalConsentAuthAdapter; consentAdapter?: LegalConsentAdapter; navigationAdapter?: LegalConsentNavigationAdapter }) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const navigation = useMemo(() => navigationAdapter ?? browserNavigationAdapter(), [navigationAdapter]);
  const safeNext = useMemo(() => getSafeNext(next ?? (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("next")), "/feed/"), [next]);
  const [state, setState] = useState<PageState>("loading"); const [status, setStatus] = useState<LegalConsentStatus | null>(null); const [acknowledged, setAcknowledged] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function session() { return authAdapter ? await authAdapter.getSession() : (await supabase!.auth.getSession()).data.session ? { accessToken: (await supabase!.auth.getSession()).data.session!.access_token } : null; }
  async function loadStatus() {
    if (!supabase && !authAdapter) { setState("error"); setError("登录服务暂不可用，请稍后重试。"); return; }
    setState("loading"); setError(""); const current = await session();
    if (!current?.accessToken) { setState("signed_out"); return; }
    try { const nextStatus = consentAdapter ? await consentAdapter.getCurrentConsent(current.accessToken) : await getLegalConsentStatus(current.accessToken); setStatus(nextStatus); setState(nextStatus.current ? "current" : "needs_consent"); } catch (loadError) { setState("error"); setError(messageForError(loadError)); }
  }
  useEffect(() => { void loadStatus(); }, [supabase, authAdapter, consentAdapter]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!acknowledged) { setError("请确认您已阅读并同意相关政策后继续。"); return; } if ((!supabase && !authAdapter) || busy) return;
    const current = await session(); if (!current?.accessToken) { setState("signed_out"); return; } setBusy(true); setError("");
    try { const nextStatus = consentAdapter ? await consentAdapter.recordCurrentConsent({ accessToken: current.accessToken, source: sourceForReason(reason ?? null) }) : await recordLegalConsent({ accessToken: current.accessToken, source: sourceForReason(reason ?? null) }); setStatus(nextStatus); setState("current"); navigation.navigate(safeNext); } catch (submitError) { setError(messageForError(submitError)); } finally { setBusy(false); }
  }
  async function signOut() { if (!supabase && !authAdapter) return; setBusy(true); if (authAdapter?.signOut) await authAdapter.signOut(); else await supabase!.auth.signOut(); navigation.navigate(`/login/?next=${encodeURIComponent("/legal-consent/")}`); }
  if (state === "loading") return <section className="auth-card"><div className="auth-alert" role="status">正在检查政策确认状态...</div></section>;
  if (state === "signed_out") return <section className="auth-card"><div className="auth-alert">登录后才能记录政策确认。</div><a className="community-button auth-button" href={`/login/?next=${encodeURIComponent("/legal-consent/")}`}>前往登录</a></section>;
  if (state === "error") return <section className="auth-card"><div className="auth-alert auth-alert--error" role="alert">{error}</div><div className="community-cta-row"><button type="button" className="community-button auth-button" onClick={() => void loadStatus()}>重试</button><button type="button" className="community-button--secondary auth-button" onClick={() => void signOut()} disabled={busy}>退出登录</button></div></section>;
  if (state === "current") return <section className="auth-card"><div className="auth-alert auth-alert--success" role="status">当前政策版本已确认。</div><a className="community-button auth-button" href={safeNext}>继续前往</a></section>;
  return <section className="auth-card"><div className="auth-card__top"><h1>政策确认</h1><p>请完成当前政策确认。</p></div><form className="auth-form" onSubmit={submit}><div className="auth-legal-acknowledgement"><input id="legal-consent-acknowledgement" type="checkbox" checked={acknowledged} onChange={(event) => { setAcknowledged(event.target.checked); if (event.target.checked) setError(""); }} aria-invalid={error ? true : undefined} aria-describedby={error ? "legal-consent-error" : undefined} /><label htmlFor="legal-consent-acknowledgement">我已阅读并同意 <a href={LEGAL_POLICY.routes.terms} target="_blank" rel="noopener noreferrer">《服务条款》</a>、<a href={LEGAL_POLICY.routes.guidelines} target="_blank" rel="noopener noreferrer">《社区准则》</a>，并已阅读 <a href={LEGAL_POLICY.routes.privacy} target="_blank" rel="noopener noreferrer">《隐私政策》</a>。</label></div>{error ? <div id="legal-consent-error" className="auth-alert auth-alert--error" role="alert">{error}</div> : null}<div className="community-cta-row"><button className="community-button auth-button" type="submit" disabled={busy}>{busy ? "正在记录确认..." : "确认并继续"}</button><button className="community-button--secondary auth-button" type="button" onClick={() => void signOut()} disabled={busy}>退出登录</button></div></form></section>;
}
