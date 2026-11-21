"use client";

import { useMemo, useRef, useState } from "react";
import { AnswerKeyGrid } from "@/components/AnswerKeyGrid";
import { AnswerDetailDialog } from "@/components/quiz/AnswerDetailDialog";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { FormField, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ApiError, scanKeyFromImage } from "@/lib/api";
import { collectAllQuizTags } from "@/lib/tagReport";
import type { TemplateId } from "@/lib/types";
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
  activeBatchId: string | null;
  onSaved: (preferredBatchId?: string | null) => Promise<void>;
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
  activeBatchId,
  onSaved,
}: AnswerKeyTabProps) {
  const { push: pushToast } = useToast();
  const questionCount = quiz.answerKey.length;

  const [versionsDraft, setVersionsDraft] = useState<
    Partial<Record<KeyVersionId, VersionDraft>>
  >(() => buildInitialDrafts(quiz));
  const [activeVersion, setActiveVersion] = useState<KeyVersionId>("A");
  const [savingKey, setSavingKey] = useState(false);
  const [scanningKey, setScanningKey] = useState(false);
  const keyFileRef = useRef<HTMLInputElement | null>(null);

  const [detailQuestionIdx, setDetailQuestionIdx] = useState<number | null>(
    null,
  );
  const [bulkPointsOpen, setBulkPointsOpen] = useState(false);
  const [bulkPointsStr, setBulkPointsStr] = useState("1");
  const [bulkPointsError, setBulkPointsError] = useState<string | null>(null);

  const enabledVersions = KEY_VERSION_IDS.filter(
    (v) => versionsDraft[v] !== undefined,
  );
  const effectiveActiveVersion: KeyVersionId = versionsDraft[activeVersion]
    ? activeVersion
    : "A";
  const activeDraft = versionsDraft[effectiveActiveVersion]!;

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
      `Added Key ${nextVer} copied from A: Primary. Update altered questions then save.`,
      "info",
    );
  }

  function handleRemoveVersion(ver: KeyVersionId) {
    if (ver === "A") return;
    setVersionsDraft((prev) => {
      const next = { ...prev };
      delete next[ver];
      return next;
    });
    if (effectiveActiveVersion === ver) {
      setActiveVersion("A");
    }
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
          `Answer key scanned into ${effectiveActiveVersion === "A" ? "A: Primary" : `Key ${effectiveActiveVersion}`}. Click Save answer key to apply.`,
          "success",
        );
      }
    } catch (err) {
      pushToast(
        err instanceof ApiError
          ? err.detail
          : "Could not scan master key image.",
        "error",
      );
    } finally {
      setScanningKey(false);
    }
  }

  function handleApplyBulkPoints() {
    setBulkPointsError(null);
    const val = Number(bulkPointsStr);
    if (!Number.isFinite(val) || val < 0) {
      setBulkPointsError("Points must be a non-negative number (e.g. 0.5, 1, 2.5).");
      return;
    }
    updateActiveDraft((curr) => ({
      ...curr,
      points: Array<number>(questionCount).fill(val),
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
          `Select an answer for every question in ${ver === "A" ? "A: Primary" : `Key ${ver}`} before saving.`,
          "error",
        );
        return;
      }
    }

    const primary = versionsDraft.A!;
    const keyVersionsPayload: Partial<Record<KeyVersionId, KeyVersionData>> = {};
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
        questionCount,
        date: quiz.date,
        folder: quiz.folder,
        sectionIds: quiz.sectionIds,
        tags: quiz.tags,
        answerKey: primary.answerKey,
        points: primary.points,
        questionRules: primary.questionRules,
        keyVersions: keyVersionsPayload,
      });
      await onSaved(activeBatchId);
      pushToast("Answer key saved and papers rescored.", "success");
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not save answer key.",
        "error",
      );
    } finally {
      setSavingKey(false);
    }
  }

  const anyIncomplete = enabledVersions.some((v) =>
    versionsDraft[v]?.answerKey.some((entry) => !entry),
  );

  const canAddMoreKeys = enabledVersions.length < KEY_VERSION_IDS.length;

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Answer key</h2>
          <p className="text-[12px] text-[var(--text-muted)]">
            Configure primary choices, partial credit, penalties, tags, and A–D
            test versions. Saving rescores graded papers automatically.
          </p>
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
            disabled={scanningKey}
            onClick={() => keyFileRef.current?.click()}
          >
            {scanningKey ? "Scanning…" : "Scan key from sheet"}
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
            {savingKey ? "Saving…" : "Save answer key"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] pb-3">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist">
          {enabledVersions.map((ver) => {
            const selected = ver === effectiveActiveVersion;
            return (
              <button
                key={ver}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveVersion(ver)}
                className={`rounded-[8px] border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  selected
                    ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                    : "border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
                }`}
              >
                {ver === "A" ? "A: Primary" : `Key ${ver}`}
              </button>
            );
          })}
          {canAddMoreKeys && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAddKeyVersion}
            >
              + Add Key
            </Button>
          )}
        </div>

        {effectiveActiveVersion !== "A" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleRemoveVersion(effectiveActiveVersion)}
            className="text-[var(--danger)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
          >
            Remove Key {effectiveActiveVersion}
          </Button>
        )}
      </div>

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
          setBulkPointsError(null);
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
        questionNumber={detailQuestionIdx !== null ? detailQuestionIdx + 1 : null}
        activeVersionLabel={
          effectiveActiveVersion === "A"
            ? "A: Primary"
            : `Key ${effectiveActiveVersion}`
        }
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
        open={bulkPointsOpen}
        title={`Set all points (${effectiveActiveVersion === "A" ? "A: Primary" : `Key ${effectiveActiveVersion}`})`}
        description="Apply the same point value (decimals allowed, e.g. 0.5, 1, 2.5) to every question in this key version."
        confirmLabel="Apply to all"
        onConfirm={handleApplyBulkPoints}
        onClose={() => setBulkPointsOpen(false)}
      >
        <div className="space-y-3">
          <FormField id="bulk-points-input" label="Points per question">
            <TextInput
              id="bulk-points-input"
              type="number"
              step="0.25"
              min="0"
              value={bulkPointsStr}
              onChange={(e) => setBulkPointsStr(e.target.value)}
              className="font-mono tabular-nums"
            />
          </FormField>
          {bulkPointsError && (
            <p className="text-[13px] text-[var(--danger-text)]">
              {bulkPointsError}
            </p>
          )}
        </div>
      </Dialog>
    </Card>
  );
}
