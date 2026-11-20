import { API_BASE_URL, getWorkspaceDiskStatus } from "../api.ts";
import { exportWorkspaceJsonString, importWorkspace } from "./backup.ts";
import { listQuizzes } from "./quizzes.ts";
import { getRoster } from "./roster.ts";

export type DiskSyncState = "idle" | "syncing" | "synced" | "offline";

export interface DiskSyncSnapshot {
  state: DiskSyncState;
  workspaceDir: string | null;
  lastSyncedAt: string | null;
  scanCount: number;
}

const SESSION_HYDRATED_KEY = "autograde.diskHydrated";

let snapshot: DiskSyncSnapshot = {
  state: "idle",
  workspaceDir: null,
  lastSyncedAt: null,
  scanCount: 0,
};

let listenerAttached = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let syncInFlight = false;
let pendingResync = false;
let dirtySinceSync = false;
let localWriteObserved = false;

export function resetDiskSyncForTests(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  syncInFlight = false;
  pendingResync = false;
  dirtySinceSync = false;
  localWriteObserved = false;
  snapshot = {
    state: "idle",
    workspaceDir: null,
    lastSyncedAt: null,
    scanCount: 0,
  };
}

function notifyDiskSync(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("autograde:disk-sync"));
  }
}

function parentDirectory(filePath: string | undefined): string | null {
  if (!filePath) return null;
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return idx > 0 ? filePath.slice(0, idx) : null;
}

export async function runSyncQueue(): Promise<void> {
  if (typeof window === "undefined") return;
  if (syncInFlight) {
    pendingResync = true;
    return;
  }

  syncInFlight = true;
  snapshot = { ...snapshot, state: "syncing" };
  notifyDiskSync();

  try {
    do {
      pendingResync = false;
      const json = await exportWorkspaceJsonString();
      const res = await fetch(`${API_BASE_URL}/workspace/data`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: json,
      });
      if (!res.ok) {
        dirtySinceSync = true;
        snapshot = { ...snapshot, state: "offline" };
        notifyDiskSync();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        path?: string;
        saved_at?: string;
      };
      if (!pendingResync) {
        dirtySinceSync = false;
      }
      snapshot = {
        ...snapshot,
        state: pendingResync ? "syncing" : "synced",
        workspaceDir: parentDirectory(body.path) ?? snapshot.workspaceDir,
        lastSyncedAt: body.saved_at ?? new Date().toISOString(),
      };
      notifyDiskSync();
    } while (pendingResync);
  } catch {
    dirtySinceSync = true;
    snapshot = { ...snapshot, state: "offline" };
    notifyDiskSync();
  } finally {
    syncInFlight = false;
  }
}

export function scheduleDiskSync(): void {
  dirtySinceSync = true;
  localWriteObserved = true;
  if (typeof window === "undefined") return;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSyncQueue();
  }, 400);
}

export function initDiskSyncListener(): void {
  if (typeof window === "undefined" || listenerAttached) return;
  listenerAttached = true;
  window.addEventListener("autograde:workspace-saved", scheduleDiskSync);
}

export function getDiskSyncStatus(): DiskSyncSnapshot {
  return snapshot;
}

export async function refreshDiskStatus(): Promise<DiskSyncSnapshot> {
  if (typeof window === "undefined") return snapshot;
  try {
    const status = await getWorkspaceDiskStatus();
    if (dirtySinceSync) {
      scheduleDiskSync();
    }
    snapshot = {
      state:
        snapshot.state === "syncing" || dirtySinceSync
          ? "syncing"
          : status.has_workspace_json
            ? "synced"
            : snapshot.state === "offline"
              ? "idle"
              : snapshot.state,
      workspaceDir: status.workspace_dir,
      lastSyncedAt: snapshot.lastSyncedAt ?? status.last_modified,
      scanCount: status.scan_count,
    };
  } catch {
    snapshot = { ...snapshot, state: "offline" };
  }
  notifyDiskSync();
  return snapshot;
}

export async function hydrateWorkspaceFromDiskIfEmpty(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    if (window.sessionStorage.getItem(SESSION_HYDRATED_KEY) === "1") {
      return false;
    }
  } catch {
    // Ignore storage access errors
  }

  try {
    const [quizzes, roster] = await Promise.all([listQuizzes(), getRoster()]);
    const isEmpty =
      quizzes.length === 0 &&
      roster.sections.length === 0 &&
      roster.students.length === 0;
    if (!isEmpty) {
      const diskStatus = await getWorkspaceDiskStatus().catch(() => null);
      if (diskStatus && !diskStatus.has_workspace_json) {
        scheduleDiskSync();
      }
      try {
        window.sessionStorage.setItem(SESSION_HYDRATED_KEY, "1");
      } catch {}
      return false;
    }

    const writeSeenBeforeFetch = localWriteObserved;
    const res = await fetch(`${API_BASE_URL}/workspace/data`);
    if (!res.ok) {
      try {
        window.sessionStorage.setItem(SESSION_HYDRATED_KEY, "1");
      } catch {}
      return false;
    }
    if (localWriteObserved && !writeSeenBeforeFetch) {
      try {
        window.sessionStorage.setItem(SESSION_HYDRATED_KEY, "1");
      } catch {}
      return false;
    }

    const text = await res.text();
    if (localWriteObserved && !writeSeenBeforeFetch) {
      return false;
    }
    const imported = await importWorkspace(text, {
      skipDiskSync: true,
      onlyIfEmpty: true,
    });
    try {
      window.sessionStorage.setItem(SESSION_HYDRATED_KEY, "1");
    } catch {}
    if (!imported) {
      return false;
    }
    dirtySinceSync = false;
    snapshot = { ...snapshot, state: "synced" };
    window.dispatchEvent(new Event("autograde:workspace-hydrated"));
    notifyDiskSync();
    return true;
  } catch {
    return false;
  }
}
