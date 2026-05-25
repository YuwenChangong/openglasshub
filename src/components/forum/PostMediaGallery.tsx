import { useMemo, useState } from "react";
import type { ResolvedPostMedia } from "../../lib/forum-media";

interface Props {
  media: ResolvedPostMedia[];
  postTitle: string;
}

function getInitialIndex(media: ResolvedPostMedia[]): number {
  const coverIndex = media.findIndex((item) => item.is_cover);
  return coverIndex >= 0 ? coverIndex : 0;
}

export default function PostMediaGallery({ media, postTitle }: Props) {
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

  if (orderedMedia.length === 0) return null;

  const safeIndex = Math.min(activeIndex, orderedMedia.length - 1);
  const active = orderedMedia[safeIndex];

  return (
    <section className="post-media-gallery">
      <div className="post-media-main">
        {active.kind === "image" ? (
          <img
            src={active.displayUrl}
            alt={active.alt_text || postTitle}
            loading="eager"
          />
        ) : active.kind === "video" ? (
          <video controls playsInline preload="metadata" src={active.displayUrl}>
            浏览器不支持该视频。
          </video>
        ) : (
          <a href={active.displayUrl} target="_blank" rel="noreferrer" className="post-video-card post-video-card--inline">
            <span className="forum-tag">视频链接</span>
            <strong>{active.alt_text || "打开外部视频"}</strong>
            <span className="forum-meta">在新窗口查看外部视频内容。</span>
          </a>
        )}
      </div>

      {orderedMedia.length > 1 && (
        <div className="post-media-thumbs" role="tablist" aria-label="帖子媒体缩略图">
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
                  <img src={item.previewUrl || item.displayUrl} alt={item.alt_text || postTitle} loading="lazy" />
                ) : item.kind === "video" ? (
                  <>
                    <video src={item.previewUrl || item.displayUrl} muted playsInline preload="metadata" />
                    <span className="post-media-video-badge">视频</span>
                  </>
                ) : (
                  <div className="post-media-thumb__external">
                    <span>链接</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
