"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuizMetadataFields } from "@/components/quiz/QuizMetadataFields";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, SelectInput, TextInput } from "@/components/ui/Field";
import { DocumentIcon } from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { useToast } from "@/components/ui/Toast";
import { formatDate, todayLocalIso } from "@/lib/format";
import {
  ANSWER_CHOICES,
  TEMPLATE_QUESTION_COUNTS,
  type TemplateId,
} from "@/lib/types";
import {
  deleteQuiz,
  exportWorkspace,
  getRoster,
  getWorkspaceSaveStatus,
  importWorkspace,
  listQuizSummaries,
  saveBatch,
  saveQuiz,
  type QuizSummary,
  type SectionWithCount,
  type WorkspaceSaveStatus,
} from "@/lib/workspace";

type QuizSortMode = "date" | "name" | "papers";

export default function QuizzesHomePage() {
  const router = useRouter();
  const { push: pushToast } = useToast();

  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [classes, setClasses] = useState<SectionWithCount[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters & sorting
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<QuizSortMode>("date");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");

  // New quiz dialog
  const [newOpen, setNewOpen] = useState(false);
  const [quizName, setQuizName] = useState("");
  const [templateId, setTemplateId] = useState<TemplateId>("20q_a4");
  const [quizDate, setQuizDate] = useState("");
  const [quizFolder, setQuizFolder] = useState("Main Folder");
  const [quizClassIds, setQuizClassIds] = useState<string[]>([]);
  const [quizTags, setQuizTags] = useState<string[]>([]);
  const [creatingQuiz, setCreatingQuiz] = useState(false);

  // Delete quiz confirm
  const [deleteTarget, setDeleteTarget] = useState<QuizSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Save workspace dialog
  const [exportOpen, setExportOpen] = useState(false);
  const [includeImages, setIncludeImages] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Open workspace confirm dialog
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  // Backup status & reminder dismissal
  const [saveStatus, setSaveStatus] = useState<WorkspaceSaveStatus>({
    lastSavedAt: null,
    lastExportedAt: null,
    changesSinceBackup: 0,
    isBackupStale: true,
  });
  const [reminderDismissed, setReminderDismissed] = useState(false);

  const loadWorkspaceSummary = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [quizList, roster] = await Promise.all([
        listQuizSummaries(),
        getRoster(),
      ]);
      setQuizzes(quizList);
      setClasses(roster.sections);
      setStudentCount(roster.students.length);
      setSaveStatus(getWorkspaceSaveStatus());
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Could not load workspace.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadWorkspaceSummary();
    });
    function onHydrated() {
      if (active) void loadWorkspaceSummary();
    }
    window.addEventListener("autograde:workspace-hydrated", onHydrated);
    return () => {
      active = false;
      window.removeEventListener("autograde:workspace-hydrated", onHydrated);
    };
  }, [loadWorkspaceSummary]);

  function openNewQuizModal() {
    setQuizName("");
    setTemplateId("20q_a4");
    setQuizDate(todayLocalIso());
    setQuizFolder("Main Folder");
    setQuizClassIds([]);
    setQuizTags([]);
    setNewOpen(true);
  }

  async function handleCreateQuiz(e: React.FormEvent) {
    e.preventDefault();
    const questionCount = TEMPLATE_QUESTION_COUNTS[templateId];
    if (!quizName.trim() || creatingQuiz) return;
    setCreatingQuiz(true);
    try {
      const defaultKey = Array.from(
        { length: questionCount },
        (_, i) => ANSWER_CHOICES[i % 5],
      );
      const created = await saveQuiz({
        name: quizName.trim(),
        templateId,
        date: quizDate,
        folder: quizFolder.trim() || "Main Folder",
        sectionIds: quizClassIds,
        tags: quizTags,
        questionCount,
        answerKey: defaultKey,
        points: Array(questionCount).fill(1),
      });
      await saveBatch({
        quizId: created.id,
        sectionId: quizClassIds.length === 1 ? quizClassIds[0] : null,
      });
      setNewOpen(false);
      pushToast(
        `Created "${created.name}". Set your answer key below.`,
        "success",
      );
      router.push(`/quizzes/${created.id}?tab=key`);
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not create quiz.",
        "error",
      );
      setCreatingQuiz(false);
    }
  }

  async function handleDeleteQuizConfirm() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const deletedName = deleteTarget.name;
      await deleteQuiz(deleteTarget.id);
      setDeleteTarget(null);
      await loadWorkspaceSummary();
      pushToast(`Deleted "${deletedName}".`, "success");
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not delete quiz.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function handleExportWorkspace() {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await exportWorkspace({ includeImages });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const day = todayLocalIso();
      a.href = url;
      a.download = `autogradequiz-workspace-${day}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportOpen(false);
      setSaveStatus(getWorkspaceSaveStatus());
      setReminderDismissed(false);
      pushToast("Workspace saved to JSON file.", "success");
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not export workspace.",
        "error",
      );
    } finally {
      setExporting(false);
    }
  }

  async function handleImportWorkspaceConfirm() {
    if (!pendingImportFile || importing) return;
    setImporting(true);
    try {
      await importWorkspace(pendingImportFile);
      setPendingImportFile(null);
      await loadWorkspaceSummary();
      pushToast("Workspace loaded from file.", "success");
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Invalid workspace file.",
        "error",
      );
    } finally {
      setImporting(false);
    }
  }

  const availableFolders = useMemo(() => {
    const set = new Set<string>(["Main Folder"]);
    for (const q of quizzes) {
      if (q.folder?.trim()) set.add(q.folder.trim());
    }
    return Array.from(set).sort((a, b) =>
      a === "Main Folder" ? -1 : b === "Main Folder" ? 1 : a.localeCompare(b),
    );
  }, [quizzes]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const q of quizzes) {
      for (const t of q.tags ?? []) set.add(t);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [quizzes]);

  const classById = useMemo(
    () => new Map(classes.map((c) => [c.id, c])),
    [classes],
  );

  const visibleQuizzes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return quizzes
      .filter((q) => {
        const folder = q.folder?.trim() || "Main Folder";
        if (folderFilter !== "all" && folder !== folderFilter) return false;
        if (tagFilter !== "all" && !(q.tags ?? []).includes(tagFilter)) {
          return false;
        }
        if (!query) return true;
        const classNames = (q.sectionIds ?? [])
          .map((id) => classById.get(id)?.name ?? "")
          .join(" ")
          .toLowerCase();
        const tagText = (q.tags ?? []).join(" ").toLowerCase();
        return (
          q.name.toLowerCase().includes(query) ||
          folder.toLowerCase().includes(query) ||
          classNames.includes(query) ||
          tagText.includes(query)
        );
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "papers") return b.paperCount - a.paperCount;
        const da = a.date || a.createdAt;
        const db = b.date || b.createdAt;
        return db.localeCompare(da);
      });
  }, [quizzes, searchQuery, folderFilter, tagFilter, sortBy, classById]);

  const totalPapers = quizzes.reduce((s, q) => s + q.paperCount, 0);
  const totalNeedsReview = quizzes.reduce((s, q) => s + q.needsReviewCount, 0);

  const showBackupReminder =
    !loading &&
    !reminderDismissed &&
    (quizzes.length > 0 || studentCount > 0) &&
    (saveStatus.changesSinceBackup >= 5 ||
      (saveStatus.changesSinceBackup > 0 && saveStatus.isBackupStale) ||
      (totalPapers > 0 && !saveStatus.lastExportedAt));

  const columns: DataTableColumn<QuizSummary>[] = [
    {
      key: "name",
      header: "Quiz",
      render: (q) => {
        const assignedClasses = (q.sectionIds ?? [])
          .map((id) => classById.get(id))
          .filter((c): c is SectionWithCount => c !== undefined);
        return (
          <div>
            <Link
              href={`/quizzes/${q.id}`}
              className="font-medium text-[var(--text-primary)] hover:text-[var(--brand-text)] hover:underline"
            >
              {q.name}
            </Link>
            {(assignedClasses.length > 0 || (q.tags?.length ?? 0) > 0) && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {assignedClasses.map((cls) => (
                  <Link
                    key={cls.id}
                    href={`/classes/${cls.id}`}
                    className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--brand-text)]"
                  >
                    {cls.name}
                  </Link>
                ))}
                {(q.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[var(--border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "folder",
      header: "Folder",
      render: (q) => (
        <span className="text-[12px] text-[var(--text-secondary)]">
          {q.folder?.trim() || "Main Folder"}
        </span>
      ),
    },
    {
      key: "format",
      header: "Format",
      render: (q) => (
        <span className="text-[var(--text-secondary)]">
          {q.answerKey.length}Q · A4
        </span>
      ),
    },
    {
      key: "papers",
      header: "Papers",
      align: "right",
      render: (q) => (
        <span className="font-mono tabular-nums">{q.paperCount}</span>
      ),
    },
    {
      key: "review",
      header: "Status",
      render: (q) =>
        q.needsReviewCount > 0 ? (
          <Badge variant="warning">{q.needsReviewCount} need review</Badge>
        ) : (
          <Badge variant="success">Clear</Badge>
        ),
    },
    {
      key: "created",
      header: "Date",
      render: (q) => (
        <span className="text-[var(--text-secondary)] tabular-nums">
          {q.date || formatDate(q.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1>Quizzes</h1>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
            Local-first workspace stored in this browser and synced to your
            workspace/ folder when connected. Save a .json backup anytime.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              if (importInputRef.current) importInputRef.current.value = "";
              if (file) setPendingImportFile(file);
            }}
            className="sr-only"
          />
          <Button
            variant="secondary"
            onClick={() => importInputRef.current?.click()}
          >
            Open workspace
          </Button>
          <Button variant="secondary" onClick={() => setExportOpen(true)}>
            Save workspace
          </Button>
          <Button variant="primary" onClick={openNewQuizModal}>
            New quiz
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Quizzes" value={quizzes.length} />
        <StatCard label="Papers graded" value={totalPapers} />
        <StatCard
          label="Need review"
          value={
            <span
              className={
                totalNeedsReview > 0
                  ? "text-[var(--warning)]"
                  : "text-[var(--text-primary)]"
              }
            >
              {totalNeedsReview}
            </span>
          }
          href="/review"
        />
        <StatCard
          label="Students"
          value={studentCount}
          hint={`${classes.length} class${classes.length === 1 ? "" : "es"}`}
          href="/students"
        />
      </div>

      {showBackupReminder && (
        <div
          role="region"
          aria-label="Workspace backup reminder"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-amber-800/25 bg-[var(--warning-bg)] px-4 py-3 text-[13px] text-[var(--warning-text)]"
        >
          <div>
            <p className="font-medium">
              Backup reminder: Your workspace is stored locally in this browser.
            </p>
            <p className="mt-0.5 text-[12px] opacity-90">
              {saveStatus.lastExportedAt
                ? `Last backup file saved on ${formatDate(saveStatus.lastExportedAt)} (${saveStatus.changesSinceBackup} changes since then).`
                : "You have not exported a .json workspace backup file yet."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExportOpen(true)}
            >
              Save workspace (.json)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReminderDismissed(true)}
            >
              Remind me later
            </Button>
          </div>
        </div>
      )}

      {quizzes.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <FormField
            id="quiz-search"
            label="Search quizzes"
            size="sm"
            className="min-w-[200px] flex-1"
          >
            <TextInput
              id="quiz-search"
              type="search"
              inputSize="sm"
              placeholder="Filter by quiz name, folder, class, or tag…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </FormField>

          <FormField id="quiz-folder-filter" label="Folder" size="sm">
            <SelectInput
              id="quiz-folder-filter"
              selectSize="sm"
              value={folderFilter}
              onChange={(e) => setFolderFilter(e.target.value)}
              className="!w-auto min-w-[140px]"
            >
              <option value="all">All folders</option>
              {availableFolders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </SelectInput>
          </FormField>

          {availableTags.length > 0 && (
            <FormField id="quiz-tag-filter" label="Tag" size="sm">
              <SelectInput
                id="quiz-tag-filter"
                selectSize="sm"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                className="!w-auto min-w-[120px]"
              >
                <option value="all">All tags</option>
                {availableTags.map((t) => (
                  <option key={t} value={t}>
                    #{t}
                  </option>
                ))}
              </SelectInput>
            </FormField>
          )}

          <FormField id="quiz-sort" label="Sort" size="sm">
            <SelectInput
              id="quiz-sort"
              selectSize="sm"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as QuizSortMode)}
              className="!w-auto min-w-[120px]"
            >
              <option value="date">Date</option>
              <option value="name">Name</option>
              <option value="papers">Papers</option>
            </SelectInput>
          </FormField>
        </div>
      )}

      {loading ? (
        <SkeletonRows rows={5} />
      ) : loadError ? (
        <EmptyState
          icon={<DocumentIcon />}
          title="Could not load quizzes"
          description={loadError}
          action={
            <Button
              variant="primary"
              onClick={() => void loadWorkspaceSummary()}
            >
              Retry
            </Button>
          }
        />
      ) : quizzes.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon />}
          title="No quizzes yet"
          description="Create a quiz to set up an answer key and grade scanned sheets, or open a saved workspace (.json) file."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="secondary"
                onClick={() => importInputRef.current?.click()}
              >
                Open workspace
              </Button>
              <Button variant="secondary" onClick={openNewQuizModal}>
                New quiz
              </Button>
            </div>
          }
        />
      ) : visibleQuizzes.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon />}
          title="No matching quizzes"
          description="Try clearing your search or folder/tag filter."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearchQuery("");
                setFolderFilter("all");
                setTagFilter("all");
              }}
            >
              Reset filters
            </Button>
          }
        />
      ) : (
        <DataTable
          rows={visibleQuizzes}
          columns={columns}
          rowKey={(q) => q.id}
          renderActions={(q) => (
            <>
              <Link href={`/quizzes/${q.id}`}>
                <Button variant="ghost" size="sm">
                  Open
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteTarget(q)}
                className="text-[var(--danger)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
              >
                Delete
              </Button>
            </>
          )}
        />
      )}

      <Dialog
        open={newOpen}
        title="New quiz"
        description="Configure your quiz details and sheet format, then set or scan the answer key."
        busy={creatingQuiz}
        hideFooter
        onClose={() => setNewOpen(false)}
      >
        <form onSubmit={(e) => void handleCreateQuiz(e)} className="space-y-4">
          <QuizMetadataFields
            key={newOpen ? "open" : "closed"}
            idPrefix="new-quiz"
            name={quizName}
            onChangeName={setQuizName}
            date={quizDate}
            onChangeDate={setQuizDate}
            folder={quizFolder}
            onChangeFolder={setQuizFolder}
            availableFolders={availableFolders}
            classes={classes}
            selectedClassIds={quizClassIds}
            onChangeClassIds={setQuizClassIds}
            tags={quizTags}
            onChangeTags={setQuizTags}
            tagSuggestions={availableTags}
            extraTopContent={
              <FormField id="new-quiz-template" label="Answer sheet template">
                <SelectInput
                  id="new-quiz-template"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value as TemplateId)}
                >
                  <option value="20q_a4">20 questions · A4</option>
                  <option value="50q_a4">50 questions · A4</option>
                  <option value="100q_a4">100 questions · A4</option>
                </SelectInput>
              </FormField>
            }
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setNewOpen(false)}
              disabled={creatingQuiz}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!quizName.trim() || creatingQuiz}
              disabledReason={
                !quizName.trim() ? "Quiz name is required" : undefined
              }
            >
              {creatingQuiz ? "Creating…" : "Continue to answer key →"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        title={`Delete quiz "${deleteTarget?.name ?? ""}"?`}
        description={`This permanently removes the quiz "${deleteTarget?.name ?? ""}" (${deleteTarget?.answerKey.length ?? 0} questions), ${deleteTarget?.batchCount ?? 0} batch${deleteTarget?.batchCount === 1 ? "" : "es"}, and ${deleteTarget?.paperCount ?? 0} graded paper${deleteTarget?.paperCount === 1 ? "" : "s"} along with their aligned scan images.`}
        confirmLabel="Delete quiz"
        confirmVariant="danger"
        busy={deleting}
        onConfirm={() => void handleDeleteQuizConfirm()}
        onClose={() => setDeleteTarget(null)}
      />

      <Dialog
        open={exportOpen}
        title="Save workspace (.json)"
        description="Download all quizzes, batches, students, classes, and grades as a portable JSON file."
        confirmLabel="Download .json"
        busy={exporting}
        onConfirm={() => void handleExportWorkspace()}
        onClose={() => setExportOpen(false)}
      >
        <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={includeImages}
            onChange={(e) => setIncludeImages(e.target.checked)}
            className="h-4 w-4 accent-[var(--brand)]"
          />
          <span>Include aligned scan images in backup file</span>
        </label>
      </Dialog>

      <Dialog
        open={pendingImportFile !== null}
        title="Replace current workspace?"
        description={`Opening "${pendingImportFile?.name ?? ""}" replaces all current quizzes, batches, papers, classes, and students in this browser.`}
        confirmLabel="Replace workspace"
        confirmVariant="danger"
        busy={importing}
        onConfirm={() => void handleImportWorkspaceConfirm()}
        onClose={() => setPendingImportFile(null)}
      />
    </div>
  );
}
