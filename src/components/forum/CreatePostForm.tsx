import { useEffect, useMemo, useRef, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createOptimizedImageVariant } from "../../lib/client-image";
import { uploadToPostMediaWithTus } from "../../lib/storage-tus";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";

interface CircleOption {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
}

interface LocalMedia {
  id: string;
  file: File;
  thumbnailFile: File | null;
  previewUrl: string;
  kind: "image" | "video";
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  sizeBytes: number;
  mimeType: string;
  isCover: boolean;
}

const postTypes = [
  { value: "question", label: "求助", description: "兼容性、选购和使用问题。" },
  { value: "experience", label: "文字", description: "适合一般讨论、观察记录和补充说明。" },
  { value: "review", label: "体验/评测", description: "适合完整总结、对比和长期观察。" },
  { value: "dev", label: "开发", description: "围绕 SDK、权限、输入和系统能力讨论。" },
  { value: "news", label: "资讯", description: "适合手动整理的动态、公告和观察。" },
  { value: "feedback", label: "反馈", description: "对产品、社区和 Gaze Launcher 的建议。" },
] as const;

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ACCEPTED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const MAX_IMAGE_SIZE = 50 * 1024 * 1024;
const MAX_VIDEO_SIZE = 150 * 1024 * 1024;
const MAX_MEDIA_COUNT = 6;
const MAX_TOTAL_SIZE = 150 * 1024 * 1024;

function normalizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes >= 50 * 1024 * 1024 ? 0 : 1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remain = totalSeconds % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

function formatDimensions(width: number | null, height: number | null): string {
  if (!width || !height) return "";
  return `${width} × ${height}`;
}

function withSingleCover(items: LocalMedia[], preferredId?: string): LocalMedia[] {
  if (items.length === 0) return items;
  const coverId = preferredId ?? items.find((item) => item.isCover)?.id ?? items[0].id;
  return items.map((item) => ({
    ...item,
    isCover: item.id === coverId,
  }));
}

function readImageMetadata(file: File, previewUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => reject(new Error(`无法读取图片元信息：${file.name}`));
    image.src = previewUrl;
  });
}

function readVideoMetadata(
  file: File,
  previewUrl: string,
): Promise<{ width: number; height: number; durationSeconds: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
      });
    };
    video.onerror = () => reject(new Error(`无法读取视频元信息：${file.name}`));
    video.src = previewUrl;
  });
}

function mapAuthError(errorMessage: string): string {
  if (/RATE_LIMITED/i.test(errorMessage)) return "操作过于频繁，请稍后再试。";
  if (/TURNSTILE_REQUIRED|TURNSTILE_INVALID/i.test(errorMessage)) {
    return "当前上传需要额外安全验证，请稍后重试。";
  }
  if (/CONTENT_REJECTED/i.test(errorMessage)) {
    return "这篇帖子可能违反社区规则，暂时无法发布。";
  }
  if (/INVALID_POST_BODY/i.test(errorMessage)) return "正文至少需要 1 个字符，且不能超过 50000 个字符。";
  if (/Invalid login credentials/i.test(errorMessage)) return "邮箱或密码错误。";
  if (/Email not confirmed/i.test(errorMessage)) return "请先完成邮箱验证后再登录。";
  if (/User already registered/i.test(errorMessage)) return "该邮箱已经注册，请直接登录。";
  if (/exceeded the maximum allowed size/i.test(errorMessage)) {
    return "视频上传失败。";
  }
  return errorMessage;
}

