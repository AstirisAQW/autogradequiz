import type { ReactNode } from "react";

export type BadgeVariant = "success" | "warning";

export interface BadgeProps {
  variant: BadgeVariant;
  className?: string;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success:
    "border border-emerald-800/20 bg-[var(--success-bg)] text-[var(--success-text)]",
  warning:
    "border border-amber-800/25 bg-[var(--warning-bg)] text-[var(--warning-text)]",
};

const VARIANT_ICONS: Record<BadgeVariant, string> = {
  success: "✓",
  warning: "▲",
};

export function Badge({ variant, className = "", children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]} ${className}`}
    >
      <span aria-hidden="true" className="text-[0.625rem] leading-none">
        {VARIANT_ICONS[variant]}
      </span>
      <span>{children}</span>
    </span>
  );
}
