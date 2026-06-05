import { useMemo, useRef, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { uploadToPostMediaWithTus } from "../../lib/storage-tus";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { useBrowserAuthState } from "../auth/useBrowserAuthState";
import { useInvisibleTurnstile } from "./useInvisibleTurnstile";

interface CircleCoverEditorProps {
  circleId: string;
  circleSlug: string;
  supportsExtendedSchema: boolean;
  ownerId: string | null;
  onUpdated?: (imagePath: string | null, coverUrl?: string | null) => void;
}

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

function normalizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapCoverError(message: string) {
  if (/TURNSTILE_REQUIRED/i.test(message)) return "请先完成安全验证后再上传封面。";
  if (/TURNSTILE_INVALID/i.test(message)) return "封面验证失败，请刷新页面后重试。";
  if (/RATE_LIMITED/i.test(message)) return "上传过于频繁，请稍后再试。";
  return message;
}

export default function CircleCoverEditor({
  circleId,
  circleSlug,
  supportsExtendedSchema,
  ownerId,
  onUpdated,
}: CircleCoverEditorProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const authState = useBrowserAuthState(supabase);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const canEdit = authState.status === "signed_in" && !!authState.user;
  const {
    siteKeyEnabled,
    ready: turnstileReady,
    error: turnstileError,
    containerRef,
    ensureToken,
    resetToken,
  } = useInvisibleTurnstile("封面验证失败，请刷新后重试。");

  async function getSessionToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }

  async function updateCircleCover(imagePath: string | null, token: string) {
    const response = await fetch(`/api/forum/circles/${circleSlug}/manage`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        id: circleId,
        image_path: imagePath,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; circle?: { cover_url?: string | null } }
      | null;
    if (!response.ok) {
      throw new Error(payload?.error ?? `更新封面失败 (${response.status})`);
    }
    return payload?.circle?.cover_url ?? null;
  }

  async function guardUpload(token: string, sizeBytes: number) {
    const turnstileToken = await ensureToken({ forceRefresh: true });
    const response = await fetch("/api/forum/media-upload-guard", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        upload_kind: "circle_cover",
        size_bytes: sizeBytes,
        turnstile_token: turnstileToken || undefined,
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

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file || loading) return;

    setError("");
    setMessage("");

    if (!supportsExtendedSchema) {
      setError("当前环境未启用圈子图片字段，无法上传封面。");
      event.target.value = "";
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setError("圈子封面只支持 jpg / png / webp / gif。");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setError("圈子封面不能超过 5MB。");
      event.target.value = "";
      return;
    }

    setLoading(true);
    let uploadedPath = "";

    try {
      const token = await getSessionToken();
      if (!token || authState.status !== "signed_in" || !authState.user) {
        window.location.assign(buildLoginHref(`/circles/${circleSlug}/manage/`));
        return;
      }

      await guardUpload(token, file.size);
      uploadedPath = `circle-covers/${authState.user.id}/${Date.now()}-${normalizeFileName(file.name)}`;
      try {
        await uploadToPostMediaWithTus({
          file,
          objectPath: uploadedPath,
          accessToken: token,
        });
      } catch {
        throw new Error("圈子封面上传失败。");
      }

      const coverUrl = await updateCircleCover(uploadedPath, token);
      setMessage("圈子封面已更新。");
      resetToken();
      onUpdated?.(uploadedPath, coverUrl);
    } catch (requestError) {
      if (uploadedPath) {
        await supabase.storage.from("post-media").remove([uploadedPath]).catch(() => undefined);
      }
      setError(mapCoverError(requestError instanceof Error ? requestError.message : "更新封面失败。"));
      resetToken();
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleClearCover() {
    if (loading) return;
    setLoading(true);
    setError("");
    setMessage("");

    try {
      if (!supportsExtendedSchema) {
        throw new Error("当前环境未启用圈子图片字段，无法清除封面。");
      }

      const token = await getSessionToken();
      if (!token) {
        window.location.assign(buildLoginHref(`/circles/${circleSlug}/manage/`));
        return;
      }

      const coverUrl = await updateCircleCover(null, token);
      setMessage("圈子封面已清除。");
      onUpdated?.(null, coverUrl);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "清除封面失败。");
    } finally {
      setLoading(false);
    }
  }

  if (!canEdit) {
    if (authState.status === "signed_in" && !authState.user) {
      console.warn("[circle-cover-editor] signed-in state missing user", { circleSlug, ownerId });
    }
    return null;
  }

  return (
    <div className="circle-cover-editor">
      <div className="circle-cover-editor__row">
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} disabled={loading} />
        <button
          type="button"
          className="community-action-button community-action-button--muted"
          onClick={handleClearCover}
          disabled={loading}
        >
          清除封面
        </button>
      </div>
      {supportsExtendedSchema ? (
        <p className="community-meta">支持上传 jpg / png / webp / gif，单图不超过 5MB。</p>
      ) : (
        <p className="community-meta">当前环境未完成圈子图片 migration，先只能显示兼容封面。</p>
      )}
      {error ? <span className="inline-error">{error}</span> : null}
      {message ? <span className="inline-success">{message}</span> : null}
      {turnstileError ? <span className="inline-error">{turnstileError}</span> : null}
      {!turnstileReady && siteKeyEnabled ? <span className="community-meta">正在初始化上传验证…</span> : null}
      <div ref={containerRef} aria-hidden="true" style={{ position: "absolute", insetInlineStart: "-9999px" }} />
    </div>
  );
}
