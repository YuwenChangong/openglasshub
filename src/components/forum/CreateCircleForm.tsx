import { useEffect, useMemo, useRef, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { uploadToPostMediaWithTus } from "../../lib/storage-tus";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";

const circleTypes = [
  { value: "topic", label: "通用话题" },
  { value: "device", label: "设备圈子" },
  { value: "project", label: "项目圈子" },
] as const;

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

function normalizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function mapCircleError(message: string) {
  if (message.includes("NOT_AUTHENTICATED")) return "登录状态已失效，请重新登录后再创建圈子。";
  if (message.includes("CIRCLE_NAME_ALREADY_EXISTS")) return "圈子名称已存在，请换一个名称。";
  if (message.includes("CIRCLE_SLUG_ALREADY_EXISTS")) return "圈子标识已存在，请换一个标识。";
  if (message.includes("CIRCLE_OWNER_RLS_NOT_READY")) return "数据库还没有准备好 owner/RLS，请先执行最新 migration。";
  if (message.includes("PROFILE_NOT_FOUND")) return "当前账号缺少 profile，请先重新登录或补齐资料。";
  if (message.includes("CIRCLE_CREATE_FAILED")) return "圈子创建失败，请稍后重试。";
  return message;
}

export default function CreateCircleForm() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const authState = useBrowserAuthState(supabase);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<(typeof circleTypes)[number]["value"]>("topic");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setSlug((current) => {
      const next = createSlug(name);
      if (!current || current === createSlug(current)) return next;
      return current;
    });
  }, [name]);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  function handleSelectImage(file: File | null) {
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setError("圈子图片只支持 jpg / png / webp / gif。");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setError("圈子图片不能超过 5MB。");
      return;
    }

    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setError("");
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function clearImage() {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");
    let uploadedPath = "";

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (sessionError || !session?.access_token || !session.user) {
        throw new Error("NOT_AUTHENTICATED");
      }

      const nextName = name.trim();
      const nextSlug = createSlug(slug || name);
      const nextDescription = description.trim();

      if (nextName.length < 2 || nextName.length > 40) {
        throw new Error("圈子名称需要在 2 - 40 个字符之间。");
      }
      if (!nextSlug || nextSlug.length < 2 || nextSlug.length > 80) {
        throw new Error("圈子标识需要在 2 - 80 个字符之间。");
      }
      if (nextDescription.length > 200) {
        throw new Error("圈子简介最多 200 个字符。");
      }

      if (imageFile) {
        uploadedPath = `circles/${session.user.id}/${Date.now()}-${normalizeFileName(imageFile.name)}`;
        await uploadToPostMediaWithTus({
          file: imageFile,
          objectPath: uploadedPath,
          accessToken: session.access_token,
        });
      }

      const response = await fetch("/api/forum/circles", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          slug: nextSlug,
          name: nextName,
          description: nextDescription,
          type,
          image_path: uploadedPath || null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { circle?: { slug?: string }; error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? `CIRCLE_CREATE_FAILED (${response.status})`);
      }

      setMessage("圈子创建成功，正在跳转。");
      window.location.assign(`/circles/${payload?.circle?.slug || nextSlug}/`);
    } catch (submitError) {
      if (uploadedPath) {
        await supabase.storage.from("post-media").remove([uploadedPath]).catch(() => undefined);
      }

      const nextMessage = submitError instanceof Error ? submitError.message : "CIRCLE_CREATE_FAILED";
      if (nextMessage === "NOT_AUTHENTICATED") {
        window.location.replace(buildLoginHref("/circles/"));
        return;
      }
      setError(mapCircleError(nextMessage));
    } finally {
      setSubmitting(false);
    }
  }

  if (authState.status === "checking") {
    return (
      <section className="community-surface community-surface--padded create-circle-form">
        <div className="community-section-head">
          <div>
            <h2>创建圈子</h2>
            <p>正在检查登录状态，稍后即可创建圈子。</p>
          </div>
        </div>
        <div className="community-cta-row">
          <button type="button" className="community-action-button community-action-button--muted" disabled>
            检查登录状态...
          </button>
        </div>
      </section>
    );
  }

  if (authState.status !== "signed_in") {
    return (
      <section className="community-surface community-surface--padded create-circle-form">
        <div className="community-section-head">
          <div>
            <h2>创建圈子</h2>
            <p>登录后即可创建自己的讨论空间。</p>
          </div>
        </div>
        <div className="community-cta-row">
          <a href={buildLoginHref("/circles/")} className="community-action-button community-action-button--primary">
            去登录
          </a>
        </div>
      </section>
    );
  }

  if (!expanded) {
    return (
      <section className="community-surface community-surface--padded create-circle-form">
        <div className="community-section-head">
          <div>
            <h2>创建圈子</h2>
            <p>创建自己的圈子，并由 owner 或管理员继续维护。</p>
          </div>
        </div>
        {error ? <span className="inline-error">{error}</span> : null}
        {message ? <span className="inline-success">{message}</span> : null}
        <div className="community-cta-row">
          <button
            type="button"
            className="community-action-button community-action-button--primary"
            onClick={() => setExpanded(true)}
          >
            创建圈子
          </button>
        </div>
      </section>
    );
  }

  return (
    <form className="community-surface community-surface--padded create-circle-form" onSubmit={handleSubmit}>
      <div className="community-section-head">
        <div>
          <h2>创建圈子</h2>
          <p>创建自己的圈子，并由 owner 或管理员继续维护。</p>
        </div>
      </div>

      <div className="create-circle-form__grid">
        <label className="create-circle-form__field">
          <span>圈子名称</span>
          <input
            className="community-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如 Brilliant Labs"
            maxLength={40}
            disabled={submitting}
          />
        </label>

        <label className="create-circle-form__field">
          <span>圈子标识</span>
          <input
            className="community-input"
            value={slug}
            onChange={(event) => setSlug(createSlug(event.target.value))}
            placeholder="brilliant-labs"
            maxLength={80}
            disabled={submitting}
          />
        </label>

        <label className="create-circle-form__field create-circle-form__field--full">
          <span>圈子简介（可选）</span>
          <textarea
            className="community-input community-input--textarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="说明这个圈子主要讨论什么，方便其他人判断是否加入。"
            maxLength={200}
            disabled={submitting}
          />
        </label>

        <label className="create-circle-form__field">
          <span>圈子类型</span>
          <select
            className="community-input"
            value={type}
            onChange={(event) => setType(event.target.value as (typeof circleTypes)[number]["value"])}
            disabled={submitting}
          >
            {circleTypes.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <div className="create-circle-form__field">
          <span>圈子图片</span>
          <div className="create-circle-form__image-row">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(event) => handleSelectImage(event.target.files?.[0] ?? null)}
              disabled={submitting}
            />
            {imageFile ? (
              <button type="button" className="community-button--secondary" onClick={clearImage} disabled={submitting}>
                移除图片
              </button>
            ) : null}
          </div>
          {imagePreview ? (
            <div className="create-circle-form__preview">
              <img src={imagePreview} alt="圈子封面预览" />
            </div>
          ) : null}
        </div>
      </div>

      {error ? <span className="inline-error">{error}</span> : null}
      {message ? <span className="inline-success">{message}</span> : null}

      <div className="community-cta-row">
        <button
          type="button"
          className="community-action-button community-action-button--muted"
          disabled={submitting}
          onClick={() => setExpanded(false)}
        >
          收起
        </button>
        <button type="submit" className="community-button" disabled={submitting}>
          {submitting ? "创建中..." : "创建圈子"}
        </button>
      </div>
    </form>
  );
}
