"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnswerKeyTab } from "@/components/quiz/AnswerKeyTab";
import { BatchesTab } from "@/components/quiz/BatchesTab";
import { ItemAnalysisTab } from "@/components/quiz/ItemAnalysisTab";
import { PapersTab } from "@/components/quiz/PapersTab";
import { QuizMetadataFields } from "@/components/quiz/QuizMetadataFields";
import { StatisticsTab } from "@/components/quiz/StatisticsTab";
import { TagReportTab } from "@/components/quiz/TagReportTab";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectInput } from "@/components/ui/Field";
import { DocumentIcon, EditIcon, MoreIcon } from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { templatePdfUrl } from "@/lib/api";
import { formatDate, shortId } from "@/lib/format";
import { collectAllQuizTags } from "@/lib/tagReport";
import {
  deleteQuiz,
  getQuizWorkspace,
  getRoster,
  listQuizzes,
  saveBatch,
  saveQuiz,
  type Batch,
  type Paper,
  type Quiz,
  type SectionWithCount,
} from "@/lib/workspace";

type QuizTab = "papers" | "statistics" | "analysis" | "tags" | "key" | "batches";

function batchSessionKey(quizId: string): string {
  return `autograde.quiz.${quizId}.batchId`;
}

export default function QuizDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { push: pushToast } = useToast();
  const quizId = String(params.id ?? "");

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [allQuizzes, setAllQuizzes] = useState<Quiz[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [sections, setSections] = useState<SectionWithCount[]>([]);
  const [sectionFilterId, setSectionFilterId] = useState<string>("");
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [allPapers, setAllPapers] = useState<Paper[]>([]);
  const [batchCounts, setBatchCounts] = useState<Record<string, number>>({});

  const [loadingPage, setLoadingPage] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [activeTab, setActiveTab] = useState<QuizTab>("papers");
  const dropzoneSectionRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editFolder, setEditFolder] = useState("Main Folder");
  const [editClassIds, setEditClassIds] = useState<string[]>([]);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [savingQuizName, setSavingQuizName] = useState(false);

  const [deleteQuizOpen, setDeleteQuizOpen] = useState(false);
  const [deletingQuiz, setDeletingQuiz] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const tabParam = new URLSearchParams(window.location.search).get("tab");
        if (
          tabParam === "key" ||
          tabParam === "batches" ||
          tabParam === "statistics" ||
          tabParam === "analysis" ||
          tabParam === "tags" ||
          tabParam === "papers"
        ) {
          setActiveTab(tabParam);
        }
      } catch {
        // Ignore URLSearchParams errors
      }
    });
  }, []);

  const sectionById = useMemo(
    () => new Map(sections.map((s) => [s.id, s])),
    [sections],
  );

  const visibleBatches = useMemo(() => {
    if (!sectionFilterId) return batches;
    return batches.filter((b) => b.sectionId === sectionFilterId);
  }, [batches, sectionFilterId]);

  const activeBatch = useMemo(() => {
    if (visibleBatches.length === 0) return null;
    return (
      visibleBatches.find((b) => b.id === activeBatchId) ??
      visibleBatches[visibleBatches.length - 1]
    );
  }, [visibleBatches, activeBatchId]);

  const loadWorkspace = useCallback(
    async (preferredBatchId?: string | null) => {
      if (!quizId) {
        setNotFound(true);
        setLoadingPage(false);
        return;
      }
      setPageError(null);
      try {
        let desiredBatchId = preferredBatchId;
        if (desiredBatchId === undefined) {
          try {
            desiredBatchId = window.sessionStorage.getItem(
              batchSessionKey(quizId),
            );
          } catch {
            desiredBatchId = null;
          }
        }

        const [ws, roster, quizList] = await Promise.all([
          getQuizWorkspace(quizId, desiredBatchId),
          getRoster(),
          listQuizzes(),
        ]);

        if (!ws) {
          setNotFound(true);
          setQuiz(null);
          return;
        }

        setNotFound(false);
        setQuiz(ws.quiz);
        setAllQuizzes(quizList);
        setBatches(ws.batches);
        setSections(roster.sections);
        setActiveBatchId(ws.activeBatch?.id ?? null);
        setPapers(ws.papers);
        setAllPapers(ws.allPapers);
        setBatchCounts(ws.batchPaperCounts);
      } catch (err) {
        setPageError(
          err instanceof Error ? err.message : "Could not load quiz.",
        );
      } finally {
        setLoadingPage(false);
      }
    },
    [quizId],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadWorkspace();
    });
    return () => {
      active = false;
    };
  }, [loadWorkspace]);

  // Persist activeBatch.id to sessionStorage and load its papers when switching batches
  useEffect(() => {
    if (!activeBatch) return;
    try {
      window.sessionStorage.setItem(batchSessionKey(quizId), activeBatch.id);
    } catch {
      // Ignore storage errors
    }
    let active = true;
    getQuizWorkspace(quizId, activeBatch.id)
      .then((ws) => {
        if (active && ws) {
          setPapers(ws.papers);
          setAllPapers(ws.allPapers);
          setBatchCounts(ws.batchPaperCounts);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [activeBatch, quizId]);

  useEffect(() => {
    if (!moreOpen) return;
    function onClick(e: MouseEvent) {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(e.target as Node)
      ) {
        setMoreOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  async function handleCreateBatch() {
    if (!quiz) return;
    setMoreOpen(false);
    try {
      const created = await saveBatch({
        quizId: quiz.id,
        sectionId: sectionFilterId || null,
      });
      await loadWorkspace(created.id);
      pushToast(`Created batch #${shortId(created.id)}.`, "success");
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not create batch.",
        "error",
      );
    }
  }

  function openEditQuizDialog(target: Quiz) {
    setEditName(target.name);
    setEditDate(target.date ?? "");
    setEditFolder(target.folder?.trim() || "Main Folder");
    setEditClassIds(target.sectionIds ?? []);
    setEditTags(target.tags ?? []);
    setEditDialogOpen(true);
  }

  async function handleSaveQuizMetadata(e: React.FormEvent) {
    e.preventDefault();
    if (!quiz || !editName.trim() || savingQuizName) return;
    setSavingQuizName(true);
    try {
      const updated = await saveQuiz({
        id: quiz.id,
        name: editName.trim(),
        templateId: quiz.templateId,
        questionCount: quiz.answerKey.length,
        answerKey: quiz.answerKey,
        points: quiz.points,
        date: editDate,
        folder: editFolder,
        sectionIds: editClassIds,
        tags: editTags,
        questionRules: quiz.questionRules,
        keyVersions: quiz.keyVersions,
      });
      setQuiz(updated);
      setAllQuizzes((prev) =>
        prev.map((q) => (q.id === updated.id ? updated : q)),
      );
      setEditDialogOpen(false);
      pushToast("Quiz details updated.", "success");
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not update quiz.",
        "error",
      );
    } finally {
      setSavingQuizName(false);
    }
  }

  async function handleDeleteQuiz() {
    if (!quiz || deletingQuiz) return;
    setDeletingQuiz(true);
    try {
      await deleteQuiz(quiz.id);
      setDeleteQuizOpen(false);
      pushToast(`Deleted "${quiz.name}".`, "success");
      router.push("/");
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not delete quiz.",
        "error",
      );
      setDeletingQuiz(false);
    }
  }

  if (loadingPage) {
    return (
      <div className="space-y-6">
        <SkeletonRows rows={3} />
        <SkeletonRows rows={5} />
      </div>
    );
  }

  if (pageError) {
    return (
      <EmptyState
        icon={<DocumentIcon />}
        title="Could not load quiz"
        description={pageError}
        action={
          <Button variant="primary" onClick={() => void loadWorkspace()}>
            Retry
          </Button>
        }
      />
    );
  }

  if (notFound || !quiz) {
    return (
      <EmptyState
        icon={<DocumentIcon />}
        title="Quiz not found"
        description="This quiz may have been deleted or does not exist in this browser workspace."
        action={
          <Link href="/">
            <Button variant="primary">Back to quizzes</Button>
          </Link>
        }
      />
    );
  }

  const questionCount = quiz.answerKey.length;
  const doneRows = papers.filter((r) => r.status === "done");
  const gradedCount = doneRows.length;
  const averageScore =
    gradedCount > 0
      ? doneRows.reduce((sum, r) => sum + r.score, 0) / gradedCount
      : null;
  const needsReviewCount = doneRows.filter((r) => r.needsReview).length;
  const unlinkedCount = papers.filter((r) => r.studentId === null).length;
  const totalPapersAcrossQuiz = batches.reduce(
    (sum, b) => sum + (batchCounts[b.id] ?? 0),
    0,
  );

  const tabItems: TabItem<QuizTab>[] = [
    { id: "papers", label: "Papers", count: papers.length },
    { id: "statistics", label: "Statistics" },
    { id: "analysis", label: "Item analysis" },
    { id: "tags", label: "Tag report" },
    { id: "key", label: "Answer key" },
    { id: "batches", label: "Batches", count: batches.length },
  ];

  const keyTabKey = JSON.stringify({
    id: quiz.id,
    answerKey: quiz.answerKey,
    points: quiz.points ?? null,
    questionRules: quiz.questionRules ?? null,
    keyVersions: quiz.keyVersions ?? null,
  });

  const availableFolders = Array.from(
    new Set(
      allQuizzes
        .map((q) => q.folder?.trim())
        .filter((f): f is string => Boolean(f)),
    ),
  );
  const tagSuggestions = Array.from(
    new Set(allQuizzes.flatMap((q) => collectAllQuizTags(q))),
  ).sort((a, b) => a.localeCompare(b));
  const assignedClasses = (quiz.sectionIds ?? [])
    .map((id) => sectionById.get(id))
    .filter((s): s is SectionWithCount => s !== undefined);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13px]">
            <Link
              href="/"
              className="font-medium text-[var(--text-secondary)] hover:text-[var(--brand-text)] hover:underline"
            >
              ← All quizzes
            </Link>
            {allQuizzes.length > 1 && (
              <>
                <span className="text-[var(--text-muted)]">/</span>
                <select
                  aria-label="Switch quiz"
                  value={quiz.id}
                  onChange={(e) => {
                    const targetId = e.target.value;
                    if (targetId && targetId !== quiz.id) {
                      router.push(`/quizzes/${targetId}`);
                    }
                  }}
                  className="rounded-[6px] border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 py-0.5 text-[12px] font-medium text-[var(--text-primary)] focus:border-[var(--brand)] focus:outline-none"
                >
                  {allQuizzes.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name} ({q.answerKey.length}Q)
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1>{quiz.name}</h1>
              <button
                type="button"
                aria-label="Edit quiz"
                onClick={() => openEditQuizDialog(quiz)}
                className="rounded-[8px] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
              >
                <EditIcon />
              </button>
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--text-muted)]">
              <span>{questionCount} questions · A4 form</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {quiz.date || formatDate(quiz.createdAt)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                {quiz.folder?.trim() || "Main Folder"}
              </span>
              <span aria-hidden="true">·</span>
              <a
                href={templatePdfUrl(quiz.templateId)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[var(--brand-text)] hover:underline"
              >
                Download blank A4 PDF
              </a>
            </p>
            {(assignedClasses.length > 0 || (quiz.tags?.length ?? 0) > 0) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {assignedClasses.map((cls) => (
                  <Link
                    key={cls.id}
                    href={`/classes/${cls.id}`}
                    className="rounded bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--brand-text)]"
                  >
                    {cls.name}
                  </Link>
                ))}
                {(quiz.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SelectInput
              aria-label="Class"
              value={sectionFilterId}
              onChange={(e) => setSectionFilterId(e.target.value)}
              className="!w-auto"
            >
              <option value="">All classes</option>
              {sections.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.name}
                  {sec.term ? ` (${sec.term})` : ""}
                </option>
              ))}
            </SelectInput>

            <SelectInput
              aria-label="Batch"
              value={activeBatch ? activeBatch.id : ""}
              onChange={(e) => setActiveBatchId(e.target.value || null)}
              disabled={visibleBatches.length === 0}
              className="!w-auto"
            >
              {visibleBatches.length === 0 ? (
                <option value="">No batches yet</option>
              ) : (
                visibleBatches.map((b) => {
                  const sec = b.sectionId
                    ? sectionById.get(b.sectionId)
                    : undefined;
                  return (
                    <option key={b.id} value={b.id}>
                      {sec ? `${sec.name} · ` : ""}
                      {formatDate(b.createdAt)} (#{shortId(b.id)})
                    </option>
                  );
                })
              )}
            </SelectInput>

            <Button
              variant="primary"
              onClick={() => {
                setActiveTab("papers");
                window.setTimeout(() => {
                  dropzoneSectionRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                }, 50);
              }}
            >
              Upload papers
            </Button>

            <div ref={moreMenuRef} className="relative">
              <Button
                variant="secondary"
                aria-label="More quiz actions"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((v) => !v)}
              >
                <MoreIcon />
              </Button>
              {moreOpen && (
                <div
                  role="menu"
                  className="absolute right-0 z-30 mt-1.5 w-44 rounded-[12px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] py-1"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      openEditQuizDialog(quiz);
                    }}
                    className="block w-full px-3.5 py-2 text-left text-[14px] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                  >
                    Edit quiz
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void handleCreateBatch()}
                    className="block w-full px-3.5 py-2 text-left text-[14px] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                  >
                    New batch
                  </button>
                  <div className="my-1 border-t border-[var(--border-hairline)]" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      setDeleteQuizOpen(true);
                    }}
                    className="block w-full px-3.5 py-2 text-left text-[14px] text-[var(--danger)] hover:bg-[var(--danger-bg)]"
                  >
                    Delete quiz
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Graded" value={gradedCount} />
        <StatCard
          label="Average"
          value={averageScore !== null ? `${averageScore.toFixed(1)}%` : "—"}
        />
        <StatCard
          label="Need review"
          value={
            <span
              className={
                needsReviewCount > 0
                  ? "text-[var(--warning)]"
                  : "text-[var(--text-primary)]"
              }
            >
              {needsReviewCount}
            </span>
          }
          href="/review"
        />
        <StatCard label="Unlinked" value={unlinkedCount} />
      </div>

      <Tabs items={tabItems} activeId={activeTab} onChange={setActiveTab} />

      {activeTab === "papers" && (
        <PapersTab
          quiz={quiz}
          activeBatch={activeBatch}
          sectionFilterId={sectionFilterId}
          papers={papers}
          dropzoneRef={dropzoneSectionRef}
          onBatchCreated={setActiveBatchId}
          onReload={loadWorkspace}
        />
      )}

      {activeTab === "statistics" && (
        <StatisticsTab
          quiz={quiz}
          batchPapers={papers}
          allPapers={allPapers}
          hasMultipleBatches={batches.length > 1}
          onGoToPapers={() => setActiveTab("papers")}
        />
      )}

      {activeTab === "analysis" && (
        <ItemAnalysisTab
          quiz={quiz}
          batchPapers={papers}
          allPapers={allPapers}
          hasMultipleBatches={batches.length > 1}
        />
      )}

      {activeTab === "tags" && (
        <TagReportTab
          quiz={quiz}
          batchPapers={papers}
          allPapers={allPapers}
          hasMultipleBatches={batches.length > 1}
          onGoToAnswerKey={() => setActiveTab("key")}
        />
      )}

      {activeTab === "key" && (
        <AnswerKeyTab
          key={keyTabKey}
          quiz={quiz}
          activeBatchId={activeBatch?.id ?? null}
          onSaved={loadWorkspace}
        />
      )}

      {activeTab === "batches" && (
        <BatchesTab
          quizId={quiz.id}
          batches={batches}
          sections={sections}
          batchCounts={batchCounts}
          activeBatchId={activeBatch?.id ?? null}
          onCreateBatch={handleCreateBatch}
          onOpenBatch={(b) => {
            if (sectionFilterId && b.sectionId !== sectionFilterId) {
              setSectionFilterId("");
            }
            setActiveBatchId(b.id);
            setActiveTab("papers");
          }}
          onReload={loadWorkspace}
        />
      )}

      <Dialog
        open={editDialogOpen}
        title="Edit quiz"
        confirmLabel="Save"
        busy={savingQuizName}
        hideFooter
        onClose={() => setEditDialogOpen(false)}
      >
        <form
          onSubmit={(e) => void handleSaveQuizMetadata(e)}
          className="space-y-4"
        >
          <QuizMetadataFields
            idPrefix="edit-quiz"
            name={editName}
            onChangeName={setEditName}
            date={editDate}
            onChangeDate={setEditDate}
            folder={editFolder}
            onChangeFolder={setEditFolder}
            availableFolders={availableFolders}
            classes={sections}
            selectedClassIds={editClassIds}
            onChangeClassIds={setEditClassIds}
            tags={editTags}
            onChangeTags={setEditTags}
            tagSuggestions={tagSuggestions}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setEditDialogOpen(false)}
              disabled={savingQuizName}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!editName.trim() || savingQuizName}
              disabledReason={
                !editName.trim() ? "Quiz name cannot be empty" : undefined
              }
            >
              {savingQuizName ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deleteQuizOpen}
        title={`Delete quiz "${quiz.name}"?`}
        description={`This permanently removes "${quiz.name}" (${questionCount} questions), ${batches.length} batch${batches.length === 1 ? "" : "es"}, and ${totalPapersAcrossQuiz} graded paper${totalPapersAcrossQuiz === 1 ? "" : "s"} along with their aligned scan images.`}
        confirmLabel="Delete quiz"
        confirmVariant="danger"
        busy={deletingQuiz}
        onConfirm={() => void handleDeleteQuiz()}
        onClose={() => setDeleteQuizOpen(false)}
      />
    </div>
  );
}
