import { useEffect, useMemo, useState } from "react";
import type { ResolvedPostMedia } from "../../lib/forum-media";
import { buildResolvedPostMediaMap } from "../../lib/forum-media";
import { buildPostCommentCountMap, buildPostLikeCountMap } from "../../lib/post-engagement";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import {
  getProfileById,
  loadProfilePageData,
  type LoadedProfilePage,
  type ProfilePostRecord,
} from "../../lib/profile-data";
import { buildProfileHref } from "../../lib/profile-links";
import ProfilePostCard from "./ProfilePostCard";

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

export type OwnTab = "posts" | "comments" | "circles" | "liked" | "saved";

const TAB_LABELS: Record<OwnTab, string> = {
  posts: "帖子",
  comments: "评论",
  circles: "创建的圈子",
  liked: "我的喜欢",
  saved: "我的收藏",
};

type MyProfilePageProps = {
  profileId?: string;
  initialPageData?: LoadedProfilePage | null;
  initialTab?: OwnTab;
};

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

export default function MyProfilePage({ profileId, initialPageData = null, initialTab = "posts" }: MyProfilePageProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [loading, setLoading] = useState(initialPageData ? false : true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<OwnTab>(initialTab);
  const [pageData, setPageData] = useState<LoadedProfilePage | null>(initialPageData);
  const [likedPosts, setLikedPosts] = useState<CollectionPost[]>([]);
  const [savedPosts, setSavedPosts] = useState<CollectionPost[]>([]);
  const [savedPostsAvailable, setSavedPostsAvailable] = useState(false);
  const [viewerIsOwner, setViewerIsOwner] = useState(!profileId);

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
      const viewerId = session?.user?.id ?? null;
      const targetProfileId = profileId ?? viewerId;

      if (!targetProfileId) {
        window.location.replace(buildLoginHref("/me/"));
        return;
      }

      const ownsProfile = Boolean(viewerId && viewerId === targetProfileId);
      if (!cancelled) {
        setViewerIsOwner(ownsProfile);
      }

      const profile = await getProfileById(supabase, targetProfileId);
      if (!profile) {
        if (!cancelled) {
          setLoading(false);
          setError("当前用户还没有可用的个人资料。");
        }
        return;
      }

      const r2PublicBaseUrl = (import.meta.env.PUBLIC_R2_PUBLIC_BASE_URL as string | undefined) || undefined;

      const profilePagePromise = loadProfilePageData(supabase, profile, r2PublicBaseUrl);
      const likedVotesPromise = ownsProfile && viewerId
        ? supabase.from("post_votes").select("post_id").eq("user_id", viewerId).eq("vote", 1)
        : Promise.resolve({ data: [] as VoteRow[] | null, error: null });
      const bookmarksPromise = ownsProfile && viewerId
        ? supabase
            .from("bookmarks")
            .select("created_at,post_id")
            .eq("user_id", viewerId)
            .order("created_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] as BookmarkRow[] | null, error: null });

      const [profilePage, likedVotesResult, bookmarksResult] = await Promise.all([
        profilePagePromise,
        likedVotesPromise,
        bookmarksPromise,
      ]);

      if (cancelled) return;

      const likedPostIds = ((likedVotesResult.data as VoteRow[] | null) ?? [])
        .map((item) => item.post_id)
        .filter(Boolean);
      const savedPostIds = ((bookmarksResult.data as BookmarkRow[] | null) ?? [])
        .map((item) => item.post_id)
        .filter(Boolean);

      const [liked, saved] = ownsProfile
        ? await Promise.all([
            loadCollectionPosts(supabase, likedPostIds, r2PublicBaseUrl),
            loadCollectionPosts(supabase, savedPostIds, r2PublicBaseUrl),
          ])
        : [[], []];

      if (cancelled) return;

      setPageData(profilePage);
      setLikedPosts(liked);

      const bookmarksAvailable = ownsProfile && !bookmarksResult.error;
      if (ownsProfile && bookmarksResult.error) {
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
  }, [initialPageData, profileId, supabase]);

  useEffect(() => {
    if (!savedPostsAvailable && tab === "saved") {
      setTab("posts");
    }
  }, [savedPostsAvailable, tab]);

  useEffect(() => {
    if (!viewerIsOwner && (tab === "liked" || tab === "saved")) {
      setTab("posts");
    }
  }, [tab, viewerIsOwner]);

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
  const visibleTabs = viewerIsOwner
    ? savedPostsAvailable
      ? (["posts", "comments", "circles", "liked", "saved"] as OwnTab[])
      : (["posts", "comments", "circles", "liked"] as OwnTab[])
    : (["posts", "comments", "circles"] as OwnTab[]);

  const renderPostCard = (post: CollectionPost, extraMeta?: string) => (
    <ProfilePostCard
      key={`${post.id}-${extraMeta ?? "default"}`}
      id={post.id}
      title={post.title}
      body={post.body}
      createdAt={post.created_at}
      circleName={post.circles?.name ?? null}
      circleSlug={post.circles?.slug ?? null}
      likeCount={post.likeCount}
      commentCount={post.commentCount}
      mediaResolved={post.mediaResolved}
      extraMeta={extraMeta}
      interactive={true}
      onLikeChange={(liked, likeCount) => syncLikeState(post.id, liked, likeCount, post)}
      onBookmarkChange={(bookmarked) => syncBookmarkState(post.id, bookmarked, post)}
    />
  );

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
              {viewerIsOwner ? (
                <span>
                  <strong>{likedPosts.length}</strong> 喜欢
                </span>
              ) : null}
              {viewerIsOwner && savedPostsAvailable ? (
                <span>
                  <strong>{savedPosts.length}</strong> 收藏
                </span>
              ) : null}
            </div>
            {viewerIsOwner ? (
              <div className="community-inline-links profile-owner-actions">
                <a href="/me/edit/" className="community-inline-link community-inline-link--active">
                  编辑资料
                </a>
                <a href={publicHref} className="community-inline-link">
                  公开主页
                </a>
              </div>
            ) : null}
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
