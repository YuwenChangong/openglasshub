import { useEffect, useMemo, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

interface CircleOption {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
}

const postTypes = [
  { value: "question", label: "求助", description: "适合兼容性、选购和使用问题。" },
  { value: "experience", label: "体验", description: "记录真实使用体验、佩戴感受和场景反馈。" },
  { value: "review", label: "评测", description: "适合更完整的对比、总结和长期观察。" },
  { value: "dev", label: "开发", description: "围绕 SDK、权限、输入和系统能力讨论。" },
  { value: "news", label: "资讯", description: "适合手动整理的动态、公告和观察。" },
  { value: "feedback", label: "反馈", description: "适合对产品、社区和 Gaze Launcher 的建议。" },
] as const;

const wrapperStyle: React.CSSProperties = {
  maxWidth: "860px",
  margin: "1.25rem 0 0",
  padding: "1.35rem",
  border: "1px solid #20283a",
  borderRadius: "1rem",
  background: "#0f1624",
  boxShadow: "0 18px 38px rgba(3, 8, 18, 0.2)",
};

const stackStyle: React.CSSProperties = {
  display: "grid",
  gap: "1rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#0c1220",
  border: "1px solid #25314a",
  borderRadius: "0.75rem",
  color: "#e8edf8",
  padding: "0.82rem 0.9rem",
  fontSize: "0.95rem",
};

const buttonStyle: React.CSSProperties = {
  borderRadius: "0.75rem",
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "#f8fafc",
  fontWeight: 600,
  padding: "0.75rem 1rem",
  cursor: "pointer",
};

const messageStyle: React.CSSProperties = {
  border: "1px solid #25314a",
  borderRadius: "0.75rem",
  padding: "0.75rem",
  fontSize: "0.95rem",
  background: "#101827",
};

export default function CreatePostForm() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [ready, setReady] = useState(false);
  const [circleSlug, setCircleSlug] = useState("");
  const [type, setType] = useState("question");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [circles, setCircles] = useState<CircleOption[]>([]);
  const [loadingCircles, setLoadingCircles] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!supabase) {
      setError("缺少 PUBLIC_SUPABASE_URL 或 PUBLIC_SUPABASE_ANON_KEY。");
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        window.location.replace(buildLoginHref("/posts/new/"));
        return;
      }
      setReady(true);
    });

    return () => {
      mounted = false;
    };
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    async function fetchCircles() {
      setLoadingCircles(true);
      try {
        const response = await fetch("/api/forum/circles");
        const payload = (await response.json().catch(() => null)) as
          | { circles?: CircleOption[]; error?: string }
          | null;

        if (cancelled) return;
        if (!response.ok) {
          throw new Error(payload?.error ?? `请求失败 (${response.status})`);
        }

        const nextCircles = payload?.circles ?? [];
        setCircles(nextCircles);
        if (nextCircles[0] && !circleSlug) {
          setCircleSlug(nextCircles[0].slug);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "加载圈子失败");
        }
      } finally {
        if (!cancelled) {
          setLoadingCircles(false);
        }
      }
    }

    fetchCircles();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;

    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) {
        window.location.replace(buildLoginHref("/posts/new/"));
        return;
      }

      const response = await fetch("/api/forum/posts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          circle_slug: circleSlug.trim(),
          type: type.trim(),
          title: title.trim(),
          body: body.trim(),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; post?: { id: string; status: string } }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? `请求失败 (${response.status})`);
      }

      setTitle("");
      setBody("");
      setMessage(
        `帖子已提交，当前状态为 ${payload?.post?.status ?? "pending"}。审核或发布后会出现在公开动态中。`,
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交失败。");
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !ready && !loadingCircles) {
    return <section style={wrapperStyle}><div style={messageStyle}>错误：{error}</div></section>;
  }

  if (!ready) {
    return <section style={wrapperStyle}><div style={messageStyle}>正在检查登录状态...</div></section>;
  }

  return (
    <section style={wrapperStyle}>
      <div style={{ display: "grid", gap: "0.35rem", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>新建帖子</h2>
        <p style={{ margin: 0, color: "#95a6c6" }}>
          当前公开版先支持文字发帖，提交后默认进入 <code>pending</code>。图片、视频链接和外链能力会在后续媒体版开放，不会在这一步伪装成已可用功能。
        </p>
      </div>

      <form onSubmit={handleSubmit} style={stackStyle}>
        <div>
          <label style={{ display: "block", marginBottom: "0.55rem", fontWeight: 600 }}>发布类型</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
            {postTypes.map((option) => {
              const active = type === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setType(option.value)}
                  style={{
                    textAlign: "left",
                    padding: "0.9rem",
                    borderRadius: "0.9rem",
                    border: active ? "1px solid #3b82f6" : "1px solid #25314a",
                    background: active ? "#13213a" : "#101827",
                    color: "#e8edf8",
                    cursor: "pointer",
                  }}
                >
                  <strong style={{ display: "block", marginBottom: "0.2rem" }}>{option.label}</strong>
                  <span style={{ color: "#90a0bf", fontSize: "0.88rem", lineHeight: 1.5 }}>{option.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        <label>
          圈子
          <select
            style={inputStyle}
            value={circleSlug}
            onChange={(event) => setCircleSlug(event.target.value)}
            disabled={loadingCircles}
            required
          >
            {circles.map((circle) => (
              <option key={circle.id} value={circle.slug}>
                {circle.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          标题
          <input
            style={inputStyle}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            minLength={3}
            maxLength={180}
            required
          />
        </label>

        <label>
          正文
          <textarea
            style={{ ...inputStyle, minHeight: "180px", resize: "vertical" }}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            minLength={10}
            maxLength={20000}
            required
          />
        </label>

        <div style={{ display: "grid", gap: "0.45rem", padding: "0.95rem", borderRadius: "0.9rem", border: "1px dashed #30415f", background: "#101827" }}>
          <strong style={{ color: "#f8fafc", fontSize: "0.96rem" }}>媒体能力规划</strong>
          <span style={{ color: "#90a0bf", fontSize: "0.9rem" }}>
            图片帖、视频链接帖和外部链接帖会在下一阶段产品化中接入。当前这一步只开放文字内容，避免出现不可提交的假入口。
          </span>
        </div>

        <button type="submit" style={buttonStyle} disabled={submitting || loadingCircles}>
          {submitting ? "提交中..." : "提交帖子"}
        </button>
      </form>

      <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
        {error ? <div style={messageStyle}>错误：{error}</div> : null}
        {message ? <div style={messageStyle}>{message}</div> : null}
      </div>
    </section>
  );
}
