import { useEffect, useState } from "react";
import GlassConfirmDialog from "../common/GlassConfirmDialog";
import { adminFetch } from "../../lib/admin-api-client";
import { uploadToPostMediaWithTus } from "../../lib/storage-tus";
import { useAdminSession } from "./useAdminSession";

type CircleRecord = {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: string;
  status: string;
  created_at: string;
  updated_at: string;
  image_path: string | null;
  owner_id: string | null;
  post_count: number;
  comment_count: number;
  owner_profile: {
    id: string | null;
    username?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
    role?: string | null;
  } | null;
};

type CirclePayload = {
  circles?: CircleRecord[];
  circle?: CircleRecord;
  error?: string;
};

type CircleDraft = {
  name: string;
  description: string;
  type: string;
};

const circleTypes = [
  { value: "topic", label: "通用话题" },
  { value: "device", label: "设备圈子" },
  { value: "project", label: "项目圈子" },
] as const;

function normalizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapCircleError(message: string) {
  if (message.includes("CIRCLE_NAME_ALREADY_EXISTS")) return "圈子名称已存在。";
  if (message.includes("CIRCLE_COVER_UPLOAD_FAILED")) return "圈子封面上传失败。";
  if (message.includes("CIRCLE_STATUS_SCHEMA_NOT_READY")) return "数据库还没有完成圈子状态 migration，请先执行最新 SQL。";
  return message;
}

function ownerLabel(circle: CircleRecord) {
  return circle.owner_profile?.display_name || circle.owner_profile?.username || circle.owner_id || "无 owner";
}

