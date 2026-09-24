import { useEffect, useState } from "react";
import { getSafeNext } from "../../lib/auth-redirect";

type ChallengeReply = { status?: string; challengeId?: string; error?: string };
type Props = {
  next: string;
  initialChallengeId: string | null;
  getAccessToken: () => Promise<string | null>;
  onVerified: (next: string) => void;
  onUsePassword: () => void;
};

const messages: Record<string, string> = {
  CHALLENGE_INVALID: "验证码错误，请检查后重试。",
  CHALLENGE_EXPIRED: "验证码已过期，请重新发送。",
  CHALLENGE_SUPERSEDED: "请使用最新邮件中的验证码。",
  CHALLENGE_EXHAUSTED: "尝试次数已用尽，请重新发送。",
  RESEND_COOLDOWN: "请稍后再重新发送。",
  EMAIL_BUDGET_EXHAUSTED: "今日发送次数已达上限，请明天再试。",
  SESSION_GONE: "会话已失效，请重新输入密码登录。",
};

export default function LoginVerification({ next, initialChallengeId, getAccessToken, onVerified, onUsePassword }: Props) {
  const [challengeId, setChallengeId] = useState(initialChallengeId);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(initialChallengeId ? "验证码已发送，请检查邮箱。" : "如已收到验证码，请稍后重新发送以获取新的验证码。");
  const [resendAfter, setResendAfter] = useState(initialChallengeId ? Date.now() + 60_000 : 0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (resendAfter <= now) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendAfter, now]);

  async function request(path: string, body: object): Promise<ChallengeReply> {
    const token = await getAccessToken();
    if (!token) throw new Error("SESSION_GONE");
    const response = await fetch(path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null) as ChallengeReply | null;
    if (!response.ok || !result) throw new Error(result?.error || "VERIFICATION_SERVICE_UNAVAILABLE");
    return result;
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !challengeId || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setError("");
    try {
      const result = await request("/api/auth/login-challenge/verify", { challengeId, code, next: getSafeNext(next) });
      if (result.status !== "VERIFIED") throw new Error("VERIFICATION_SERVICE_UNAVAILABLE");
      onVerified(getSafeNext(next));
    } catch (failure) {
      const key = failure instanceof Error ? failure.message : "";
      setError(messages[key] || "验证暂不可用，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (busy || Date.now() < resendAfter) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await request("/api/auth/login-challenge/resend", { next: getSafeNext(next) });
      if (result.status === "SENT" && result.challengeId) {
        setChallengeId(result.challengeId);
        setCode("");
        setResendAfter(Date.now() + 60_000);
        setNow(Date.now());
        setMessage("新验证码已发送，请使用最新邮件中的验证码。");
      } else if (result.status === "PENDING") {
        setMessage("验证码发送仍在处理中，请稍后再试。");
      } else throw new Error("VERIFICATION_SERVICE_UNAVAILABLE");
    } catch (failure) {
      const key = failure instanceof Error ? failure.message : "";
      setError(messages[key] || "暂时无法重新发送验证码，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-form">
      <div className="auth-alert">{message || "请输入登录验证码。"}</div>
      <form className="auth-form" onSubmit={verify}>
        <label>
          <span className="auth-label">登录验证码</span>
          <input className="community-input" type="text" inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]{6}" maxLength={6} value={code} required
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
        </label>
        <div className="community-cta-row">
          <button className="community-button auth-button" type="submit" disabled={busy || !challengeId || code.length !== 6}>
            {busy ? "验证中..." : "验证并继续"}
          </button>
          <button className="community-button--secondary auth-button" type="button" onClick={resend}
            disabled={busy || now < resendAfter}>重新发送验证码</button>
        </div>
      </form>
      <button className="auth-forgot-link" type="button" onClick={onUsePassword} disabled={busy}>使用密码重新登录</button>
      {error ? <div className="auth-alert auth-alert--error" role="alert">{error}</div> : null}
    </div>
  );
}
