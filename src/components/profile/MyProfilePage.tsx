import { useEffect, useMemo, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { getProfileById, loadProfilePageData, type LoadedProfilePage } from "../../lib/profile-data";
import { buildProfileHref } from "../../lib/profile-links";

type BookmarkRow = {
  created_at: string;
  posts: {
    id: string;
    title: string;
    body: string | null;
    created_at: string;
    status: string;
    circles?: { slug?: string | null; name?: string | null } | null;
  } | null;
};

type OwnTab = "posts" | "comments" | "circles" | "saved";

const TAB_LABELS: Record<OwnTab, string> = {
  posts: "帖子",
  comments: "评论",
  circles: "创建的圈子",
  saved: "收藏",
};

function formatTime(value: string) {
  try {
    return new Date(value).toLocaleString("zh-CN");
  } catch {
    return value;
  }
}

export default function MyProfilePage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<OwnTab>("posts");
  const [pageData, setPageData] = useState<LoadedProfilePage | null>(null);
  const [savedPosts, setSavedPosts] = useState<BookmarkRow[]>([]);
  const [savedPostsAvailable, setSavedPostsAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!supabase) {
        if (!cancelled) {
          setLoading(false);
          setError("当前环境未启用登录。");
        }
        return;
      }

      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session?.user) {
        window.location.replace(buildLoginHref("/me/"));
        return;
      }

      const profile = await getProfileById(supabase, session.user.id);
      if (!profile) {
        if (!cancelled) {
          setLoading(false);
          setError("当前账号还没有可用的个人资料。");
        }
        return;
      }

      const [profilePage, bookmarksResult] = await Promise.all([
        loadProfilePageData(
          supabase,
          profile,
          (import.meta.env.PUBLIC_R2_PUBLIC_BASE_URL as string | undefined) || undefined,
        ),
        supabase
          .from("bookmarks")
          .select("created_at,posts:post_id(id,title,body,created_at,status,circles:circle_id(slug,name))")
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      if (cancelled) return;

      setPageData(profilePage);
      const bookmarksAvailable = !bookmarksResult.error;
      if (bookmarksResult.error) {
        console.warn("[profile] bookmarks unavailable", {
          message: bookmarksResult.error.message,
        });
      }
      setSavedPostsAvailable(bookmarksAvailable);
      setSavedPosts(
        bookmarksAvailable
          ? ((bookmarksResult.data as BookmarkRow[] | null) ?? []).filter(
              (item) => item.posts?.id && item.posts?.status === "published",
            )
          : [],
      );
      setLoading(false);
    }

    void load().catch((requestError) => {
      if (cancelled) return;
      setLoading(false);
      setError(requestError instanceof Error ? requestError.message : "加载我的主页失败。");
    });

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!savedPostsAvailable && tab === "saved") {
      setTab("posts");
    }
  }, [savedPostsAvailable, tab]);

  if (loading) {
    return (
      <section className="community-surface community-surface--padded profile-shell">
        <h1>我的主页</h1>
        <p className="community-meta">正在加载...</p>
      </section>
    );
  }

  if (error || !pageData) {
    return (
      <section className="community-surface community-surface--padded profile-shell">
        <h1>我的主页</h1>
        <p className="community-meta">{error || "加载失败"}</p>
      </section>
    );
  }

  const displayName = pageData.profile.display_name || pageData.profile.username || "社区成员";
  const publicHref = buildProfileHref(pageData.profile) ?? "/feed/";
  const visibleTabs = (savedPostsAvailable
    ? (["posts", "comments", "circles", "saved"] as OwnTab[])
    : (["posts", "comments", "circles"] as OwnTab[]));

  return (
    <>
      <section className="community-surface community-surface--padded profile-shell">
        {pageData.resolvedBannerUrl ? (
          <div className="profile-banner">
            <img src={pageData.resolvedBannerUrl} alt="" className="profile-banner__image" />
          </div>
        ) : null}
        <div className="profile-head">
          <div className="profile-avatar-wrap">
            {pageData.resolvedAvatarUrl ? (
              <img src={pageData.resolvedAvatarUrl} alt="" className="profile-avatar-image" />
            ) : (
              <span className="community-avatar profile-avatar-fallback" aria-hidden="true">
                {(displayName.trim().charAt(0) || "U").toUpperCase()}
              </span>
            )}
          </div>
          <div className="profile-copy">
            <div className="profile-copy__title">
              <h1>{displayName}</h1>
              {pageData.profile.username ? <span className="community-meta">@{pageData.profile.username}</span> : null}
            </div>
            {pageData.profile.bio ? <p className="profile-bio">{pageData.profile.bio}</p> : null}
            <div className="profile-stats">
              <span><strong>{pageData.stats.postCount}</strong> 帖子</span>
              <span><strong>{pageData.stats.commentCount}</strong> 评论</span>
              <span><strong>{pageData.stats.circleCount}</strong> 圈子</span>
              {savedPostsAvailable ? <span><strong>{savedPosts.length}</strong> 收藏</span> : null}
            </div>
            <div className="community-inline-links">
              <a href="/me/edit/" className="community-inline-link community-inline-link--active">编辑资料</a>
              <a href={publicHref} className="community-inline-link">公开主页</a>
            </div>
          </div>
        </div>
      </section>

      <section className="community-surface community-surface--padded profile-tabs">
        <div className="community-inline-links" role="tablist" aria-label="我的动态">
          {visibleTabs.map((item) => (
            <button
              key={item}
              type="button"
              className={`community-inline-link${tab === item ? " community-inline-link--active" : ""}`}
              onClick={() => setTab(item)}
            >
              {TAB_LABELS[item]}
            </button>
          ))}
        </div>
      </section>

      {tab === "posts" ? (
        <section className="community-list">
          {pageData.posts.length > 0 ? pageData.posts.map((post) => (
            <article key={post.id} className="community-list-item profile-post-card">
              <div className="community-post-meta">
                {post.circles?.slug && post.circles?.name ? <a href={`/circles/${post.circles.slug}/`} className="community-post-meta__link">{post.circles.name}</a> : null}
                <a href={`/posts/${post.id}/`} className="community-post-meta__link">{post.title}</a>
                <span>{formatTime(post.created_at)}</span>
              </div>
              <p>{post.body}</p>
              <div className="community-post-actions">
                <a href={`/posts/${post.id}/`} className="community-action-button community-action-button--muted">查看帖子</a>
              </div>
            </article>
          )) : (
            <section className="community-empty"><strong>还没有公开帖子</strong></section>
          )}
        </section>
      ) : null}

      {tab === "comments" ? (
        <section className="community-list">
          {pageData.comments.length > 0 ? pageData.comments.map((comment) => (
            <article key={comment.id} className="community-list-item profile-comment-card">
              <div className="community-post-meta">
                <a href={comment.postHref} className="community-post-meta__link">{comment.postTitle}</a>
                <span>{formatTime(comment.created_at)}</span>
              </div>
              <p>{comment.body}</p>
              <div className="community-post-actions">
                <a href={comment.postHref} className="community-action-button community-action-button--muted">查看帖子</a>
              </div>
            </article>
          )) : (
            <section className="community-empty"><strong>还没有公开评论</strong></section>
          )}
        </section>
      ) : null}

      {tab === "circles" ? (
        <section className="community-list">
          {pageData.circles.length > 0 ? pageData.circles.map((circle) => (
            <article key={circle.id} className="community-list-item profile-circle-card">
              <div className="community-post-meta">
                <a href={`/circles/${circle.slug}/`} className="community-post-meta__link">{circle.name}</a>
                {circle.created_at ? <span>{new Date(circle.created_at).toLocaleDateString("zh-CN")}</span> : null}
              </div>
              {circle.description ? <p>{circle.description}</p> : null}
              <div className="community-post-actions">
                <a href={`/circles/${circle.slug}/`} className="community-action-button community-action-button--muted">进入圈子</a>
              </div>
            </article>
          )) : (
            <section className="community-empty"><strong>还没有创建公开圈子</strong></section>
          )}
        </section>
      ) : null}

      {tab === "saved" ? (
        <section className="community-list">
          {savedPosts.length > 0 ? savedPosts.map((item) => (
            <article key={`${item.posts?.id}-${item.created_at}`} className="community-list-item profile-post-card">
              <div className="community-post-meta">
                {item.posts?.circles?.slug && item.posts?.circles?.name ? <a href={`/circles/${item.posts.circles.slug}/`} className="community-post-meta__link">{item.posts.circles.name}</a> : null}
                {item.posts?.id ? <a href={`/posts/${item.posts.id}/`} className="community-post-meta__link">{item.posts.title}</a> : null}
                <span>收藏于 {formatTime(item.created_at)}</span>
              </div>
              <p>{item.posts?.body ?? ""}</p>
              <div className="community-post-actions">
                {item.posts?.id ? <a href={`/posts/${item.posts.id}/`} className="community-action-button community-action-button--muted">查看帖子</a> : null}
              </div>
            </article>
          )) : (
            <section className="community-empty"><strong>还没有收藏帖子</strong></section>
          )}
        </section>
      ) : null}
    </>
  );
}
