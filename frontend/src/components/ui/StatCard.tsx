import Link from "next/link";
import type { ReactNode } from "react";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  href?: string;
}

export function StatCard({ label, value, hint, href }: StatCardProps) {
  const inner = (
    <div className="rounded-[12px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-4 py-3.5 transition-colors hover:border-[var(--border-strong)]">
      <p className="text-[12px] font-medium text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mt-1 text-[20px] font-medium leading-tight text-[var(--text-primary)] tabular-nums">
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
          {hint}
        </p>
      )}
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
      >
        {inner}
      </Link>
    );
  }

  return inner;
}
