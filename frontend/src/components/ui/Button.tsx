"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabledReason?: string;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--brand)] text-white border border-transparent hover:bg-[var(--brand-hover)]",
  secondary:
    "bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]",
  ghost:
    "bg-transparent text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]",
  danger:
    "bg-[var(--danger)] text-white border border-transparent hover:bg-[var(--danger-hover)]",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "px-3.5 py-2 text-[14px]",
  sm: "px-2.5 py-1.5 text-[12px]",
};

export function Button({
  variant = "secondary",
  size = "md",
  disabled,
  disabledReason,
  title,
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const effectiveTitle = disabled && disabledReason ? disabledReason : title;

  return (
    <button
      type={type}
      disabled={disabled}
      title={effectiveTitle}
      aria-disabled={disabled || undefined}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[8px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
