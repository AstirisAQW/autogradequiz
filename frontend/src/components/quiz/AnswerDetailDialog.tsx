"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { FormField, SelectInput, TextInput } from "@/components/ui/Field";
import { TagInput } from "@/components/ui/TagInput";
import { formatPointsValue } from "@/lib/scoring";
import { ANSWER_CHOICES } from "@/lib/types";
import type { QuestionRule } from "@/lib/workspace";

interface AlternateDraft {
  id: number;
  choice: string;
  pointsStr: string;
}

export interface AnswerDetailDialogProps {
  open: boolean;
  questionNumber: number | null;
  activeVersionLabel: string;
  entry: string;
  primaryPoints: number;
  rule: QuestionRule | undefined;
  tagSuggestions: string[];
  onSave: (update: {
    entry: string;
    primaryPoints: number;
    rule: QuestionRule;
  }) => void;
  onClose: () => void;
}

export function AnswerDetailDialog({
  open,
  questionNumber,
  activeVersionLabel,
  entry,
  primaryPoints,
  rule,
  tagSuggestions,
  onSave,
  onClose,
}: AnswerDetailDialogProps) {
  const [draftEntry, setDraftEntry] = useState(entry);
  const [draftPrimaryPts, setDraftPrimaryPts] = useState(
    String(primaryPoints ?? 1),
  );
  const [primaryTouched, setPrimaryTouched] = useState(false);
  const [alternates, setAlternates] = useState<AlternateDraft[]>(() =>
    (rule?.alternateAnswers ?? []).map((alt, idx) => ({
      id: idx + 1,
      choice: alt.choice,
      pointsStr: String(alt.points),
    })),
  );
  const [nextAltId, setNextAltId] = useState(
    () => (rule?.alternateAnswers?.length ?? 0) + 1,
  );
  const [incorrectEnabled, setIncorrectEnabled] = useState(
    rule?.incorrectPoints !== undefined,
  );
  const [incorrectPtsStr, setIncorrectPtsStr] = useState(
    rule?.incorrectPoints !== undefined ? String(rule.incorrectPoints) : "0",
  );
  const [incorrectTouched, setIncorrectTouched] = useState(false);
  const [draftTags, setDraftTags] = useState<string[]>(rule?.tags ?? []);
  const [error, setError] = useState<string | null>(null);

  const selectedChoices = draftEntry.split("+").filter(Boolean);

  function togglePrimaryChoice(choice: string) {
    const has = selectedChoices.includes(choice);
    const next = has
      ? selectedChoices.filter((c) => c !== choice)
      : [...selectedChoices, choice];
    next.sort(
      (a, b) =>
        ANSWER_CHOICES.indexOf(a as (typeof ANSWER_CHOICES)[number]) -
        ANSWER_CHOICES.indexOf(b as (typeof ANSWER_CHOICES)[number]),
    );
    setDraftEntry(next.join("+"));
    if (!has) {
      setAlternates((prev) => prev.filter((row) => row.choice !== choice));
    }
    if (error) setError(null);
  }

  const unusedChoices = ANSWER_CHOICES.filter(
    (c) =>
      !selectedChoices.includes(c) &&
      !alternates.some((alt) => alt.choice === c),
  );

  function addAlternateRow() {
    const unused = unusedChoices[0];
    if (!unused) return;
    setAlternates((prev) => [
      ...prev,
      { id: nextAltId, choice: unused, pointsStr: "0.5" },
    ]);
    setNextAltId((n) => n + 1);
  }

  const parsedPrimaryNum = Number(draftPrimaryPts);
  const primaryPtsError =
    draftPrimaryPts.trim() === "" ||
    !Number.isFinite(parsedPrimaryNum) ||
    parsedPrimaryNum < 0
      ? "Enter a non-negative number"
      : null;

  const parsedIncorrectNum = Number(incorrectPtsStr);
  const incorrectPtsError =
    incorrectEnabled &&
    (incorrectPtsStr.trim() === "" || !Number.isFinite(parsedIncorrectNum))
      ? "Enter a valid number"
      : null;

  const maxPts = Math.max(
    Number.isFinite(parsedPrimaryNum) && parsedPrimaryNum >= 0
      ? parsedPrimaryNum
      : 0,
    ...alternates.map((alt) => {
      const val = Number(alt.pointsStr);
      return Number.isFinite(val) && val >= 0 ? val : 0;
    }),
  );

  const altConflictError = (() => {
    const seen = new Set<string>();
    for (const alt of alternates) {
      if (selectedChoices.includes(alt.choice)) {
        return `Alternate choice ${alt.choice} is already selected as a primary answer.`;
      }
      if (seen.has(alt.choice)) {
        return `Duplicate alternate choice ${alt.choice}.`;
      }
      seen.add(alt.choice);
    }
    return null;
  })();

  function handleConfirm() {
    setError(null);
    setPrimaryTouched(true);
    setIncorrectTouched(true);
    if (selectedChoices.length === 0) {
      setError("Select at least one primary answer choice (A to E).");
      return;
    }
    if (altConflictError) {
      setError(altConflictError);
      return;
    }
    if (primaryPtsError || incorrectPtsError) return;

    const parsedAlts: { choice: string; points: number }[] = [];
    for (const alt of alternates) {
      const altPts = Number(alt.pointsStr);
      if (alt.pointsStr.trim() === "" || !Number.isFinite(altPts) || altPts < 0) {
        setError(
          `Alternate answer ${alt.choice} points must be a non-negative number.`,
        );
        return;
      }
      parsedAlts.push({ choice: alt.choice, points: altPts });
    }

    onSave({
      entry: selectedChoices.join("+"),
      primaryPoints: parsedPrimaryNum,
      rule: {
        ...(parsedAlts.length > 0 ? { alternateAnswers: parsedAlts } : {}),
        ...(incorrectEnabled ? { incorrectPoints: parsedIncorrectNum } : {}),
        ...(draftTags.length > 0 ? { tags: draftTags } : {}),
      },
    });
  }

  const disabledReason =
    selectedChoices.length === 0
      ? "Select at least one primary choice"
      : (altConflictError ?? primaryPtsError ?? incorrectPtsError ?? undefined);

  return (
    <Dialog
      open={open}
      title={`Question ${questionNumber ?? ""}, ${activeVersionLabel}`}
      hideFooter
      onClose={onClose}
    >
      <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
        <div className="flex items-center justify-between rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-3 py-2 text-xs">
          <span className="text-[var(--text-secondary)]">
            Maximum possible credit
          </span>
          <span className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">
            {formatPointsValue(maxPts)} pt{maxPts === 1 ? "" : "s"}
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[0.8125rem] font-medium text-[var(--text-primary)]">
              Primary answer
            </span>
            <div className="flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="detail-primary-pts"
                  className="text-xs text-[var(--text-secondary)]"
                >
                  Points
                </label>
                <TextInput
                  id="detail-primary-pts"
                  type="number"
                  step="0.25"
                  min="0"
                  inputSize="sm"
                  hasError={Boolean(primaryTouched && primaryPtsError)}
                  value={draftPrimaryPts}
                  onBlur={() => setPrimaryTouched(true)}
                  onChange={(e) => setDraftPrimaryPts(e.target.value)}
                  className="w-20 font-mono tabular-nums"
                />
              </div>
              {primaryTouched && primaryPtsError && (
                <span className="text-[0.6875rem] text-[var(--danger)]">
                  {primaryPtsError}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {ANSWER_CHOICES.map((ch) => {
              const active = selectedChoices.includes(ch);
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => togglePrimaryChoice(ch)}
                  aria-pressed={active}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border text-[0.8125rem] font-semibold transition-colors ${
                    active
                      ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                      : "border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--brand)]"
                  }`}
                >
                  {ch}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2 border-t border-[var(--border-hairline)] pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[0.8125rem] font-medium text-[var(--text-primary)]">
              Alternate or partial credit answers
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={unusedChoices.length === 0}
              onClick={addAlternateRow}
            >
              Add answer
            </Button>
          </div>
          {alternates.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              No alternate partial-credit choices added.
            </p>
          ) : (
            <div className="space-y-2">
              {alternates.map((alt) => (
                <div key={alt.id} className="flex items-center gap-2">
                  <SelectInput
                    selectSize="sm"
                    value={alt.choice}
                    onChange={(e) => {
                      setAlternates((prev) =>
                        prev.map((row) =>
                          row.id === alt.id
                            ? { ...row, choice: e.target.value }
                            : row,
                        ),
                      );
                      if (error) setError(null);
                    }}
                    className="w-24"
                    aria-label="Alternate choice"
                  >
                    {ANSWER_CHOICES.map((ch) => {
                      const takenByPrimary = selectedChoices.includes(ch);
                      const takenByOtherAlt = alternates.some(
                        (other) => other.id !== alt.id && other.choice === ch,
                      );
                      return (
                        <option
                          key={ch}
                          value={ch}
                          disabled={takenByPrimary || takenByOtherAlt}
                        >
                          {ch}
                        </option>
                      );
                    })}
                  </SelectInput>
                  <TextInput
                    type="number"
                    step="0.25"
                    min="0"
                    inputSize="sm"
                    value={alt.pointsStr}
                    onChange={(e) => {
                      setAlternates((prev) =>
                        prev.map((row) =>
                          row.id === alt.id
                            ? { ...row, pointsStr: e.target.value }
                            : row,
                        ),
                      );
                      if (error) setError(null);
                    }}
                    className="w-24 font-mono tabular-nums"
                    aria-label="Alternate points"
                  />
                  <span className="text-xs text-[var(--text-muted)]">
                    pts
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setAlternates((prev) =>
                        prev.filter((row) => row.id !== alt.id),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-[var(--border-hairline)] pt-3">
          {!incorrectEnabled ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setIncorrectEnabled(true);
                setIncorrectTouched(false);
              }}
            >
              Add attempted incorrect points
            </Button>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-hairline)] p-2.5">
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-[var(--text-primary)]">
                  Attempted, incorrect answer
                </p>
                <p className="text-[0.6875rem] text-[var(--text-muted)]">
                  Award points or penalty when marked wrong (blank stays 0).
                </p>
                {incorrectTouched && incorrectPtsError && (
                  <p className="text-[0.6875rem] text-[var(--danger)]">
                    {incorrectPtsError}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <TextInput
                  type="number"
                  step="0.25"
                  inputSize="sm"
                  hasError={Boolean(incorrectTouched && incorrectPtsError)}
                  value={incorrectPtsStr}
                  onBlur={() => setIncorrectTouched(true)}
                  onChange={(e) => setIncorrectPtsStr(e.target.value)}
                  className="w-20 font-mono tabular-nums"
                  aria-label="Attempted incorrect points"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIncorrectEnabled(false)}
                >
                  Remove
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border-hairline)] pt-3">
          <FormField id="detail-question-tags" label="Question tags">
            <TagInput
              id="detail-question-tags"
              tags={draftTags}
              onChange={setDraftTags}
              suggestions={tagSuggestions}
              placeholder="e.g. osmosis, cells"
            />
          </FormField>
          <p className="mt-1 text-[0.6875rem] text-[var(--text-muted)]">
            Used to group questions inside the Tags tab.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 bg-[var(--danger-bg)] px-3 py-2 text-[0.8125rem] text-[var(--danger-text)]">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-hairline)] pt-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={Boolean(disabledReason)}
            disabledReason={disabledReason}
            onClick={handleConfirm}
          >
            Apply to {activeVersionLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
