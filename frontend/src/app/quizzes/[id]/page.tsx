"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnswerKeyTab } from "@/components/quiz/AnswerKeyTab";
import { ItemAnalysisTab } from "@/components/quiz/ItemAnalysisTab";
import { PapersTab } from "@/components/quiz/PapersTab";
import { QuizMetadataFields } from "@/components/quiz/QuizMetadataFields";
import { StatisticsTab } from "@/components/quiz/StatisticsTab";
import { TagReportTab } from "@/components/quiz/TagReportTab";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectInput } from "@/components/ui/Field";
import { DocumentIcon, WarningIcon } from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { getErrorMessage, templatePdfUrl } from "@/lib/api";
import { downloadBlob, slugifyFilename } from "@/lib/csvExport";
import { formatHumanDate } from "@/lib/format";
import { computeQuizStatistics } from "@/lib/quizStatistics";
import { formatPointsValue } from "@/lib/scoring";
import { collectAllQuizTags } from "@/lib/tagReport";
import {
  deleteQuiz,
  exportQuizCsv,
  getQuizWorkspace,
  getRoster,
  listQuizSummaries,
  saveQuiz,
  type ClassWithCount,
  type Paper,
  type Quiz,
  type Student,
} from "@/lib/workspace";

type QuizTab = "papers" | "statistics" | "analysis" | "tags" | "key";

