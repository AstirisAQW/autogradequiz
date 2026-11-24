"use client";

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
}

export interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  activeId: T;
  onChange: (id: T) => void;
  className?: string;
}

export function Tabs<T extends string = string>({
  items,
  activeId,
  onChange,
  className = "",
}: TabsProps<T>) {
  return (
    <div
      role="tablist"
      className={`flex flex-nowrap gap-5 overflow-x-auto border-b border-[var(--border-hairline)] sm:gap-6 ${className}`}
    >
      {items.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-0.5 pb-2.5 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
              active
                ? "border-[var(--brand)] font-bold text-[var(--text-primary)]"
                : "border-transparent font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <span className="tab-label" data-text={tab.label}>
              {tab.label}
            </span>
            {tab.count !== undefined && (
              <span className="rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)] tabular-nums">
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
