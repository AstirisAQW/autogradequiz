"use client";

import { useState } from "react";
import { getErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormField, SelectInput, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { formatHumanDate } from "@/lib/format";
import {
  createFolder,
  setActiveFolder,
  validateFolderName,
  type FolderSummary,
} from "@/lib/workspace";

interface FolderGateProps {
  folders: FolderSummary[];
  onFolderReady: () => Promise<void>;
}

export function FolderGate({ folders, onFolderReady }: FolderGateProps) {
  const { push: pushToast } = useToast();
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const clientErr = validateFolderName(name, folders);
  const visibleError = error ?? (touched ? clientErr : null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (clientErr || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createFolder(name.trim(), copyFrom || undefined);
      setActiveFolder(created.name);
      setName("");
      setCopyFrom("");
      setTouched(false);
      await onFolderReady();
      pushToast(`Opened folder "${created.name}".`, "success");
    } catch (err) {
      setError(getErrorMessage(err, "Could not create folder."));
    } finally {
      setCreating(false);
    }
  }

  async function handlePickFolder(folderName: string) {
    setActiveFolder(folderName);
    await onFolderReady();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div className="space-y-1 text-center">
        <h1>
          {folders.length === 0
            ? "Create your first folder"
            : "Select a folder"}
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Each folder keeps its own classes, students, quizzes, graded papers,
          and scan images.
        </p>
      </div>

      {folders.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {folders.map((folder) => (
            <button
              key={folder.name}
              type="button"
              onClick={() => void handlePickFolder(folder.name)}
              className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4 text-left transition-colors hover:border-[var(--brand)] hover:bg-[var(--bg-subtle)]/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
            >
              <p className="truncate text-[0.9375rem] font-semibold text-[var(--text-primary)]">
                {folder.name}
              </p>
              <p className="mt-1 text-xs text-[var(--text-secondary)] tabular-nums">
                {folder.quizCount} {folder.quizCount === 1 ? "quiz" : "quizzes"},{" "}
                {folder.paperCount} {folder.paperCount === 1 ? "paper" : "papers"},{" "}
                {folder.studentCount}{" "}
                {folder.studentCount === 1 ? "student" : "students"}
              </p>
              <p className="mt-0.5 text-[0.6875rem] text-[var(--text-muted)] tabular-nums">
                Updated {formatHumanDate(folder.lastModified || folder.createdAt)}
              </p>
            </button>
          ))}
        </div>
      )}

      <Card>
        <form
          noValidate
          onSubmit={(e) => void handleCreate(e)}
          className="space-y-4"
        >
          <h2>{folders.length === 0 ? "New folder" : "Or create a new folder"}</h2>
          <FormField
            id="gate-folder-name"
            label="Folder name"
            error={visibleError}
          >
            <TextInput
              id="gate-folder-name"
              type="text"
              maxLength={60}
              aria-required="true"
              hasError={Boolean(visibleError)}
              placeholder="e.g. Midterm Grade 10"
              value={name}
              onBlur={() => setTouched(true)}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
            />
          </FormField>

          {folders.length > 0 && (
            <FormField
              id="gate-copy-roster"
              label="Copy classes and students from (optional)"
            >
              <SelectInput
                id="gate-copy-roster"
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
            <Button type="submit" variant="primary" disabled={creating}>
              {creating ? "Creating..." : "Create and open folder"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
