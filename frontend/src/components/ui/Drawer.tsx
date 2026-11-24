"use client";

import { useEffect, useId, type ReactNode } from "react";
import { Button } from "./Button";

export interface DrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
}: DrawerProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="flex h-full w-full max-w-lg flex-col border-l border-[var(--border-hairline)] bg-[var(--bg-surface)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-hairline)] px-6 py-4">
          <div>
            <h2
              id={titleId}
              className="text-base font-medium text-[var(--text-primary)]"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {subtitle}
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close drawer">
            Close
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </aside>
    </div>
  );
}
