"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ReviewIdentityBar } from "@/components/review/ReviewIdentityBar";
import { ScanPreviewPane } from "@/components/review/ScanPreviewPane";
import { ShortcutsDialog } from "@/components/review/ShortcutsDialog";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectInput } from "@/components/ui/Field";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  WarningIcon,
} from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { getErrorMessage } from "@/lib/api";
import { formatPointsValue, scorePaper } from "@/lib/scoring";
import { questionRegionPercent, rowCropAspect } from "@/lib/sheetGeometry";
import { ANSWER_CHOICES, type CorrectionValue } from "@/lib/types";
import {
  getPaperImageUrl,
  getReviewQueue,
  getRoster,
  submitReview,
  type KeyVersionId,
  type Paper,
  type ReviewQueueItem,
  type Student,
} from "@/lib/workspace";

interface FlaggedQuestion {
  number: number;
  reason: string;
  readValue: string;
}

function mergeUpdatedPaperIntoQueueItem(
  item: ReviewQueueItem,
  updated: Paper,
): ReviewQueueItem {
  if (
    item.answerKey.length > 0 &&
    updated.answers.length === item.answerKey.length
  ) {
    const rescored = scorePaper({
      answerKey: item.answerKey,
      points:
        item.points?.length === item.answerKey.length ? item.points : undefined,
      questionRules: item.questionRules,
      keyVersionFlagged: updated.keyVersionFlagged,
      answers: updated.answers,
      flags: updated.flags,
      corrections: updated.corrections,
    });
    return {
      ...item,
      ...updated,
      earnedPoints: rescored.earnedPoints,
      totalPoints: rescored.totalPoints,
    };
  }
  const earnedPoints =
    item.totalPoints > 0
      ? Math.round((updated.score / 100) * item.totalPoints * 100) / 100
      : 0;
  return {
    ...item,
    ...updated,
    earnedPoints,
  };
}

function getFlaggedQuestions(paper: ReviewQueueItem): FlaggedQuestion[] {
  const items: FlaggedQuestion[] = [];
  for (const [key, flagReason] of Object.entries(paper.flags)) {
    const num = Number(key);
    if (!Number.isInteger(num) || num < 1) continue;
    const raw = paper.answers[num - 1] ?? "";
    if (flagReason === "ambiguous") {
      items.push({
        number: num,
        reason: "Unclear mark",
        readValue: raw || "blank",
      });
    } else if (flagReason === "multiple") {
      items.push({
        number: num,
        reason: `Two marks: ${raw || "?"}`,
        readValue: raw || "blank",
      });
    }
  }
  return items.sort((a, b) => a.number - b.number);
}

function initialDraftsForPaper(
  paper: ReviewQueueItem | null,
): Record<number, CorrectionValue> {
  if (!paper) return {};
  const flagged = getFlaggedQuestions(paper);
  const drafts: Record<number, CorrectionValue> = {};

  for (const q of flagged) {
    const saved = paper.corrections[q.number];
    if (
      saved !== undefined &&
      (saved === "" ||
        ANSWER_CHOICES.includes(saved as (typeof ANSWER_CHOICES)[number]))
    ) {
      drafts[q.number] = saved as CorrectionValue;
    }
  }
  return drafts;
}

