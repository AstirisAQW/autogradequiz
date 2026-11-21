import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[12px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-6 py-10 text-center">
      {icon && (
        <div
          aria-hidden="true"
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)]"
        >
          {icon}
        </div>
      )}
      <p className="text-[14px] font-medium text-[var(--text-primary)]">
        {title}
      </p>
      <p className="mt-1 max-w-md text-[14px] text-[var(--text-secondary)]">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
