"use client";

import Link from "next/link";
import { Fragment } from "react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-0.5"
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        const linkCls =
          "inline-flex min-h-[48px] items-center rounded-lg pr-2.5 pl-0.5 text-[0.8125rem] font-medium text-[var(--brand-text)] hover:bg-[var(--brand)]/[0.06] hover:text-[var(--brand-hover)] hover:underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]";

        return (
          <Fragment key={`${item.label}-${idx}`}>
            {idx > 0 && (
              <span
                aria-hidden="true"
                className="pr-2 text-[0.8125rem] text-[var(--text-muted)] select-none"
              >
                /
              </span>
            )}
            {isLast || (!item.href && !item.onClick) ? (
              <span className="px-1 text-[0.8125rem] font-medium text-[var(--text-secondary)]">
                {item.label}
              </span>
            ) : item.href ? (
              <Link href={item.href} className={linkCls}>
                {item.label}
              </Link>
            ) : (
              <button type="button" onClick={item.onClick} className={linkCls}>
                {item.label}
              </button>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
