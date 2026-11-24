"use client";

import { useEffect, useId, type ReactNode } from "react";
import { Button } from "./Button";

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "danger";
  busy?: boolean;
  hideFooter?: boolean;
  onConfirm?: () => void;
  onClose: () => void;
  children?: ReactNode;
}

export function Dialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  busy = false,
  hideFooter = false,
  onConfirm,
  onClose,
  children,
}: DialogProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6">
        <h2 id={titleId} className="text-base font-medium text-[var(--text-primary)]">
          {title}
        </h2>
        {description && (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {description}
          </p>
        )}
        {children && <div className="mt-4">{children}</div>}
        {!hideFooter && (
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {cancelLabel}
            </Button>
            {onConfirm && (
              <Button
                variant={confirmVariant}
                onClick={onConfirm}
                disabled={busy}
              >
                {busy ? "Working..." : confirmLabel}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
