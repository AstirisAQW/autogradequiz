"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm" | "row";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabledReason?: string;
  inlineReason?: boolean;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--brand)] text-white border border-transparent hover:bg-[var(--brand-hover)]",
  secondary:
    "bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]",
  ghost:
    "bg-transparent text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]",
  danger:
    "bg-[var(--danger)] text-white border border-transparent hover:bg-[var(--danger-hover)]",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "min-h-9 px-4 py-1.5 text-sm",
  sm: "min-h-8 px-3 py-1 text-[0.8125rem]",
  row: "min-h-9 px-3.5 py-1.5 text-[0.8125rem] [@media(pointer:coarse)]:min-h-12",
};

export function Button({
  variant = "secondary",
  size = "md",
  disabled,
  disabledReason,
  inlineReason = true,
  title,
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const effectiveTitle = disabled && disabledReason ? disabledReason : title;

  const buttonEl = (
    <button
      type={type}
      disabled={disabled}
      title={effectiveTitle}
      aria-disabled={disabled || undefined}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );

  if (disabled && disabledReason && inlineReason) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2.5">
        <span className="text-xs text-[var(--text-muted)]">
          {disabledReason}
        </span>
        {buttonEl}
      </span>
    );
  }

  return buttonEl;
}
