import { useState } from "react";
import { getSafeNext } from "../../lib/auth-redirect";
import { LEGAL_POLICY } from "../../lib/legal-policy";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

type Props = { email: string; next: string; onConfirmed?: (next: string) => void };

export default function SignupConfirmation({ email, next, onConfirmed }: Props) {
  const [code, setCode] = useState("");
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!acceptedPolicies || !/^\d{6}$/.test(code) || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/signup-confirm", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email, code, acceptedPolicies: true,
          policyVersions: {
            bundle: LEGAL_POLICY.bundleVersion, terms: LEGAL_POLICY.termsVersion,
            privacy: LEGAL_POLICY.privacyVersion, guidelines: LEGAL_POLICY.guidelinesVersion,
          },
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.access_token !== "string" || typeof result?.refresh_token !== "string") {
        throw new Error("CONFIRMATION_FAILED");
      }
      const supabase = createBrowserSupabaseClient();
      if (!supabase) throw new Error("SESSION_UNAVAILABLE");
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: result.access_token, refresh_token: result.refresh_token,
      });
      if (sessionError) throw sessionError;
      const destination = getSafeNext(next);
      if (onConfirmed) onConfirmed(destination);
      else window.location.assign(destination);
    } catch {
      setError("验证失败或验证码已失效。请检查最新邮件后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={confirm}>
      <label>
        <span className="auth-label">邮箱验证码</span>
        <input className="community-input" type="text" inputMode="numeric" autoComplete="one-time-code"
          pattern="[0-9]{6}" maxLength={6} value={code} required
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
      </label>
      <div className="auth-legal-acknowledgement">
        <input id="signup-confirm-policy" type="checkbox" checked={acceptedPolicies}
          onChange={(event) => setAcceptedPolicies(event.target.checked)} required />
        <label htmlFor="signup-confirm-policy">
          我已阅读并同意 <a href={LEGAL_POLICY.routes.terms} target="_blank" rel="noopener noreferrer">服务条款</a>（{LEGAL_POLICY.termsVersion}）、
          <a href={LEGAL_POLICY.routes.guidelines} target="_blank" rel="noopener noreferrer">社区准则</a>（{LEGAL_POLICY.guidelinesVersion}），
          并已阅读 <a href={LEGAL_POLICY.routes.privacy} target="_blank" rel="noopener noreferrer">隐私政策</a>（{LEGAL_POLICY.privacyVersion}）。
        </label>
      </div>
      <button className="community-button auth-button" type="submit" disabled={busy || !acceptedPolicies || code.length !== 6}>
        {busy ? "验证中..." : "确认邮箱"}
      </button>
      {error ? <div className="auth-alert auth-alert--error" role="alert">{error}</div> : null}
    </form>
  );
}
