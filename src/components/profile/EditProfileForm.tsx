import { useEffect, useMemo, useRef, useState } from "react";
import { buildLoginHref } from "../../lib/auth-redirect";
import { getProfileById, type ProfileRecord } from "../../lib/profile-data";
import { isValidProfileUsername } from "../../lib/profile-links";
import { resolveProfileAvatarUrl, resolveProfileBannerUrl } from "../../lib/profile-media";
import { createBrowserSupabaseClient } from "../../lib/supabase-browser";
import { uploadToPostMediaWithTus } from "../../lib/storage-tus";

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const MAX_BANNER_SIZE = 8 * 1024 * 1024;

type EditableProfile = ProfileRecord & {
  banner_url?: string | null;
};

type PendingUploadState = {
  path: string | null;
  previewUrl: string | null;
};

function normalizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeUsernameForSave(value: string) {
  return value.trim().toLowerCase();
}

function normalizeUsernameForBlur(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function mapProfileError(message: string) {
  if (/23505|duplicate key|profiles_username_unique_ci/i.test(message)) return "主页地址已被占用。";
  if (/username/i.test(message) && /check|constraint|invalid/i.test(message)) {
    return "主页地址仅支持小写英文、数字、下划线和短横线。";
  }
  if (/RATE_LIMITED/i.test(message)) return "上传过于频繁，请稍后再试。";
  if (/TURNSTILE_REQUIRED|TURNSTILE_INVALID/i.test(message)) return "当前上传需要额外安全验证，请稍后再试。";
  if (/banner_url/i.test(message)) return "当前环境尚未完成个人横幅 migration。";
  return message;
}

function validateProfileInput(values: {
  displayName: string;
  username: string;
  bio: string;
}) {
  const displayName = values.displayName.trim();
  const username = normalizeUsernameForSave(values.username);
  const bio = values.bio.trim();

  if (!displayName) return "用户名不能为空。";
  if (displayName.length > 40) return "用户名不能超过 40 个字符。";
  if (username && !isValidProfileUsername(username)) {
    return "主页地址仅支持小写英文、数字、下划线和短横线。";
  }
  if (bio.length > 240) return "个人简介不能超过 240 个字符。";
  return "";
}

export default function EditProfileForm() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<"avatar" | "banner" | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [profile, setProfile] = useState<EditableProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [avatarPending, setAvatarPending] = useState<PendingUploadState>({ path: null, previewUrl: null });
  const [bannerPending, setBannerPending] = useState<PendingUploadState>({ path: null, previewUrl: null });
  const [avatarResolvedUrl, setAvatarResolvedUrl] = useState<string | null>(null);
  const [bannerResolvedUrl, setBannerResolvedUrl] = useState<string | null>(null);
  const [usernameComposing, setUsernameComposing] = useState(false);

  const avatarDisplayUrl = avatarPending.previewUrl ?? avatarResolvedUrl;
  const bannerDisplayUrl = bannerPending.previewUrl ?? bannerResolvedUrl;
  const isBusy = saving || uploadingKind !== null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!supabase) {
        if (!cancelled) {
          setLoading(false);
          setError("当前环境未启用登录。");
        }
        return;
      }

      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session?.user) {
        window.location.replace(buildLoginHref("/me/edit/"));
        return;
      }

      const profileRow = (await getProfileById(supabase, session.user.id)) as EditableProfile | null;
      if (!profileRow) {
        if (!cancelled) {
          setLoading(false);
          setError("当前账号还没有可用的个人资料。");
        }
        return;
      }

      const [resolvedAvatarUrl, resolvedBannerUrl] = await Promise.all([
        resolveProfileAvatarUrl(supabase, profileRow.avatar_url),
        resolveProfileBannerUrl(supabase, profileRow.banner_url ?? null),
      ]);

      if (!cancelled) {
        setProfile(profileRow);
        setDisplayName(profileRow.display_name ?? "");
        setUsername(profileRow.username ?? "");
        setBio(profileRow.bio ?? "");
        setAvatarResolvedUrl(resolvedAvatarUrl);
        setBannerResolvedUrl(resolvedBannerUrl);
        setLoading(false);
      }
    }

    void load().catch((requestError) => {
      if (cancelled) return;
      setLoading(false);
      setError(requestError instanceof Error ? requestError.message : "加载资料失败。");
    });

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    return () => {
      if (avatarPending.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(avatarPending.previewUrl);
      if (bannerPending.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(bannerPending.previewUrl);
    };
  }, [avatarPending.previewUrl, bannerPending.previewUrl]);

  async function getSessionToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }

  async function removeStorageObject(path: string | null | undefined) {
    if (!supabase || !path || !/^(profile-avatars|profile-banners)\//.test(path)) return;
    await supabase.storage.from("post-media").remove([path]).catch(() => undefined);
  }

  async function guardUpload(token: string, sizeBytes: number, uploadKind: "profile_avatar" | "profile_banner") {
    const response = await fetch("/api/forum/media-upload-guard", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        upload_kind: uploadKind,
        size_bytes: sizeBytes,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
    if (!response.ok) {
      throw new Error(
        payload?.code ? `${payload.code}: ${payload.error ?? ""}` : payload?.error ?? `上传校验失败 (${response.status})`,
      );
    }
  }

  async function uploadProfileImage(file: File, kind: "avatar" | "banner") {
    if (!profile || !supabase) throw new Error("当前资料尚未加载完成。");
    const token = await getSessionToken();
    if (!token) {
      window.location.replace(buildLoginHref("/me/edit/"));
      return null;
    }

    const sizeLimit = kind === "avatar" ? MAX_AVATAR_SIZE : MAX_BANNER_SIZE;
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) throw new Error("仅支持 jpg / png / webp / gif。");
    if (file.size > sizeLimit) throw new Error(kind === "avatar" ? "头像不能超过 5MB。" : "横幅不能超过 8MB。");

    const objectPath = `${kind === "avatar" ? "profile-avatars" : "profile-banners"}/${profile.id}/${Date.now()}-${normalizeFileName(file.name)}`;
    await guardUpload(token, file.size, kind === "avatar" ? "profile_avatar" : "profile_banner");
    await uploadToPostMediaWithTus({ file, objectPath, accessToken: token });
    return objectPath;
  }

  async function handleImageUpload(kind: "avatar" | "banner", file: File | null) {
    if (!file || !profile || isBusy) return;
    setUploadingKind(kind);
    setError("");
    setSuccess("");

    let nextPath: string | null = null;
    const previousPendingPath = kind === "avatar" ? avatarPending.path : bannerPending.path;
    const previousPreviewUrl = kind === "avatar" ? avatarPending.previewUrl : bannerPending.previewUrl;

    try {
      nextPath = await uploadProfileImage(file, kind);
      if (!nextPath) return;

      const nextPreviewUrl = URL.createObjectURL(file);
      if (kind === "avatar") {
        setAvatarPending({ path: nextPath, previewUrl: nextPreviewUrl });
      } else {
        setBannerPending({ path: nextPath, previewUrl: nextPreviewUrl });
      }

      if (previousPreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previousPreviewUrl);
      }
      if (previousPendingPath && previousPendingPath !== nextPath) {
        await removeStorageObject(previousPendingPath);
      }

      setSuccess(kind === "avatar" ? "头像已上传，记得保存资料。" : "横幅已上传，记得保存资料。");
    } catch (requestError) {
      if (nextPath) {
        await removeStorageObject(nextPath);
      }
      setError(mapProfileError(requestError instanceof Error ? requestError.message : "上传失败。"));
    } finally {
      setUploadingKind(null);
      if (kind === "avatar" && avatarInputRef.current) avatarInputRef.current.value = "";
      if (kind === "banner" && bannerInputRef.current) bannerInputRef.current.value = "";
    }
  }

  async function handleSaveProfile() {
    if (!profile || !supabase || isBusy) return;
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const nextDisplayName = displayName.trim();
      const nextUsername = normalizeUsernameForSave(username);
      const nextBio = bio.trim();
      const validationError = validateProfileInput({
        displayName: nextDisplayName,
        username: nextUsername,
        bio: nextBio,
      });
      if (validationError) throw new Error(validationError);

      const payload = {
        display_name: nextDisplayName || null,
        username: nextUsername || null,
        bio: nextBio || null,
        avatar_url: avatarPending.path ?? profile.avatar_url ?? null,
        banner_url: bannerPending.path ?? profile.banner_url ?? null,
      };

      const withBannerResult = await supabase
        .from("profiles")
        .update(payload)
        .eq("id", profile.id)
        .select("id, username, display_name, avatar_url, bio, role, created_at, banner_url")
        .single();

      let data = withBannerResult.data as EditableProfile | null;
      let updateError = withBannerResult.error;

      if (updateError && /banner_url/i.test(updateError.message) && !bannerPending.path) {
        const fallbackResult = await supabase
          .from("profiles")
          .update({
            display_name: payload.display_name,
            username: payload.username,
            bio: payload.bio,
            avatar_url: payload.avatar_url,
          })
          .eq("id", profile.id)
          .select("id, username, display_name, avatar_url, bio, role, created_at")
          .single();
        data = (fallbackResult.data as EditableProfile | null) ?? null;
        updateError = fallbackResult.error;
      }

      if (updateError || !data) throw updateError ?? new Error("保存资料失败。");

      const previousAvatarPath = profile.avatar_url ?? null;
      const previousBannerPath = profile.banner_url ?? null;
      const finalAvatarPath = data.avatar_url ?? null;
      const finalBannerPath = data.banner_url ?? null;

      if (avatarPending.path && previousAvatarPath && previousAvatarPath !== finalAvatarPath) {
        await removeStorageObject(previousAvatarPath);
      }
      if (bannerPending.path && previousBannerPath && previousBannerPath !== finalBannerPath) {
        await removeStorageObject(previousBannerPath);
      }

      const [resolvedAvatar, resolvedBanner] = await Promise.all([
        resolveProfileAvatarUrl(supabase, finalAvatarPath),
        resolveProfileBannerUrl(supabase, finalBannerPath),
      ]);

      setProfile(data);
      setDisplayName(data.display_name ?? "");
      setUsername(data.username ?? "");
      setBio(data.bio ?? "");
      setAvatarResolvedUrl(resolvedAvatar);
      setBannerResolvedUrl(resolvedBanner);
      setAvatarPending((current) => {
        if (current.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(current.previewUrl);
        return { path: null, previewUrl: null };
      });
      setBannerPending((current) => {
        if (current.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(current.previewUrl);
        return { path: null, previewUrl: null };
      });
      setSuccess("个人资料已保存。");
    } catch (requestError) {
      setError(mapProfileError(requestError instanceof Error ? requestError.message : "保存资料失败。"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="community-surface community-surface--padded profile-shell">
        <h1>编辑资料</h1>
        <p className="community-meta">正在加载...</p>
      </section>
    );
  }

  if (error && !profile) {
    return (
      <section className="community-surface community-surface--padded profile-shell">
        <h1>编辑资料</h1>
        <p className="community-meta">{error}</p>
      </section>
    );
  }

  const visibleName = displayName.trim() || profile?.display_name?.trim() || username.trim() || profile?.username?.trim() || "我的资料";

  return (
    <section className="community-surface community-surface--padded profile-shell profile-editor">
      <div className="community-stream-head profile-editor__head">
        <div>
          <h2>编辑资料</h2>
        </div>
        <div className="community-inline-links">
          <a href="/me/" className="community-inline-link">
            返回我的主页
          </a>
        </div>
      </div>

      {bannerDisplayUrl ? (
        <div className="profile-banner">
          <img src={bannerDisplayUrl} alt="" className="profile-banner__image" loading="eager" decoding="async" />
        </div>
      ) : null}

      <div className="profile-head profile-head--editor">
        <div className="profile-avatar-wrap">
          {avatarDisplayUrl ? (
            <img src={avatarDisplayUrl} alt="" className="profile-avatar-image" loading="eager" decoding="async" />
          ) : (
            <span className="community-avatar profile-avatar-fallback" aria-hidden="true">
              {(visibleName.trim().charAt(0) || "U").toUpperCase()}
            </span>
          )}
        </div>
        <div className="profile-copy">
          <div className="profile-copy__title">
            <h1>{visibleName}</h1>
            {profile ? <span className="profile-account-id">ID: {profile.id}</span> : null}
          </div>
          <div className="profile-upload-grid">
            <label className="profile-upload-field">
              <span className="community-meta">头像</span>
              <input
                ref={avatarInputRef}
                className="community-input"
                type="file"
                accept="image/*"
                onChange={(event) => void handleImageUpload("avatar", event.target.files?.[0] ?? null)}
                disabled={isBusy}
              />
              <small className="community-meta">支持 jpg / png / webp / gif，最大 5MB</small>
            </label>
            <label className="profile-upload-field">
              <span className="community-meta">横幅</span>
              <input
                ref={bannerInputRef}
                className="community-input"
                type="file"
                accept="image/*"
                onChange={(event) => void handleImageUpload("banner", event.target.files?.[0] ?? null)}
                disabled={isBusy}
              />
              <small className="community-meta">支持 jpg / png / webp / gif，最大 8MB</small>
            </label>
          </div>
        </div>
      </div>

      <label className="create-circle-form__field">
        <span>用户名</span>
        <input
          className="community-input"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={40}
          autoCapitalize="words"
          autoCorrect="off"
        />
      </label>

      <label className="create-circle-form__field">
        <span>主页地址</span>
        <input
          className="community-input"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          onCompositionStart={() => setUsernameComposing(true)}
          onCompositionEnd={() => setUsernameComposing(false)}
          onBlur={() => {
            if (!usernameComposing) {
              setUsername((current) => normalizeUsernameForBlur(current));
            }
          }}
          maxLength={30}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <small className="community-meta">仅支持小写英文、数字、下划线和短横线。留空则使用账号 ID。</small>
      </label>

      <label className="create-circle-form__field">
        <span>个人简介</span>
        <textarea
          className="community-input community-input--textarea"
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          maxLength={240}
        />
      </label>

      {error ? <span className="inline-error">{error}</span> : null}
      {success ? <span className="inline-success">{success}</span> : null}

      <div className="community-cta-row">
        <button type="button" className="community-button" onClick={() => void handleSaveProfile()} disabled={isBusy}>
          {saving ? "保存中..." : "保存资料"}
        </button>
      </div>
    </section>
  );
}
