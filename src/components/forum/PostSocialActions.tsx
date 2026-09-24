import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient, syncBrowserRealtimeAuth } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";

interface PostSocialActionsProps {
  postId: string;
  initialLikeCount?: number;
  compact?: boolean;
  onLikeChange?: (liked: boolean, likeCount: number) => void;
  onBookmarkChange?: (bookmarked: boolean) => void;
}

export default function PostSocialActions({
  postId,
  initialLikeCount = 0,
  compact = false,
  onLikeChange,
  onBookmarkChange,
}: PostSocialActionsProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const { status, user } = useBrowserAuthState(supabase);
  const userId = status === "signed_in" ? user?.id : null;
  const [liked, setLiked] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [loadingLike, setLoadingLike] = useState(false);
  const [loadingBookmark, setLoadingBookmark] = useState(false);
  const [likeAnimating, setLikeAnimating] = useState(false);
  const [bookmarkAnimating, setBookmarkAnimating] = useState(false);
  const likeTimerRef = useRef<number | null>(null);
  const bookmarkTimerRef = useRef<number | null>(null);

  const refreshSocialState = useCallback(async (shouldApply: () => boolean = () => true) => {
    if (!supabase) return;

    const [countResult, voteResult, bookmarkResult] = await Promise.all([
      supabase
        .from("post_votes")
        .select("id", { count: "exact", head: true })
        .eq("post_id", postId)
        .eq("vote", 1),
      userId
        ? supabase
            .from("post_votes")
            .select("id, vote")
            .eq("post_id", postId)
            .eq("user_id", userId)
            .eq("vote", 1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      userId
        ? supabase
            .from("bookmarks")
            .select("id")
            .eq("post_id", postId)
            .eq("user_id", userId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (!shouldApply()) return;

    if (!countResult.error && typeof countResult.count === "number") {
      setLikeCount(Math.max(0, countResult.count));
    }
    if (!voteResult.error) {
      setLiked(Boolean(voteResult.data));
    }
    if (!bookmarkResult.error) {
      setBookmarked(Boolean(bookmarkResult.data));
    }
  }, [userId, postId, supabase]);

  useEffect(() => {
    if (!supabase) return;
    return () => {
      if (likeTimerRef.current !== null) {
        window.clearTimeout(likeTimerRef.current);
      }
      if (bookmarkTimerRef.current !== null) {
        window.clearTimeout(bookmarkTimerRef.current);
      }
    };
  }, [postId, supabase]);

  useEffect(() => {
    if (userId) return;
    setLiked(false);
    setBookmarked(false);
  }, [userId]);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    void refreshSocialState(() => mounted);

    return () => {
      mounted = false;
    };
  }, [refreshSocialState, supabase]);

  useEffect(() => {
    if (!supabase || !userId) return;

    let cancelled = false;
    let channel: ReturnType<NonNullable<typeof supabase>["channel"]> | null = null;

    const setupChannel = async () => {
      const accessToken = await syncBrowserRealtimeAuth(supabase);
      if (!accessToken || cancelled) return;

      channel = supabase
        .channel(`forum-post-votes-${postId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "post_votes",
            filter: `post_id=eq.${postId}`,
          },
          () => {
            void refreshSocialState();
          },
        )
        .subscribe((subscriptionStatus) => {
          if (import.meta.env.DEV) {
            console.debug("[realtime] post votes", { subscriptionStatus, postId });
          }
        });
    };

    void setupChannel();

    return () => {
      cancelled = true;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [postId, refreshSocialState, supabase, userId]);

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

  function triggerBookmarkAnimation() {
    setBookmarkAnimating(true);
    if (bookmarkTimerRef.current !== null) {
      window.clearTimeout(bookmarkTimerRef.current);
    }
    bookmarkTimerRef.current = window.setTimeout(() => {
      setBookmarkAnimating(false);
      bookmarkTimerRef.current = null;
    }, 240);
  }

  async function handleToggleLike() {
    if (loadingLike || !supabase) return;
    if (!userId) {
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
            user_id: userId,
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
          .eq("user_id", userId);
        if (error) throw error;
      }
      onLikeChange?.(nextLiked, nextCount);
    } catch {
      setLiked(!nextLiked);
      setLikeCount(Math.max(0, likeCount));
    } finally {
      setLoadingLike(false);
    }
  }

  async function handleToggleBookmark() {
    if (loadingBookmark || !supabase) return;
    if (!userId) {
      requireLogin();
      return;
    }

    const nextBookmarked = !bookmarked;
    setLoadingBookmark(true);
    setBookmarked(nextBookmarked);
    triggerBookmarkAnimation();

    try {
      if (nextBookmarked) {
        const { error } = await supabase.from("bookmarks").upsert(
          {
            post_id: postId,
            user_id: userId,
          },
          { onConflict: "user_id,post_id" },
        );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("bookmarks")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", userId);
        if (error) throw error;
      }
      onBookmarkChange?.(nextBookmarked);
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
        className={`community-action-button community-action-button--social${bookmarked ? " is-active is-bookmarked" : ""}`}
        onClick={handleToggleBookmark}
        disabled={loadingBookmark}
        aria-pressed={bookmarked}
        title={bookmarked ? "取消收藏" : "收藏"}
      >
        <span className={`community-bookmark-icon${bookmarkAnimating ? " is-animating" : ""}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M6 3.75h12a1 1 0 0 1 1 1v15.83a.75.75 0 0 1-1.24.58L12 16.3l-5.76 4.86A.75.75 0 0 1 5 20.58V4.75a1 1 0 0 1 1-1Z" />
          </svg>
        </span>
        <span>收藏</span>
      </button>
    </div>
  );
}
