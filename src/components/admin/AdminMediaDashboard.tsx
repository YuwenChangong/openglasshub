import { resolveLocale, type LocaleContext } from "../../lib/i18n/locale";
import { getUiMessages, formatUiMessage } from "../../lib/i18n/catalog";
import { localizeAdminSessionMessage } from "../../lib/i18n/messages/admin";
import { useLocale } from "../i18n/useLocale";
import { useEffect, useState } from "react";
import { AdminApiError, adminFetch } from "../../lib/admin-api-client";
import { useAdminSession } from "./useAdminSession";

type AdminMedia = {
  id: string;
  post_id: string | null;
  user_id: string | null;
  kind: string;
  size_bytes: number | null;
  mime_type: string | null;
  storage_path: string | null;
  url: string | null;
  created_at: string;
  is_bound_to_post: boolean;
  post_status: string | null;
  post_title: string | null;
  uploader_profile: {
    id: string;
    display_name?: string | null;
    username?: string | null;
  } | null;
};

type Filter = "all" | "video" | "large" | "unbound" | "recent";
type DataState = "idle" | "loading" | "ready" | "error";

type MediaPayload = {
  media?: AdminMedia[];
};

type MediaDeletePayload = {
  ok?: boolean;
  id?: string;
  warnings?: unknown;
};

