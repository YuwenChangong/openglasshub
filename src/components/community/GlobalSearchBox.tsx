import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

type SearchPostResult = {
  id: string;
  title: string;
  excerpt: string;
  preview_image_url: string | null;
};

type SearchApiResponse =
  | {
      ok: true;
      results: {
        query: string;
        posts: SearchPostResult[];
      };
    }
  | {
      error: "INVALID_QUERY" | "SEARCH_FAILED";
    };

type Props = {
  className?: string;
  compact?: boolean;
  circleSlug?: string;
};

const MIN_QUERY_LENGTH = 2;
const PREVIEW_LIMIT = 3;

export default function GlobalSearchBox({ className = "", compact = false, circleSlug }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [posts, setPosts] = useState<SearchPostResult[]>([]);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const trimmedQuery = query.trim();
  const detailHref = trimmedQuery
    ? circleSlug
      ? `/search/?q=${encodeURIComponent(trimmedQuery)}&circle=${encodeURIComponent(circleSlug)}&type=posts`
      : `/search/?q=${encodeURIComponent(trimmedQuery)}`
    : "/search/";
  const hasPreviewQuery = trimmedQuery.length >= MIN_QUERY_LENGTH;
  const hasResults = posts.length > 0;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mounted]);

  useEffect(() => {
    if (!hasPreviewQuery) {
      setPosts([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q: trimmedQuery,
          type: "posts",
          limit_posts: String(PREVIEW_LIMIT),
        });
        if (circleSlug) {
          params.set("circle", circleSlug);
        }

        const response = await fetch(`/api/forum/search?${params.toString()}`, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        const payload = (await response.json()) as SearchApiResponse;

        if (!response.ok || !("ok" in payload) || !payload.ok) {
          setPosts([]);
          setOpen(true);
          return;
        }

        setPosts(payload.results.posts.slice(0, PREVIEW_LIMIT));
        setOpen(true);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setPosts([]);
          setOpen(true);
        }
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [circleSlug, hasPreviewQuery, trimmedQuery]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      window.location.assign(detailHref);
    },
    [detailHref],
  );

  const dropdownVisible = open && hasPreviewQuery && (loading || hasResults || trimmedQuery.length >= MIN_QUERY_LENGTH);

  const wrapperClassName = useMemo(
    () =>
      [
        "global-search-box",
        compact ? "global-search-box--compact" : "global-search-box--hero",
        className,
      ]
        .filter(Boolean)
        .join(" "),
    [className, compact],
  );

  return (
    <div className={wrapperClassName} ref={rootRef}>
      <form className="global-search-box__form" onSubmit={handleSubmit} role="search" action="/search/" method="get">
        <label className="global-search-box__field">
          <span className="sr-only">搜索</span>
          <input
            type="search"
            name="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => {
              if (trimmedQuery.length >= MIN_QUERY_LENGTH) {
                setOpen(true);
              }
            }}
            className="glass-input global-search-box__input"
            placeholder="搜索"
            autoComplete="off"
            maxLength={80}
          />
        </label>
        <button type="submit" className="community-button global-search-box__button">
          搜索
        </button>
      </form>

      {dropdownVisible ? (
        <div className="global-search-box__dropdown glass-card" role="listbox" aria-label="快速搜索结果">
          <div className="global-search-box__dropdown-head">
            <strong>搜索结果</strong>
            <a href={detailHref} className="community-link">
              查看详情
            </a>
          </div>

          {loading ? (
            <div className="global-search-box__empty">搜索中…</div>
          ) : hasResults ? (
            <div className="global-search-box__list">
              {posts.map((post) => (
                <a key={post.id} href={`/posts/${post.id}/`} className="global-search-box__item">
                  {post.preview_image_url ? (
                    <img src={post.preview_image_url} alt="" className="global-search-box__thumb" />
                  ) : null}
                  <div className="global-search-box__item-copy">
                    <strong>{post.title}</strong>
                    {post.excerpt ? <span>{post.excerpt}</span> : null}
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="global-search-box__empty">没有找到相关内容</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
