"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { FormField, SelectInput, TextInput } from "@/components/ui/Field";
import { ChevronDownIcon, FolderIcon } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";
import {
  createFolder,
  deleteFolder,
  renameFolder,
  setActiveFolder,
  validateFolderName,
  type FolderSummary,
} from "@/lib/workspace";

interface FolderSwitcherProps {
  activeFolder: string;
  folders: FolderSummary[];
  onRefreshFolders: () => Promise<void>;
}

export function FolderSwitcher({
  activeFolder,
  folders,
  onRefreshFolders,
}: FolderSwitcherProps) {
  const router = useRouter();
  const { push: pushToast } = useToast();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTouched, setNewTouched] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameTouched, setRenameTouched] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const activeSummary = folders.find((f) => f.name === activeFolder);
  const newClientErr = validateFolderName(newName, folders);
  const visibleNewErr = newError ?? (newTouched ? newClientErr : null);

  const renameClientErr = validateFolderName(
    renameValue,
    folders,
    activeFolder,
  );
  const visibleRenameErr = renameError ?? (renameTouched ? renameClientErr : null);

  function runWithNavigationGuard(proceed: () => void) {
    const event = new CustomEvent("agq:before-navigate", {
      cancelable: true,
      detail: { proceed },
    });
    if (window.dispatchEvent(event)) {
      proceed();
    }
  }

  function handleSwitchFolder(name: string) {
    setMenuOpen(false);
    if (name === activeFolder) return;
    runWithNavigationGuard(() => {
      setActiveFolder(name);
      router.push("/");
    });
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNewTouched(true);
    if (newClientErr || creating) return;
    setCreating(true);
    setNewError(null);
    try {
      const created = await createFolder(newName.trim(), copyFrom || undefined);
      setActiveFolder(created.name);
      setNewOpen(false);
      setNewName("");
      setCopyFrom("");
      setNewTouched(false);
      await onRefreshFolders();
      router.push("/");
      pushToast(`Switched to folder "${created.name}".`, "success");
    } catch (err) {
      setNewError(getErrorMessage(err, "Could not create folder."));
    } finally {
      setCreating(false);
    }
  }

  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRenameTouched(true);
    if (renameClientErr || renaming) return;
    setRenaming(true);
    setRenameError(null);
    try {
      const updated = await renameFolder(activeFolder, renameValue.trim());
      setRenameOpen(false);
      setRenameTouched(false);
      await onRefreshFolders();
      pushToast(`Renamed folder to "${updated.name}".`, "success");
    } catch (err) {
      setRenameError(getErrorMessage(err, "Could not rename folder."));
    } finally {
      setRenaming(false);
    }
  }

  async function handleDeleteConfirm() {
    if (deleting) return;
    setDeleting(true);
    try {
      const target = activeFolder;
      await deleteFolder(target);
      setDeleteOpen(false);
      await onRefreshFolders();
      router.push("/");
      pushToast(`Deleted folder "${target}".`, "info");
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not delete folder."), "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div
        ref={menuRef}
        className="relative rounded-xl border border-white/15 bg-[var(--sidebar-surface)] p-1"
      >
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-white transition-colors hover:bg-[var(--sidebar-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          title={`Folder: ${activeFolder}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="inline-flex shrink-0">
              <FolderIcon />
            </span>
            <span className="min-w-0">
              <span className="block text-[0.6875rem] leading-tight text-white/70">
                Folder
              </span>
              <span className="block truncate text-[0.8125rem] font-semibold text-white">
                {activeFolder}
              </span>
            </span>
          </span>
          <span className="shrink-0 opacity-80">
            <ChevronDownIcon />
          </span>
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute inset-x-0 z-50 mt-2 flex w-full flex-col gap-0.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1 text-[var(--text-primary)] shadow-lg"
          >
            <div className="max-h-56 overflow-y-auto overflow-x-hidden">
              {folders.map((folder) => {
                const isCurrent = folder.name === activeFolder;
                return (
                  <button
                    key={folder.name}
                    type="button"
                    role="menuitem"
                    onClick={() => handleSwitchFolder(folder.name)}
                    className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left text-[0.8125rem] transition-colors ${
                      isCurrent
                        ? "bg-[var(--brand-subtle)] text-[var(--brand-text)]"
                        : "hover:bg-[var(--bg-subtle)]"
                    }`}
                  >
                    <span
                      className={`w-full truncate ${isCurrent ? "font-semibold" : "font-medium"}`}
                    >
                      {folder.name}
                    </span>
                    <span className="w-full truncate text-[0.6875rem] font-normal text-[var(--text-muted)] tabular-nums">
                      {folder.quizCount}{" "}
                      {folder.quizCount === 1 ? "quiz" : "quizzes"},{" "}
                      {folder.paperCount}{" "}
                      {folder.paperCount === 1 ? "paper" : "papers"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mx-1 my-0.5 h-px bg-[var(--border-hairline)]" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                runWithNavigationGuard(() => {
                  setNewName("");
                  setNewTouched(false);
                  setCopyFrom(activeFolder);
                  setNewError(null);
                  setNewOpen(true);
                });
              }}
              className="block w-full rounded-lg px-2.5 py-2 text-left text-[0.8125rem] font-medium text-[var(--brand-text)] hover:bg-[var(--bg-subtle)]"
            >
              New folder
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setRenameValue(activeFolder);
                setRenameTouched(false);
                setRenameError(null);
                setRenameOpen(true);
              }}
              className="block w-full rounded-lg px-2.5 py-2 text-left text-[0.8125rem] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
            >
              Rename folder
            </button>
            <div className="mx-1 my-0.5 h-px bg-[var(--border-hairline)]" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                runWithNavigationGuard(() => setDeleteOpen(true));
              }}
              className="block w-full rounded-lg px-2.5 py-2 text-left text-[0.8125rem] font-medium text-[var(--danger)] hover:bg-[var(--danger-bg)]"
            >
              Delete folder
            </button>
          </div>
        )}
      </div>

      <Dialog
        open={newOpen}
        title="New folder"
        description="Creates an isolated folder for its own classes, students, quizzes, and scan images."
        busy={creating}
        hideFooter
        onClose={() => {
          setNewOpen(false);
          setNewTouched(false);
        }}
      >
        <form
          noValidate
          onSubmit={(e) => void handleCreateSubmit(e)}
          className="space-y-4"
        >
          <FormField
            id="switcher-new-folder-name"
            label="Folder name"
            error={visibleNewErr}
          >
            <TextInput
              id="switcher-new-folder-name"
              type="text"
              maxLength={60}
              aria-required="true"
              hasError={Boolean(visibleNewErr)}
              placeholder="e.g. Finals Grade 11"
              value={newName}
              onBlur={() => setNewTouched(true)}
              onChange={(e) => {
                setNewName(e.target.value);
                if (newError) setNewError(null);
              }}
            />
          </FormField>

          {folders.length > 0 && (
            <FormField
              id="switcher-copy-roster"
              label="Copy classes and students from (optional)"
            >
              <SelectInput
                id="switcher-copy-roster"
                value={copyFrom}
                onChange={(e) => setCopyFrom(e.target.value)}
              >
                <option value="">Start with an empty roster</option>
                {folders.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name} ({f.classCount}{" "}
                    {f.classCount === 1 ? "class" : "classes"},{" "}
                    {f.studentCount}{" "}
                    {f.studentCount === 1 ? "student" : "students"})
                  </option>
                ))}
              </SelectInput>
            </FormField>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="secondary"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setNewOpen(false);
                setNewTouched(false);
              }}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={creating}>
              {creating ? "Creating..." : "Create folder"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={renameOpen}
        title={`Rename folder "${activeFolder}"`}
        busy={renaming}
        hideFooter
        onClose={() => {
          setRenameOpen(false);
          setRenameTouched(false);
        }}
      >
        <form
          noValidate
          onSubmit={(e) => void handleRenameSubmit(e)}
          className="space-y-4"
        >
          <FormField
            id="switcher-rename-folder"
            label="New folder name"
            error={visibleRenameErr}
          >
            <TextInput
              id="switcher-rename-folder"
              type="text"
              maxLength={60}
              aria-required="true"
              hasError={Boolean(visibleRenameErr)}
              value={renameValue}
              onBlur={() => setRenameTouched(true)}
              onChange={(e) => {
                setRenameValue(e.target.value);
                if (renameError) setRenameError(null);
              }}
            />
          </FormField>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="secondary"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setRenameOpen(false);
                setRenameTouched(false);
              }}
              disabled={renaming}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={renaming}>
              {renaming ? "Renaming..." : "Rename folder"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deleteOpen}
        title={`Delete folder "${activeFolder}"?`}
        description={`This permanently removes "${activeFolder}" from disk (${activeSummary?.quizCount ?? 0} ${activeSummary?.quizCount === 1 ? "quiz" : "quizzes"}, ${activeSummary?.paperCount ?? 0} ${activeSummary?.paperCount === 1 ? "paper" : "papers"}, ${activeSummary?.studentCount ?? 0} ${activeSummary?.studentCount === 1 ? "student" : "students"}, and all scan images).`}
        confirmLabel="Delete folder"
        confirmVariant="danger"
        busy={deleting}
        onConfirm={() => void handleDeleteConfirm()}
        onClose={() => setDeleteOpen(false)}
      />
    </>
  );
}
