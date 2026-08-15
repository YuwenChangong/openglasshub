import { useEffect, useId, useRef, useState } from "react";
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
  confirmationLabel?: string;
  confirmationText?: string;
  onConfirmationChange?: (value: string) => void;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function getGlassConfirmDialogButtonState({
  loading,
  confirmDisabled,
  confirmationText,
  confirmationValue,
}: Pick<GlassConfirmDialogProps, "loading" | "confirmDisabled" | "confirmationText"> & { confirmationValue: string }) {
  const confirmationMismatch = Boolean(confirmationText && confirmationValue !== confirmationText);

  return {
    cancelDisabled: Boolean(loading),
    confirmDisabled: Boolean(loading || confirmDisabled || confirmationMismatch),
  };
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
  confirmationLabel,
  confirmationText,
  onConfirmationChange,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: GlassConfirmDialogProps) {
  const titleId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const loadingRef = useRef(loading);
  const onCancelRef = useRef(onCancel);
  const [confirmationValue, setConfirmationValue] = useState("");

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

  useEffect(() => {
    if (!open) setConfirmationValue("");
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const buttonState = getGlassConfirmDialogButtonState({
    loading,
    confirmDisabled,
    confirmationText,
    confirmationValue,
  });

  return createPortal(
    <div className="glass-confirm-backdrop">
      <div className="glass-confirm-dialog glass-modal" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="glass-confirm-header glass-modal__header">
          <h3 id={titleId}>{title}</h3>
          <p>{description}</p>
        </div>
        <div className="glass-confirm-body glass-modal__body">
          {detail ? <p>{detail}</p> : null}
          {confirmationText ? (
            <label className="glass-confirm-confirmation">
              <span>{confirmationLabel ?? "输入确认内容"}</span>
              <input
                className="community-input"
                value={confirmationValue}
                onChange={(event) => {
                  setConfirmationValue(event.target.value);
                  onConfirmationChange?.(event.target.value);
                }}
                autoComplete="off"
              />
            </label>
          ) : null}
          {error ? <div className="comment-delete-error">{error}</div> : null}
        </div>
        <div className="glass-confirm-actions glass-modal__actions">
          <button
            type="button"
            className="community-button--secondary"
            onClick={onCancel}
            disabled={buttonState.cancelDisabled}
            ref={cancelButtonRef}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? "community-button admin-action-danger" : "community-button"}
            onClick={onConfirm}
            disabled={buttonState.confirmDisabled}
          >
            {loading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
