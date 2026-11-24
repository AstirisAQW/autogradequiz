"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreIcon } from "./Icons";

export type ActionMenuEntry =
  | { kind: "divider"; id: string }
  | {
      kind?: "item";
      id: string;
      label: string;
      variant?: "default" | "danger";
      href?: string;
      external?: boolean;
      onClick?: () => void;
    };

export interface ActionMenuProps {
  label?: string;
  align?: "left" | "right";
  items: ActionMenuEntry[];
}

export function ActionMenu({
  label = "More actions",
  align = "right",
  items,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const btn = buttonRef.current;
    const menu = menuRef.current;
    if (!open || !btn || !menu) return;

    const btnRect = btn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const rawLeft =
      align === "left" ? btnRect.left : btnRect.right - menuRect.width;
    const maxLeft = Math.max(8, window.innerWidth - menuRect.width - 8);
    const left = Math.min(Math.max(8, rawLeft), maxLeft);

    let top = btnRect.bottom + 4;
    if (
      top + menuRect.height > window.innerHeight - 8 &&
      btnRect.top - 4 - menuRect.height >= 8
    ) {
      top = btnRect.top - 4 - menuRect.height;
    }
    top = Math.max(8, top);

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.visibility = "visible";
    (
      menu.querySelector('[role="menuitem"]') as HTMLElement | null
    )?.focus({ preventScroll: true });

    return () => {
      menu.style.visibility = "hidden";
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (
        buttonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const itemsEls = Array.from(
          menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
            [],
        );
        if (itemsEls.length === 0) return;
        e.preventDefault();
        const activeIdx = itemsEls.indexOf(
          document.activeElement as HTMLElement,
        );
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const nextIdx =
          activeIdx === -1
            ? delta > 0
              ? 0
              : itemsEls.length - 1
            : (activeIdx + delta + itemsEls.length) % itemsEls.length;
        itemsEls[nextIdx]?.focus();
      }
    }
    function onScroll(e: Event) {
      const target = e.target as Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function onResize() {
      setOpen(false);
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <div data-stop-row="true" className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] [@media(pointer:coarse)]:h-12 [@media(pointer:coarse)]:w-12"
      >
        <MoreIcon />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            data-stop-row="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: -9999,
              left: -9999,
              visibility: "hidden",
            }}
            className="z-50 flex min-w-[196px] flex-col gap-0.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1 text-left shadow-lg"
          >
            {items.map((entry) => {
              if (entry.kind === "divider") {
                return (
                  <div
                    key={entry.id}
                    className="mx-1 my-0.5 h-px bg-[var(--border-hairline)]"
                  />
                );
              }

              const itemCls = `block w-full rounded-lg px-2.5 py-2 text-left text-[0.8125rem] font-medium transition-colors ${
                entry.variant === "danger"
                  ? "text-[var(--danger)] hover:bg-[var(--danger-bg)]"
                  : "text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
              }`;

              if (entry.href) {
                if (entry.external) {
                  return (
                    <a
                      key={entry.id}
                      role="menuitem"
                      href={entry.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setOpen(false)}
                      className={itemCls}
                    >
                      {entry.label}
                    </a>
                  );
                }
                return (
                  <Link
                    key={entry.id}
                    role="menuitem"
                    href={entry.href}
                    onClick={() => setOpen(false)}
                    className={itemCls}
                  >
                    {entry.label}
                  </Link>
                );
              }

              return (
                <button
                  key={entry.id}
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    entry.onClick?.();
                  }}
                  className={itemCls}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
