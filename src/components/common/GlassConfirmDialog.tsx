import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

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
  const titleId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const loadingRef = useRef(loading);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    loadingRef.current = loading;
    onCancelRef.current = onCancel;
  }, [loading, onCancel]);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loadingRef.current) {
        event.preventDefault();
        onCancelRef.current();
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    cancelButtonRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="glass-confirm-backdrop">
      <div className="glass-confirm-dialog glass-modal" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="glass-confirm-header glass-modal__header">
          <h3 id={titleId}>{title}</h3>
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
            ref={cancelButtonRef}
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
    </div>,
    document.body,
  );
}
