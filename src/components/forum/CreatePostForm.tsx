import { useEffect, useMemo, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

interface CircleOption {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
}

const wrapperStyle: React.CSSProperties = {
  maxWidth: "760px",
  margin: "2rem auto",
  padding: "1.5rem",
  border: "1px solid #2a2e45",
  borderRadius: "0.75rem",
  background: "#111527",
};

const stackStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.75rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#0a0d1a",
  border: "1px solid #2a2e45",
  borderRadius: "0.5rem",
  color: "#e8edf8",
  padding: "0.75rem",
};

const buttonStyle: React.CSSProperties = {
  borderRadius: "0.5rem",
  border: "1px solid #7cb5ff",
  background: "#7cb5ff",
  color: "#0b0e16",
  fontWeight: 600,
  padding: "0.625rem 0.875rem",
  cursor: "pointer",
};

const messageStyle: React.CSSProperties = {
  border: "1px solid #2a2e45",
  borderRadius: "0.5rem",
  padding: "0.75rem",
  fontSize: "0.95rem",
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
      <h2>发布帖子</h2>
      <p>公开社区允许所有人浏览。发帖需要登录，帖子默认以 `pending` 状态提交。</p>

      <form onSubmit={handleSubmit} style={stackStyle}>
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
          类型
          <select style={inputStyle} value={type} onChange={(event) => setType(event.target.value)}>
            <option value="experience">体验</option>
            <option value="question">提问</option>
            <option value="review">评测</option>
            <option value="dev">开发</option>
            <option value="news">资讯</option>
            <option value="feedback">反馈</option>
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
