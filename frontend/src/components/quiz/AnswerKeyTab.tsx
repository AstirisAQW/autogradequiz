"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnswerDetailDialog } from "@/components/quiz/AnswerDetailDialog";
import { AnswerKeyGrid } from "@/components/quiz/AnswerKeyGrid";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { FormField, TextInput } from "@/components/ui/Field";
import { WarningIcon } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";
import { getErrorMessage, scanKeyFromImage } from "@/lib/api";
import { collectAllQuizTags } from "@/lib/tagReport";
import { ANSWER_CHOICES, type TemplateId } from "@/lib/types";
import {
  KEY_VERSION_IDS,
  saveQuiz,
  type KeyVersionData,
  type KeyVersionId,
  type QuestionRule,
  type Quiz,
} from "@/lib/workspace";

interface VersionDraft {
  answerKey: string[];
  points: number[];
  questionRules: QuestionRule[];
}

export interface AnswerKeyTabProps {
  quiz: Quiz;
  paperCount: number;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved: () => Promise<void>;
}

function normalizeRulesList(
  count: number,
  raw?: QuestionRule[],
): QuestionRule[] {
  return Array.from({ length: count }, (_, i) => {
    const r = raw?.[i];
    if (!r) return {};
    return {
      ...(r.alternateAnswers?.length
        ? {
            alternateAnswers: r.alternateAnswers.map((a) => ({
              choice: a.choice,
              points: a.points,
            })),
          }
        : {}),
      ...(r.incorrectPoints !== undefined
        ? { incorrectPoints: r.incorrectPoints }
        : {}),
      ...(r.tags?.length ? { tags: [...r.tags] } : {}),
    };
  });
}

function buildInitialDrafts(
  quiz: Quiz,
): Partial<Record<KeyVersionId, VersionDraft>> {
  const n = quiz.answerKey.length;
  const defaultPts =
    quiz.points?.length === n ? [...quiz.points] : Array<number>(n).fill(1);
  const out: Partial<Record<KeyVersionId, VersionDraft>> = {
    A: {
      answerKey: [...quiz.answerKey],
      points: [...defaultPts],
      questionRules: normalizeRulesList(n, quiz.questionRules),
    },
  };
  for (const ver of ["B", "C", "D"] as const) {
    const verData = quiz.keyVersions?.[ver];
    if (verData) {
      out[ver] = {
        answerKey: [...verData.answerKey],
        points:
          verData.points?.length === n
            ? [...verData.points]
            : [...defaultPts],
        questionRules: normalizeRulesList(n, verData.questionRules),
      };
    }
  }
  return out;
}

