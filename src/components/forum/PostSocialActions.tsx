import { useEffect, useMemo, useRef, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

interface PostSocialActionsProps {
  postId: string;
  initialLikeCount?: number;
  compact?: boolean;
}

type AuthState = {
  userId: string;
} | null;

export default function PostSocialActions({
  postId,
  initialLikeCount = 0,
  compact = false,
}: PostSocialActionsProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [authState, setAuthState] = useState<AuthState>(null);
  const [liked, setLiked] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [loadingLike, setLoadingLike] = useState(false);
  const [loadingBookmark, setLoadingBookmark] = useState(false);
  const [likeAnimating, setLikeAnimating] = useState(false);
  const likeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      const user = data.user;

      if (!user) {
        setAuthState(null);
        setLiked(false);
        setBookmarked(false);
        return;
      }

      setAuthState({ userId: user.id });
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const user = session?.user;
      setAuthState(user ? { userId: user.id } : null);
      if (!user) {
        setLiked(false);
        setBookmarked(false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
      if (likeTimerRef.current !== null) {
        window.clearTimeout(likeTimerRef.current);
      }
    };
  }, [postId, supabase]);

  useEffect(() => {
    if (!supabase || !authState?.userId) return;
    let mounted = true;

    Promise.all([
      supabase
        .from("post_votes")
        .select("id, vote")
        .eq("post_id", postId)
        .eq("user_id", authState.userId)
        .eq("vote", 1)
        .maybeSingle(),
      supabase
        .from("bookmarks")
        .select("id")
        .eq("post_id", postId)
        .eq("user_id", authState.userId)
        .maybeSingle(),
    ]).then(([voteResult, bookmarkResult]) => {
      if (!mounted) return;
      setLiked(Boolean(voteResult.data));
      setBookmarked(Boolean(bookmarkResult.data));
    });

    return () => {
      mounted = false;
    };
  }, [authState?.userId, postId, supabase]);

  function requireLogin() {
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(buildLoginHref(next));
  }

  function triggerLikeAnimation() {
    setLikeAnimating(true);
    if (likeTimerRef.current !== null) {
      window.clearTimeout(likeTimerRef.current);
    }
    likeTimerRef.current = window.setTimeout(() => {
      setLikeAnimating(false);
      likeTimerRef.current = null;
    }, 240);
  }

  async function handleToggleLike() {
    if (loadingLike) return;
    if (!authState) {
      requireLogin();
      return;
    }

    const nextLiked = !liked;
    const nextCount = Math.max(0, likeCount + (nextLiked ? 1 : -1));

    setLoadingLike(true);
    setLiked(nextLiked);
    setLikeCount(nextCount);
    triggerLikeAnimation();

    try {
      if (nextLiked) {
        const { error } = await supabase.from("post_votes").upsert(
          {
            post_id: postId,
            user_id: authState.userId,
            vote: 1,
          },
          { onConflict: "post_id,user_id" },
        );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("post_votes")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", authState.userId);
        if (error) throw error;
      }
    } catch {
      setLiked(!nextLiked);
      setLikeCount(Math.max(0, likeCount));
    } finally {
      setLoadingLike(false);
    }
  }

  async function handleToggleBookmark() {
    if (loadingBookmark) return;
    if (!authState) {
      requireLogin();
      return;
    }

    const nextBookmarked = !bookmarked;
    setLoadingBookmark(true);
    setBookmarked(nextBookmarked);

    try {
      if (nextBookmarked) {
        const { error } = await supabase.from("bookmarks").upsert(
          {
            post_id: postId,
            user_id: authState.userId,
          },
          { onConflict: "user_id,post_id" },
        );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("bookmarks")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", authState.userId);
        if (error) throw error;
      }
    } catch {
      setBookmarked(!nextBookmarked);
    } finally {
      setLoadingBookmark(false);
    }
  }

  return (
    <div className={`community-social-actions${compact ? " community-social-actions--compact" : ""}`}>
      <button
        type="button"
        className={`community-action-button community-action-button--social${liked ? " is-active is-liked" : ""}`}
        onClick={handleToggleLike}
        disabled={loadingLike}
        aria-pressed={liked}
        title={liked ? "取消点赞" : "点赞"}
      >
        <span className={`community-like-heart${likeAnimating ? " is-animating" : ""}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M12 21.35 10.55 20C5.4 15.24 2 12.09 2 8.23 2 5.08 4.42 2.7 7.5 2.7c1.74 0 3.41.82 4.5 2.09 1.09-1.27 2.76-2.09 4.5-2.09 3.08 0 5.5 2.38 5.5 5.53 0 3.86-3.4 7.01-8.55 11.78L12 21.35Z" />
          </svg>
        </span>
        <span>{likeCount}</span>
      </button>

      <button
        type="button"
        className={`community-action-button community-action-button--social${bookmarked ? " is-active" : ""}`}
        onClick={handleToggleBookmark}
        disabled={loadingBookmark}
        aria-pressed={bookmarked}
        title={bookmarked ? "取消收藏" : "收藏"}
      >
        <span className="community-bookmark-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M6 3.75h12a1 1 0 0 1 1 1v15.83a.75.75 0 0 1-1.24.58L12 16.3l-5.76 4.86A.75.75 0 0 1 5 20.58V4.75a1 1 0 0 1 1-1Z" />
          </svg>
        </span>
        <span>收藏</span>
      </button>
    </div>
  );
}
