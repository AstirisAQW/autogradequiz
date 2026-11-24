import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
  children: ReactNode;
}

export function Card({
  padded = true,
  className = "",
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={`rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] ${padded ? "p-6" : ""} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
