import { useEffect, useMemo, useState } from "react";
import type { ResolvedPostMedia } from "../../lib/forum-media";
import { buildResolvedPostMediaMap } from "../../lib/forum-media";
import { buildPostCommentCountMap, buildPostLikeCountMap } from "../../lib/post-engagement";
import { MEDIA_ONLY_SENTINEL, sanitizeBodyForDisplay } from "../../lib/post-body";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import {
  getProfileById,
  loadProfilePageData,
  type LoadedProfilePage,
  type ProfilePostRecord,
} from "../../lib/profile-data";
import { buildProfileHref } from "../../lib/profile-links";
import PostSocialActions from "../forum/PostSocialActions";

type BookmarkRow = {
  created_at: string;
  post_id: string;
};

type VoteRow = {
  post_id: string;
};

type CollectionPost = ProfilePostRecord & {
  likeCount: number;
  commentCount: number;
  mediaResolved: ResolvedPostMedia[];
};

type OwnTab = "posts" | "comments" | "circles" | "liked" | "saved";

const TAB_LABELS: Record<OwnTab, string> = {
  posts: "帖子",
  comments: "评论",
  circles: "创建的圈子",
  liked: "我的喜欢",
  saved: "我的收藏",
};

function formatTime(value: string) {
  try {
    return new Date(value).toLocaleString("zh-CN");
  } catch {
    return value;
  }
}

function buildProfileSnippet(body?: string | null) {
  const text = sanitizeBodyForDisplay(body ?? "").replace(MEDIA_ONLY_SENTINEL, "").trim();
  if (!text) return "";
  const chars = Array.from(text);
  return chars.length > 15 ? `${chars.slice(0, 15).join("")}...` : text;
}

function pickPreviewMedia(media: ResolvedPostMedia[]) {
  return media.find((item) => item.kind === "image" || item.kind === "video") ?? media[0] ?? null;
}

async function loadCollectionPosts(
  supabase: ReturnType<typeof createBrowserSupabaseClient>,
  postIds: string[],
  r2PublicBaseUrl?: string,
): Promise<CollectionPost[]> {
  if (!supabase || postIds.length === 0) return [];

  const { data, error } = await supabase
    .from("posts")
    .select(
      "id,author_id,title,body,type,created_at,last_activity_at,circles:circle_id(slug,name),profiles:author_id(username,display_name),post_media(*)",
    )
    .in("id", postIds)
    .eq("status", "published");

  if (error) {
    console.warn("[profile] collection posts failed", error.message);
    return [];
  }

  const posts = ((data as ProfilePostRecord[] | null) ?? []).sort(
    (left, right) => postIds.indexOf(left.id) - postIds.indexOf(right.id),
  );
  const [mediaMap, likeCountMap, commentCountMap] = await Promise.all([
    buildResolvedPostMediaMap(supabase, posts, 60 * 60, r2PublicBaseUrl),
    buildPostLikeCountMap(supabase, postIds),
    buildPostCommentCountMap(supabase, postIds),
  ]);

  return posts.map((post) => ({
    ...post,
    likeCount: likeCountMap.get(post.id) ?? 0,
    commentCount: commentCountMap.get(post.id) ?? 0,
    mediaResolved: mediaMap.get(post.id) ?? [],
  }));
}

