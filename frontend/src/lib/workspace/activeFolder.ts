const ACTIVE_FOLDER_KEY = "autograde.activeFolder";

export const FOLDER_CHANGED_EVENT = "autograde:folder-changed";
export const WORKSPACE_CHANGED_EVENT = "autograde:workspace-changed";

let memoryFolder: string | null = null;

function dispatchEventSafe(name: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(name));
  }
}

export function getActiveFolder(): string | null {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(ACTIVE_FOLDER_KEY);
      if (stored && stored.trim()) {
        memoryFolder = stored.trim();
        return memoryFolder;
      }
      memoryFolder = null;
      return null;
    } catch {
      return memoryFolder;
    }
  }
  return memoryFolder;
}

export function setActiveFolder(name: string | null): void {
  const normalized = name && name.trim() ? name.trim() : null;
  memoryFolder = normalized;
  if (typeof window !== "undefined") {
    try {
      if (normalized) {
        window.localStorage.setItem(ACTIVE_FOLDER_KEY, normalized);
      } else {
        window.localStorage.removeItem(ACTIVE_FOLDER_KEY);
      }
    } catch {
    }
  }
  dispatchEventSafe(FOLDER_CHANGED_EVENT);
}

export function requireActiveFolder(): string {
  const active = getActiveFolder();
  if (!active) {
    throw new Error("Select or create a workspace folder first.");
  }
  return active;
}

export function notifyWorkspaceChanged(): void {
  dispatchEventSafe(WORKSPACE_CHANGED_EVENT);
}