export default function AdminCirclesDashboard() {
  const adminSession = useAdminSession();
  const [circles, setCircles] = useState<CircleRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, CircleDraft>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createType, setCreateType] = useState<(typeof circleTypes)[number]["value"]>("topic");
  const [createImage, setCreateImage] = useState<File | null>(null);
  const [confirmCircleAction, setConfirmCircleAction] = useState<{ id: string; name: string; nextStatus: "active" | "deleted" } | null>(null);

  const accessToken = adminSession.session?.access_token ?? "";

  useEffect(() => {
    if (adminSession.state.status !== "ready" || !adminSession.session) return;

    let cancelled = false;
    const load = async () => {
      setError("");
      try {
        const payload = await adminFetch<CirclePayload>("/api/admin/forum/circles", {
          method: "GET",
          session: adminSession.session,
        });
        if (cancelled) return;
        const items = payload.circles ?? [];
        setCircles(items);
        setDrafts(
          items.reduce<Record<string, CircleDraft>>((acc, circle) => {
            acc[circle.id] = {
              name: circle.name,
              description: circle.description ?? "",
              type: circle.type,
            };
            return acc;
          }, {}),
        );
      } catch (requestError) {
        if (cancelled) return;
        setError(requestError instanceof Error ? requestError.message : "加载圈子失败");
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [adminSession.session, adminSession.state.status]);

  async function uploadCircleImage(file: File, userId: string) {
    if (!accessToken) throw new Error("登录状态已失效，请重新登录");
    const objectPath = `circle-covers/${userId}/${Date.now()}-${normalizeFileName(file.name)}`;
    try {
      await uploadToPostMediaWithTus({ file, objectPath, accessToken });
    } catch {
      throw new Error("CIRCLE_COVER_UPLOAD_FAILED");
    }
    return objectPath;
  }

  async function handleCreate() {
    if (!adminSession.session || !adminSession.me) return;
    setCreating(true);
    setError("");
    setSuccess("");
    let uploadedPath = "";

    try {
      if (createImage) {
        uploadedPath = await uploadCircleImage(createImage, adminSession.me.user_id);
      }

      const payload = await adminFetch<CirclePayload>("/api/admin/forum/circles", {
        method: "POST",
        session: adminSession.session,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          description: createDescription.trim(),
          type: createType,
          image_path: uploadedPath || null,
        }),
      });

      if (payload.circle) {
        const nextCircle = { status: "active", ...(payload.circle as CircleRecord) };
        setCircles((current) => [nextCircle, ...current]);
        setDrafts((current) => ({
          ...current,
          [nextCircle.id]: {
            name: nextCircle.name,
            description: nextCircle.description ?? "",
            type: nextCircle.type,
          },
        }));
      }

      setCreateName("");
      setCreateDescription("");
      setCreateType("topic");
      setCreateImage(null);
      setSuccess("圈子已创建。");
    } catch (requestError) {
      if (uploadedPath) {
        await adminSession.supabase?.storage.from("post-media").remove([uploadedPath]).catch(() => undefined);
      }
      setError(mapCircleError(requestError instanceof Error ? requestError.message : "创建圈子失败"));
    } finally {
      setCreating(false);
    }
  }

  async function saveCircle(circleId: string) {
    if (!adminSession.session) return;
    const draft = drafts[circleId];
    if (!draft) return;
    setLoadingId(circleId);
    setError("");
    setSuccess("");

    try {
      const payload = await adminFetch<CirclePayload>("/api/admin/forum/circles", {
        method: "PATCH",
        session: adminSession.session,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: circleId,
          name: draft.name.trim(),
          description: draft.description.trim(),
          type: draft.type,
        }),
      });

      if (payload.circle) {
        setCircles((current) => current.map((circle) => (circle.id === circleId ? { ...circle, ...payload.circle } as CircleRecord : circle)));
      }
      setSuccess("圈子已更新。");
    } catch (requestError) {
      setError(mapCircleError(requestError instanceof Error ? requestError.message : "更新圈子失败"));
    } finally {
      setLoadingId(null);
    }
  }

  async function updateCover(circle: CircleRecord, file: File | null) {
    if (!adminSession.session) return;
    setLoadingId(circle.id);
    setError("");
    setSuccess("");
    let imagePath: string | null = null;

    try {
      if (file) {
        imagePath = await uploadCircleImage(file, adminSession.me?.user_id || "admin");
      }

      const payload = await adminFetch<CirclePayload>("/api/admin/forum/circles", {
        method: "PATCH",
        session: adminSession.session,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: circle.id,
          image_path: imagePath,
        }),
      });

      if (payload.circle) {
        setCircles((current) => current.map((item) => (item.id === circle.id ? { ...item, ...payload.circle } as CircleRecord : item)));
      }

      setSuccess(imagePath ? "圈子封面已更新。" : "圈子封面已清除。");
    } catch (requestError) {
      if (imagePath) {
        await adminSession.supabase?.storage.from("post-media").remove([imagePath]).catch(() => undefined);
      }
      setError(mapCircleError(requestError instanceof Error ? requestError.message : "更新封面失败"));
    } finally {
      setLoadingId(null);
    }
  }

  async function updateCircleStatus(circleId: string, status: "active" | "deleted") {
    if (!adminSession.session) return;
    setLoadingId(circleId);
    setError("");
    setSuccess("");

    try {
      const payload = await adminFetch<CirclePayload>("/api/admin/forum/circles", {
        method: "PATCH",
        session: adminSession.session,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: circleId, status }),
      });

      if (payload.circle) {
        setCircles((current) => current.map((circle) => (circle.id === circleId ? { ...circle, ...payload.circle } as CircleRecord : circle)));
      }
      setSuccess(status === "deleted" ? "圈子已删除。" : "圈子已恢复。");
    } catch (requestError) {
      setError(mapCircleError(requestError instanceof Error ? requestError.message : "更新圈子状态失败"));
    } finally {
      setLoadingId(null);
    }
  }

  if (adminSession.state.status !== "ready") {
    return (
      <section className="community-surface">
        <div className="community-empty admin-state-message">
          <strong>{adminSession.state.message}</strong>
          {"details" in adminSession.state && adminSession.state.details ? <p className="admin-debug-note">{adminSession.state.details}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="community-surface">
      <div className="community-stream-head">
        <div>
          <h2>管理员圈子管理</h2>
          <p>查看 owner、帖子/评论数量，并维护圈子信息与封面。</p>
        </div>
      </div>

      <div className="admin-user-line">
        当前管理员：{adminSession.me?.profile?.display_name || adminSession.me?.profile?.username || adminSession.me?.user_id} · 角色 {adminSession.me?.role}
      </div>

      <div className="community-list" style={{ gap: "0.8rem", marginTop: "0.8rem" }}>
        <article className="community-list-item" style={{ gap: "0.75rem" }}>
          <strong>创建圈子</strong>
          <div className="admin-meta-grid">
            <label>
              <span>圈子名称</span>
              <input className="community-input" value={createName} onChange={(event) => setCreateName(event.target.value)} maxLength={40} />
            </label>
            <label>
              <span>圈子类型</span>
              <select className="community-input" value={createType} onChange={(event) => setCreateType(event.target.value as (typeof circleTypes)[number]["value"])}>
                {circleTypes.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>封面图片</span>
              <input className="community-input" type="file" accept="image/*" onChange={(event) => setCreateImage(event.target.files?.[0] ?? null)} />
            </label>
          </div>
          <label>
            <span className="community-meta">圈子说明</span>
            <textarea className="community-input community-input--textarea" value={createDescription} onChange={(event) => setCreateDescription(event.target.value)} maxLength={200} />
          </label>
          <div className="admin-inline-actions">
            <button type="button" className="admin-action-button" onClick={() => void handleCreate()} disabled={creating}>
              {creating ? "创建中..." : "创建圈子"}
            </button>
          </div>
        </article>

        {error ? <div className="admin-error">{error}</div> : null}
        {success ? <div className="admin-inline-success">{success}</div> : null}

        {circles.map((circle) => {
          const draft = drafts[circle.id] ?? {
            name: circle.name,
            description: circle.description ?? "",
            type: circle.type,
          };
          const rowLoading = loadingId === circle.id;

          return (
            <article key={circle.id} className="community-list-item" style={{ gap: "0.7rem" }}>
              <div className="admin-action-row">
                <strong>{circle.name}</strong>
                <span className={`admin-status-badge admin-status-${circle.status}`}>{circle.status}</span>
                <span className="admin-status-badge">{circle.type}</span>
              </div>
              <div className="admin-meta-grid">
                <span>owner：{ownerLabel(circle)}</span>
                <span>slug：<code>{circle.slug}</code></span>
                <span>创建时间：{new Date(circle.created_at).toLocaleString("zh-CN")}</span>
                <span>封面：{circle.image_path ? "已设置" : "未设置"}</span>
                <span>帖子：{circle.post_count}</span>
                <span>评论：{circle.comment_count}</span>
              </div>
              <div className="admin-meta-grid">
                <label>
                  <span>圈子名称</span>
                  <input
                    className="community-input"
                    value={draft.name}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [circle.id]: { ...draft, name: event.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  <span>圈子类型</span>
                  <select
                    className="community-input"
                    value={draft.type}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [circle.id]: { ...draft, type: event.target.value },
                      }))
                    }
                  >
                    {circleTypes.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>更新封面</span>
                  <input className="community-input" type="file" accept="image/*" onChange={(event) => void updateCover(circle, event.target.files?.[0] ?? null)} disabled={rowLoading} />
                </label>
              </div>
              <label>
                <span className="community-meta">圈子说明</span>
                <textarea
                  className="community-input community-input--textarea"
                  value={draft.description}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [circle.id]: { ...draft, description: event.target.value },
                    }))
                  }
                  maxLength={200}
                />
              </label>
              <div className="admin-inline-actions">
                <button type="button" className="admin-action-button" onClick={() => void saveCircle(circle.id)} disabled={rowLoading}>
                  {rowLoading ? "保存中..." : "保存修改"}
                </button>
                <button type="button" className="admin-action-button" onClick={() => void updateCover(circle, null)} disabled={rowLoading}>
                  清除封面
                </button>
                {circle.status === "deleted" ? (
                  <button
                    type="button"
                    className="admin-action-button"
                    onClick={() => void updateCircleStatus(circle.id, "active")}
                    disabled={rowLoading}
                  >
                    恢复圈子
                  </button>
                ) : (
                  <button
                    type="button"
                    className="admin-action-button admin-action-danger"
                    onClick={() => setConfirmCircleAction({ id: circle.id, name: circle.name, nextStatus: "deleted" })}
                    disabled={rowLoading}
                  >
                    删除圈子
                  </button>
                )}
                <a href={`/circles/${circle.slug}/manage/`} className="admin-action-button">管理帖子和评论</a>
                {circle.status === "deleted" ? (
                  <span className="admin-action-button" aria-disabled="true">公开页已隐藏</span>
                ) : (
                  <a href={`/circles/${circle.slug}/`} className="admin-action-button">查看公开页</a>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <GlassConfirmDialog
        open={!!confirmCircleAction}
        title="确认删除圈子"
        description="删除后圈子会从公开列表、圈子详情和发帖选择器中隐藏，但数据库记录仍会保留。"
        detail={confirmCircleAction ? `目标：${confirmCircleAction.name}` : ""}
        confirmLabel="确认删除圈子"
        cancelLabel="取消"
        danger={true}
        loading={!!confirmCircleAction && loadingId === confirmCircleAction.id}
        error=""
        onCancel={() => setConfirmCircleAction(null)}
        onConfirm={() => {
          if (!confirmCircleAction) return;
          void (async () => {
            await updateCircleStatus(confirmCircleAction.id, confirmCircleAction.nextStatus);
            setConfirmCircleAction(null);
          })();
        }}
      />
    </section>
  );
}
