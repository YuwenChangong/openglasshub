import { useEffect, useMemo, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { resolveLocale, type LocaleContext } from "../../lib/i18n/locale";
import { getUiMessages } from "../../lib/i18n/catalog";
import { useLocale } from "../i18n/useLocale";
type CommunityMessages = ReturnType<typeof getUiMessages>["community"];

type ReportTargetType = "post" | "comment" | "circle" | "user";

type ReportTriggerProps = {
  localeContext?: LocaleContext;
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
  { code: "spam" },
  { code: "harassment" },
  { code: "hate" },
  { code: "sexual" },
  { code: "violence" },
  { code: "illegal" },
  { code: "off_platform_contact" },
  { code: "misinformation" },
  { code: "privacy" },
  { code: "other" },
] as const;

function mapApiError(error: string, text: CommunityMessages) {
  switch (error) {
    case "INVALID_REPORT_TARGET_TYPE":
    case "INVALID_REPORT_TARGET_ID":
    case "INVALID_REPORT_REASON_CODE":
    case "INVALID_REPORT_REASON_TEXT":
      return text.reportInvalid;
    case "REPORT_TARGET_NOT_FOUND":
      return text.reportGone;
    case "RATE_LIMITED":
      return text.reportRateLimited;
    default:
      return error;
  }
}

export default function ReportTrigger({
  targetType,
  targetId,
  buttonLabel,
  loginHref,
  className,
  compact = false,
  localeContext = resolveLocale({ acceptLanguage: "zh-CN" }),
}: ReportTriggerProps) {
  const { messages } = useLocale(localeContext);
  const text = messages.community;
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
      setError(text.loginReport);
      return;
    }

    const trimmed = reasonText.trim();
    if (trimmed && trimmed.length < 5) {
      setError(text.reportReasonShort);
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
        throw new Error(mapApiError(payload?.error ?? `${text.reportFailed} (${response.status})`, text));
      }

      if (payload?.already_handled) {
        setSuccess(text.reportHandled);
      } else if (payload?.duplicate) {
        setSuccess(text.reportDuplicate);
      } else {
        setSuccess(text.reportSuccess);
      }

      window.setTimeout(() => {
        setOpen(false);
        setSuccess("");
      }, 1400);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : text.reportFailed);
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
        {buttonLabel ?? text.report}
      </button>

      {open ? (
        <div className="glass-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={`report-title-${targetType}-${targetId}`}>
          <div className="glass-modal">
            <div className="glass-modal__header">
              <h3 id={`report-title-${targetType}-${targetId}`}>{text.reportContent}</h3>
              <p>
                {text.reportIntro}
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
                        {text.reportReasons[reason.code]}
                      </button>
                    ))}
                  </div>
                  <label>
                    <span className="community-meta" style={{ display: "inline-block", marginBottom: "0.45rem" }}>
                      {text.reportDetails}
                    </span>
                    <textarea
                      className="glass-textarea"
                      placeholder={text.reportDetailsPlaceholder}
                      value={reasonText}
                      onChange={(event) => setReasonText(event.target.value)}
                      maxLength={1000}
                      disabled={loading}
                    />
                  </label>
                  <span className="community-meta">{text.reportDetailsHint}</span>
                  {success ? <span className="report-success-message">{success}</span> : null}
                </>
              ) : (
                <div className="report-login-cta">
                  <p>{text.reportLoginHint}</p>
                  <a href={resolvedLoginHref} className="community-button">
                    {text.goLogin}
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
                {text.cancel}
              </button>
              {session ? (
                <button
                  type="button"
                  className="community-button"
                  onClick={() => void handleSubmit()}
                  disabled={loading}
                >
                  {loading ? text.submitting : text.submitReport}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