export function AnswerKeyTab({
  quiz,
  paperCount,
  onDirtyChange,
  onSaved,
}: AnswerKeyTabProps) {
  const { push: pushToast } = useToast();
  const questionCount = quiz.answerKey.length;

  const initialDrafts = useMemo(() => buildInitialDrafts(quiz), [quiz]);
  const initialSnapshot = useMemo(
    () => JSON.stringify(initialDrafts),
    [initialDrafts],
  );

  const [versionsDraft, setVersionsDraft] = useState<
    Partial<Record<KeyVersionId, VersionDraft>>
  >(() => initialDrafts);
  const [activeVersion, setActiveVersion] = useState<KeyVersionId>("A");
  const [savingKey, setSavingKey] = useState(false);
  const [scanningKey, setScanningKey] = useState(false);
  const keyFileRef = useRef<HTMLInputElement | null>(null);

  const [detailQuestionIdx, setDetailQuestionIdx] = useState<number | null>(
    null,
  );
  const [bulkPointsOpen, setBulkPointsOpen] = useState(false);
  const [bulkPointsStr, setBulkPointsStr] = useState("1");
  const [bulkPointsTouched, setBulkPointsTouched] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const enabledVersions = KEY_VERSION_IDS.filter(
    (v) => versionsDraft[v] !== undefined,
  );
  const effectiveActiveVersion: KeyVersionId = versionsDraft[activeVersion]
    ? activeVersion
    : "A";
  const activeDraft = versionsDraft[effectiveActiveVersion]!;

  const isDirty = useMemo(
    () => JSON.stringify(versionsDraft) !== initialSnapshot,
    [versionsDraft, initialSnapshot],
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const allTagSuggestions = useMemo(() => {
    const tagSet = new Set<string>(collectAllQuizTags(quiz));
    for (const ver of enabledVersions) {
      for (const rule of versionsDraft[ver]?.questionRules ?? []) {
        for (const tag of rule.tags ?? []) {
          if (tag.trim()) tagSet.add(tag.trim());
        }
      }
    }
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }, [quiz, enabledVersions, versionsDraft]);

  function updateActiveDraft(updater: (prev: VersionDraft) => VersionDraft) {
    setVersionsDraft((prev) => {
      const curr = prev[effectiveActiveVersion];
      if (!curr) return prev;
      return {
        ...prev,
        [effectiveActiveVersion]: updater(curr),
      };
    });
  }

  function handleAddKeyVersion() {
    const nextVer = (["B", "C", "D"] as const).find(
      (v) => versionsDraft[v] === undefined,
    );
    if (!nextVer) return;
    const primary = versionsDraft.A!;
    setVersionsDraft((prev) => ({
      ...prev,
      [nextVer]: {
        answerKey: [...primary.answerKey],
        points: [...primary.points],
        questionRules: normalizeRulesList(questionCount, primary.questionRules),
      },
    }));
    setActiveVersion(nextVer);
    pushToast(
      `Added Key ${nextVer} copied from Key A. Edit differences then save.`,
      "info",
    );
  }

  function handleRemoveVersion(ver: KeyVersionId) {
    if (ver === "A") return;
    const removedDraft = versionsDraft[ver];
    setVersionsDraft((prev) => {
      const next = { ...prev };
      delete next[ver];
      return next;
    });
    if (effectiveActiveVersion === ver) {
      setActiveVersion("A");
    }
    if (removedDraft) {
      pushToast(`Removed Key ${ver}.`, "info", {
        actionLabel: "Undo",
        onAction: () => {
          setVersionsDraft((prev) => ({ ...prev, [ver]: removedDraft }));
          setActiveVersion(ver);
          pushToast(`Restored Key ${ver}.`, "success");
        },
      });
    }
  }

  function handleConfirmClearAll() {
    const targetVer = effectiveActiveVersion;
    const previousEntries = [...activeDraft.answerKey];
    setVersionsDraft((prev) => {
      const curr = prev[targetVer];
      if (!curr) return prev;
      return {
        ...prev,
        [targetVer]: {
          ...curr,
          answerKey: Array<string>(questionCount).fill(""),
        },
      };
    });
    setClearConfirmOpen(false);
    pushToast(`Cleared all answers in Key ${targetVer}.`, "info", {
      actionLabel: "Undo",
      onAction: () => {
        setVersionsDraft((prev) => {
          const existing = prev[targetVer];
          if (!existing) return prev;
          return {
            ...prev,
            [targetVer]: { ...existing, answerKey: previousEntries },
          };
        });
        setActiveVersion(targetVer);
        pushToast(`Restored Key ${targetVer} answers.`, "success");
      },
    });
  }

  function handleFillRepeatingPattern() {
    const targetVer = effectiveActiveVersion;
    const previousEntries = [...activeDraft.answerKey];
    const nextEntries = Array.from(
      { length: questionCount },
      (_, idx) => ANSWER_CHOICES[idx % ANSWER_CHOICES.length],
    );
    setVersionsDraft((prev) => {
      const curr = prev[targetVer];
      if (!curr) return prev;
      return {
        ...prev,
        [targetVer]: { ...curr, answerKey: nextEntries },
      };
    });
    if (previousEntries.some((entry) => entry !== "")) {
      pushToast(`Filled Key ${targetVer} with repeating A, B, C, D, E.`, "info", {
        actionLabel: "Undo",
        onAction: () => {
          setVersionsDraft((prev) => {
            const existing = prev[targetVer];
            if (!existing) return prev;
            return {
              ...prev,
              [targetVer]: { ...existing, answerKey: previousEntries },
            };
          });
          setActiveVersion(targetVer);
          pushToast(`Restored Key ${targetVer} answers.`, "success");
        },
      });
    }
  }

  function handleDiscardChanges() {
    setVersionsDraft(buildInitialDrafts(quiz));
    if (!quiz.keyVersions?.[activeVersion]) {
      setActiveVersion("A");
    }
    pushToast("Discarded unsaved answer key changes.");
  }

  async function handleScanMasterKey(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (keyFileRef.current) keyFileRef.current.value = "";
    if (!file || scanningKey) return;
    setScanningKey(true);
    try {
      const scanned = await scanKeyFromImage(
        quiz.templateId as TemplateId,
        file,
      );
      updateActiveDraft((curr) => ({
        ...curr,
        answerKey: scanned.answer_key,
      }));
      if (scanned.flagged_questions.length > 0) {
        pushToast(
          `Scanned key with ${scanned.flagged_questions.length} unclear question(s). Review before saving.`,
          "info",
        );
      } else {
        pushToast(
          `Answer key scanned into Key ${effectiveActiveVersion}. Select Save answer key to apply.`,
          "success",
        );
      }
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not scan master key image."), "error");
    } finally {
      setScanningKey(false);
    }
  }

  const bulkVal = Number(bulkPointsStr);
  const bulkPointsError =
    bulkPointsStr.trim() === "" || !Number.isFinite(bulkVal) || bulkVal < 0
      ? "Points must be a non-negative number (e.g. 0.5, 1, 2.5)."
      : null;

  function handleApplyBulkPoints() {
    setBulkPointsTouched(true);
    if (bulkPointsError) return;
    updateActiveDraft((curr) => ({
      ...curr,
      points: Array<number>(questionCount).fill(bulkVal),
    }));
    setBulkPointsOpen(false);
  }

  async function handleSaveAnswerKey() {
    if (savingKey) return;
    for (const ver of enabledVersions) {
      const draft = versionsDraft[ver];
      if (!draft || draft.answerKey.some((entry) => !entry)) {
        setActiveVersion(ver);
        pushToast(
          `Select an answer for every question in Key ${ver} before saving.`,
          "error",
        );
        return;
      }
    }

    const primary = versionsDraft.A!;
    const keyVersionsPayload: Partial<Record<KeyVersionId, KeyVersionData>> =
      {};
    for (const ver of ["B", "C", "D"] as const) {
      const draft = versionsDraft[ver];
      if (draft) {
        keyVersionsPayload[ver] = {
          answerKey: draft.answerKey,
          points: draft.points,
          questionRules: draft.questionRules,
        };
      }
    }

    setSavingKey(true);
    try {
      await saveQuiz({
        id: quiz.id,
        name: quiz.name,
        templateId: quiz.templateId,
        date: quiz.date,
        classIds: quiz.classIds,
        tags: quiz.tags,
        answerKey: primary.answerKey,
        points: primary.points,
        questionRules: primary.questionRules,
        keyVersions: keyVersionsPayload,
      });
      await onSaved();
      pushToast(
        paperCount > 0
          ? `Saved answer key and regraded ${paperCount} ${paperCount === 1 ? "paper" : "papers"}.`
          : "Saved answer key.",
        "success",
      );
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not save answer key."), "error");
    } finally {
      setSavingKey(false);
    }
  }

  const anyIncomplete = enabledVersions.some((v) =>
    versionsDraft[v]?.answerKey.some((entry) => !entry),
  );

  const canAddMoreKeys = enabledVersions.length < KEY_VERSION_IDS.length;
  const nextVer = (["B", "C", "D"] as const).find(
    (v) => versionsDraft[v] === undefined,
  );

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Answer key versions"
            className="inline-flex flex-wrap items-center gap-1 rounded-[10px] border border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-0.5"
          >
            {enabledVersions.map((ver) => {
              const selected = ver === effectiveActiveVersion;
              return (
                <button
                  key={ver}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveVersion(ver)}
                  className={`min-h-8 rounded-lg px-3 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
                    selected
                      ? "bg-[var(--brand)] font-semibold text-white"
                      : "font-medium text-[var(--text-secondary)] hover:bg-black/[0.04] hover:text-[var(--text-primary)]"
                  }`}
                >
                  Key {ver}
                </button>
              );
            })}
          </div>
          {canAddMoreKeys && nextVer && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAddKeyVersion}
            >
              Add Key {nextVer}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={keyFileRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => void handleScanMasterKey(e)}
            className="sr-only"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={scanningKey}
            onClick={() => keyFileRef.current?.click()}
          >
            {scanningKey ? "Scanning..." : "Scan key from sheet"}
          </Button>
          <ActionMenu
            label="More answer key actions"
            items={[
              {
                id: "fill-pattern",
                label: "Fill A, B, C, D, E pattern",
                onClick: handleFillRepeatingPattern,
              },
              { kind: "divider", id: "div-key-fill" },
              {
                id: "clear-answers",
                label: "Clear all answers",
                variant: "danger",
                onClick: () => setClearConfirmOpen(true),
              },
              ...(effectiveActiveVersion !== "A"
                ? [
                    { kind: "divider" as const, id: "div-key-remove" },
                    {
                      id: "remove-version",
                      label: `Remove Key ${effectiveActiveVersion}`,
                      variant: "danger" as const,
                      onClick: () => handleRemoveVersion(effectiveActiveVersion),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </div>

      {quiz.answerKey.some((a) => !a) && (
        <div className="flex items-center gap-2.5 rounded-xl border border-amber-700/25 bg-[var(--warning-bg)] px-4 py-3 text-[0.8125rem] font-medium text-[var(--warning-text)]">
          <WarningIcon />
          <span>
            Answer key not set yet. Select bubbles below or use Scan key from
            sheet, then save to enable grading.
          </span>
        </div>
      )}

      {isDirty ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-700/25 bg-[var(--warning-bg)] px-4 py-3 text-[0.8125rem]">
          <div className="flex items-center gap-2.5 font-medium text-[var(--warning-text)]">
            <WarningIcon />
            <span>
              {paperCount > 0
                ? `Unsaved changes. Saving will regrade ${paperCount} ${paperCount === 1 ? "paper" : "papers"}.`
                : "Unsaved changes."}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={savingKey}
              onClick={handleDiscardChanges}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              disabled={savingKey || anyIncomplete}
              disabledReason={
                anyIncomplete
                  ? "Select an answer for every question across all key versions"
                  : undefined
              }
              onClick={() => void handleSaveAnswerKey()}
            >
              {savingKey ? "Saving..." : "Save answer key"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[0.8125rem] text-[var(--text-secondary)]">
          Key {effectiveActiveVersion} is saved.
          {paperCount > 0
            ? ` Saving changes to this key regrades ${paperCount} ${paperCount === 1 ? "paper" : "papers"}.`
            : " Select bubbles, point weights, or the row settings icon for alternate answers and tags."}
        </p>
      )}

      <AnswerKeyGrid
        questionCount={questionCount}
        entries={activeDraft.answerKey}
        points={activeDraft.points}
        questionRules={activeDraft.questionRules}
        onChangeEntries={(nextEntries) =>
          updateActiveDraft((curr) => ({ ...curr, answerKey: nextEntries }))
        }
        onChangePoints={(nextPoints) =>
          updateActiveDraft((curr) => ({ ...curr, points: nextPoints }))
        }
        onOpenDetail={(qIdx) => setDetailQuestionIdx(qIdx)}
        onOpenBulkPoints={() => {
          setBulkPointsStr("1");
          setBulkPointsTouched(false);
          setBulkPointsOpen(true);
        }}
      />

      <AnswerDetailDialog
        key={
          detailQuestionIdx !== null
            ? `detail-${effectiveActiveVersion}-${detailQuestionIdx}`
            : "detail-closed"
        }
        open={detailQuestionIdx !== null}
        questionNumber={
          detailQuestionIdx !== null ? detailQuestionIdx + 1 : null
        }
        activeVersionLabel={`Key ${effectiveActiveVersion}`}
        entry={
          detailQuestionIdx !== null
            ? (activeDraft.answerKey[detailQuestionIdx] ?? "")
            : ""
        }
        primaryPoints={
          detailQuestionIdx !== null
            ? (activeDraft.points[detailQuestionIdx] ?? 1)
            : 1
        }
        rule={
          detailQuestionIdx !== null
            ? activeDraft.questionRules[detailQuestionIdx]
            : undefined
        }
        tagSuggestions={allTagSuggestions}
        onSave={({ entry, primaryPoints, rule }) => {
          if (detailQuestionIdx === null) return;
          updateActiveDraft((curr) => ({
            ...curr,
            answerKey: curr.answerKey.map((val, idx) =>
              idx === detailQuestionIdx ? entry : val,
            ),
            points: curr.points.map((val, idx) =>
              idx === detailQuestionIdx ? primaryPoints : val,
            ),
            questionRules: curr.questionRules.map((val, idx) =>
              idx === detailQuestionIdx ? rule : val,
            ),
          }));
          setDetailQuestionIdx(null);
        }}
        onClose={() => setDetailQuestionIdx(null)}
      />

      <Dialog
        open={clearConfirmOpen}
        title={`Clear all answers in Key ${effectiveActiveVersion}?`}
        description={`Clears all ${questionCount} selected answers in Key ${effectiveActiveVersion}.${paperCount > 0 ? ` Saving afterwards will regrade ${paperCount} ${paperCount === 1 ? "paper" : "papers"}.` : ""}`}
        confirmLabel="Clear answers"
        confirmVariant="danger"
        onConfirm={handleConfirmClearAll}
        onClose={() => setClearConfirmOpen(false)}
      />

      <Dialog
        open={bulkPointsOpen}
        title={`Set all points (Key ${effectiveActiveVersion})`}
        description="Apply the same point value (decimals allowed, e.g. 0.5, 1, 2.5) to every question in this key version."
        busy={false}
        hideFooter
        onClose={() => {
          setBulkPointsOpen(false);
          setBulkPointsTouched(false);
        }}
      >
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            handleApplyBulkPoints();
          }}
          className="space-y-4"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {["0.5", "1", "2"].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setBulkPointsStr(preset);
                  setBulkPointsTouched(false);
                }}
                className={`min-h-8 rounded-md border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors ${
                  bulkPointsStr === preset
                    ? "border-[var(--brand)] bg-[var(--brand-subtle)] text-[var(--brand-text)]"
                    : "border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                }`}
              >
                {preset} {preset === "1" ? "pt" : "pts"}
              </button>
            ))}
          </div>
          <FormField
            id="bulk-points-input"
            label="Points per question"
            error={bulkPointsTouched ? bulkPointsError : null}
          >
            <TextInput
              id="bulk-points-input"
              type="number"
              step="0.25"
              min="0"
              hasError={Boolean(bulkPointsTouched && bulkPointsError)}
              value={bulkPointsStr}
              onBlur={() => setBulkPointsTouched(true)}
              onChange={(e) => setBulkPointsStr(e.target.value)}
              className="font-mono tabular-nums"
            />
          </FormField>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="secondary"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setBulkPointsOpen(false);
                setBulkPointsTouched(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Apply to all
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