export default function QuizDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { push: pushToast } = useToast();
  const quizId = String(params.id ?? "");

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [allQuizzes, setAllQuizzes] = useState<Quiz[]>([]);
  const [classes, setClasses] = useState<ClassWithCount[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [classFilterId, setClassFilterId] = useState<string>("");
  const [papers, setPapers] = useState<Paper[]>([]);

  const [loadingPage, setLoadingPage] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [activeTab, setActiveTab] = useState<QuizTab>("papers");
  const [keyDirty, setKeyDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<QuizTab | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(
    null,
  );
  const [pendingUploadAfterDiscard, setPendingUploadAfterDiscard] =
    useState(false);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editNameTouched, setEditNameTouched] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editClassIds, setEditClassIds] = useState<string[]>([]);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [savingQuiz, setSavingQuiz] = useState(false);
  const editNameInputRef = useRef<HTMLInputElement | null>(null);

  const [deleteQuizOpen, setDeleteQuizOpen] = useState(false);
  const [deletingQuiz, setDeletingQuiz] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const tabParam = new URLSearchParams(window.location.search).get("tab");
        if (
          tabParam === "key" ||
          tabParam === "statistics" ||
          tabParam === "analysis" ||
          tabParam === "tags" ||
          tabParam === "papers"
        ) {
          setActiveTab(tabParam);
        }
      } catch {
      }
    });
  }, []);

  const loadQuizDetail = useCallback(async () => {
    if (!quizId) {
      setNotFound(true);
      setLoadingPage(false);
      return;
    }
    setPageError(null);
    try {
      const [ws, roster] = await Promise.all([
        getQuizWorkspace(quizId),
        getRoster(),
      ]);

      if (!ws) {
        setNotFound(true);
        setQuiz(null);
        return;
      }

      setNotFound(false);
      setQuiz(ws.quiz);
      setClasses(roster.classes);
      setStudents(roster.students);
      setPapers(ws.papers);
      setKeyDirty(false);
      try {
        const hasTabParam = new URLSearchParams(window.location.search).has(
          "tab",
        );
        if (!hasTabParam && ws.quiz.answerKey.some((a) => !a)) {
          setActiveTab("key");
        }
      } catch {
      }
    } catch (err) {
      setPageError(getErrorMessage(err, "Could not load quiz."));
    } finally {
      setLoadingPage(false);
    }
  }, [quizId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadQuizDetail();
    });
    return () => {
      active = false;
    };
  }, [loadQuizDetail]);

  useEffect(() => {
    if (!(activeTab === "key" && keyDirty)) return;

    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }

    function onDocumentClick(e: MouseEvent) {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const anchor = (e.target as HTMLElement | null)?.closest("a[href]");
      if (!anchor) return;
      if (
        anchor.getAttribute("target") === "_blank" ||
        anchor.hasAttribute("download")
      ) {
        return;
      }
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const nextPath = `${url.pathname}${url.search}${url.hash}`;
      const currPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextPath === currPath) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(nextPath);
    }

    function onBeforeNavigate(e: Event) {
      const custom = e as CustomEvent<{ proceed?: () => void }>;
      if (typeof custom.detail?.proceed === "function") {
        e.preventDefault();
        const proceed = custom.detail.proceed;
        setPendingAction(() => proceed);
      }
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("agq:before-navigate", onBeforeNavigate);
    document.addEventListener("click", onDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("agq:before-navigate", onBeforeNavigate);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, [activeTab, keyDirty]);

  const studentById = useMemo(
    () => new Map(students.map((s) => [s.id, s])),
    [students],
  );

  const visiblePapers = useMemo(() => {
    if (!classFilterId) return papers;
    const targetClassName =
      classes.find((c) => c.id === classFilterId)?.name.trim().toLowerCase() ??
      "";
    return papers.filter((p) => {
      if (p.studentId) {
        const stu = studentById.get(p.studentId);
        if (stu && stu.classIds.includes(classFilterId)) return true;
      }
      return (
        Boolean(targetClassName) &&
        (p.classText ?? "").trim().toLowerCase() === targetClassName
      );
    });
  }, [papers, classFilterId, classes, studentById]);

  function openEditQuizDialog(target: Quiz) {
    setEditName(target.name);
    setEditNameTouched(false);
    setEditDate(target.date ?? "");
    setEditClassIds(target.classIds ?? []);
    setEditTags(target.tags ?? []);
    setEditDialogOpen(true);
    if (allQuizzes.length === 0) {
      void listQuizSummaries().then(setAllQuizzes).catch(() => {});
    }
  }

  const editNameErr = !editName.trim() ? "Quiz name cannot be empty" : null;

  async function handleSaveQuizMetadata(e: React.FormEvent) {
    e.preventDefault();
    setEditNameTouched(true);
    if (!quiz) return;
    if (editNameErr) {
      editNameInputRef.current?.focus();
      return;
    }
    if (savingQuiz) return;
    setSavingQuiz(true);
    try {
      const updated = await saveQuiz({
        id: quiz.id,
        name: editName.trim(),
        templateId: quiz.templateId,
        answerKey: quiz.answerKey,
        points: quiz.points,
        date: editDate,
        classIds: editClassIds,
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
      pushToast(getErrorMessage(err, "Could not update quiz."), "error");
    } finally {
      setSavingQuiz(false);
    }
  }

  async function handleExportGrades() {
    if (!quiz || papers.length === 0) return;
    try {
      const blob = await exportQuizCsv(quiz.id);
      downloadBlob(blob, `${slugifyFilename(quiz.name)}-grades.csv`);
      pushToast("Exported grades CSV.", "success");
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not export grades."), "error");
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
      pushToast(getErrorMessage(err, "Could not delete quiz."), "error");
      setDeletingQuiz(false);
    }
  }

  function triggerUploadFileInput() {
    window.setTimeout(() => {
      const input = document.getElementById(
        "papers-upload-input",
      ) as HTMLInputElement | null;
      input?.click();
    }, 30);
  }

  function handleTabChange(nextTab: QuizTab) {
    if (nextTab === activeTab) return;
    if (activeTab === "key" && keyDirty) {
      setPendingTab(nextTab);
      setPendingUploadAfterDiscard(false);
      return;
    }
    if (activeTab === "key") setKeyDirty(false);
    setActiveTab(nextTab);
  }

  function handleTriggerUpload() {
    if (quiz?.answerKey.some((a) => !a)) return;
    if (activeTab === "key" && keyDirty) {
      setPendingTab("papers");
      setPendingUploadAfterDiscard(true);
      return;
    }
    if (activeTab !== "papers") {
      if (activeTab === "key") setKeyDirty(false);
      setActiveTab("papers");
    }
    triggerUploadFileInput();
  }

  const questionCount = quiz ? quiz.answerKey.length : 0;
  const keyUnset = quiz ? quiz.answerKey.some((a) => !a) : false;
  const stats = useMemo(
    () =>
      quiz && activeTab === "papers" && !keyUnset
        ? computeQuizStatistics(quiz, visiblePapers)
        : null,
    [quiz, activeTab, keyUnset, visiblePapers],
  );

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
        tone="error"
        icon={<WarningIcon />}
        title="Could not load quiz details"
        description={pageError}
        nextStep="Verify the backend is running and select Try again."
        action={
          <Button variant="primary" onClick={() => void loadQuizDetail()}>
            Try again
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
        description="This quiz may have been deleted or does not exist in this folder."
        nextStep="Return to Quizzes to open or create a quiz."
        action={
          <Link href="/">
            <Button variant="primary">All quizzes</Button>
          </Link>
        }
      />
    );
  }

  const needsReviewCount = visiblePapers.filter((r) => r.needsReview).length;
  const confirmedCount = visiblePapers.length - needsReviewCount;

  const tabItems: TabItem<QuizTab>[] = [
    { id: "papers", label: "Papers", count: visiblePapers.length },
    { id: "statistics", label: "Statistics" },
    { id: "analysis", label: "Item analysis" },
    { id: "tags", label: "Tags" },
    { id: "key", label: "Answer key" },
  ];

  const keyTabKey = JSON.stringify({
    id: quiz.id,
    answerKey: quiz.answerKey,
    points: quiz.points ?? null,
    questionRules: quiz.questionRules ?? null,
    keyVersions: quiz.keyVersions ?? null,
  });

  const tagSuggestions = Array.from(
    new Set(allQuizzes.flatMap((q) => collectAllQuizTags(q))),
  ).sort((a, b) => a.localeCompare(b));

  const provisionalBanner =
    visiblePapers.length > 0 && needsReviewCount > 0 ? (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-700/25 bg-[var(--warning-bg)] px-4 py-3 text-[0.8125rem]">
        <div className="flex items-center gap-2.5 font-medium text-[var(--warning-text)] tabular-nums">
          <WarningIcon />
          <span>
            {needsReviewCount} of {visiblePapers.length}{" "}
            {visiblePapers.length === 1 ? "paper needs" : "papers need"} review,
            so all figures are provisional.
          </span>
        </div>
        <Link
          href={`/review?quiz_id=${quiz.id}`}
          className="font-medium text-[var(--brand-text)] underline underline-offset-[3px] hover:text-[var(--brand-hover)]"
        >
          Review now
        </Link>
      </div>
    ) : null;

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumb
          items={[{ label: "Quizzes", href: "/" }, { label: quiz.name }]}
        />

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1>{quiz.name}</h1>
            <p className="mt-1.5 text-sm text-[var(--text-secondary)] tabular-nums">
              {questionCount} questions, A4 form,{" "}
              {formatHumanDate(quiz.date || quiz.createdAt)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {classes.length > 0 && activeTab !== "key" && (
              <SelectInput
                aria-label="Filter by class"
                value={classFilterId}
                onChange={(e) => setClassFilterId(e.target.value)}
                className="!w-auto min-w-[136px]"
              >
                <option value="">All classes</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                    {cls.term ? ` (${cls.term})` : ""}
                  </option>
                ))}
              </SelectInput>
            )}

            <Button
              variant={activeTab === "key" && keyDirty ? "secondary" : "primary"}
              disabled={keyUnset}
              disabledReason={keyUnset ? "Set answer key first" : undefined}
              onClick={handleTriggerUpload}
            >
              Upload papers
            </Button>

            <ActionMenu
              label="More quiz actions"
              items={[
                {
                  id: "edit",
                  label: "Edit details",
                  onClick: () => openEditQuizDialog(quiz),
                },
                {
                  id: "pdf",
                  label: "Download blank A4 PDF",
                  href: templatePdfUrl(quiz.templateId),
                  external: true,
                },
                ...(papers.length > 0
                  ? [
                      {
                        id: "export-grades",
                        label: "Export grades",
                        onClick: () => void handleExportGrades(),
                      },
                    ]
                  : []),
                { kind: "divider", id: "div-1" },
                {
                  id: "delete",
                  label: "Delete quiz",
                  variant: "danger",
                  onClick: () => setDeleteQuizOpen(true),
                },
              ]}
            />
          </div>
        </div>
      </div>

      <Tabs items={tabItems} activeId={activeTab} onChange={handleTabChange} />

      {activeTab === "papers" && visiblePapers.length > 0 && (
        <p className="text-sm text-[var(--text-primary)] tabular-nums">
          {confirmedCount === 0 ? (
            `${visiblePapers.length} ${visiblePapers.length === 1 ? "paper" : "papers"} scanned, awaiting review.`
          ) : confirmedCount === 1 ? (
            `${visiblePapers.length} ${visiblePapers.length === 1 ? "paper" : "papers"} scanned, 1 confirmed.`
          ) : (
            <>
              {visiblePapers.length} papers scanned, {confirmedCount} confirmed.
              {stats?.avgPoints != null && stats?.totalPossiblePoints != null ? (
                <>
                  {" "}
                  Average {formatPointsValue(stats.avgPoints)} /{" "}
                  {formatPointsValue(stats.totalPossiblePoints)} pts (
                  {(stats.avgPct ?? 0).toFixed(1)}%
                  {needsReviewCount > 0 ? ", provisional" : ""}).
                </>
              ) : stats?.avgPct != null ? (
                <>
                  {" "}
                  Average {stats.avgPct.toFixed(1)}%
                  {needsReviewCount > 0 ? " (provisional)" : ""}.
                </>
              ) : null}
            </>
          )}
        </p>
      )}

      {activeTab === "papers" && (
        <PapersTab
          quiz={quiz}
          papers={visiblePapers}
          keyUnset={keyUnset}
          onGoToAnswerKey={() => handleTabChange("key")}
          onReload={loadQuizDetail}
        />
      )}

      {activeTab === "statistics" && (
        <StatisticsTab
          quiz={quiz}
          papers={visiblePapers}
          provisionalBanner={provisionalBanner}
          onGoToPapers={() => setActiveTab("papers")}
          onUploadPapers={handleTriggerUpload}
        />
      )}

      {activeTab === "analysis" && (
        <ItemAnalysisTab
          quiz={quiz}
          papers={visiblePapers}
          provisionalBanner={provisionalBanner}
          onUploadPapers={handleTriggerUpload}
        />
      )}

      {activeTab === "tags" && (
        <TagReportTab
          quiz={quiz}
          papers={visiblePapers}
          provisionalBanner={provisionalBanner}
          onGoToAnswerKey={() => setActiveTab("key")}
        />
      )}

      {activeTab === "key" && (
        <AnswerKeyTab
          key={keyTabKey}
          quiz={quiz}
          paperCount={papers.length}
          onDirtyChange={setKeyDirty}
          onSaved={loadQuizDetail}
        />
      )}

      <Dialog
        open={editDialogOpen}
        title="Edit quiz"
        busy={savingQuiz}
        hideFooter
        onClose={() => {
          setEditDialogOpen(false);
          setEditNameTouched(false);
        }}
      >
        <form
          noValidate
          onSubmit={(e) => void handleSaveQuizMetadata(e)}
          className="space-y-4"
        >
          <QuizMetadataFields
            idPrefix="edit-quiz"
            name={editName}
            nameError={editNameTouched ? editNameErr : null}
            nameInputRef={editNameInputRef}
            onBlurName={() => setEditNameTouched(true)}
            onChangeName={setEditName}
            date={editDate}
            onChangeDate={setEditDate}
            classes={classes}
            selectedClassIds={editClassIds}
            onChangeClassIds={setEditClassIds}
            tags={editTags}
            onChangeTags={setEditTags}
            tagSuggestions={tagSuggestions}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="secondary"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setEditDialogOpen(false);
                setEditNameTouched(false);
              }}
              disabled={savingQuiz}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={savingQuiz}>
              {savingQuiz ? "Saving..." : "Save quiz"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={
          pendingTab !== null || pendingHref !== null || pendingAction !== null
        }
        title="Discard unsaved answer key changes?"
        description="You have unsaved changes to the answer key. Leaving now will discard them."
        confirmLabel="Discard changes"
        confirmVariant="danger"
        onConfirm={() => {
          const targetTab = pendingTab;
          const targetHref = pendingHref;
          const targetAction = pendingAction;
          const shouldUpload = pendingUploadAfterDiscard;
          setPendingTab(null);
          setPendingHref(null);
          setPendingAction(null);
          setPendingUploadAfterDiscard(false);
          setKeyDirty(false);
          if (targetAction) {
            targetAction();
            return;
          }
          if (targetHref) {
            router.push(targetHref);
            return;
          }
          if (targetTab) setActiveTab(targetTab);
          if (shouldUpload) triggerUploadFileInput();
        }}
        onClose={() => {
          setPendingTab(null);
          setPendingHref(null);
          setPendingAction(null);
          setPendingUploadAfterDiscard(false);
        }}
      />

      <Dialog
        open={deleteQuizOpen}
        title={`Delete quiz "${quiz.name}"?`}
        description={`Removes "${quiz.name}" (${questionCount} questions) and its ${papers.length} graded ${papers.length === 1 ? "paper" : "papers"} from disk.`}
        confirmLabel="Delete quiz"
        confirmVariant="danger"
        busy={deletingQuiz}
        onConfirm={() => void handleDeleteQuiz()}
        onClose={() => setDeleteQuizOpen(false)}
      />
    </div>
  );
}
