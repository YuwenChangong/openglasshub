import { useEffect, useMemo, useState } from "react";
import type { ResolvedPostMedia } from "../../lib/forum-media";
import { resolveLocale, type LocaleContext } from "../../lib/i18n/locale";
import { useLocale } from "../i18n/useLocale";

interface Props {
  localeContext?: LocaleContext;
  media: ResolvedPostMedia[];
  postTitle: string;
}

function getInitialIndex(media: ResolvedPostMedia[]): number {
  const coverIndex = media.findIndex((item) => item.is_cover);
  return coverIndex >= 0 ? coverIndex : 0;
}

export default function PostMediaGallery({ media, postTitle, localeContext = resolveLocale({ acceptLanguage: "zh-CN" }) }: Props) {
  const { messages } = useLocale(localeContext);
  const text = messages.community;
  const orderedMedia = useMemo(
    () =>
      [...media].sort((left, right) => {
        const leftCover = left.is_cover ? 1 : 0;
        const rightCover = right.is_cover ? 1 : 0;
        if (leftCover !== rightCover) return rightCover - leftCover;
        return (left.sort_order ?? 0) - (right.sort_order ?? 0);
      }),
    [media],
  );
  const [activeIndex, setActiveIndex] = useState(() => getInitialIndex(orderedMedia));
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (orderedMedia.length === 0) return null;

  const safeIndex = Math.min(activeIndex, orderedMedia.length - 1);
  const active = orderedMedia[safeIndex];
  const isPortrait = (active.height ?? 0) > (active.width ?? 0);

  useEffect(() => {
    if (!lightboxOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLightboxOpen(false);
      } else if (event.key === "ArrowRight") {
        setActiveIndex((current) => (current + 1) % orderedMedia.length);
      } else if (event.key === "ArrowLeft") {
        setActiveIndex((current) => (current - 1 + orderedMedia.length) % orderedMedia.length);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxOpen, orderedMedia.length]);

  function openLightbox() {
    setLightboxOpen(true);
  }

  function closeLightbox() {
    setLightboxOpen(false);
  }

  function showNext() {
    setActiveIndex((current) => (current + 1) % orderedMedia.length);
  }

  function showPrev() {
    setActiveIndex((current) => (current - 1 + orderedMedia.length) % orderedMedia.length);
  }

  return (
    <section className="post-media-gallery">
      <div className={`post-media-main${isPortrait ? " post-media-main--portrait" : " post-media-main--landscape"}`}>
        {active.kind === "image" ? (
          <button type="button" className="post-media-main__trigger" onClick={openLightbox}>
            <img
              src={active.displayUrl}
              alt={active.alt_text || postTitle}
              loading="eager"
              decoding="async"
              width={active.width ?? undefined}
              height={active.height ?? undefined}
            />
          </button>
        ) : active.kind === "video" ? (
          <div className="post-media-main__video-shell">
            <video controls playsInline preload="metadata" src={active.displayUrl}>
              {text.unsupportedVideo}
            </video>
            <button type="button" className="post-media-main__expand" onClick={openLightbox}>
              {text.expand}
            </button>
          </div>
        ) : (
          <a href={active.displayUrl} target="_blank" rel="noreferrer" className="post-video-card post-video-card--inline">
            <span className="forum-tag">{text.videoLink}</span>
            <strong>{active.alt_text || text.openExternalVideo}</strong>
            <span className="forum-meta">{text.externalVideoHint}</span>
          </a>
        )}
      </div>

      {orderedMedia.length > 1 && (
        <div className="post-media-thumbs" role="tablist" aria-label={text.mediaThumbnails}>
          {orderedMedia.map((item, index) => {
            const isActive = index === safeIndex;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`post-media-thumb${isActive ? " post-media-thumb-active" : ""}`}
                onClick={() => setActiveIndex(index)}
              >
                {item.kind === "image" ? (
                  <img
                    src={item.previewUrl || item.displayUrl}
                    alt={item.alt_text || postTitle}
                    loading="lazy"
                    decoding="async"
                    width={item.width ?? undefined}
                    height={item.height ?? undefined}
                  />
                ) : item.kind === "video" ? (
                  <>
                    <video src={item.previewUrl || item.displayUrl} muted playsInline preload="none" />
                    <span className="post-media-video-badge">{text.video}</span>
                  </>
                ) : (
                  <div className="post-media-thumb__external">
                    <span>{text.link}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {lightboxOpen ? (
        <div className="post-lightbox-backdrop" onClick={closeLightbox}>
          <div className="post-lightbox" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="post-lightbox__close" onClick={closeLightbox} aria-label={text.closeMedia}>
              {text.close}
            </button>
            {orderedMedia.length > 1 ? (
              <>
                <button type="button" className="post-lightbox__nav post-lightbox__nav--prev" onClick={showPrev} aria-label={text.previousImage}>
                  {text.previousImage}
                </button>
                <button type="button" className="post-lightbox__nav post-lightbox__nav--next" onClick={showNext} aria-label={text.nextImage}>
                  {text.nextImage}
                </button>
              </>
            ) : null}
            <div className="post-lightbox__content">
              {active.kind === "image" ? (
                <img src={active.displayUrl} alt={active.alt_text || postTitle} />
              ) : active.kind === "video" ? (
                <video controls playsInline preload="metadata" src={active.displayUrl}>
                  {text.unsupportedVideo}
                </video>
              ) : (
                <a href={active.displayUrl} target="_blank" rel="noreferrer" className="post-video-card post-video-card--inline">
                  <span className="forum-tag">{text.videoLink}</span>
                  <strong>{active.alt_text || text.openExternalVideo}</strong>
                  <span className="forum-meta">{text.externalVideoHint}</span>
                </a>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