export default function AdminMediaDashboard({ localeContext = resolveLocale({ acceptLanguage: "zh-CN" }) }: { localeContext?: LocaleContext } = {}) {
  const { context } = useLocale(localeContext);
  const locale = context.locale;
  const text = getUiMessages(locale).admin;
  function bytesLabel(bytes: number | null): string {
    const value = Number(bytes ?? 0);
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let current = value;
    let idx = 0;
    while (current >= 1024 && idx < units.length - 1) {
      current /= 1024;
      idx += 1;
    }
    return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[idx]}`;
  }

  function shortId(id: string | null | undefined): string {
    if (!id) return "-";
    return `${id.slice(0, 8)}...`;
  }

  function uploaderLabel(item: AdminMedia): string {
    return item.uploader_profile?.display_name || item.uploader_profile?.username || text.copy.unknownUser;
  }

  const adminSession = useAdminSession();
  const [filter, setFilter] = useState<Filter>("all");
  const [dataState, setDataState] = useState<DataState>("idle");
  const [error, setError] = useState("");
  const [items, setItems] = useState<AdminMedia[]>([]);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (adminSession.state.status !== "ready" || !adminSession.session) return;
    let cancelled = false;

    const loadMedia = async () => {
      setDataState("loading");
      setError("");
      try {
        const query = new URLSearchParams({ limit: "120" });
        if (filter === "video") query.set("kind", "video");
        if (filter === "large") query.set("large", "1");
        if (filter === "unbound") query.set("unbound", "1");
        if (filter === "recent") query.set("recent", "24h");

        const payload = await adminFetch<MediaPayload>(`/api/admin/forum/media?${query.toString()}`, {
          method: "GET",
          session: adminSession.session,
        });
        if (cancelled) return;
        setItems(payload.media ?? []);
        setDataState("ready");
      } catch (requestError) {
        if (cancelled) return;
        if (requestError instanceof AdminApiError && requestError.status === 401) {
          adminSession.setState({
            status: "signed_out",
            message: text.copy.yourSessionExpiredSignInAgain,
            details: `api status code: 401 | error message: ${requestError.message}`,
          });
          return;
        }
        if (requestError instanceof AdminApiError && requestError.status === 403) {
          adminSession.setState({
            status: "forbidden",
            message: text.copy.thisAccountDoesNotHaveAdministratorAccess,
            details:
              typeof requestError.details === "string"
                ? requestError.details
                : `api status code: 403 | error message: ${requestError.message}`,
          });
          return;
        }
        setError(requestError instanceof Error ? requestError.message : text.copy.failedToLoadMedia);
        setDataState("error");
      }
    };

    void loadMedia();
    return () => {
      cancelled = true;
    };
  }, [adminSession.session, adminSession.state.status, filter]);

  async function removeMedia(id: string) {
    if (!adminSession.session) return;
    setActionLoadingId(id);
    setError("");
    setSuccessMessage("");

    try {
      const payload = await adminFetch<MediaDeletePayload>(`/api/admin/forum/media?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        session: adminSession.session,
      });
      setItems((current) => current.filter((item) => item.id !== id));
      setSuccessMessage(
        payload.warnings ? formatUiMessage(text.copy.mediaDeletedWarning, { value0: JSON.stringify(payload.warnings) }) : text.copy.mediaDeletedAndStorageCleaned,
      );
    } catch (requestError) {
      if (requestError instanceof AdminApiError && requestError.status === 401) {
        adminSession.setState({
          status: "signed_out",
          message: text.copy.yourSessionExpiredSignInAgain,
          details: `api status code: 401 | error message: ${requestError.message}`,
        });
      } else if (requestError instanceof AdminApiError && requestError.status === 403) {
        adminSession.setState({
          status: "forbidden",
          message: text.copy.thisAccountDoesNotHaveAdministratorAccess,
          details:
            typeof requestError.details === "string"
              ? requestError.details
              : `api status code: 403 | error message: ${requestError.message}`,
        });
      }
      setError(requestError instanceof Error ? requestError.message : text.copy.failedToDeleteMedia);
    } finally {
      setActionLoadingId(null);
    }
  }

  if (adminSession.state.status === "checking") {
    return <div className="community-empty admin-state-message"><strong>{localizeAdminSessionMessage(adminSession.state.message, locale)}</strong></div>;
  }
  if (adminSession.state.status === "timeout") {
    return <div className="community-empty admin-state-message admin-timeout"><strong>{localizeAdminSessionMessage(adminSession.state.message, locale)}</strong>{adminSession.state.details ? <p className="admin-debug-note">{adminSession.state.details}</p> : null}</div>;
  }
  if (adminSession.state.status === "signed_out") {
    return <div className="community-empty admin-state-message"><strong>{localizeAdminSessionMessage(adminSession.state.message, locale)}</strong>{adminSession.state.details ? <p className="admin-debug-note">{adminSession.state.details}</p> : null}</div>;
  }
  if (adminSession.state.status === "forbidden") {
    return <div className="community-empty admin-state-message admin-error"><strong>{localizeAdminSessionMessage(adminSession.state.message, locale)}</strong>{adminSession.state.details ? <p className="admin-debug-note">{adminSession.state.details}</p> : null}</div>;
  }
  if (adminSession.state.status === "error") {
    return <div className="community-empty admin-state-message admin-error"><strong>{localizeAdminSessionMessage(adminSession.state.message, locale)}</strong>{adminSession.state.details ? <p className="admin-debug-note">{adminSession.state.details}</p> : null}</div>;
  }

  return (
    <section className="community-surface">
      <div className="community-stream-head">
        <div>
          <h2>{text.copy.mediaAudit}</h2>
          <p>{text.copy.reviewRecentMediaLinkedPostsUploadersAndCleanupStatus}</p>
        </div>
        <div className="community-cta-row">
          {[
            ["all", text.copy.all],
            ["video", text.copy.video],
            ["large", text.copy.largeFiles],
            ["unbound", text.copy.unbound],
            ["recent", text.copy.last24Hours],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "community-button" : "community-button--secondary"}
              onClick={() => setFilter(value as Filter)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-user-line">
        {text.copy.currentAdministrator}{adminSession.me?.profile?.display_name || adminSession.me?.profile?.username || shortId(adminSession.me?.user_id)} {text.copy.role}{adminSession.me?.role}
      </div>

      {error ? <div className="admin-error">{error}</div> : null}
      {successMessage ? <div className="admin-inline-success">{successMessage}</div> : null}
      {dataState === "loading" ? <p className="community-meta admin-state-message">{text.copy.loadingMedia}</p> : null}

      {dataState === "ready" && items.length === 0 ? (
        <div className="community-empty">
          <strong>{text.copy.noMedia}</strong>
          <p>{text.copy.noMediaMatchesTheseFilters}</p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="community-list" style={{ marginTop: "0.8rem" }}>
          {items.map((item) => (
            <article key={item.id} className="community-list-item" style={{ gap: "0.6rem" }}>
              <div className="admin-action-row">
                <strong>{item.kind.toUpperCase()} · {bytesLabel(item.size_bytes)}</strong>
                {!item.is_bound_to_post ? <span className="admin-status-badge admin-status-hidden">{text.copy.unbound}</span> : null}
                {item.post_status ? <span className="admin-status-badge">{item.post_status}</span> : null}
              </div>
              <div className="admin-meta-grid">
                <span>{text.copy.post2}{item.post_title ?? text.copy.unbound2} {item.post_id ? <code>{shortId(item.post_id)}</code> : null}</span>
                <span>{text.copy.uploader}{uploaderLabel(item)} <code>{shortId(item.user_id)}</code></span>
                <span>mime：{item.mime_type ?? "-"}</span>
                <span>{text.copy.created2}{new Date(item.created_at).toLocaleString(locale)}</span>
              </div>
              <p className="admin-post-excerpt">{item.storage_path ?? item.url ?? "-"}</p>
              <div className="admin-action-row">
                {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="admin-action-button">{text.copy.openMedia}</a> : null}
                <button
                  type="button"
                  className="admin-action-button admin-action-danger"
                  onClick={() => removeMedia(item.id)}
                  disabled={actionLoadingId === item.id}
                >
                  {actionLoadingId === item.id ? text.copy.processing : text.copy.deleteMedia}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
