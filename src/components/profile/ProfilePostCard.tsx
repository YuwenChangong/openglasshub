import type { ResolvedPostMedia } from "../../lib/forum-media";
import { MEDIA_ONLY_SENTINEL, sanitizeBodyForDisplay } from "../../lib/post-body";
import PostSocialActions from "../forum/PostSocialActions";

type ProfilePostCardProps = {
  id: string;
  title: string;
  body?: string | null;
  createdAt: string;
  circleName?: string | null;
  circleSlug?: string | null;
  likeCount: number;
  commentCount: number;
  mediaResolved: ResolvedPostMedia[];
  extraMeta?: string;
  interactive?: boolean;
  onLikeChange?: (liked: boolean, likeCount: number) => void;
  onBookmarkChange?: (bookmarked: boolean) => void;
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

export default function ProfilePostCard({
  id,
  title,
  body,
  createdAt,
  circleName,
  circleSlug,
  likeCount,
  commentCount,
  mediaResolved,
  extraMeta,
  interactive = false,
  onLikeChange,
  onBookmarkChange,
}: ProfilePostCardProps) {
  const previewMedia = pickPreviewMedia(mediaResolved);
  const previewImageUrl =
    previewMedia?.kind === "video" ? previewMedia.previewUrl ?? previewMedia.displayUrl : previewMedia?.displayUrl;
  const snippet = buildProfileSnippet(body);

  return (
    <article className="community-post-card profile-post-card profile-post-card--rich">
      <div className="community-post-meta-row">
        <div className="community-post-meta">
          {circleSlug && circleName ? (
            <a href={`/circles/${circleSlug}/`} className="community-post-meta__link">
              {circleName}
            </a>
          ) : null}
          <a href={`/posts/${id}/`} className="community-post-meta__link">
            {title}
          </a>
          <span>{formatTime(createdAt)}</span>
          {extraMeta ? <span>{extraMeta}</span> : null}
        </div>
      </div>

      {previewImageUrl ? (
        <a href={`/posts/${id}/`} className="profile-post-card__media" aria-label={`${title} 预览`}>
          <img src={previewImageUrl} alt="" loading="lazy" />
        </a>
      ) : null}

      {snippet ? <p className="community-post-excerpt">{snippet}</p> : null}

      <div className="profile-post-card__metrics">
        <span>点赞 {likeCount}</span>
        <span>评论 {commentCount}</span>
      </div>

      <div className="community-post-actions">
        <a href={`/posts/${id}/`} className="community-action-button community-action-button--muted">
          查看帖子
        </a>
        {interactive ? (
          <PostSocialActions
            postId={id}
            initialLikeCount={likeCount}
            compact={true}
            onLikeChange={onLikeChange}
            onBookmarkChange={onBookmarkChange}
          />
        ) : null}
      </div>
      <div className="community-post-divider" aria-hidden="true"></div>
    </article>
  );
}
