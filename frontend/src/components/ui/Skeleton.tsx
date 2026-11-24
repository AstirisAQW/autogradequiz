export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg bg-black/[0.06] ${className}`}
    />
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="space-y-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-6"
    >
      <Skeleton className="h-4 w-1/3" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
