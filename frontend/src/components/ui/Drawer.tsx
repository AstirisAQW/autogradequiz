"use client";

import { useEffect, type ReactNode } from "react";
import { Button } from "./Button";

export interface DrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  size?: "md" | "lg" | "xl";
  onClose: () => void;
  children: ReactNode;
}

const SIZE_CLASSES: Record<NonNullable<DrawerProps["size"]>, string> = {
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Drawer({
  open,
  title,
  subtitle,
  size = "md",
  onClose,
  children,
}: DrawerProps) {
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
      aria-labelledby="drawer-title"
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className={`flex h-full w-full ${SIZE_CLASSES[size]} flex-col border-l border-[var(--border-hairline)] bg-[var(--bg-surface)]`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-hairline)] px-6 py-4">
          <div>
            <h2
              id="drawer-title"
              className="text-[16px] font-medium text-[var(--text-primary)]"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
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
