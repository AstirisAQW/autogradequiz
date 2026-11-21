"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getHealth } from "@/lib/api";
import {
  getReviewQueue,
  getWorkspaceSaveStatus,
  type WorkspaceSaveStatus,
} from "@/lib/workspace";
import {
  getDiskSyncStatus,
  hydrateWorkspaceFromDiskIfEmpty,
  initDiskSyncListener,
  refreshDiskStatus,
  type DiskSyncSnapshot,
} from "@/lib/workspace/diskSync";

const NAV_ITEMS = [
  { href: "/", label: "Quizzes" },
  { href: "/classes", label: "Classes" },
  { href: "/students", label: "Students" },
  { href: "/review", label: "Review Papers" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [reviewCount, setReviewCount] = useState<number>(0);
  const [saveStatus, setSaveStatus] = useState<WorkspaceSaveStatus>({
    lastSavedAt: null,
    lastExportedAt: null,
    changesSinceBackup: 0,
    isBackupStale: true,
  });
  const [diskStatus, setDiskStatus] = useState<DiskSyncSnapshot>(() =>
    getDiskSyncStatus(),
  );

  const refreshStatus = useCallback(() => {
    getHealth()
      .then((res) => setHealthy(res.status === "ok"))
      .catch(() => setHealthy(false));
    getReviewQueue()
      .then((items) => setReviewCount(items.length))
      .catch(() => {});
    void refreshDiskStatus()
      .then((next) => setDiskStatus(next))
      .catch(() => {});
    queueMicrotask(() => {
      setSaveStatus(getWorkspaceSaveStatus());
    });
  }, []);

  useEffect(() => {
    initDiskSyncListener();
    void hydrateWorkspaceFromDiskIfEmpty().then((hydrated) => {
      if (hydrated) refreshStatus();
    });
  }, [refreshStatus]);

  useEffect(() => {
    refreshStatus();
  }, [pathname, refreshStatus]);

  useEffect(() => {
    function onRefresh() {
      refreshStatus();
    }
    function onDiskSync() {
      setDiskStatus(getDiskSyncStatus());
    }
    window.addEventListener("autograde:workspace-saved", onRefresh);
    window.addEventListener("autograde:workspace-hydrated", onRefresh);
    window.addEventListener("autograde:disk-sync", onDiskSync);
    return () => {
      window.removeEventListener("autograde:workspace-saved", onRefresh);
      window.removeEventListener("autograde:workspace-hydrated", onRefresh);
      window.removeEventListener("autograde:disk-sync", onDiskSync);
    };
  }, [refreshStatus]);

  const healthDotClass =
    healthy === null
      ? "bg-white/40"
      : healthy
        ? "bg-emerald-400"
        : "bg-red-400";
  const healthLabel =
    healthy === null
      ? "Checking grader status"
      : healthy
        ? "Grader connected"
        : "Grader unreachable";

  const statusPillLabel =
    diskStatus.state === "syncing"
      ? "Syncing to workspace/…"
      : diskStatus.state === "synced" && healthy !== false
        ? "Saved to workspace/"
        : "Saved locally";

  const statusPillTitle =
    diskStatus.state === "synced" && diskStatus.workspaceDir
      ? `Synced to ${diskStatus.workspaceDir}${diskStatus.lastSyncedAt ? ` (${new Date(diskStatus.lastSyncedAt).toLocaleTimeString()})` : ""}`
      : saveStatus.lastSavedAt
        ? `Saved locally in browser IndexedDB (${new Date(saveStatus.lastSavedAt).toLocaleTimeString()})`
        : "All workspace data is saved locally in browser IndexedDB";

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-40 border-b border-black/15 bg-[var(--brand)] text-white">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-2.5 py-3.5">
            <Link
              href="/"
              className="font-[family-name:var(--font-heading)] text-[17px] font-medium tracking-tight text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              AutoGradeQuiz
            </Link>
            <span
              title={healthLabel}
              aria-label={healthLabel}
              className={`inline-block h-2 w-2 rounded-full ${healthDotClass}`}
            />
            <span
              title={statusPillTitle}
              className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/12 px-2.5 py-0.5 text-[11px] font-medium text-white/90"
            >
              <span aria-hidden="true">✓</span>
              <span>{statusPillLabel}</span>
            </span>
          </div>

          <nav
            aria-label="Primary navigation"
            className="flex flex-wrap items-center gap-6 text-[14px] font-medium"
          >
            {NAV_ITEMS.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/" || pathname.startsWith("/quizzes/")
                  : item.href === "/classes"
                    ? pathname.startsWith("/classes") ||
                      pathname.startsWith("/sections")
                    : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex items-center gap-2 border-b-2 py-3.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                    active
                      ? "border-white text-white"
                      : "border-transparent text-white/85 hover:text-white"
                  }`}
                >
                  <span>{item.label}</span>
                  {item.href === "/review" && reviewCount > 0 && (
                    <span
                      aria-label={`${reviewCount} papers need review`}
                      className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-amber-300 px-1.5 py-0.5 text-[12px] font-medium leading-none text-amber-950 tabular-nums"
                    >
                      {reviewCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] p-6">{children}</main>
    </div>
  );
}