export default function MyProfilePage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<OwnTab>("posts");
  const [pageData, setPageData] = useState<LoadedProfilePage | null>(null);
  const [likedPosts, setLikedPosts] = useState<CollectionPost[]>([]);
  const [savedPosts, setSavedPosts] = useState<CollectionPost[]>([]);
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

      const r2PublicBaseUrl = (import.meta.env.PUBLIC_R2_PUBLIC_BASE_URL as string | undefined) || undefined;

      const [profilePage, likedVotesResult, bookmarksResult] = await Promise.all([
        loadProfilePageData(supabase, profile, r2PublicBaseUrl),
        supabase.from("post_votes").select("post_id").eq("user_id", session.user.id).eq("vote", 1),
        supabase
          .from("bookmarks")
          .select("created_at,post_id")
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      if (cancelled) return;

      const likedPostIds = ((likedVotesResult.data as VoteRow[] | null) ?? [])
        .map((item) => item.post_id)
        .filter(Boolean);
      const savedPostIds = ((bookmarksResult.data as BookmarkRow[] | null) ?? [])
        .map((item) => item.post_id)
        .filter(Boolean);

      const [liked, saved] = await Promise.all([
        loadCollectionPosts(supabase, likedPostIds, r2PublicBaseUrl),
        loadCollectionPosts(supabase, savedPostIds, r2PublicBaseUrl),
      ]);

      if (cancelled) return;

      setPageData(profilePage);
      setLikedPosts(liked);

      const bookmarksAvailable = !bookmarksResult.error;
      if (bookmarksResult.error) {
        console.warn("[profile] bookmarks unavailable", {
          message: bookmarksResult.error.message,
        });
      }

      setSavedPostsAvailable(bookmarksAvailable);
      setSavedPosts(bookmarksAvailable ? saved : []);
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

  function syncLikeState(postId: string, liked: boolean, likeCount: number, sourcePost?: CollectionPost) {
    const applyLikeCount = (posts: CollectionPost[]) =>
      posts.map((post) => (post.id === postId ? { ...post, likeCount } : post));

    setPageData((current) =>
      current
        ? {
            ...current,
            posts: applyLikeCount(current.posts as CollectionPost[]),
          }
        : current,
    );
    setSavedPosts((current) => applyLikeCount(current));
    setLikedPosts((current) => {
      const withCounts = applyLikeCount(current);
      const exists = withCounts.some((post) => post.id === postId);
      if (liked && sourcePost && !exists) {
        return [{ ...sourcePost, likeCount }, ...withCounts];
      }
      if (!liked) {
        return withCounts.filter((post) => post.id !== postId);
      }
      return withCounts;
    });
  }

  function syncBookmarkState(postId: string, bookmarked: boolean, sourcePost?: CollectionPost) {
    setSavedPosts((current) => {
      const exists = current.some((post) => post.id === postId);
      if (bookmarked && sourcePost && !exists) {
        return [{ ...sourcePost }, ...current];
      }
      if (!bookmarked) {
        return current.filter((post) => post.id !== postId);
      }
      return current;
    });
  }

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
  const visibleTabs = savedPostsAvailable
    ? (["posts", "comments", "circles", "liked", "saved"] as OwnTab[])
    : (["posts", "comments", "circles", "liked"] as OwnTab[]);

  const renderPostCard = (post: CollectionPost, extraMeta?: string) => {
    const previewMedia = pickPreviewMedia(post.mediaResolved);
    const previewImageUrl =
      previewMedia?.kind === "video" ? previewMedia.previewUrl ?? previewMedia.displayUrl : previewMedia?.displayUrl;
    const snippet = buildProfileSnippet(post.body);

    return (
      <article key={`${post.id}-${extraMeta ?? "default"}`} className="community-post-card profile-post-card profile-post-card--rich">
        <div className="community-post-meta-row">
          <div className="community-post-meta">
            {post.circles?.slug && post.circles?.name ? (
              <a href={`/circles/${post.circles.slug}/`} className="community-post-meta__link">
                {post.circles.name}
              </a>
            ) : null}
            <a href={`/posts/${post.id}/`} className="community-post-meta__link">
              {post.title}
            </a>
            <span>{formatTime(post.created_at)}</span>
            {extraMeta ? <span>{extraMeta}</span> : null}
          </div>
        </div>

        {previewImageUrl ? (
          <a href={`/posts/${post.id}/`} className="profile-post-card__media" aria-label={`${post.title} 预览`}>
            <img src={previewImageUrl} alt="" loading="lazy" />
          </a>
        ) : null}

        {snippet ? <p className="community-post-excerpt">{snippet}</p> : null}

        <div className="profile-post-card__metrics">
          <span>点赞 {post.likeCount}</span>
          <span>评论 {post.commentCount}</span>
        </div>

        <div className="community-post-actions">
          <a href={`/posts/${post.id}/`} className="community-action-button community-action-button--muted">
            查看帖子
          </a>
          <PostSocialActions
            postId={post.id}
            initialLikeCount={post.likeCount}
            compact={true}
            onLikeChange={(liked, likeCount) => syncLikeState(post.id, liked, likeCount, post)}
            onBookmarkChange={(bookmarked) => syncBookmarkState(post.id, bookmarked, post)}
          />
        </div>
        <div className="community-post-divider" aria-hidden="true"></div>
      </article>
    );
  };

  return (
    <div className="profile-layout">
      <section className="community-surface community-surface--padded profile-shell profile-shell--owner">
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
            <span className="profile-account-id">ID: {pageData.profile.id}</span>
            {pageData.profile.bio ? <p className="profile-bio">{pageData.profile.bio}</p> : null}
            <div className="profile-stats">
              <span>
                <strong>{pageData.stats.postCount}</strong> 帖子
              </span>
              <span>
                <strong>{pageData.stats.commentCount}</strong> 评论
              </span>
              <span>
                <strong>{pageData.stats.circleCount}</strong> 圈子
              </span>
              <span>
                <strong>{likedPosts.length}</strong> 喜欢
              </span>
              {savedPostsAvailable ? (
                <span>
                  <strong>{savedPosts.length}</strong> 收藏
                </span>
              ) : null}
            </div>
            <div className="community-inline-links profile-owner-actions">
              <a href="/me/edit/" className="community-inline-link community-inline-link--active">
                编辑资料
              </a>
              <a href={publicHref} className="community-inline-link">
                公开主页
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="community-surface community-surface--padded profile-tabs">
        <div className="community-inline-links profile-tabs__links" role="tablist" aria-label="我的动态">
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
        <section className="community-feed-list profile-tab-content">
          {pageData.posts.length > 0 ? (
            pageData.posts.map((post) => renderPostCard(post as CollectionPost))
          ) : (
            <section className="community-empty">
              <strong>还没有公开帖子</strong>
            </section>
          )}
        </section>
      ) : null}

      {tab === "comments" ? (
        <section className="community-list profile-tab-content">
          {pageData.comments.length > 0 ? (
            pageData.comments.map((comment) => (
              <article key={comment.id} className="community-list-item profile-comment-card">
                <div className="community-post-meta">
                  <a href={comment.postHref} className="community-post-meta__link">
                    {comment.postTitle}
                  </a>
                  <span>{formatTime(comment.created_at)}</span>
                </div>
                <p>{comment.body}</p>
                <div className="community-post-actions">
                  <a href={comment.postHref} className="community-action-button community-action-button--muted">
                    查看帖子
                  </a>
                </div>
              </article>
            ))
          ) : (
            <section className="community-empty">
              <strong>还没有公开评论</strong>
            </section>
          )}
        </section>
      ) : null}

      {tab === "circles" ? (
        <section className="community-list profile-tab-content">
          {pageData.circles.length > 0 ? (
            pageData.circles.map((circle) => (
              <article key={circle.id} className="community-list-item profile-circle-card">
                <div className="community-post-meta">
                  <a href={`/circles/${circle.slug}/`} className="community-post-meta__link">
                    {circle.name}
                  </a>
                  {circle.created_at ? <span>{new Date(circle.created_at).toLocaleDateString("zh-CN")}</span> : null}
                </div>
                {circle.description ? <p>{circle.description}</p> : null}
                <div className="community-post-actions">
                  <a href={`/circles/${circle.slug}/`} className="community-action-button community-action-button--muted">
                    进入圈子
                  </a>
                </div>
              </article>
            ))
          ) : (
            <section className="community-empty">
              <strong>还没有创建公开圈子</strong>
            </section>
          )}
        </section>
      ) : null}

      {tab === "liked" ? (
        <section className="community-feed-list profile-tab-content">
          {likedPosts.length > 0 ? (
            likedPosts.map((post) => renderPostCard(post))
          ) : (
            <section className="community-empty">
              <strong>还没有喜欢的帖子</strong>
            </section>
          )}
        </section>
      ) : null}

      {tab === "saved" ? (
        <section className="community-feed-list profile-tab-content">
          {savedPosts.length > 0 ? (
            savedPosts.map((post) => renderPostCard(post, "已收藏"))
          ) : (
            <section className="community-empty">
              <strong>还没有收藏帖子</strong>
            </section>
          )}
        </section>
      ) : null}
    </div>
  );
}