async function uploadVideoToExternal(params: {
  accessToken: string;
  postId: string;
  file: File;
}): Promise<{ mediaUrl: string; storagePath: string }> {
  const { accessToken, postId, file } = params;
  const ticketResponse = await fetch("/api/forum/external-video-upload", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      post_id: postId,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    }),
  });

  const ticketPayload = (await ticketResponse.json().catch(() => null)) as
    | {
        error?: string;
        code?: string;
        upload_url?: string;
        media_url?: string;
        storage_path?: string;
      }
    | null;

  if (
    !ticketResponse.ok ||
    !ticketPayload?.upload_url ||
    !ticketPayload.media_url ||
    !ticketPayload.storage_path
  ) {
    throw new Error(
      ticketPayload?.code
        ? `${ticketPayload.code}: ${ticketPayload?.error ?? ""}`
        : ticketPayload?.error ?? `视频上传初始化失败 (${ticketResponse.status})`,
    );
  }

  const uploadResponse = await fetch(ticketPayload.upload_url, {
    method: "PUT",
    headers: {
      "content-type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text().catch(() => "");
    throw new Error(errorText || `视频上传失败 (${uploadResponse.status})`);
  }

  return { mediaUrl: ticketPayload.media_url, storagePath: ticketPayload.storage_path };
}

type Props = {
  initialTitle?: string;
  initialBody?: string;
  nextPath?: string;
  discussionDeviceName?: string;
};

export default function CreatePostForm({
  initialTitle = "",
  initialBody = "",
  nextPath = "/posts/new/",
  discussionDeviceName,
}: Props) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const circlePickerRef = useRef<HTMLDivElement | null>(null);
  const circleButtonRef = useRef<HTMLButtonElement | null>(null);
  const mediaFilesRef = useRef<LocalMedia[]>([]);
  const [circleSlug, setCircleSlug] = useState("");
  const [type, setType] = useState("question");
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [circles, setCircles] = useState<CircleOption[]>([]);
  const [circleMenuOpen, setCircleMenuOpen] = useState(false);
  const [circleActiveIndex, setCircleActiveIndex] = useState(0);
  const [mediaFiles, setMediaFiles] = useState<LocalMedia[]>([]);
  const [loadingCircles, setLoadingCircles] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const authState = useBrowserAuthState(supabase);

  useEffect(() => {
    if (!supabase) {
      setError("缺少 PUBLIC_SUPABASE_URL 或 PUBLIC_SUPABASE_ANON_KEY。");
    }
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    async function fetchCircles() {
      setLoadingCircles(true);
      try {
        const response = await fetch("/api/forum/circles");
        const payload = (await response.json().catch(() => null)) as
          | { circles?: CircleOption[]; error?: string }
          | null;

        if (cancelled) return;
        if (!response.ok) {
          throw new Error(payload?.error ?? `请求失败 (${response.status})`);
        }

        const nextCircles = payload?.circles ?? [];
        setCircles(nextCircles);
        if (nextCircles[0] && !circleSlug) {
          setCircleSlug(nextCircles[0].slug);
          setCircleActiveIndex(0);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "加载圈子失败。");
        }
      } finally {
        if (!cancelled) {
          setLoadingCircles(false);
        }
      }
    }

    fetchCircles();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    mediaFilesRef.current = mediaFiles;
  }, [mediaFiles]);

  useEffect(() => {
    if (!circleMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!circlePickerRef.current?.contains(event.target as Node)) {
        setCircleMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCircleMenuOpen(false);
        circleButtonRef.current?.focus();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [circleMenuOpen]);

  useEffect(() => {
    return () => {
      mediaFilesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  async function guardDirectMediaUpload(params: {
    accessToken: string;
    sizeBytes: number;
    uploadKind: "post_media" | "circle_cover";
  }) {
    const response = await fetch("/api/forum/media-upload-guard", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({
        upload_kind: params.uploadKind,
        size_bytes: params.sizeBytes,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; code?: string }
      | null;

    if (!response.ok) {
      throw new Error(
        payload?.code ? `${payload.code}: ${payload.error ?? ""}` : payload?.error ?? `上传校验失败 (${response.status})`,
      );
    }
  }

  async function addMediaFiles(fileList: FileList | File[]) {
    const nextFiles = Array.from(fileList);
    if (!nextFiles.length) return;

    setError("");

    if (mediaFiles.length + nextFiles.length > MAX_MEDIA_COUNT) {
      setError(`单帖最多上传 ${MAX_MEDIA_COUNT} 个媒体文件。`);
      return;
    }

    const currentTotalSize = mediaFiles.reduce((sum, item) => sum + item.file.size, 0);
    let videoCount = mediaFiles.filter((item) => item.kind === "video").length;
    let nextTotalSize = currentTotalSize;
    const accepted: LocalMedia[] = [];

    for (const file of nextFiles) {
      const isImage = ACCEPTED_IMAGE_TYPES.has(file.type);
      const isVideo = ACCEPTED_VIDEO_TYPES.has(file.type);
      if (!isImage && !isVideo) {
        setError("只支持 jpg / png / webp / gif 图片，以及 mp4 / webm / mov 视频。");
        continue;
      }
      if (isImage && file.size > MAX_IMAGE_SIZE) {
        setError("单张图片不能超过 50MB。");
        continue;
      }
      if (isVideo && file.size > MAX_VIDEO_SIZE) {
        setError("单个视频不能超过 150MB。");
        continue;
      }
      if (isVideo && videoCount >= 1) {
        setError("每个帖子最多上传 1 个视频。");
        continue;
      }
      nextTotalSize += file.size;
      if (nextTotalSize > MAX_TOTAL_SIZE) {
        setError("单帖媒体总大小不能超过 150MB。");
        continue;
      }

      const previewUrl = URL.createObjectURL(file);
      const id = `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;

      try {
        if (isVideo) {
          videoCount += 1;
          const metadata = await readVideoMetadata(file, previewUrl);
          accepted.push({
            id,
            file,
            thumbnailFile: null,
            previewUrl,
            kind: "video",
            width: metadata.width,
            height: metadata.height,
            durationSeconds: metadata.durationSeconds,
            sizeBytes: file.size,
            mimeType: file.type,
            isCover: false,
          });
        } else {
          URL.revokeObjectURL(previewUrl);
          const optimizedUpload = await createOptimizedImageVariant(file, {
            maxWidth: 1600,
            quality: 0.82,
          });
          const optimizedThumb = await createOptimizedImageVariant(file, {
            maxWidth: 480,
            quality: 0.72,
            fileName: `${file.name.replace(/\.[a-z0-9]+$/i, "")}-thumb`,
          });
          const optimizedPreviewUrl = URL.createObjectURL(optimizedUpload.file);
          const metadata = await readImageMetadata(optimizedUpload.file, optimizedPreviewUrl);
          accepted.push({
            id,
            file: optimizedUpload.file,
            thumbnailFile: optimizedThumb.file !== optimizedUpload.file ? optimizedThumb.file : null,
            previewUrl: optimizedPreviewUrl,
            kind: "image",
            width: optimizedUpload.width || metadata.width,
            height: optimizedUpload.height || metadata.height,
            durationSeconds: null,
            sizeBytes: optimizedUpload.file.size,
            mimeType: optimizedUpload.mimeType || optimizedUpload.file.type,
            isCover: false,
          });
        }
      } catch (metadataError) {
        URL.revokeObjectURL(previewUrl);
        setError(metadataError instanceof Error ? metadataError.message : "读取媒体元信息失败。");
      }
    }

    if (accepted.length > 0) {
      setMediaFiles((current) => withSingleCover([...current, ...accepted]));
    }
  }

  function removeMedia(id: string) {
    setMediaFiles((current) => {
      const target = current.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return withSingleCover(current.filter((item) => item.id !== id));
    });
  }

  function markAsCover(id: string) {
    setMediaFiles((current) => withSingleCover(current, id));
  }

  function selectCircle(slug: string) {
    const nextIndex = circles.findIndex((circle) => circle.slug === slug);
    setCircleSlug(slug);
    setCircleActiveIndex(nextIndex >= 0 ? nextIndex : 0);
    setCircleMenuOpen(false);
    circleButtonRef.current?.focus();
  }

  async function rollbackPendingPost(token: string, postId: string) {
    await fetch(`/api/forum/posts?id=${encodeURIComponent(postId)}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`,
      },
    }).catch(() => undefined);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;

    setSubmitting(true);
    setError("");
    setMessage("");

    const uploadedPaths: string[] = [];
    let createdPostId = "";
    let accessToken = "";

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.access_token || !sessionData.session.user) {
        window.location.replace(buildLoginHref(nextPath));
        return;
      }

      accessToken = sessionData.session.access_token;

      const createResponse = await fetch("/api/forum/posts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          circle_slug: circleSlug.trim(),
          type: type.trim(),
          title: title.trim(),
          body: body.trim(),
          has_media: mediaFiles.length > 0,
        }),
      });

      const createPayload = (await createResponse.json().catch(() => null)) as
        | { error?: string; code?: string; post?: { id: string; status: string }; pending_review?: boolean; message?: string }
        | null;

      if (!createResponse.ok || !createPayload?.post?.id) {
        throw new Error(
          createPayload?.code ? `${createPayload.code}: ${createPayload?.error ?? ""}` : createPayload?.error ?? `发帖失败 (${createResponse.status})`,
        );
      }

      createdPostId = createPayload.post.id;
      const mediaPayload: Array<{
        kind: "image" | "video";
        storage_path?: string;
        url?: string;
        thumbnail_url?: string;
        alt_text?: string;
        sort_order: number;
        width?: number | null;
        height?: number | null;
        duration_seconds?: number | null;
        size_bytes?: number | null;
        mime_type?: string | null;
        is_cover?: boolean;
      }> = [];

      if (mediaFiles.length > 0) {
        for (const [index, item] of mediaFiles.entries()) {
          if (item.kind === "video") {
            try {
              const uploaded = await uploadVideoToExternal({
                accessToken,
                postId: createdPostId,
                file: item.file,
              });
              mediaPayload.push({
                kind: "video",
                storage_path: uploaded.storagePath,
                alt_text: title.trim() || item.file.name,
                sort_order: index,
                width: item.width,
                height: item.height,
                duration_seconds: item.durationSeconds,
                size_bytes: item.sizeBytes,
                mime_type: item.mimeType,
                is_cover: item.isCover,
              });
            } catch (uploadError) {
              const uploadMessage = uploadError instanceof Error ? uploadError.message : "未知错误";
              const canFallbackToSupabase =
                /Missing required env var: R2_/i.test(uploadMessage) ||
                /视频上传初始化失败 \(500\)/i.test(uploadMessage) ||
                /Failed to fetch/i.test(uploadMessage) ||
                /NetworkError/i.test(uploadMessage) ||
                /Load failed/i.test(uploadMessage);

              if (!canFallbackToSupabase) {
                throw new Error(`视频上传失败：${uploadMessage}`);
              }

              const fileName = normalizeFileName(item.file.name) || `video-${index + 1}.mp4`;
              const storagePath = `${sessionData.session.user.id}/${createdPostId}/${Date.now()}-${index}-${fileName}`;
              try {
                await guardDirectMediaUpload({
                  accessToken,
                  sizeBytes: item.sizeBytes,
                  uploadKind: "post_media",
                });
                await uploadToPostMediaWithTus({
                  file: item.file,
                  objectPath: storagePath,
                  accessToken,
                });
              } catch (fallbackError) {
                const fallbackMessage =
                  fallbackError instanceof Error ? fallbackError.message : "未知错误";
                throw new Error(`视频上传失败：${fallbackMessage}`);
              }
              uploadedPaths.push(storagePath);
              mediaPayload.push({
                kind: "video",
                storage_path: storagePath,
                alt_text: title.trim() || item.file.name,
                sort_order: index,
                width: item.width,
                height: item.height,
                duration_seconds: item.durationSeconds,
                size_bytes: item.sizeBytes,
                mime_type: item.mimeType,
                is_cover: item.isCover,
              });
            }
            continue;
          }

          const fileName = normalizeFileName(item.file.name) || `image-${index + 1}.jpg`;
          const storagePath = `${sessionData.session.user.id}/${createdPostId}/${Date.now()}-${index}-${fileName}`;
          const thumbnailPath = item.thumbnailFile
            ? `${sessionData.session.user.id}/${createdPostId}/thumb-${Date.now()}-${index}-${normalizeFileName(item.thumbnailFile.name || fileName)}`
            : "";
          try {
            await guardDirectMediaUpload({
              accessToken,
              sizeBytes: item.sizeBytes,
              uploadKind: "post_media",
            });
            await uploadToPostMediaWithTus({
              file: item.file,
              objectPath: storagePath,
              accessToken,
            });
            if (item.thumbnailFile && thumbnailPath) {
              await uploadToPostMediaWithTus({
                file: item.thumbnailFile,
                objectPath: thumbnailPath,
                accessToken,
              });
            }
          } catch (uploadError) {
            const uploadMessage = uploadError instanceof Error ? uploadError.message : "未知错误";
            throw new Error(`图片上传失败：${uploadMessage}`);
          }

          uploadedPaths.push(storagePath);
          if (thumbnailPath) {
            uploadedPaths.push(thumbnailPath);
          }
          mediaPayload.push({
            kind: "image",
            storage_path: storagePath,
            thumbnail_url: thumbnailPath || undefined,
            alt_text: title.trim() || item.file.name,
            sort_order: index,
            width: item.width,
            height: item.height,
            duration_seconds: item.durationSeconds,
            size_bytes: item.sizeBytes,
            mime_type: item.mimeType,
            is_cover: item.isCover,
          });
        }
      }

      if (mediaPayload.length > 0) {
        const mediaResponse = await fetch("/api/forum/post-media", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            post_id: createdPostId,
            media: mediaPayload,
          }),
        });

        const mediaResult = (await mediaResponse.json().catch(() => null)) as
          | {
              error?: string;
              message?: string;
              reason_code?: string | null;
              post?: { id: string; status?: string | null; moderation_status?: string | null };
              pending_review?: boolean;
              rejected?: boolean;
            }
          | null;
        if (!mediaResponse.ok) {
          throw new Error(mediaResult?.error ?? `媒体写入失败 (${mediaResponse.status})`);
        }

        if (mediaResult?.post?.status) {
          createPayload.post.status = mediaResult.post.status;
        }
        if (typeof mediaResult?.pending_review === "boolean") {
          createPayload.pending_review = mediaResult.pending_review;
        }
        if (mediaResult?.message) {
          createPayload.message = mediaResult.message;
        }
        if (
          mediaResult?.pending_review &&
          mediaResult?.reason_code &&
          /video_thumbnail_missing_review|video_thumbnail_required_review|openai_video_thumbnail_missing_review/i.test(
            mediaResult.reason_code,
          )
        ) {
          createPayload.message = "视频已提交审核。";
        }
      }

      mediaFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setTitle("");
      setBody("");
      setMediaFiles([]);

      const createdStatus = createPayload.post.status ?? "published";
      if (createdStatus === "published") {
        setMessage(createPayload.message || "发布成功，正在跳转到帖子页面。");
        window.location.assign(`/posts/${createdPostId}/`);
        return;
      }
      setMessage(createPayload.message || (createPayload.pending_review ? "帖子已提交审核。" : "发布成功。"));
    } catch (submitError) {
      if (uploadedPaths.length > 0) {
        await supabase.storage.from("post-media").remove(uploadedPaths).catch(() => undefined);
      }
      if (createdPostId && accessToken) {
        await rollbackPendingPost(accessToken, createdPostId);
      }

      const rawMessage = submitError instanceof Error ? submitError.message : "提交失败。";
      setError(mapAuthError(rawMessage));
    } finally {
      setSubmitting(false);
    }
  }

  if (error && authState.status !== "signed_in" && !loadingCircles) {
    return <section className="post-composer"><div className="auth-alert auth-alert--error">{error}</div></section>;
  }

  if (authState.status === "checking") {
    return <section className="post-composer"><div className="auth-alert">正在检查登录状态...</div></section>;
  }

  if (authState.status !== "signed_in") {
    return (
      <section className="post-composer">
        <div className="auth-alert">
          <a href={buildLoginHref(nextPath)} className="community-link">登录后继续发帖</a>
        </div>
      </section>
    );
  }

  const selectedCircle =
    circles.find((circle) => circle.slug === circleSlug) ??
    circles[0] ??
    null;

  return (
    <section className="post-composer">
      <div className="post-composer__intro">
        <h2>发布帖子</h2>
        {discussionDeviceName ? <p>已根据 {discussionDeviceName} 设备页带入一个中性讨论草稿，可继续修改。</p> : null}
      </div>

      <form onSubmit={handleSubmit} className="post-composer__form">
        <div>
          <label className="post-composer__label">帖子类型</label>
          <div className="post-type-grid">
            {postTypes.map((option) => {
              const active = type === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setType(option.value)}
                  className={`post-type-option${active ? " is-active" : ""}`}
                >
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        <label>
          <span className="post-composer__label">圈子</span>
          <div className={`community-select${circleMenuOpen ? " is-open" : ""}${loadingCircles ? " is-disabled" : ""}`} ref={circlePickerRef}>
            <input type="hidden" name="circle_slug" value={circleSlug} />
            <button
              ref={circleButtonRef}
              type="button"
              className="community-select__trigger"
              onClick={() => {
                if (loadingCircles || circles.length === 0) return;
                setCircleMenuOpen((current) => !current);
              }}
              disabled={loadingCircles || circles.length === 0}
              aria-haspopup="listbox"
              aria-expanded={circleMenuOpen}
            >
              <span className="community-select__content">
                <strong>{selectedCircle?.name ?? (loadingCircles ? "正在加载圈子..." : "暂无可选圈子")}</strong>
                <span>{selectedCircle?.description || "选择要发布到的圈子"}</span>
              </span>
              <span className="community-select__chevron" aria-hidden="true">⌄</span>
            </button>
            {circleMenuOpen ? (
              <div className="community-select__menu" role="listbox" aria-label="圈子列表">
                {circles.map((circle, index) => {
                  const active = circle.slug === circleSlug;
                  return (
                    <button
                      key={circle.id}
                      type="button"
                      className={`community-select__option${active ? " is-selected" : ""}${circleActiveIndex === index ? " is-active" : ""}`}
                      onClick={() => selectCircle(circle.slug)}
                      onMouseEnter={() => setCircleActiveIndex(index)}
                      role="option"
                      aria-selected={active}
                    >
                      <strong>{circle.name}</strong>
                      <span>{circle.description || circle.slug}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </label>

        <label>
          <span className="post-composer__label">标题</span>
          <input
            className="community-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            minLength={3}
            maxLength={180}
            required
          />
        </label>

        <label>
          <span className="post-composer__label">正文</span>
          <textarea
            className="community-input community-input--textarea"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={50000}
          />
        </label>

        <div className="media-upload-block">
          <div className="post-composer__label-row">
            <span className="post-composer__label">媒体文件</span>
          </div>
          <button
            type="button"
            className="media-dropzone"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (event.dataTransfer.files) {
                addMediaFiles(event.dataTransfer.files);
              }
            }}
          >
            <strong>拖拽图片或视频到这里，或点击选择文件</strong>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/mp4,video/webm,video/quicktime"
            multiple
            hidden
            onChange={async (event) => {
              if (event.target.files) {
                await addMediaFiles(event.target.files);
                event.target.value = "";
              }
            }}
          />
          {mediaFiles.length > 0 && (
            <div className="media-preview-grid">
              {mediaFiles.map((item) => (
                <figure key={item.id} className="media-preview-card">
                  <div className="media-preview-card__visual">
                    {item.kind === "video" ? (
                      <video src={item.previewUrl} muted playsInline preload="metadata" />
                    ) : (
                      <img src={item.previewUrl} alt={item.file.name} />
                    )}
                    {item.kind === "video" ? <span className="media-preview-card__badge">视频</span> : null}
                    {item.isCover ? <span className="media-preview-card__badge media-preview-card__badge--cover">封面</span> : null}
                  </div>
                  <figcaption>
                    <div className="media-preview-card__meta">
                      <strong title={item.file.name}>{item.file.name}</strong>
                      <span>{formatBytes(item.sizeBytes)}</span>
                      <span>
                        {item.kind === "video"
                          ? `${formatDimensions(item.width, item.height) || "视频"}${item.durationSeconds != null ? ` · ${formatDuration(item.durationSeconds)}` : ""}`
                          : formatDimensions(item.width, item.height) || "图片"}
                      </span>
                    </div>
                    <div className="media-preview-card__actions">
                      <button type="button" onClick={() => markAsCover(item.id)} disabled={item.isCover}>
                        {item.isCover ? "当前封面" : "设为封面"}
                      </button>
                      <button type="button" onClick={() => removeMedia(item.id)}>
                        删除
                      </button>
                    </div>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>

        <div className="community-cta-row">
          <button type="submit" className="community-button post-composer__submit" disabled={submitting || loadingCircles}>
            {submitting ? "提交中..." : "提交帖子"}
          </button>
        </div>
      </form>

      <div className="post-composer__feedback">
        {error ? <div className="auth-alert auth-alert--error">{error}</div> : null}
        {message ? <div className="auth-alert auth-alert--success">{message}</div> : null}
      </div>
    </section>
  );
}
