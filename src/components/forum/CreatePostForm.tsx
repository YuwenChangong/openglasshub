import { useEffect, useMemo, useRef, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

interface CircleOption {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
}

interface LocalImage {
  id: string;
  file: File;
  previewUrl: string;
}

const postTypes = [
  { value: "question", label: "求助", description: "兼容性、选购和使用问题。" },
  { value: "experience", label: "文字", description: "适合一般讨论、观察记录和补充说明。" },
  { value: "review", label: "体验/评测", description: "适合完整总结、对比和长期观察。" },
  { value: "dev", label: "开发", description: "围绕 SDK、权限、输入和系统能力讨论。" },
  { value: "news", label: "资讯", description: "适合手动整理的动态、公告和观察。" },
  { value: "feedback", label: "反馈", description: "对产品、社区和 Gaze Launcher 的建议。" },
] as const;

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGE_COUNT = 9;

function normalizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isValidVideoUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function mapAuthError(errorMessage: string): string {
  if (/Invalid login credentials/i.test(errorMessage)) return "邮箱或密码错误。";
  if (/Email not confirmed/i.test(errorMessage)) return "请先完成邮箱验证后再登录。";
  if (/User already registered/i.test(errorMessage)) return "该邮箱已经注册，请直接登录。";
  return errorMessage;
}

export default function CreatePostForm() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imagesRef = useRef<LocalImage[]>([]);
  const [ready, setReady] = useState(false);
  const [circleSlug, setCircleSlug] = useState("");
  const [type, setType] = useState("question");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [circles, setCircles] = useState<CircleOption[]>([]);
  const [images, setImages] = useState<LocalImage[]>([]);
  const [loadingCircles, setLoadingCircles] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!supabase) {
      setError("缺少 PUBLIC_SUPABASE_URL 或 PUBLIC_SUPABASE_ANON_KEY。");
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        window.location.replace(buildLoginHref("/posts/new/"));
        return;
      }
      setReady(true);
    });

    return () => {
      mounted = false;
    };
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
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
  }, []);

  function addImages(fileList: FileList | File[]) {
    const nextFiles = Array.from(fileList);
    if (!nextFiles.length) return;

    setError("");

    if (images.length + nextFiles.length > MAX_IMAGE_COUNT) {
      setError(`单帖最多上传 ${MAX_IMAGE_COUNT} 张图片。`);
      return;
    }

    const accepted: LocalImage[] = [];
    for (const file of nextFiles) {
      if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
        setError("只支持 jpg / jpeg / png / webp 图片。");
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        setError("单张图片不能超过 5MB。");
        continue;
      }

      accepted.push({
        id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    if (accepted.length > 0) {
      setImages((current) => [...current, ...accepted]);
    }
  }

  function removeImage(id: string) {
    setImages((current) => {
      const target = current.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.id !== id);
    });
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
      if (videoUrl.trim() && !isValidVideoUrl(videoUrl.trim())) {
        throw new Error("视频链接格式无效，请输入可访问的 http(s) 地址。");
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.access_token || !sessionData.session.user) {
        window.location.replace(buildLoginHref("/posts/new/"));
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
        }),
      });

      const createPayload = (await createResponse.json().catch(() => null)) as
        | { error?: string; post?: { id: string; status: string } }
        | null;

      if (!createResponse.ok || !createPayload?.post?.id) {
        throw new Error(createPayload?.error ?? `发帖失败 (${createResponse.status})`);
      }

      createdPostId = createPayload.post.id;
      const mediaPayload: Array<{
        kind: "image" | "video_link";
        storage_path?: string;
        url?: string;
        alt_text?: string;
        sort_order: number;
      }> = [];

      if (images.length > 0) {
        for (const [index, image] of images.entries()) {
          const fileName = normalizeFileName(image.file.name) || `image-${index + 1}.jpg`;
          const storagePath = `${sessionData.session.user.id}/${createdPostId}/${Date.now()}-${index}-${fileName}`;
          const { error: uploadError } = await supabase.storage
            .from("post-media")
            .upload(storagePath, image.file, {
              upsert: false,
              contentType: image.file.type,
            });

          if (uploadError) {
            throw new Error(`图片上传失败：${uploadError.message}`);
          }

          uploadedPaths.push(storagePath);
          mediaPayload.push({
            kind: "image",
            storage_path: storagePath,
            alt_text: title.trim() || image.file.name,
            sort_order: index,
          });
        }
      }

      if (videoUrl.trim()) {
        mediaPayload.push({
          kind: "video_link",
          url: videoUrl.trim(),
          alt_text: `${title.trim() || "帖子视频"} 视频链接`,
          sort_order: mediaPayload.length,
        });
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

        const mediaResult = (await mediaResponse.json().catch(() => null)) as { error?: string } | null;
        if (!mediaResponse.ok) {
          throw new Error(mediaResult?.error ?? `媒体写入失败 (${mediaResponse.status})`);
        }
      }

      images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      setTitle("");
      setBody("");
      setVideoUrl("");
      setImages([]);
      const createdStatus = createPayload.post.status ?? "pending";
      if (createdStatus === "published") {
        setMessage("发布成功，正在跳转到帖子页面。");
        window.location.assign(`/posts/${createdPostId}/`);
        return;
      }
      setMessage("帖子已提交，正在等待审核。审核通过后会出现在公开动态里。");
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

  if (error && !ready && !loadingCircles) {
    return <section className="post-composer"><div className="auth-alert auth-alert--error">{error}</div></section>;
  }

  if (!ready) {
    return <section className="post-composer"><div className="auth-alert">正在检查登录状态...</div></section>;
  }

  return (
    <section className="post-composer">
      <div className="post-composer__intro">
        <h2>发布帖子</h2>
        <p>文字、图片和外部视频链接都可以从这里发布。图片会存到受 RLS 控制的媒体桶，视频当前只支持外部链接，不做原生视频上传。</p>
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
          <select
            className="community-input"
            value={circleSlug}
            onChange={(event) => setCircleSlug(event.target.value)}
            disabled={loadingCircles}
            required
          >
            {circles.map((circle) => (
              <option key={circle.id} value={circle.slug}>
                {circle.name}
              </option>
            ))}
          </select>
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
            minLength={10}
            maxLength={20000}
            required
          />
        </label>

        <div className="media-upload-block">
          <div className="post-composer__label-row">
            <span className="post-composer__label">图片</span>
            <span className="community-meta">单图 5MB 以内，最多 9 张</span>
          </div>
          <button
            type="button"
            className="media-dropzone"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (event.dataTransfer.files) {
                addImages(event.dataTransfer.files);
              }
            }}
          >
            <strong>拖拽图片到这里，或点击选择文件</strong>
            <span>支持 jpg / jpeg / png / webp</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) {
                addImages(event.target.files);
                event.target.value = "";
              }
            }}
          />
          {images.length > 0 && (
            <div className="media-preview-grid">
              {images.map((image) => (
                <figure key={image.id} className="media-preview-card">
                  <img src={image.previewUrl} alt={image.file.name} />
                  <figcaption>
                    <span>{image.file.name}</span>
                    <button type="button" onClick={() => removeImage(image.id)}>
                      删除
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>

        <label>
          <span className="post-composer__label">视频链接</span>
          <input
            className="community-input"
            type="url"
            placeholder="https://www.youtube.com/... 或 https://www.bilibili.com/..."
            value={videoUrl}
            onChange={(event) => setVideoUrl(event.target.value)}
          />
        </label>

        {videoUrl.trim() && (
          <div className="video-link-preview">
            <strong>视频链接预览</strong>
            <a href={videoUrl.trim()} target="_blank" rel="noreferrer">
              {videoUrl.trim()}
            </a>
            <span>当前阶段只保存外部视频链接，不做站内原生视频上传。</span>
          </div>
        )}

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
