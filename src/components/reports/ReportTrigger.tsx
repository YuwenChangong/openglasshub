import { useEffect, useMemo, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

type ReportTargetType = "post" | "comment" | "circle" | "user";

type ReportTriggerProps = {
  targetType: ReportTargetType;
  targetId: string;
  buttonLabel?: string;
  loginHref?: string;
  className?: string;
  compact?: boolean;
};

type SessionState = {
  accessToken: string;
  userId: string;
};

const REPORT_REASONS = [
  { code: "spam", label: "垃圾广告" },
  { code: "harassment", label: "骚扰或攻击" },
  { code: "hate", label: "仇恨内容" },
  { code: "sexual", label: "性相关违规" },
  { code: "violence", label: "暴力或威胁" },
  { code: "illegal", label: "违法内容" },
  { code: "off_platform_contact", label: "站外引流" },
  { code: "misinformation", label: "虚假或误导信息" },
  { code: "privacy", label: "隐私泄露" },
  { code: "other", label: "其他" },
] as const;

function mapApiError(error: string) {
  switch (error) {
    case "INVALID_REPORT_TARGET_TYPE":
    case "INVALID_REPORT_TARGET_ID":
    case "INVALID_REPORT_REASON_CODE":
    case "INVALID_REPORT_REASON_TEXT":
      return "举报信息无效，请检查后重试。";
    case "REPORT_TARGET_NOT_FOUND":
      return "该内容已不可见，无需重复举报。";
    case "RATE_LIMITED":
      return "提交过于频繁，请稍后再试。";
    default:
      return error;
  }
}

export default function ReportTrigger({
  targetType,
  targetId,
  buttonLabel = "举报",
  loginHref,
  className,
  compact = false,
}: ReportTriggerProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [session, setSession] = useState<SessionState | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string>(REPORT_REASONS[0].code);
  const [reasonText, setReasonText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    const syncSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      const token = data.session?.access_token;
      const userId = data.session?.user?.id;
      if (token && userId) {
        setSession({ accessToken: token, userId });
      } else {
        setSession(null);
      }
      setSessionResolved(true);
    };

    void syncSession();
    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      void syncSession();
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [supabase]);

  const resolvedLoginHref = loginHref ?? buildLoginHref(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/feed/");

  function closeModal() {
    if (loading) return;
    setOpen(false);
    setError("");
    setSuccess("");
    setReasonText("");
    setSelectedReason(REPORT_REASONS[0].code);
  }

  async function handleSubmit() {
    if (!session) {
      setError("请先登录后再举报。");
      return;
    }

    const trimmed = reasonText.trim();
    if (trimmed && trimmed.length < 5) {
      setError("补充说明至少需要 5 个字。");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/forum/reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          target_type: targetType,
          target_id: targetId,
          reason_code: selectedReason,
          reason_text: trimmed || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; duplicate?: boolean; already_handled?: boolean }
        | null;
      if (!response.ok) {
        throw new Error(mapApiError(payload?.error ?? `举报失败 (${response.status})`));
      }

      if (payload?.already_handled) {
        setSuccess("该内容已在处理或已不可见，无需重复举报。");
      } else if (payload?.duplicate) {
        setSuccess("你最近已经举报过这条内容，管理员会统一处理。");
      } else {
        setSuccess("已成功提交举报，管理员会尽快处理。");
      }

      window.setTimeout(() => {
        setOpen(false);
        setSuccess("");
      }, 1400);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "举报失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={className ?? `community-action-button${compact ? " community-action-button--compact" : ""}`}
        onClick={() => {
          setError("");
          setSuccess("");
          setOpen(true);
        }}
        disabled={!sessionResolved || loading}
      >
        {buttonLabel}
      </button>

      {open ? (
        <div className="glass-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={`report-title-${targetType}-${targetId}`}>
          <div className="glass-modal">
            <div className="glass-modal__header">
              <h3 id={`report-title-${targetType}-${targetId}`}>举报内容</h3>
              <p>
                选择举报原因并补充说明，提交后管理员会查看。
              </p>
            </div>
            <div className="glass-modal__body">
              {session ? (
                <>
                  <div className="glass-choice-grid">
                    {REPORT_REASONS.map((reason) => (
                      <button
                        key={reason.code}
                        type="button"
                        className={`glass-choice${selectedReason === reason.code ? " is-selected" : ""}`}
                        onClick={() => setSelectedReason(reason.code)}
                        disabled={loading}
                      >
                        {reason.label}
                      </button>
                    ))}
                  </div>
                  <label>
                    <span className="community-meta" style={{ display: "inline-block", marginBottom: "0.45rem" }}>
                      补充说明
                    </span>
                    <textarea
                      className="glass-textarea"
                      placeholder="可选，补充更多细节帮助管理员判断"
                      value={reasonText}
                      onChange={(event) => setReasonText(event.target.value)}
                      maxLength={1000}
                      disabled={loading}
                    />
                  </label>
                  <span className="community-meta">可不填写；如填写，至少 5 个字。</span>
                  {success ? <span className="report-success-message">{success}</span> : null}
                </>
              ) : (
                <div className="report-login-cta">
                  <p>当前需要登录后才能提交举报。登录后会返回当前页面。</p>
                  <a href={resolvedLoginHref} className="community-button">
                    去登录
                  </a>
                </div>
              )}
              {error ? <span className="inline-error">{error}</span> : null}
            </div>
            <div className="glass-modal__actions">
              <button
                type="button"
                className="community-button--secondary"
                onClick={closeModal}
                disabled={loading}
              >
                取消
              </button>
              {session ? (
                <button
                  type="button"
                  className="community-button"
                  onClick={() => void handleSubmit()}
                  disabled={loading}
                >
                  {loading ? "提交中..." : "提交举报"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
