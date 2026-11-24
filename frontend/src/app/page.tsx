"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuizMetadataFields } from "@/components/quiz/QuizMetadataFields";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, SelectInput, TextInput } from "@/components/ui/Field";
import { DocumentIcon, WarningIcon } from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { getErrorMessage } from "@/lib/api";
import { formatHumanDate, todayLocalIso } from "@/lib/format";
import {
  TEMPLATE_QUESTION_COUNTS,
  type TemplateId,
} from "@/lib/types";
import {
  deleteQuiz,
  getRoster,
  listQuizSummaries,
  saveQuiz,
  type ClassWithCount,
  type QuizSummary,
} from "@/lib/workspace";

type QuizSortMode = "date" | "name" | "papers";

export default function QuizzesHomePage() {
  const router = useRouter();
  const { push: pushToast } = useToast();

  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [classes, setClasses] = useState<ClassWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<QuizSortMode>("date");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<string>("all");

  const [quizModalOpen, setQuizModalOpen] = useState(false);
  const [editingQuiz, setEditingQuiz] = useState<QuizSummary | null>(null);
  const [quizName, setQuizName] = useState("");
  const [quizNameTouched, setQuizNameTouched] = useState(false);
  const [templateId, setTemplateId] = useState<TemplateId>("20q_a4");
  const [quizDate, setQuizDate] = useState("");
  const [quizClassIds, setQuizClassIds] = useState<string[]>([]);
  const [quizTags, setQuizTags] = useState<string[]>([]);
  const [savingQuiz, setSavingQuiz] = useState(false);
  const quizNameInputRef = useRef<HTMLInputElement | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<QuizSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadQuizzesPage = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [quizList, roster] = await Promise.all([
        listQuizSummaries(),
        getRoster(),
      ]);
      setQuizzes(quizList);
      setClasses(roster.classes);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load quizzes."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadQuizzesPage();
    });
    return () => {
      active = false;
    };
  }, [loadQuizzesPage]);

  function openNewQuizModal() {
    setEditingQuiz(null);
    setQuizName("");
    setQuizNameTouched(false);
    setTemplateId("20q_a4");
    setQuizDate(todayLocalIso());
    setQuizClassIds([]);
    setQuizTags([]);
    setQuizModalOpen(true);
  }

  function openEditQuizModal(q: QuizSummary) {
    setEditingQuiz(q);
    setQuizName(q.name);
    setQuizNameTouched(false);
    setTemplateId((q.templateId as TemplateId) || "20q_a4");
    setQuizDate(q.date || todayLocalIso());
    setQuizClassIds(q.classIds ?? []);
    setQuizTags(q.tags ?? []);
    setQuizModalOpen(true);
  }

  const nameError = !quizName.trim() ? "Enter a quiz name" : null;

  async function handleSubmitQuiz(e: React.FormEvent) {
    e.preventDefault();
    setQuizNameTouched(true);
    if (nameError) {
      quizNameInputRef.current?.focus();
      return;
    }
    if (savingQuiz) return;
    setSavingQuiz(true);
    try {
      if (editingQuiz) {
        const updated = await saveQuiz({
          id: editingQuiz.id,
          name: quizName.trim(),
          templateId: editingQuiz.templateId,
          answerKey: editingQuiz.answerKey,
          points: editingQuiz.points,
          date: quizDate,
          classIds: quizClassIds,
          tags: quizTags,
          questionRules: editingQuiz.questionRules,
          keyVersions: editingQuiz.keyVersions,
        });
        setQuizModalOpen(false);
        await loadQuizzesPage();
        pushToast(`Updated "${updated.name}".`, "success");
      } else {
        const questionCount = TEMPLATE_QUESTION_COUNTS[templateId];
        const defaultKey = Array<string>(questionCount).fill("");
        const created = await saveQuiz({
          name: quizName.trim(),
          templateId,
          date: quizDate,
          classIds: quizClassIds,
          tags: quizTags,
          answerKey: defaultKey,
          points: Array(questionCount).fill(1),
        });
        setQuizModalOpen(false);
        pushToast(`Created "${created.name}".`, "success");
        router.push(`/quizzes/${created.id}?tab=key`);
      }
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not save quiz."), "error");
    } finally {
      setSavingQuiz(false);
    }
  }

  async function handleDeleteQuizConfirm() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const deletedName = deleteTarget.name;
      await deleteQuiz(deleteTarget.id);
      setDeleteTarget(null);
      await loadQuizzesPage();
      pushToast(`Deleted "${deletedName}".`, "success");
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not delete quiz."), "error");
    } finally {
      setDeleting(false);
    }
  }

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
        if (tagFilter !== "all" && !(q.tags ?? []).includes(tagFilter)) {
          return false;
        }
        if (
          classFilter !== "all" &&
          !(q.classIds ?? []).includes(classFilter)
        ) {
          return false;
        }
        if (!query) return true;
        const classNames = (q.classIds ?? [])
          .map((id) => classById.get(id)?.name ?? "")
          .join(" ")
          .toLowerCase();
        const tagText = (q.tags ?? []).join(" ").toLowerCase();
        return (
          q.name.toLowerCase().includes(query) ||
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
  }, [quizzes, searchQuery, tagFilter, classFilter, sortBy, classById]);

  const totalPapers = quizzes.reduce((s, q) => s + q.paperCount, 0);
  const confirmedPapers = Math.max(
    0,
    totalPapers - quizzes.reduce((s, q) => s + q.needsReviewCount, 0),
  );

  const filtersActive = Boolean(
    searchQuery.trim() || tagFilter !== "all" || classFilter !== "all",
  );
  const showFilters = quizzes.length >= 5 || filtersActive;

  const columns: DataTableColumn<QuizSummary>[] = [
    {
      key: "name",
      header: "Quiz",
      render: (q) => {
        const assignedNames = (q.classIds ?? [])
          .map((id) => classById.get(id)?.name)
          .filter((name): name is string => Boolean(name))
          .join(", ");
        return (
          <div>
            <Link
              href={`/quizzes/${q.id}`}
              className="font-semibold text-[var(--text-primary)] hover:text-[var(--brand-text)] hover:underline"
            >
              {q.name}
            </Link>
            {assignedNames && (
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                {assignedNames}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: "format",
      header: "Format",
      render: (q) => (
        <span className="text-[var(--text-secondary)] tabular-nums">
          {q.answerKey.length} questions, A4
        </span>
      ),
    },
    {
      key: "papers",
      header: "Papers",
      align: "right",
      render: (q) => (
        <span className="font-semibold tabular-nums">{q.paperCount}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (q) =>
        q.answerKey.some((a) => !a) ? (
          <span className="text-[0.8125rem] font-medium text-[var(--warning-text)]">
            Key not set
          </span>
        ) : q.needsReviewCount > 0 ? (
          <span className="text-[0.8125rem] font-medium text-[var(--warning-text)] tabular-nums">
            {q.needsReviewCount}{" "}
            {q.needsReviewCount === 1 ? "needs review" : "need review"}
          </span>
        ) : (
          <span className="text-[0.8125rem] font-medium text-[var(--success-text)]">
            Confirmed
          </span>
        ),
    },
    {
      key: "date",
      header: "Date",
      render: (q) => (
        <span className="text-[var(--text-secondary)] tabular-nums">
          {formatHumanDate(q.date || q.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1>Quizzes</h1>
        <Button variant="primary" onClick={openNewQuizModal}>
          New quiz
        </Button>
      </div>

      {!loading && !loadError && quizzes.length >= 2 && (
        <p className="text-sm text-[var(--text-primary)] tabular-nums">
          {totalPapers === 0
            ? `${quizzes.length} quizzes, no papers scanned yet.`
            : confirmedPapers === 0
              ? `${quizzes.length} quizzes, ${totalPapers} ${totalPapers === 1 ? "paper" : "papers"} scanned, awaiting review.`
              : `${quizzes.length} quizzes, ${totalPapers} ${totalPapers === 1 ? "paper" : "papers"} scanned, ${confirmedPapers} confirmed.`}
        </p>
      )}

      {showFilters && quizzes.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-3">
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
              placeholder="Search by quiz name, class, or tag"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </FormField>

          {classes.length > 0 && (
            <FormField id="quiz-class-filter" label="Class" size="sm">
              <SelectInput
                id="quiz-class-filter"
                selectSize="sm"
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="!w-auto min-w-[130px]"
              >
                <option value="all">All classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectInput>
            </FormField>
          )}

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

          <FormField id="quiz-sort" label="Sort by" size="sm">
            <SelectInput
              id="quiz-sort"
              selectSize="sm"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as QuizSortMode)}
              className="!w-auto min-w-[120px]"
            >
              <option value="date">Date</option>
              <option value="name">Name</option>
              <option value="papers">Paper count</option>
            </SelectInput>
          </FormField>
        </div>
      )}

      {loading ? (
        <SkeletonRows rows={5} />
      ) : loadError ? (
        <EmptyState
          tone="error"
          icon={<WarningIcon />}
          title="Could not load quizzes"
          description={loadError}
          nextStep="Make sure the backend server is running, then select Try again."
          action={
            <Button
              variant="primary"
              onClick={() => void loadQuizzesPage()}
            >
              Try again
            </Button>
          }
        />
      ) : quizzes.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon />}
          title="No quizzes in this folder yet"
          description="This folder has no quizzes yet."
          nextStep="Select New quiz above to create an answer key and upload scanned sheets."
          action={
            <Button variant="primary" onClick={openNewQuizModal}>
              New quiz
            </Button>
          }
        />
      ) : visibleQuizzes.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon />}
          title="No quizzes match these filters"
          description="No quizzes matched your current search or filter settings."
          nextStep="Clear your filters to see every quiz in this folder."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearchQuery("");
                setTagFilter("all");
                setClassFilter("all");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <DataTable
          rows={visibleQuizzes}
          columns={columns}
          rowKey={(q) => q.id}
          actionsHeaderSrOnly
          onRowClick={(q) => router.push(`/quizzes/${q.id}`)}
          renderActions={(q) => (
            <ActionMenu
              label={`Actions for ${q.name}`}
              items={[
                { id: "open", label: "Open quiz", href: `/quizzes/${q.id}` },
                {
                  id: "edit",
                  label: "Edit details",
                  onClick: () => openEditQuizModal(q),
                },
                { kind: "divider", id: "div-1" },
                {
                  id: "delete",
                  label: "Delete quiz",
                  variant: "danger",
                  onClick: () => setDeleteTarget(q),
                },
              ]}
            />
          )}
        />
      )}

      <Dialog
        open={quizModalOpen}
        title={editingQuiz ? "Edit quiz" : "New quiz"}
        description={
          editingQuiz
            ? undefined
            : "Set quiz details and sheet format, then configure the answer key."
        }
        busy={savingQuiz}
        hideFooter
        onClose={() => {
          setQuizModalOpen(false);
          setQuizNameTouched(false);
        }}
      >
        <form
          noValidate
          onSubmit={(e) => void handleSubmitQuiz(e)}
          className="space-y-4"
        >
          <QuizMetadataFields
            key={
              quizModalOpen
                ? editingQuiz
                  ? `edit-${editingQuiz.id}`
                  : "new-open"
                : "closed"
            }
            idPrefix="quiz-form"
            name={quizName}
            nameError={quizNameTouched ? nameError : null}
            nameInputRef={quizNameInputRef}
            onBlurName={() => setQuizNameTouched(true)}
            onChangeName={setQuizName}
            date={quizDate}
            onChangeDate={setQuizDate}
            classes={classes}
            selectedClassIds={quizClassIds}
            onChangeClassIds={setQuizClassIds}
            tags={quizTags}
            onChangeTags={setQuizTags}
            tagSuggestions={availableTags}
            extraTopContent={
              !editingQuiz ? (
                <FormField id="new-quiz-template" label="Sheet format">
                  <SelectInput
                    id="new-quiz-template"
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value as TemplateId)}
                  >
                    <option value="20q_a4">20 questions, A4 sheet</option>
                    <option value="50q_a4">50 questions, A4 sheet</option>
                    <option value="100q_a4">100 questions, A4 sheet</option>
                  </SelectInput>
                </FormField>
              ) : undefined
            }
          />

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQuizModalOpen(false);
                setQuizNameTouched(false);
              }}
              disabled={savingQuiz}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={savingQuiz}>
              {savingQuiz
                ? "Saving..."
                : editingQuiz
                  ? "Save quiz"
                  : "Create quiz"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        title={`Delete quiz "${deleteTarget?.name ?? ""}"?`}
        description={`Removes "${deleteTarget?.name ?? ""}" (${deleteTarget?.answerKey.length ?? 0} questions) and its ${deleteTarget?.paperCount ?? 0} graded papers from disk.`}
        confirmLabel="Delete quiz"
        confirmVariant="danger"
        busy={deleting}
        onConfirm={() => void handleDeleteQuizConfirm()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
