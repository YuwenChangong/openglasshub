import { useMemo, useState } from "react";
import { resolveLocale, type LocaleContext } from "../../lib/i18n/locale";
import { getUiMessages, formatUiMessage } from "../../lib/i18n/catalog";
import { useLocale } from "../i18n/useLocale";

type Props = {
  localeContext?: LocaleContext;
  currentPage: number;
  totalPages: number;
  category: string | null;
};

function buildHref(category: string | null, page: number) {
  const base = category && category !== "recommended"
    ? `/news/?category=${encodeURIComponent(category)}`
    : "/news/";
  return page > 1 ? `${base}${base.includes("?") ? "&" : "?"}page=${page}` : base;
}

export default function NewsPagination({ currentPage, totalPages, category, localeContext = resolveLocale({ acceptLanguage: "zh-CN" }) }: Props) {
  const { context, messages } = useLocale(localeContext);
  const text = messages.catalog;
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const [jumpError, setJumpError] = useState("");

  const pageItems = useMemo(() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const items: Array<number | "ellipsis"> = [1, 2, 3, 4, 5];
    if (currentPage > 5 && currentPage < totalPages) {
      items.push("ellipsis", currentPage);
    } else {
      items.push("ellipsis");
    }
    if (!items.includes(totalPages)) {
      items.push(totalPages);
    }
    return items;
  }, [currentPage, totalPages]);

  function handleJumpSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetPage = Number.parseInt(jumpValue, 10);
    if (!Number.isFinite(targetPage)) {
      setJumpError(text.pageNumber);
      return;
    }
    if (targetPage < 1 || targetPage > totalPages) {
      setJumpError(formatUiMessage(text.pageRange, { count: totalPages }));
      return;
    }
    window.location.assign(buildHref(category, targetPage));
  }

  if (totalPages <= 1) return null;

  return (
    <div className="news-pagination">
      <a
        href={currentPage > 1 ? buildHref(category, currentPage - 1) : undefined}
        className={`community-action-button community-action-button--muted${currentPage <= 1 ? " is-disabled" : ""}`}
        aria-disabled={currentPage <= 1}
      >
        {text.previous}
      </a>

      <div className="news-pagination__pages">
        {pageItems.map((item, index) => {
          if (item === "ellipsis") {
            return (
              <div key={`ellipsis-${index}`} className="news-pagination__jump">
                <button
                  type="button"
                  className="community-action-button community-action-button--muted news-pagination__ellipsis"
                  onClick={() => {
                    setJumpOpen((current) => !current);
                    setJumpError("");
                  }}
                >
                  ...
                </button>
                {jumpOpen ? (
                  <form className="news-pagination__popover glass-modal" onSubmit={handleJumpSubmit}>
                    <div className="glass-modal__header">
                      <h3>{text.jumpPage}</h3>
                      <p>{formatUiMessage(text.rangeHint, { count: totalPages })}</p>
                    </div>
                    <div className="glass-modal__body">
                      <input
                        className="news-pagination__input"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={jumpValue}
                        onChange={(event) => {
                          setJumpValue(event.target.value.replace(/[^\d]/g, ""));
                          setJumpError("");
                        }}
                        placeholder={`1-${totalPages}`}
                      />
                      {jumpError ? <div className="comment-inline-error">{jumpError}</div> : null}
                    </div>
                    <div className="glass-modal__actions">
                      <button type="button" className="community-button--secondary" onClick={() => setJumpOpen(false)}>
                        {text.cancel}
                      </button>
                      <button type="submit" className="community-button">
                        {text.jump}
                      </button>
                    </div>
                  </form>
                ) : null}
              </div>
            );
          }

          return (
            <a
              key={item}
              href={buildHref(category, item)}
              className={`community-action-button community-action-button--muted news-pagination__page${currentPage === item ? " is-active" : ""}`}
              aria-current={currentPage === item ? "page" : undefined}
            >
              {item}
            </a>
          );
        })}
      </div>

      <a
        href={currentPage < totalPages ? buildHref(category, currentPage + 1) : undefined}
        className={`community-action-button community-action-button--muted${currentPage >= totalPages ? " is-disabled" : ""}`}
        aria-disabled={currentPage >= totalPages}
      >
        {text.next}
      </a>
    </div>
  );
}
