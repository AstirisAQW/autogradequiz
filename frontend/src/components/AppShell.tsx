"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderGate } from "@/components/FolderGate";
import { FolderSwitcher } from "@/components/FolderSwitcher";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  DocumentIcon,
  MenuIcon,
  ReviewCheckIcon,
  StudentIcon,
  UsersIcon,
  WarningIcon,
} from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Skeleton";
import {
  API_BASE_URL,
  getErrorMessage,
  getHealth,
  templatePdfUrl,
} from "@/lib/api";
import {
  FOLDER_CHANGED_EVENT,
  WORKSPACE_CHANGED_EVENT,
  getActiveFolder,
  listFolders,
  setActiveFolder,
  type FolderSummary,
} from "@/lib/workspace";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [activeFolder, setActiveFolderState] = useState<string | null>(null);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [reviewCount, setReviewCount] = useState<number>(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const requestSeqRef = useRef(0);

  const refreshShellState = useCallback(async () => {
    const seq = ++requestSeqRef.current;

    getHealth()
      .then((res) => {
        if (seq === requestSeqRef.current) setHealthy(res.status === "ok");
      })
      .catch(() => {
        if (seq === requestSeqRef.current) setHealthy(false);
      });

    try {
      const folderList = await listFolders();
      if (seq !== requestSeqRef.current) return;
      setFolders(folderList);
      setBootError(null);

      const stored = getActiveFolder();
      const matched = stored
        ? folderList.find((f) => f.name === stored)?.name ?? null
        : null;
      if (stored && !matched) {
        setActiveFolder(null);
      }
      setActiveFolderState(matched);
      const activeSummary = matched
        ? folderList.find((f) => f.name === matched)
        : undefined;
      setReviewCount(activeSummary?.needsReviewCount ?? 0);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setBootError(
        getErrorMessage(err, `Cannot reach backend at ${API_BASE_URL}`),
      );
      setActiveFolderState(null);
    } finally {
      if (seq === requestSeqRef.current) setLoadingFolders(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => setMobileOpen(false));
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refreshShellState();
    });
    return () => {
      cancelled = true;
    };
  }, [refreshShellState]);

  useEffect(() => {
    let active = true;
    const id = window.setInterval(() => {
      getHealth()
        .then((res) => {
          if (active) setHealthy(res.status === "ok");
        })
        .catch(() => {
          if (active) setHealthy(false);
        });
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let debounceId: number | undefined;
    function onFolderChanged() {
      if (debounceId !== undefined) {
        window.clearTimeout(debounceId);
        debounceId = undefined;
      }
      const stored = getActiveFolder();
      setActiveFolderState(stored);
      void refreshShellState();
    }
    function onWorkspaceChanged() {
      if (debounceId !== undefined) {
        window.clearTimeout(debounceId);
      }
      debounceId = window.setTimeout(() => {
        debounceId = undefined;
        void refreshShellState();
      }, 400);
    }
    window.addEventListener(FOLDER_CHANGED_EVENT, onFolderChanged);
    window.addEventListener(WORKSPACE_CHANGED_EVENT, onWorkspaceChanged);
    return () => {
      if (debounceId !== undefined) window.clearTimeout(debounceId);
      window.removeEventListener(FOLDER_CHANGED_EVENT, onFolderChanged);
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, onWorkspaceChanged);
    };
  }, [refreshShellState]);

  const offlineBanner =
    healthy === false ? (
      <div
        role="alert"
        className="border-b border-amber-700/25 bg-[var(--warning-bg)] px-5 py-2.5 text-[0.8125rem] text-[var(--warning-text)] lg:px-12"
      >
        <div className="mx-auto flex w-full max-w-[1160px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-medium">
            <WarningIcon />
            <span>Grader offline, uploads are paused.</span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refreshShellState()}
          >
            Reconnect
          </Button>
        </div>
      </div>
    ) : null;

  if (loadingFolders) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
        <main className="mx-auto w-full max-w-[980px] px-5 py-9 lg:px-12">
          <SkeletonRows rows={4} />
        </main>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
        <main className="mx-auto w-full max-w-[780px] px-5 py-12">
          <EmptyState
            tone="error"
            icon={<WarningIcon />}
            title="Could not connect to AutoGradeQuiz backend"
            description={`${bootError}.`}
            nextStep={`Make sure the FastAPI server is running at ${API_BASE_URL}, then select Try again.`}
            action={
              <Button variant="primary" onClick={() => void refreshShellState()}>
                Try again
              </Button>
            }
          />
        </main>
      </div>
    );
  }

  if (!activeFolder) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
        <main className="mx-auto w-full max-w-[920px] px-5 py-9">
          <FolderGate folders={folders} onFolderReady={refreshShellState} />
        </main>
      </div>
    );
  }

  const navItems = [
    {
      href: "/",
      label: "Quizzes",
      icon: <DocumentIcon />,
      active: pathname === "/" || pathname.startsWith("/quizzes/"),
      badge: 0,
    },
    {
      href: "/classes",
      label: "Classes",
      icon: <UsersIcon />,
      active: pathname.startsWith("/classes"),
      badge: 0,
    },
    {
      href: "/students",
      label: "Students",
      icon: <StudentIcon />,
      active: pathname.startsWith("/students"),
      badge: 0,
    },
    {
      href: "/review",
      label: "Review papers",
      icon: <ReviewCheckIcon />,
      active: pathname.startsWith("/review"),
      badge: reviewCount,
    },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)] lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      {mobileOpen && (
        <div
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}

      <aside
        aria-label="Primary navigation"
        className={`fixed inset-y-0 left-0 z-40 w-[248px] bg-[var(--sidebar-bg)] text-white transition-transform duration-150 lg:static lg:w-auto lg:translate-x-0 ${
          mobileOpen ? "translate-x-0 shadow-xl" : "-translate-x-full"
        }`}
      >
        <div className="sticky top-0 flex h-screen flex-col gap-4 overflow-y-auto overflow-x-hidden px-3 py-4">
          <div className="px-1 py-1">
            <Link
              href="/"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2 rounded-lg font-[family-name:var(--font-heading)] text-base font-bold tracking-tight text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg bg-white/15 text-[0.8125rem] font-bold">
                A
              </span>
              <span className="truncate">AutoGradeQuiz</span>
            </Link>
          </div>

          <FolderSwitcher
            activeFolder={activeFolder}
            folders={folders}
            onRefreshFolders={refreshShellState}
          />

          <nav className="flex flex-1 flex-col gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                aria-current={item.active ? "page" : undefined}
                className={`flex min-h-[40px] items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                  item.active
                    ? "bg-[var(--sidebar-active)] font-semibold text-white"
                    : "font-medium text-white/85 hover:bg-[var(--sidebar-hover)] hover:text-white"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="inline-flex shrink-0">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge > 0 && (
                  <span
                    aria-label={`${item.badge} ${item.badge === 1 ? "paper needs" : "papers need"} review`}
                    className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[var(--gold)] px-1.5 text-[0.6875rem] font-bold text-zinc-900 tabular-nums"
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            ))}
          </nav>

          <div className="border-t border-white/10 pt-3">
            <p className="px-2 text-[0.6875rem] font-medium tracking-wider text-white/65 uppercase">
              Blank A4 sheets (PDF)
            </p>
            <div className="mt-2 grid grid-cols-3 gap-1.5 px-1">
              {(
                [
                  ["20Q", "20q_a4"],
                  ["50Q", "50q_a4"],
                  ["100Q", "100q_a4"],
                ] as const
              ).map(([label, tid]) => (
                <a
                  key={tid}
                  href={templatePdfUrl(tid)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-8 items-center justify-center rounded-lg border border-white/15 bg-white/10 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  {label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="sticky top-0 z-20 flex items-center gap-3 bg-[var(--sidebar-bg)] px-4 py-2.5 text-white lg:hidden">
          <button
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <MenuIcon />
          </button>
          <span className="truncate font-semibold">{activeFolder}</span>
        </div>

        {offlineBanner}

        <main
          key={activeFolder}
          className={`mx-auto w-full ${
            pathname.startsWith("/review")
              ? "max-w-[1200px]"
              : "max-w-[980px]"
          } px-5 py-7 lg:px-10 lg:py-8`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
