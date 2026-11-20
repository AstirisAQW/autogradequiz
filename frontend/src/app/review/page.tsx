"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ReviewIdentityBar } from "@/components/review/ReviewIdentityBar";
import { ScanPreviewPane } from "@/components/review/ScanPreviewPane";
import { ShortcutsDialog } from "@/components/review/ShortcutsDialog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@/components/ui/Icons";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { shortId } from "@/lib/format";
import { formatPointsValue } from "@/lib/scoring";
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
  singleChoice: CorrectionValue | undefined;
}

function mergeUpdatedPaperIntoQueueItem(
  item: ReviewQueueItem,
  updated: Paper,
): ReviewQueueItem {
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

function getFlaggedQuestions(scan: ReviewQueueItem): FlaggedQuestion[] {
  const items: FlaggedQuestion[] = [];
  for (const [key, flagReason] of Object.entries(scan.flags)) {
    const num = Number(key);
    if (!Number.isInteger(num) || num < 1) continue;
    const raw = scan.answers[num - 1] ?? "";
    if (flagReason === "ambiguous") {
      const singleChoice = ANSWER_CHOICES.includes(
        raw as (typeof ANSWER_CHOICES)[number],
      )
        ? (raw as CorrectionValue)
        : undefined;
      items.push({
        number: num,
        reason: "Unclear mark",
        readValue: raw || "blank",
        singleChoice,
      });
    } else if (flagReason === "multiple") {
      items.push({
        number: num,
        reason: `Two marks: ${raw || "?"}`,
        readValue: raw || "blank",
        singleChoice: undefined,
      });
    }
  }
  return items.sort((a, b) => a.number - b.number);
}

function initialDraftsForScan(
  scan: ReviewQueueItem | null,
): Record<number, CorrectionValue> {
  if (!scan) return {};
  const flagged = getFlaggedQuestions(scan);
  const drafts: Record<number, CorrectionValue> = {};

  for (const q of flagged) {
    const saved = scan.corrections[q.number];
    if (
      saved !== undefined &&
      (saved === "" ||
        ANSWER_CHOICES.includes(saved as (typeof ANSWER_CHOICES)[number]))
    ) {
      drafts[q.number] = saved as CorrectionValue;
    } else if (q.singleChoice !== undefined) {
      drafts[q.number] = q.singleChoice;
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

  const [draftCorrections, setDraftCorrections] = useState<
    Record<number, CorrectionValue>
  >({});
  const [students, setStudents] = useState<Student[]>([]);
  const [savingCorrections, setSavingCorrections] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageRetryCount, setImageRetryCount] = useState(0);

  const selectScan = useCallback((scan: ReviewQueueItem | null) => {
    setSelectedId(scan?.id ?? null);
    setDraftCorrections(initialDraftsForScan(scan));
    const flagged = scan ? getFlaggedQuestions(scan) : [];
    setFocusedQuestion(flagged[0]?.number ?? null);
  }, []);

  const refreshQueue = useCallback(
    async (preferredId: string | null = null) => {
      setLoading(true);
      setQueueError(null);
      try {
        const [data, roster] = await Promise.all([
          getReviewQueue(),
          getRoster(),
        ]);
        setQueue(data);
        setStudents(roster.students);
        const next =
          (preferredId !== null
            ? data.find((item) => item.id === preferredId)
            : undefined) ??
          data[0] ??
          null;
        selectScan(next);
      } catch (err) {
        setQueue([]);
        selectScan(null);
        setQueueError(
          err instanceof Error ? err.message : "Could not load review queue.",
        );
      } finally {
        setLoading(false);
      }
    },
    [selectScan],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      let initialPaperId: string | null = null;
      try {
        initialPaperId = new URLSearchParams(window.location.search).get(
          "paper_id",
        );
      } catch {
        initialPaperId = null;
      }
      void refreshQueue(initialPaperId);
    });
    return () => {
      active = false;
    };
  }, [refreshQueue]);

  const selectedScan = useMemo(
    () => queue.find((item) => item.id === selectedId) ?? null,
    [queue, selectedId],
  );

  useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;
    const paperId = selectedScan?.id ?? null;

    if (!paperId) {
      queueMicrotask(() => {
        if (!cancelled) {
          setImageUrl(null);
          setImageLoading(false);
        }
      });
      return;
    }

    queueMicrotask(() => {
      if (!cancelled) setImageLoading(true);
    });

    getPaperImageUrl(paperId)
      .then((url) => {
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        currentUrl = url;
        setImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) setImageUrl(null);
      })
      .finally(() => {
        if (!cancelled) setImageLoading(false);
      });

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [selectedScan?.id, imageRetryCount]);

  const selectedIndex = useMemo(
    () =>
      selectedScan
        ? queue.findIndex((item) => item.id === selectedScan.id)
        : -1,
    [queue, selectedScan],
  );
  const prevScan = selectedIndex > 0 ? queue[selectedIndex - 1] : null;
  const nextScan =
    selectedIndex >= 0 && selectedIndex < queue.length - 1
      ? queue[selectedIndex + 1]
      : null;

  const flaggedQuestions = useMemo(
    () => (selectedScan ? getFlaggedQuestions(selectedScan) : []),
    [selectedScan],
  );
  const hasGradedAnswers = (selectedScan?.answers.length ?? 0) > 0;

  const answeredCount = flaggedQuestions.filter(
    (q) => draftCorrections[q.number] !== undefined,
  ).length;
  const remainingCount = flaggedQuestions.length - answeredCount;
  const allFlaggedChosen =
    hasGradedAnswers &&
    flaggedQuestions.length > 0 &&
    remainingCount === 0;

  const handleSaveAndNext = useCallback(async () => {
    if (!selectedScan || !allFlaggedChosen || savingCorrections) return;

    const corrections: Record<number, string> = {};
    for (const q of flaggedQuestions) {
      corrections[q.number] = draftCorrections[q.number];
    }

    setSavingCorrections(true);
    try {
      const updated = await submitReview(selectedScan.id, { corrections });
      const remainingQueue = updated.needsReview
        ? queue.map((item) =>
            item.id === updated.id
              ? mergeUpdatedPaperIntoQueueItem(item, updated)
              : item,
          )
        : queue.filter((item) => item.id !== selectedScan.id);

      setQueue(remainingQueue);
      const nextTarget =
        remainingQueue[
          Math.min(selectedIndex, Math.max(0, remainingQueue.length - 1))
        ] ?? null;
      selectScan(nextTarget);
      pushToast(
        `Saved Scan #${shortId(updated.id)} (${updated.score.toFixed(1)}%).`,
        "success",
      );
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not save corrections.",
        "error",
      );
    } finally {
      setSavingCorrections(false);
    }
  }, [
    selectedScan,
    allFlaggedChosen,
    savingCorrections,
    flaggedQuestions,
    draftCorrections,
    queue,
    selectedIndex,
    selectScan,
    pushToast,
  ]);

  useEffect(() => {
    if (!selectedScan) return;

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return;
      }

      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (e.key === "ArrowLeft" && prevScan) {
        e.preventDefault();
        selectScan(prevScan);
        return;
      }
      if (e.key === "ArrowRight" && nextScan) {
        e.preventDefault();
        selectScan(nextScan);
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
        setDraftCorrections((prev) => ({
          ...prev,
          [activeQ]: upper as CorrectionValue,
        }));
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setDraftCorrections((prev) => ({ ...prev, [activeQ]: "" }));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectedScan,
    prevScan,
    nextScan,
    selectScan,
    flaggedQuestions,
    focusedQuestion,
    allFlaggedChosen,
    handleSaveAndNext,
  ]);

  const handleConfirmKeyVersion = useCallback(
    async (version: KeyVersionId) => {
      if (!selectedScan || savingCorrections) return;
      setSavingCorrections(true);
      try {
        const updated = await submitReview(selectedScan.id, {
          keyVersion: version,
        });
        if (!updated.needsReview) {
          const remainingQueue = queue.filter(
            (item) => item.id !== selectedScan.id,
          );
          setQueue(remainingQueue);
          const nextTarget =
            remainingQueue[
              Math.min(selectedIndex, Math.max(0, remainingQueue.length - 1))
            ] ?? null;
          selectScan(nextTarget);
          pushToast(
            `Confirmed Key ${version} for Scan #${shortId(updated.id)} (${updated.score.toFixed(1)}%).`,
            "success",
          );
        } else {
          await refreshQueue(updated.id);
          pushToast(`Selected Key ${version}. Finish resolving flagged marks.`, "info");
        }
      } catch (err) {
        pushToast(
          err instanceof Error ? err.message : "Could not update key version.",
          "error",
        );
      } finally {
        setSavingCorrections(false);
      }
    },
    [
      selectedScan,
      savingCorrections,
      queue,
      selectedIndex,
      selectScan,
      refreshQueue,
      pushToast,
    ],
  );

  const handleConfirmBlankSheet = useCallback(async () => {
    if (!selectedScan || savingCorrections) return;
    setSavingCorrections(true);
    try {
      const updated = await submitReview(selectedScan.id, {
        corrections: { 1: "" },
      });
      const remainingQueue = updated.needsReview
        ? queue.map((item) =>
            item.id === updated.id
              ? mergeUpdatedPaperIntoQueueItem(item, updated)
              : item,
          )
        : queue.filter((item) => item.id !== selectedScan.id);
      setQueue(remainingQueue);
      const nextTarget =
        remainingQueue[
          Math.min(selectedIndex, Math.max(0, remainingQueue.length - 1))
        ] ?? null;
      selectScan(nextTarget);
      pushToast(
        `Confirmed blank sheet #${shortId(updated.id)} (${updated.score.toFixed(1)}%).`,
        "success",
      );
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not confirm blank sheet.",
        "error",
      );
    } finally {
      setSavingCorrections(false);
    }
  }, [
    selectedScan,
    savingCorrections,
    queue,
    selectedIndex,
    selectScan,
    pushToast,
  ]);

  const highlightBox =
    focusedQuestion !== null && selectedScan
      ? questionRegionPercent(
          focusedQuestion,
          selectedScan.answers.length || 20,
        )
      : null;

  const liveAnnouncement = selectedScan
    ? `Reviewing Scan ${shortId(selectedScan.id)}, ${selectedScan.quizName || "Quiz"}, Provisional score ${formatPointsValue(selectedScan.earnedPoints)} of ${formatPointsValue(selectedScan.totalPoints)} points (${selectedScan.score.toFixed(1)}%). ${focusedQuestion !== null ? `Focused on Question ${focusedQuestion}.` : ""}`
    : "";

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="sr-only">
        {liveAnnouncement}
      </div>

      <div className="space-y-2">
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-2 text-[13px]"
        >
          <Link
            href="/"
            className="font-medium text-[var(--text-secondary)] hover:text-[var(--brand-text)] hover:underline"
          >
            ← All quizzes
          </Link>
          <span className="text-[var(--text-muted)]">/</span>
          <span className="font-medium text-[var(--text-primary)]">
            Review queue
          </span>
          {selectedScan?.quizName && (
            <>
              <span className="text-[var(--text-muted)]">/</span>
              {selectedScan.quizId ? (
                <Link
                  href={`/quizzes/${selectedScan.quizId}`}
                  className="font-medium text-[var(--text-secondary)] hover:text-[var(--brand-text)] hover:underline"
                >
                  {selectedScan.quizName}
                </Link>
              ) : (
                <span className="text-[var(--text-secondary)]">
                  {selectedScan.quizName}
                </span>
              )}
            </>
          )}
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1>Review queue</h1>
            <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
              Only flagged questions can be corrected here. Scores are
              provisional until all flagged marks are resolved.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              aria-label="Keyboard shortcuts reference"
              onClick={() => setShortcutsOpen(true)}
            >
              Keyboard shortcuts (?)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshQueue(selectedId)}
              disabled={loading}
              disabledReason={loading ? "Refreshing review queue" : undefined}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <SkeletonRows rows={6} />
      ) : queueError ? (
        <EmptyState
          icon={<CheckIcon />}
          title="Could not load review queue"
          description={queueError}
          action={
            <Button
              variant="primary"
              onClick={() => void refreshQueue(selectedId)}
            >
              Retry
            </Button>
          }
        />
      ) : queue.length === 0 ? (
        <EmptyState
          icon={<CheckIcon />}
          title="No papers need review"
          description="All graded papers are clear. New flagged sheets will appear here automatically."
        />
      ) : (
        <div className="space-y-4">
          <div className="lg:hidden">
            <label
              htmlFor="mobile-queue-select"
              className="block text-[12px] font-medium text-[var(--text-secondary)]"
            >
              Select paper ({queue.length} in queue)
            </label>
            <select
              id="mobile-queue-select"
              value={selectedId ?? ""}
              onChange={(e) => {
                const target =
                  queue.find((q) => q.id === e.target.value) ?? null;
                selectScan(target);
              }}
              className="mt-1 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-2 text-[14px] text-[var(--text-primary)] focus:border-[var(--brand)] focus:outline-none"
            >
              {queue.map((item) => {
                const count = getFlaggedQuestions(item).length;
                const labelName =
                  item.quizName || item.nameText || "Unnamed";
                return (
                  <option key={item.id} value={item.id}>
                    #{shortId(item.id)} ·{" "}
                    {formatPointsValue(item.earnedPoints)}/
                    {formatPointsValue(item.totalPoints)} pts (
                    {item.score.toFixed(1)}% Provisional) · {labelName} ({count}{" "}
                    flagged)
                  </option>
                );
              })}
            </select>
          </div>

          <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
            <aside className="hidden lg:block">
              <ul className="divide-y divide-[var(--border-hairline)] overflow-hidden rounded-[12px] border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
                {queue.map((item) => {
                  const count = getFlaggedQuestions(item).length;
                  const isSelected = item.id === selectedId;
                  const displayTitle =
                    item.quizName || item.nameText || "Unnamed";
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => selectScan(item)}
                        className={`w-full border-l-[3px] px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brand)] ${
                          isSelected
                            ? "border-l-[var(--brand)] bg-[var(--bg-subtle)] text-[var(--text-primary)]"
                            : "border-l-transparent bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]/50"
                        }`}
                      >
                        <p className="font-mono text-[12px] font-medium text-[var(--text-secondary)] tabular-nums">
                          #{shortId(item.id)} ·{" "}
                          {formatPointsValue(item.earnedPoints)}/
                          {formatPointsValue(item.totalPoints)} pts (
                          {item.score.toFixed(1)}%)
                        </p>
                        <p className="mt-0.5 truncate text-[14px] font-medium">
                          {displayTitle}
                        </p>
                        <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                          {count} flagged
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            {selectedScan && (
              <Card padded={false} className="flex flex-col overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hairline)] px-6 py-4">
                  <div className="flex items-center gap-3">
                    <h2>Scan #{shortId(selectedScan.id)}</h2>
                    <span className="text-[12px] text-[var(--text-muted)] tabular-nums">
                      {selectedIndex + 1} of {queue.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[14px] font-medium text-[var(--text-primary)] tabular-nums">
                      {formatPointsValue(selectedScan.earnedPoints)} /{" "}
                      {formatPointsValue(selectedScan.totalPoints)} pts (
                      {selectedScan.score.toFixed(1)}%)
                    </span>
                    {selectedScan.needsReview && (
                      <Badge variant="warning">Provisional</Badge>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label="Previous scan"
                      disabled={!prevScan}
                      disabledReason={
                        !prevScan ? "First paper in queue" : undefined
                      }
                      onClick={() => prevScan && selectScan(prevScan)}
                    >
                      <ChevronLeftIcon />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label="Next scan"
                      disabled={!nextScan}
                      disabledReason={
                        !nextScan ? "Last paper in queue" : undefined
                      }
                      onClick={() => nextScan && selectScan(nextScan)}
                    >
                      <ChevronRightIcon />
                    </Button>
                  </div>
                </div>

                <ReviewIdentityBar
                  key={`${selectedScan.id}:${selectedScan.studentId ?? ""}:${selectedScan.studentIdText ?? ""}:${selectedScan.nameText}:${selectedScan.sectionText}:${selectedScan.dateText}:${selectedScan.keyVersion ?? "A"}:${selectedScan.keyVersionFlagged ? "kvflag" : "ok"}`}
                  scan={selectedScan}
                  students={students}
                  onUpdated={(updated) => {
                    if (
                      !updated.needsReview ||
                      (updated.keyVersion ?? "A") !==
                        (selectedScan.keyVersion ?? "A") ||
                      Boolean(updated.keyVersionFlagged) !==
                        Boolean(selectedScan.keyVersionFlagged)
                    ) {
                      void refreshQueue(updated.needsReview ? updated.id : null);
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
                    scanId={selectedScan.id}
                    imageUrl={imageUrl}
                    imageLoading={imageLoading}
                    highlightBox={highlightBox}
                    onRetryImage={() => setImageRetryCount((c) => c + 1)}
                    answerKey={selectedScan.answerKey}
                    questionRules={selectedScan.questionRules}
                    keyVersion={selectedScan.keyVersion}
                    answers={selectedScan.answers}
                    flags={selectedScan.flags}
                    corrections={{
                      ...selectedScan.corrections,
                      ...draftCorrections,
                    }}
                  />

                  <div className="space-y-3">
                    {selectedScan.keyVersionFlagged && (
                      <div className="space-y-2 rounded-[8px] border border-amber-300 bg-[var(--warning-bg)] p-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold text-[var(--warning-text)]">
                            Confirm Key Version
                          </span>
                          <Badge variant="warning">Key strip flagged</Badge>
                        </div>
                        <p className="text-[12px] text-[var(--warning-text)]">
                          {selectedScan.detectedKeyVersion
                            ? `Detected bubble "${selectedScan.detectedKeyVersion}", which is not configured on this quiz.`
                            : "The printed Key Version strip (A–D) had an unclear or multiple mark."}
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {(selectedScan.availableKeyVersions ?? ["A"]).map(
                            (ver) => (
                              <Button
                                key={ver}
                                variant={
                                  ver === (selectedScan.keyVersion ?? "A")
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

                    <h3 className="text-[14px] font-medium text-[var(--text-primary)]">
                      Flagged questions ({flaggedQuestions.length})
                    </h3>

                    {!hasGradedAnswers ? (
                      <p className="rounded-[8px] bg-[var(--warning-bg)] px-3.5 py-2.5 text-[14px] text-[var(--warning-text)]">
                        This scan has no graded answers.
                      </p>
                    ) : flaggedQuestions.length === 0 ? (
                      selectedScan.keyVersionFlagged ? (
                        <p className="text-[14px] text-[var(--text-secondary)]">
                          No answer bubbles are flagged. Choose a Key Version
                          above to complete review.
                        </p>
                      ) : (
                        <div className="space-y-3 rounded-[8px] border border-amber-300 bg-[var(--warning-bg)] p-4">
                          <div>
                            <p className="text-[14px] font-medium text-[var(--warning-text)]">
                              Blank answer sheet
                            </p>
                            <p className="mt-1 text-[13px] text-[var(--warning-text)]">
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
                              ? "Saving…"
                              : "Confirm blank sheet (0 pts)"}
                          </Button>
                        </div>
                      )
                    ) : (
                      <ul className="space-y-3">
                        {flaggedQuestions.map((q) => {
                          const chosen = draftCorrections[q.number];
                          const isFocused = focusedQuestion === q.number;
                          const isCorrected =
                            selectedScan.corrections[q.number] !== undefined;
                          const rowCrop = questionRegionPercent(
                            q.number,
                            selectedScan.answers.length || 20,
                          );
                          const cropAspect = rowCropAspect(rowCrop);
                          return (
                            <li
                              key={q.number}
                              onClick={() => setFocusedQuestion(q.number)}
                              className={`cursor-pointer rounded-[8px] border p-3.5 transition-colors ${
                                isFocused
                                  ? "border-[var(--brand)] bg-[var(--bg-subtle)]/40"
                                  : "border-[var(--border-hairline)] bg-[var(--bg-surface)]"
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[14px] font-medium text-[var(--text-primary)]">
                                    Q{q.number}
                                  </span>
                                  {isCorrected && (
                                    <Badge variant="success">Corrected</Badge>
                                  )}
                                </div>
                                <span className="text-[12px] font-medium text-[var(--warning)]">
                                  {q.reason}
                                </span>
                              </div>
                              <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                                Read: {q.readValue}
                              </p>

                              {imageUrl && (
                                <div
                                  aria-hidden="true"
                                  className="mt-2 w-full max-w-[260px] overflow-hidden rounded-[6px] border border-[var(--border-hairline)] bg-white"
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

                              <div className="mt-2.5 flex flex-wrap gap-2">
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
                                        setDraftCorrections((prev) => ({
                                          ...prev,
                                          [q.number]: choice,
                                        }));
                                      }}
                                      className={`min-h-[36px] min-w-[36px] rounded-[8px] border px-3.5 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
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
                                    setDraftCorrections((prev) => ({
                                      ...prev,
                                      [q.number]: "",
                                    }));
                                  }}
                                  className={`min-h-[36px] rounded-[8px] border px-3.5 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
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

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-hairline)] bg-[var(--bg-subtle)]/50 px-6 py-3.5">
                  <p className="text-[12px] text-[var(--text-muted)]">
                    {answeredCount} of {flaggedQuestions.length} answered
                    {remainingCount > 0 ? ` (${remainingCount} left)` : ""} ·
                    A–E to answer, Enter to save
                  </p>
                  <Button
                    variant="primary"
                    disabled={!allFlaggedChosen || savingCorrections}
                    disabledReason={
                      !hasGradedAnswers
                        ? "Scan has no graded answers"
                        : remainingCount > 0
                          ? `Answer ${remainingCount} remaining question${remainingCount === 1 ? "" : "s"} first`
                          : undefined
                    }
                    onClick={() => void handleSaveAndNext()}
                  >
                    {savingCorrections ? "Saving…" : "Save and next"}
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}
