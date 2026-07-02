interface GlassConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function GlassConfirmDialog({
  open,
  title,
  description,
  detail,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  loading = false,
  loadingLabel = "处理中...",
  error = "",
  onConfirm,
  onCancel,
}: GlassConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="glass-confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="glass-confirm-title">
      <div className="glass-confirm-dialog glass-modal">
        <div className="glass-confirm-header glass-modal__header">
          <h3 id="glass-confirm-title">{title}</h3>
          <p>{description}</p>
        </div>
        <div className="glass-confirm-body glass-modal__body">
          {detail ? <p>{detail}</p> : null}
          {error ? <div className="comment-delete-error">{error}</div> : null}
        </div>
        <div className="glass-confirm-actions glass-modal__actions">
          <button
            type="button"
            className="community-button--secondary"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? "community-button admin-action-danger" : "community-button"}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