export default function ReviewPage() {
  const { push: pushToast } = useToast();
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedQuestion, setFocusedQuestion] = useState<number | null>(null);
  const [slideDir, setSlideDir] = useState<"next" | "prev" | "">("");

  const [scopeQuizId, setScopeQuizId] = useState<string | null>(null);
  const [scopeQuizName, setScopeQuizName] = useState<string | null>(null);

  const [draftsByPaperId, setDraftsByPaperId] = useState<
    Record<string, Record<number, CorrectionValue>>
  >({});
  const [students, setStudents] = useState<Student[]>([]);
  const [savingCorrections, setSavingCorrections] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [imageRetryCount, setImageRetryCount] = useState(0);

  const selectPaper = useCallback(
    (paper: ReviewQueueItem | null, dir: "next" | "prev" | "" = "") => {
      setSlideDir(dir);
      setSelectedId(paper?.id ?? null);
      const flagged = paper ? getFlaggedQuestions(paper) : [];
      setFocusedQuestion(flagged[0]?.number ?? null);
    },
    [],
  );

  const clearPaperDraft = useCallback((paperId: string) => {
    setDraftsByPaperId((prev) => {
      if (!(paperId in prev)) return prev;
      const next = { ...prev };
      delete next[paperId];
      return next;
    });
  }, []);

  const loadReviewQueue = useCallback(
    async (
      preferredId: string | null = null,
      quizFilter: string | null = null,
      preserveDrafts = false,
    ) => {
      setLoading(true);
      setQueueError(null);
      try {
        const [rawData, roster] = await Promise.all([
          getReviewQueue(),
          getRoster(),
        ]);
        const filtered = quizFilter
          ? rawData.filter((item) => item.quizId === quizFilter)
          : rawData;
        if (quizFilter && filtered[0]?.quizName) {
          setScopeQuizName(filtered[0].quizName);
        }
        if (!preserveDrafts) {
          setDraftsByPaperId({});
        }
        setQueue(filtered);
        setStudents(roster.students);
        const next =
          (preferredId !== null
            ? filtered.find((item) => item.id === preferredId)
            : undefined) ??
          filtered[0] ??
          null;
        selectPaper(next, "");
      } catch (err) {
        setQueue([]);
        setDraftsByPaperId({});
        selectPaper(null, "");
        setQueueError(getErrorMessage(err, "Could not load review queue."));
      } finally {
        setLoading(false);
      }
    },
    [selectPaper],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      let initialPaperId: string | null = null;
      let initialQuizId: string | null = null;
      try {
        const params = new URLSearchParams(window.location.search);
        initialPaperId = params.get("paper_id");
        initialQuizId = params.get("quiz_id");
      } catch {
        initialPaperId = null;
        initialQuizId = null;
      }
      setScopeQuizId(initialQuizId);
      void loadReviewQueue(initialPaperId, initialQuizId);
    });
    return () => {
      active = false;
    };
  }, [loadReviewQueue]);

  const selectedPaper = useMemo(
    () => queue.find((item) => item.id === selectedId) ?? null,
    [queue, selectedId],
  );

  const imageUrl = useMemo(() => {
    if (!selectedPaper) return null;
    return getPaperImageUrl(
      selectedPaper.quizId,
      selectedPaper.id,
      "aligned",
      `${imageRetryCount}-${selectedPaper.studentId ?? ""}-${selectedPaper.nameText}-${selectedPaper.keyVersion ?? ""}`,
    );
  }, [selectedPaper, imageRetryCount]);

  const selectedIndex = useMemo(
    () =>
      selectedPaper
        ? queue.findIndex((item) => item.id === selectedPaper.id)
        : -1,
    [queue, selectedPaper],
  );
  const prevPaper = selectedIndex > 0 ? queue[selectedIndex - 1] : null;
  const nextPaper =
    selectedIndex >= 0 && selectedIndex < queue.length - 1
      ? queue[selectedIndex + 1]
      : null;

  const flaggedQuestions = useMemo(
    () => (selectedPaper ? getFlaggedQuestions(selectedPaper) : []),
    [selectedPaper],
  );
  const draftCorrections = useMemo(
    () =>
      selectedPaper
        ? (draftsByPaperId[selectedPaper.id] ??
          initialDraftsForPaper(selectedPaper))
        : {},
    [selectedPaper, draftsByPaperId],
  );
  const updateSelectedDrafts = useCallback(
    (
      updater: (
        prev: Record<number, CorrectionValue>,
      ) => Record<number, CorrectionValue>,
    ) => {
      if (!selectedPaper) return;
      const paperId = selectedPaper.id;
      setDraftsByPaperId((prev) => ({
        ...prev,
        [paperId]: updater(prev[paperId] ?? initialDraftsForPaper(selectedPaper)),
      }));
    },
    [selectedPaper],
  );
  const hasGradedAnswers = (selectedPaper?.answers.length ?? 0) > 0;

  const answeredCount = flaggedQuestions.filter(
    (q) => draftCorrections[q.number] !== undefined,
  ).length;
  const remainingCount = flaggedQuestions.length - answeredCount;
  const allFlaggedChosen =
    hasGradedAnswers &&
    flaggedQuestions.length > 0 &&
    remainingCount === 0;

  const handleSaveAndNext = useCallback(async () => {
    if (!selectedPaper || !allFlaggedChosen || savingCorrections) return;

    const corrections: Record<number, string> = {};
    for (const q of flaggedQuestions) {
      corrections[q.number] = draftCorrections[q.number];
    }

    setSavingCorrections(true);
    try {
      const updated = await submitReview(selectedPaper.quizId, selectedPaper.id, {
        corrections,
      });
      const remainingQueue = updated.needsReview
        ? queue.map((item) =>
            item.id === updated.id
              ? mergeUpdatedPaperIntoQueueItem(item, updated)
              : item,
          )
        : queue.filter((item) => item.id !== selectedPaper.id);

      clearPaperDraft(selectedPaper.id);
      setQueue(remainingQueue);
      const nextTarget =
        remainingQueue[
          Math.min(selectedIndex, Math.max(0, remainingQueue.length - 1))
        ] ?? null;
      selectPaper(nextTarget, "next");
      const paperLabel =
        updated.nameText || selectedPaper.nameText || "Unnamed paper";
      pushToast(
        `Saved review for ${paperLabel} (${updated.score.toFixed(1)}%).`,
        "success",
      );
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not save corrections."), "error");
    } finally {
      setSavingCorrections(false);
    }
  }, [
    selectedPaper,
    allFlaggedChosen,
    savingCorrections,
    flaggedQuestions,
    draftCorrections,
    queue,
    selectedIndex,
    clearPaperDraft,
    selectPaper,
    pushToast,
  ]);

  useEffect(() => {
    if (!selectedPaper) return;

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[role="dialog"]')) {
        return;
      }
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return;
      }

      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (e.key === "ArrowLeft" && prevPaper) {
        e.preventDefault();
        selectPaper(prevPaper, "prev");
        return;
      }
      if (e.key === "ArrowRight" && nextPaper) {
        e.preventDefault();
        selectPaper(nextPaper, "next");
        return;
      }
      if (e.key === "ArrowUp" && flaggedQuestions.length > 0) {
        e.preventDefault();
        const idx = flaggedQuestions.findIndex(
          (q) => q.number === focusedQuestion,
        );
        const nextIdx = idx <= 0 ? flaggedQuestions.length - 1 : idx - 1;
        setFocusedQuestion(flaggedQuestions[nextIdx].number);
        return;
      }
      if (e.key === "ArrowDown" && flaggedQuestions.length > 0) {
        e.preventDefault();
        const idx = flaggedQuestions.findIndex(
          (q) => q.number === focusedQuestion,
        );
        const nextIdx =
          idx < 0 || idx >= flaggedQuestions.length - 1 ? 0 : idx + 1;
        setFocusedQuestion(flaggedQuestions[nextIdx].number);
        return;
      }
      if (e.key === "Enter" && allFlaggedChosen) {
        if (target?.closest('button, a, [role="menuitem"]')) {
          return;
        }
        e.preventDefault();
        void handleSaveAndNext();
        return;
      }

      const activeQ = focusedQuestion ?? flaggedQuestions[0]?.number ?? null;
      if (activeQ === null) return;

      const upper = e.key.toUpperCase();
      if (
        ANSWER_CHOICES.includes(upper as (typeof ANSWER_CHOICES)[number]) &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        updateSelectedDrafts((prev) => ({
          ...prev,
          [activeQ]: upper as CorrectionValue,
        }));
      } else if (e.key === "Backspace") {
        e.preventDefault();
        updateSelectedDrafts((prev) => ({ ...prev, [activeQ]: "" }));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectedPaper,
    prevPaper,
    nextPaper,
    selectPaper,
    flaggedQuestions,
    focusedQuestion,
    allFlaggedChosen,
    handleSaveAndNext,
    updateSelectedDrafts,
  ]);

  const handleConfirmKeyVersion = useCallback(
    async (version: KeyVersionId) => {
      if (!selectedPaper || savingCorrections) return;
      setSavingCorrections(true);
      try {
        const updated = await submitReview(
          selectedPaper.quizId,
          selectedPaper.id,
          { keyVersion: version },
        );
        if (!updated.needsReview) {
          clearPaperDraft(selectedPaper.id);
          const remainingQueue = queue.filter(
            (item) => item.id !== selectedPaper.id,
          );
          setQueue(remainingQueue);
          const nextTarget =
            remainingQueue[
              Math.min(selectedIndex, Math.max(0, remainingQueue.length - 1))
            ] ?? null;
          selectPaper(nextTarget, "next");
          const paperLabel =
            updated.nameText || selectedPaper.nameText || "Unnamed paper";
          pushToast(
            `Confirmed Key ${version} for ${paperLabel} (${updated.score.toFixed(1)}%).`,
            "success",
          );
        } else {
          await loadReviewQueue(updated.id, scopeQuizId, true);
          pushToast(
            `Selected Key ${version}. Finish resolving flagged marks.`,
            "info",
          );
        }
      } catch (err) {
        pushToast(
          getErrorMessage(err, "Could not update key version."),
          "error",
        );
      } finally {
        setSavingCorrections(false);
      }
    },
    [
      selectedPaper,
      savingCorrections,
      queue,
      selectedIndex,
      clearPaperDraft,
      selectPaper,
      loadReviewQueue,
      scopeQuizId,
      pushToast,
    ],
  );

  const handleConfirmBlankSheet = useCallback(async () => {
    if (!selectedPaper || savingCorrections) return;
    setSavingCorrections(true);
    try {
      const updated = await submitReview(selectedPaper.quizId, selectedPaper.id, {
        corrections: { 1: "" },
      });
      clearPaperDraft(selectedPaper.id);
      const remainingQueue = updated.needsReview
        ? queue.map((item) =>
            item.id === updated.id
              ? mergeUpdatedPaperIntoQueueItem(item, updated)
              : item,
          )
        : queue.filter((item) => item.id !== selectedPaper.id);
      setQueue(remainingQueue);
      const nextTarget =
        remainingQueue[
          Math.min(selectedIndex, Math.max(0, remainingQueue.length - 1))
        ] ?? null;
      selectPaper(nextTarget, "next");
      const paperLabel =
        updated.nameText || selectedPaper.nameText || "Unnamed paper";
      pushToast(
        `Confirmed blank sheet for ${paperLabel} (${updated.score.toFixed(1)}%).`,
        "success",
      );
    } catch (err) {
      pushToast(
        getErrorMessage(err, "Could not confirm blank sheet."),
        "error",
      );
    } finally {
      setSavingCorrections(false);
    }
  }, [
    selectedPaper,
    savingCorrections,
    queue,
    selectedIndex,
    clearPaperDraft,
    selectPaper,
    pushToast,
  ]);

  const liveScore = useMemo(() => {
    if (!selectedPaper) return null;
    if (
      selectedPaper.answerKey.length > 0 &&
      selectedPaper.answers.length === selectedPaper.answerKey.length
    ) {
      return scorePaper({
        answerKey: selectedPaper.answerKey,
        points:
          selectedPaper.points?.length === selectedPaper.answerKey.length
            ? selectedPaper.points
            : undefined,
        questionRules: selectedPaper.questionRules,
        keyVersionFlagged: selectedPaper.keyVersionFlagged,
        answers: selectedPaper.answers,
        flags: selectedPaper.flags,
        corrections: {
          ...selectedPaper.corrections,
          ...draftCorrections,
        },
      });
    }
    return {
      earnedPoints: selectedPaper.earnedPoints,
      totalPoints: selectedPaper.totalPoints,
      score: selectedPaper.score,
    };
  }, [selectedPaper, draftCorrections]);

  const highlightBox =
    focusedQuestion !== null && selectedPaper
      ? questionRegionPercent(
          focusedQuestion,
          selectedPaper.answers.length || 20,
        )
      : null;

  const displayedEarnedPoints =
    liveScore?.earnedPoints ?? selectedPaper?.earnedPoints ?? 0;
  const displayedTotalPoints =
    liveScore?.totalPoints ?? selectedPaper?.totalPoints ?? 0;
  const displayedScorePct = liveScore?.score ?? selectedPaper?.score ?? 0;

  const liveAnnouncement = selectedPaper
    ? `Reviewing ${selectedPaper.nameText || "Unnamed paper"}, ${selectedPaper.quizName || "Quiz"}, Provisional score ${formatPointsValue(displayedEarnedPoints)} of ${formatPointsValue(displayedTotalPoints)} points (${displayedScorePct.toFixed(1)}%). ${focusedQuestion !== null ? `Focused on Question ${focusedQuestion}.` : ""}`
    : "";

  const activeQuizName = scopeQuizName ?? selectedPaper?.quizName ?? null;

  return (
    <div className="space-y-5">
      <div aria-live="polite" className="sr-only">
        {liveAnnouncement}
      </div>

      <div>
        {scopeQuizId && (
          <Breadcrumb
            items={[
              { label: "Quizzes", href: "/" },
              { label: activeQuizName || "Quiz", href: `/quizzes/${scopeQuizId}` },
              { label: "Review papers" },
            ]}
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1>Review papers</h1>
          <div className="flex flex-wrap items-center gap-3">
            {!loading && queue.length > 1 && (
              <span className="text-xs font-medium text-[var(--text-secondary)] tabular-nums">
                Paper {selectedIndex + 1} of {queue.length}
              </span>
            )}
            <Button
              variant="secondary"
              size="sm"
              aria-label="Keyboard shortcuts reference"
              onClick={() => setShortcutsOpen(true)}
            >
              Keyboard shortcuts
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <SkeletonRows rows={6} />
      ) : queueError ? (
        <EmptyState
          tone="error"
          icon={<WarningIcon />}
          title="Could not load review queue"
          description={queueError}
          nextStep="Check that the backend server is running, then select Try again."
          action={
            <Button
              variant="primary"
              onClick={() => void loadReviewQueue(selectedId, scopeQuizId)}
            >
              Try again
            </Button>
          }
        />
      ) : queue.length === 0 ? (
        <EmptyState
          icon={<CheckIcon />}
          title={
            scopeQuizId
              ? `All papers in ${scopeQuizName || "this quiz"} are reviewed`
              : "All papers are reviewed"
          }
          description="No flagged marks or provisional scores remain."
          nextStep={
            scopeQuizId
              ? "Return to the quiz to inspect final scores or export grades."
              : "Return to Quizzes to view confirmed scores or upload new papers."
          }
          action={
            <Link href={scopeQuizId ? `/quizzes/${scopeQuizId}` : "/"}>
              <Button variant="primary">
                {scopeQuizId
                  ? `Back to ${scopeQuizName || "quiz"}`
                  : "Open quizzes"}
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {queue.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2.5">
              <Button
                variant="secondary"
                size="sm"
                inlineReason={false}
                disabled={selectedIndex <= 0}
                onClick={() => {
                  if (selectedIndex > 0) {
                    selectPaper(queue[selectedIndex - 1], "prev");
                  }
                }}
                aria-label="Previous paper"
              >
                <ChevronLeftIcon />
                Prev
              </Button>
              <SelectInput
                id="queue-paper-select"
                aria-label={`Select paper (${queue.length} in queue)`}
                selectSize="sm"
                value={selectedId ?? ""}
                onChange={(e) => {
                  const targetIdx = queue.findIndex(
                    (q) => q.id === e.target.value,
                  );
                  const target = targetIdx >= 0 ? queue[targetIdx] : null;
                  const dir =
                    targetIdx > selectedIndex
                      ? "next"
                      : targetIdx < selectedIndex
                        ? "prev"
                        : "";
                  selectPaper(target, dir);
                }}
                className="min-w-[200px] flex-1"
              >
                {queue.map((item) => {
                  const count = getFlaggedQuestions(item).length;
                  const labelName =
                    item.nameText || item.quizName || "Unnamed paper";
                  return (
                    <option key={item.id} value={item.id}>
                      {labelName} ({count} flagged,{" "}
                      {formatPointsValue(item.earnedPoints)} /{" "}
                      {formatPointsValue(item.totalPoints)} pts)
                    </option>
                  );
                })}
              </SelectInput>
              <Button
                variant="secondary"
                size="sm"
                inlineReason={false}
                disabled={selectedIndex < 0 || selectedIndex >= queue.length - 1}
                onClick={() => {
                  if (
                    selectedIndex >= 0 &&
                    selectedIndex < queue.length - 1
                  ) {
                    selectPaper(queue[selectedIndex + 1], "next");
                  }
                }}
                aria-label="Next paper"
              >
                Next
                <ChevronRightIcon />
              </Button>
            </div>
          )}

          {selectedPaper && (
              <Card
                key={selectedPaper.id}
                padded={false}
                className={`flex flex-col overflow-hidden ${
                  slideDir === "next"
                    ? "slide-next"
                    : slideDir === "prev"
                      ? "slide-prev"
                      : ""
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)] px-6 py-4">
                  <h2>{selectedPaper.nameText || "Unnamed paper"}</h2>
                  <span className="text-sm tabular-nums">
                    <span className="font-bold text-[var(--text-primary)]">
                      {formatPointsValue(displayedEarnedPoints)} /{" "}
                      {formatPointsValue(displayedTotalPoints)} pts
                    </span>{" "}
                    <span className="text-[var(--text-secondary)]">
                      ({displayedScorePct.toFixed(1)}%)
                    </span>
                  </span>
                </div>

                <ReviewIdentityBar
                  key={selectedPaper.id}
                  paper={selectedPaper}
                  students={students}
                  onUpdated={(updated) => {
                    if (
                      !updated.needsReview ||
                      (updated.keyVersion ?? "A") !==
                        (selectedPaper.keyVersion ?? "A") ||
                      Boolean(updated.keyVersionFlagged) !==
                        Boolean(selectedPaper.keyVersionFlagged)
                    ) {
                      if (!updated.needsReview) {
                        clearPaperDraft(updated.id);
                      }
                      void loadReviewQueue(
                        updated.needsReview ? updated.id : null,
                        scopeQuizId,
                        updated.needsReview,
                      );
                      return;
                    }
                    setQueue((prev) =>
                      prev.map((item) =>
                        item.id === updated.id
                          ? mergeUpdatedPaperIntoQueueItem(item, updated)
                          : item,
                      ),
                    );
                    void getRoster()
                      .then((r) => setStudents(r.students))
                      .catch(() => {});
                  }}
                />

                <div className="grid gap-6 p-6 md:grid-cols-2">
                  <ScanPreviewPane
                    scanId={selectedPaper.id}
                    imageUrl={imageUrl}
                    imageLoading={false}
                    highlightBox={highlightBox}
                    onRetryImage={() => setImageRetryCount((c) => c + 1)}
                    answerKey={selectedPaper.answerKey}
                    points={selectedPaper.points}
                    questionRules={selectedPaper.questionRules}
                    keyVersion={selectedPaper.keyVersion}
                    showKeyVersion={
                      (selectedPaper.availableKeyVersions?.length ?? 1) > 1 ||
                      Boolean(selectedPaper.keyVersionFlagged)
                    }
                    answers={selectedPaper.answers}
                    flags={selectedPaper.flags}
                    corrections={{
                      ...selectedPaper.corrections,
                      ...draftCorrections,
                    }}
                  />

                  <div className="space-y-3">
                    {selectedPaper.keyVersionFlagged && (
                      <div className="space-y-2 rounded-lg border border-amber-300 bg-[var(--warning-bg)] p-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[0.8125rem] font-semibold text-[var(--warning-text)]">
                            Confirm Key version
                          </span>
                          <Badge variant="warning">Key strip flagged</Badge>
                        </div>
                        <p className="text-xs text-[var(--warning-text)]">
                          {selectedPaper.detectedKeyVersion
                            ? `Detected bubble "${selectedPaper.detectedKeyVersion}", which is not configured on this quiz.`
                            : "The printed Key strip (A to D) had an unclear or multiple mark."}
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {(selectedPaper.availableKeyVersions ?? ["A"]).map(
                            (ver) => (
                              <Button
                                key={ver}
                                variant={
                                  ver === (selectedPaper.keyVersion ?? "A")
                                    ? "primary"
                                    : "secondary"
                                }
                                size="sm"
                                disabled={savingCorrections}
                                onClick={() => void handleConfirmKeyVersion(ver)}
                              >
                                Use Key {ver}
                              </Button>
                            ),
                          )}
                        </div>
                      </div>
                    )}

                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                      Flagged questions ({flaggedQuestions.length})
                    </h3>

                    {!hasGradedAnswers ? (
                      <p className="rounded-lg bg-[var(--warning-bg)] px-3.5 py-2.5 text-sm text-[var(--warning-text)]">
                        This scan has no graded answers.
                      </p>
                    ) : flaggedQuestions.length === 0 ? (
                      selectedPaper.keyVersionFlagged ? (
                        <p className="text-sm text-[var(--text-secondary)]">
                          No answer bubbles are flagged. Select a Key version
                          above to finish review.
                        </p>
                      ) : (
                        <div className="space-y-3 rounded-lg border border-amber-300 bg-[var(--warning-bg)] p-4">
                          <div>
                            <p className="text-sm font-semibold text-[var(--warning-text)]">
                              Blank answer sheet
                            </p>
                            <p className="mt-1 text-[0.8125rem] text-[var(--warning-text)]">
                              Every bubble on this scan appears unmarked. Confirm
                              to score it as 0 points, or delete the paper from
                              the quiz Papers tab.
                            </p>
                          </div>
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={savingCorrections}
                            onClick={() => void handleConfirmBlankSheet()}
                          >
                            {savingCorrections
                              ? "Saving..."
                              : "Confirm blank sheet (0 pts)"}
                          </Button>
                        </div>
                      )
                    ) : (
                      <ul className="space-y-3">
                        {flaggedQuestions.map((q) => {
                          const chosen = draftCorrections[q.number];
                          const isFocused = focusedQuestion === q.number;
                          const rowCrop = questionRegionPercent(
                            q.number,
                            selectedPaper.answers.length || 20,
                          );
                          const cropAspect = rowCropAspect(rowCrop);
                          const hint = q.reason.startsWith("Two marks")
                            ? `Two marks (${q.readValue}). Select the intended answer.`
                            : `Scanner read ${q.readValue}. Select the intended answer.`;
                          return (
                            <li
                              key={q.number}
                              onClick={() => setFocusedQuestion(q.number)}
                              className={`cursor-pointer rounded-xl border p-3.5 transition-colors ${
                                isFocused
                                  ? "border-[var(--brand)] bg-[var(--brand)]/[0.025] ring-1 ring-[var(--brand)]"
                                  : "border-[var(--border-hairline)] bg-[var(--bg-surface)]"
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-[var(--text-primary)]">
                                    Q{q.number}
                                  </span>
                                  {chosen !== undefined && (
                                    <Badge variant="success">
                                      Confirmed:{" "}
                                      {chosen === "" ? "Blank" : chosen}
                                    </Badge>
                                  )}
                                </div>
                                <span className="text-xs font-medium text-[var(--warning-text)]">
                                  {q.reason}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                                {hint}
                              </p>

                              {imageUrl && (
                                <div
                                  aria-hidden="true"
                                  className="mt-2 w-full max-w-[260px] overflow-hidden rounded-lg border border-[var(--border-hairline)] bg-white p-1"
                                  style={{ aspectRatio: `${cropAspect}` }}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={imageUrl}
                                    alt=""
                                    className="block h-auto max-w-none select-none"
                                    style={{
                                      width: `${10000 / rowCrop.width}%`,
                                      transform: `translate(-${rowCrop.left}%, -${rowCrop.top}%)`,
                                      transformOrigin: "top left",
                                    }}
                                  />
                                </div>
                              )}

                              <div className="mt-2.5 flex flex-wrap gap-1.5">
                                {ANSWER_CHOICES.map((choice) => {
                                  const active = chosen === choice;
                                  return (
                                    <button
                                      key={choice}
                                      type="button"
                                      aria-pressed={active}
                                      aria-label={`Question ${q.number} choice ${choice}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setFocusedQuestion(q.number);
                                        updateSelectedDrafts((prev) => ({
                                          ...prev,
                                          [q.number]: choice,
                                        }));
                                      }}
                                      className={`min-h-9 min-w-9 rounded-lg border px-3 py-1.5 text-[0.8125rem] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
                                        active
                                          ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                                          : "border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                                      }`}
                                    >
                                      {choice}
                                    </button>
                                  );
                                })}
                                <button
                                  type="button"
                                  aria-pressed={chosen === ""}
                                  aria-label={`Question ${q.number} Blank`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFocusedQuestion(q.number);
                                    updateSelectedDrafts((prev) => ({
                                      ...prev,
                                      [q.number]: "",
                                    }));
                                  }}
                                  className={`ml-1 min-h-9 rounded-lg border px-3.5 py-1.5 text-[0.8125rem] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
                                    chosen === ""
                                      ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                                      : "border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                                  }`}
                                >
                                  Blank
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end border-t border-[var(--border-hairline)] bg-[var(--bg-subtle)]/40 px-6 py-3.5">
                  <Button
                    variant="primary"
                    inlineReason={false}
                    disabled={!allFlaggedChosen || savingCorrections}
                    onClick={() => void handleSaveAndNext()}
                  >
                    {savingCorrections
                      ? "Saving..."
                      : !hasGradedAnswers
                        ? "No graded answers"
                        : remainingCount > 0
                          ? `Confirm ${remainingCount} more to save`
                          : nextPaper
                            ? "Save and next"
                            : "Save"}
                  </Button>
                </div>
              </Card>
            )}
        </div>
      )}

      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}
