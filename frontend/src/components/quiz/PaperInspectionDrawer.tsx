"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Drawer } from "@/components/ui/Drawer";
import { SelectInput } from "@/components/ui/Field";
import {
  GradedOverlayLegend,
  GradedSheetOverlay,
} from "@/components/ui/GradedSheetOverlay";
import { useToast } from "@/components/ui/Toast";
import { getErrorMessage } from "@/lib/api";
import {
  formatPointsValue,
  resolveEffectiveChoice,
  scorePaper,
} from "@/lib/scoring";
import { ANSWER_CHOICES } from "@/lib/types";
import {
  computePaperPoints,
  getAvailableKeyVersions,
  getPaperImageUrl,
  resolveQuizKeyForVersion,
  submitReview,
  type KeyVersionId,
  type Paper,
  type Quiz,
} from "@/lib/workspace";

export interface PaperInspectionDrawerProps {
  quiz: Quiz;
  paper: Paper | null;
  points?: { earnedPoints: number; totalPoints: number };
  imageCacheKey: number;
  regradingId: string | null;
  guardClosing: boolean;
  onRequestRescan: (paper: Paper) => void;
  onReload: () => Promise<void>;
  onClose: () => void;
}

export function PaperInspectionDrawer({
  quiz,
  paper,
  points,
  imageCacheKey,
  regradingId,
  guardClosing,
  onRequestRescan,
  onReload,
  onClose,
}: PaperInspectionDrawerProps) {
  const { push: pushToast } = useToast();
  const [viewOverlayMode, setViewOverlayMode] = useState<"graded" | "clean">(
    "graded",
  );
  const [updatingVersionId, setUpdatingVersionId] = useState<string | null>(
    null,
  );
  const [editingAnswers, setEditingAnswers] = useState(false);
  const [answerDraft, setAnswerDraft] = useState<Record<number, string>>({});
  const [savingAnswers, setSavingAnswers] = useState(false);
  const [discardAnswersAction, setDiscardAnswersAction] = useState<
    "done" | "close" | null
  >(null);

  const availableKeyVersions = getAvailableKeyVersions(quiz);
  const resolvedViewKey = paper
    ? resolveQuizKeyForVersion(quiz, paper.keyVersion)
    : null;
  const viewImageUrl = paper
    ? getPaperImageUrl(quiz.id, paper.id, "aligned", imageCacheKey)
    : null;
  const viewShowKeyVersion =
    availableKeyVersions.length > 1 || Boolean(paper?.keyVersionFlagged);

  function requestExitAnswerEdit(action: "done" | "close") {
    if (editingAnswers && Object.keys(answerDraft).length > 0) {
      setDiscardAnswersAction(action);
      return;
    }
    if (action === "close") {
      onClose();
    } else {
      setEditingAnswers(false);
      setAnswerDraft({});
    }
  }

  async function handleChangeViewKeyVersion(
    paperId: string,
    nextVersion: KeyVersionId,
  ) {
    if (updatingVersionId !== null) return;
    setUpdatingVersionId(paperId);
    try {
      await submitReview(quiz.id, paperId, { keyVersion: nextVersion });
      await onReload();
      pushToast("Key version updated and paper rescored.", "success");
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not update key version."), "error");
    } finally {
      setUpdatingVersionId(null);
    }
  }

  async function handleSaveManualAnswers(targetPaper: Paper) {
    if (savingAnswers || Object.keys(answerDraft).length === 0) return;
    setSavingAnswers(true);
    try {
      await submitReview(quiz.id, targetPaper.id, { corrections: answerDraft });
      setAnswerDraft({});
      setEditingAnswers(false);
      await onReload();
      pushToast("Saved manual answer overrides.", "success");
    } catch (err) {
      pushToast(
        getErrorMessage(err, "Could not save manual overrides."),
        "error",
      );
    } finally {
      setSavingAnswers(false);
    }
  }

  const liveEditScore =
    editingAnswers &&
    paper &&
    resolvedViewKey &&
    Object.keys(answerDraft).length > 0 &&
    paper.answers.length === resolvedViewKey.answerKey.length
      ? scorePaper({
          answerKey: resolvedViewKey.answerKey,
          points: resolvedViewKey.points,
          questionRules: resolvedViewKey.questionRules,
          keyVersionFlagged: paper.keyVersionFlagged,
          answers: paper.answers,
          flags: paper.flags,
          corrections: { ...paper.corrections, ...answerDraft },
        })
      : null;

  const resolvedPoints = paper
    ? (liveEditScore ?? points ?? computePaperPoints(quiz, paper))
    : null;
  const displayedScorePct = liveEditScore
    ? liveEditScore.score
    : (paper?.score ?? 0);
  const displayedNeedsReview = liveEditScore
    ? liveEditScore.needsReview
    : Boolean(paper?.needsReview);

  return (
    <>
      <Drawer
        open={paper !== null}
        title={paper?.nameText || "Unnamed paper"}
        subtitle={
          paper && resolvedPoints
            ? `Score: ${formatPointsValue(resolvedPoints.earnedPoints)} / ${formatPointsValue(resolvedPoints.totalPoints)} pts (${displayedScorePct.toFixed(1)}%)${displayedNeedsReview ? ", provisional" : ""}`
            : undefined
        }
        onClose={() => {
          if (!guardClosing && !discardAnswersAction) {
            requestExitAnswerEdit("close");
          }
        }}
      >
        {paper && resolvedViewKey && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {paper.answers.length === quiz.answerKey.length && (
                  <div
                    role="group"
                    aria-label="Paper image layer"
                    className="inline-flex rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-0.5 text-xs font-medium"
                  >
                    <button
                      type="button"
                      aria-pressed={viewOverlayMode === "graded"}
                      onClick={() => setViewOverlayMode("graded")}
                      className={`rounded-md px-2.5 py-1 transition-colors ${
                        viewOverlayMode === "graded"
                          ? "bg-[var(--brand)] text-white"
                          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      Graded overlay
                    </button>
                    <button
                      type="button"
                      aria-pressed={viewOverlayMode === "clean"}
                      onClick={() => setViewOverlayMode("clean")}
                      className={`rounded-md px-2.5 py-1 transition-colors ${
                        viewOverlayMode === "clean"
                          ? "bg-[var(--brand)] text-white"
                          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      Clean scan
                    </button>
                  </div>
                )}

                {availableKeyVersions.length > 1 && (
                  <div className="flex items-center gap-1.5">
                    <label
                      htmlFor="drawer-key-version"
                      className="text-xs font-medium text-[var(--text-secondary)]"
                    >
                      Key
                    </label>
                    <SelectInput
                      id="drawer-key-version"
                      selectSize="sm"
                      value={paper.keyVersion ?? "A"}
                      disabled={updatingVersionId === paper.id}
                      onChange={(e) =>
                        void handleChangeViewKeyVersion(
                          paper.id,
                          e.target.value as KeyVersionId,
                        )
                      }
                      className="!w-auto"
                    >
                      {availableKeyVersions.map((ver) => (
                        <option key={ver} value={ver}>
                          Key {ver}
                        </option>
                      ))}
                    </SelectInput>
                  </div>
                )}

                {paper.answers.length === quiz.answerKey.length && (
                  <Button
                    variant={editingAnswers ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => {
                      if (editingAnswers) {
                        requestExitAnswerEdit("done");
                      } else {
                        setEditingAnswers(true);
                        setAnswerDraft({});
                      }
                    }}
                  >
                    {editingAnswers ? "Done editing" : "Edit answers"}
                  </Button>
                )}

                <Button
                  variant="secondary"
                  size="sm"
                  disabled={regradingId === paper.id}
                  onClick={() => onRequestRescan(paper)}
                >
                  {regradingId === paper.id ? "Re-scanning..." : "Re-scan"}
                </Button>
              </div>
              {viewOverlayMode === "graded" && <GradedOverlayLegend />}
            </div>

            {viewImageUrl ? (
              <div className="flex justify-center overflow-hidden rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-2">
                <div className="relative inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={viewImageUrl}
                    alt={
                      paper.nameText
                        ? `Scan for ${paper.nameText}`
                        : "Graded answer sheet"
                    }
                    className="block max-h-[68vh] w-auto max-w-full"
                  />
                  {viewOverlayMode === "graded" &&
                    paper.answers.length === quiz.answerKey.length && (
                      <GradedSheetOverlay
                        answerKey={resolvedViewKey.answerKey}
                        points={resolvedViewKey.points}
                        questionRules={resolvedViewKey.questionRules}
                        keyVersion={paper.keyVersion ?? resolvedViewKey.version}
                        showKeyVersion={viewShowKeyVersion}
                        answers={paper.answers}
                        flags={paper.flags}
                        corrections={
                          editingAnswers
                            ? { ...paper.corrections, ...answerDraft }
                            : paper.corrections
                        }
                      />
                    )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                Aligned scan image unavailable.
              </p>
            )}

            {editingAnswers &&
              paper.answers.length === quiz.answerKey.length && (
                <div className="space-y-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-[var(--text-primary)]">
                        Edit student answers
                      </p>
                      <p className="text-[0.6875rem] text-[var(--text-secondary)]">
                        Override any scanned bubble and save to rescore.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={savingAnswers}
                        onClick={() => requestExitAnswerEdit("done")}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={
                          savingAnswers || Object.keys(answerDraft).length === 0
                        }
                        onClick={() => void handleSaveManualAnswers(paper)}
                      >
                        {savingAnswers ? "Saving..." : "Save answers"}
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-[42vh] divide-y divide-[var(--border-hairline)] overflow-y-auto rounded-lg border border-[var(--border-hairline)]">
                    {paper.answers.map((_, idx) => {
                      const qNum = idx + 1;
                      const currentEff = resolveEffectiveChoice(
                        qNum,
                        paper.answers,
                        paper.flags,
                        paper.corrections,
                      ).choice;
                      const activeChoice =
                        answerDraft[qNum] !== undefined
                          ? answerDraft[qNum]
                          : currentEff;
                      return (
                        <div
                          key={qNum}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2 tabular-nums">
                            <span className="w-8 font-semibold text-[var(--text-primary)]">
                              Q{qNum}
                            </span>
                            <span className="text-[var(--text-muted)]">
                              Key {resolvedViewKey.answerKey[idx]}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            {[...ANSWER_CHOICES, ""].map((opt) => {
                              const selected = activeChoice === opt;
                              return (
                                <button
                                  key={opt || "blank"}
                                  type="button"
                                  aria-pressed={selected}
                                  onClick={() =>
                                    setAnswerDraft((prev) => {
                                      if (opt === currentEff) {
                                        if (!(qNum in prev)) return prev;
                                        const next = { ...prev };
                                        delete next[qNum];
                                        return next;
                                      }
                                      return {
                                        ...prev,
                                        [qNum]: opt,
                                      };
                                    })
                                  }
                                  className={`min-h-7 min-w-7 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors ${
                                    selected
                                      ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                                      : "border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                                  }`}
                                >
                                  {opt || "Blank"}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
          </div>
        )}
      </Drawer>

      <Dialog
        open={discardAnswersAction !== null}
        title="Discard unsaved answer edits?"
        description="You have edited student answers without saving. Leaving edit mode now will discard them."
        confirmLabel="Discard edits"
        confirmVariant="danger"
        onConfirm={() => {
          const action = discardAnswersAction;
          setDiscardAnswersAction(null);
          if (action === "close") {
            onClose();
          } else {
            setEditingAnswers(false);
            setAnswerDraft({});
          }
        }}
        onClose={() => setDiscardAnswersAction(null)}
      />
    </>
  );
}
