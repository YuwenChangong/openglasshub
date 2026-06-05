import { useCallback, useState, type FormEvent } from "react";

type Props = {
  className?: string;
  compact?: boolean;
};

export default function GlobalSearchBox({ className = "", compact = false }: Props) {
  const [query, setQuery] = useState("");

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = query.trim();
      const href = trimmed ? `/search/?q=${encodeURIComponent(trimmed)}` : "/search/";
      window.location.assign(href);
    },
    [query],
  );

  return (
    <form
      className={[
        "global-search-box",
        compact ? "global-search-box--compact" : "global-search-box--hero",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onSubmit={handleSubmit}
      role="search"
      action="/search/"
      method="get"
    >
      <label className="global-search-box__field">
        <span className="sr-only">搜索</span>
        <input
          type="search"
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
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
  );
}
