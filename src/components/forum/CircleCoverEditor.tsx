import { useMemo, useRef, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { uploadToPostMediaWithTus } from "../../lib/storage-tus";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";

interface CircleCoverEditorProps {
  circleId: string;
  circleSlug: string;
  supportsExtendedSchema: boolean;
}

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

function normalizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function CircleCoverEditor({
  circleId,
  circleSlug,
  supportsExtendedSchema,
}: CircleCoverEditorProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function getSessionToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }

  async function updateCircleCover(imagePath: string | null, token: string) {
    const response = await fetch("/api/forum/circles", {
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
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      throw new Error(payload?.error ?? `更新封面失败 (${response.status})`);
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
      if (!token) {
        window.location.assign(buildLoginHref(`/circles/${circleSlug}/`));
        return;
      }

      const user = (await supabase.auth.getUser(token)).data.user;
      if (!user) {
        window.location.assign(buildLoginHref(`/circles/${circleSlug}/`));
        return;
      }

      uploadedPath = `circles/${user.id}/${Date.now()}-${normalizeFileName(file.name)}`;
      await uploadToPostMediaWithTus({
        file,
        objectPath: uploadedPath,
        accessToken: token,
      });

      await updateCircleCover(uploadedPath, token);
      setMessage("圈子封面已更新。");
      window.location.reload();
    } catch (requestError) {
      if (uploadedPath) {
        await supabase.storage.from("post-media").remove([uploadedPath]).catch(() => undefined);
      }
      setError(requestError instanceof Error ? requestError.message : "更新封面失败。");
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
        window.location.assign(buildLoginHref(`/circles/${circleSlug}/`));
        return;
      }
      await updateCircleCover(null, token);
      setMessage("圈子封面已清除。");
      window.location.reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "清除封面失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="circle-cover-editor">
      <div className="circle-cover-editor__row">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={loading}
        />
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
    </div>
  );
}
