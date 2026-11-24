import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  nextStep?: string;
  tone?: "default" | "error";
  action?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  nextStep,
  tone = "default",
  action,
}: EmptyStateProps) {
  const isError = tone === "error";
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border px-6 py-10 text-center ${
        isError
          ? "border-red-700/30 bg-[#fffafa]"
          : "border-[var(--border-hairline)] bg-[var(--bg-surface)]"
      }`}
    >
      {icon && (
        <div
          aria-hidden="true"
          className={`mb-3 flex h-10 w-10 items-center justify-center rounded-full ${
            isError
              ? "bg-[var(--danger-bg)] text-[var(--danger)]"
              : "bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
          }`}
        >
          {icon}
        </div>
      )}
      <p className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">
        {title}
      </p>
      <p className="mt-1 max-w-md text-sm text-[var(--text-secondary)]">
        {description}
      </p>
      {nextStep && (
        <p className="mt-1 max-w-md text-[0.8125rem] text-[var(--text-muted)]">
          {nextStep}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
