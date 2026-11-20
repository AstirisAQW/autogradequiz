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
  }

  function addAlternateRow() {
    const unused =
      ANSWER_CHOICES.find(
        (c) =>
          !selectedChoices.includes(c) &&
          !alternates.some((alt) => alt.choice === c),
      ) ?? ANSWER_CHOICES[0];
    setAlternates((prev) => [
      ...prev,
      { id: nextAltId, choice: unused, pointsStr: "0.5" },
    ]);
    setNextAltId((n) => n + 1);
  }

  const parsedPrimaryNum = Number(draftPrimaryPts);
  const maxPts = Math.max(
    Number.isFinite(parsedPrimaryNum) && parsedPrimaryNum >= 0
      ? parsedPrimaryNum
      : 0,
    ...alternates.map((alt) => {
      const val = Number(alt.pointsStr);
      return Number.isFinite(val) && val >= 0 ? val : 0;
    }),
  );

  function handleConfirm() {
    setError(null);
    if (selectedChoices.length === 0) {
      setError("Select at least one primary answer choice (A–E).");
      return;
    }
    const pts = Number(draftPrimaryPts);
    if (!Number.isFinite(pts) || pts < 0) {
      setError("Primary points must be a non-negative number.");
      return;
    }

    const parsedAlts: { choice: string; points: number }[] = [];
    for (const alt of alternates) {
      const altPts = Number(alt.pointsStr);
      if (!Number.isFinite(altPts) || altPts < 0) {
        setError(
          `Alternate answer ${alt.choice} points must be a non-negative number.`,
        );
        return;
      }
      parsedAlts.push({ choice: alt.choice, points: altPts });
    }

    let parsedIncorrect: number | undefined;
    if (incorrectEnabled) {
      const val = Number(incorrectPtsStr);
      if (!Number.isFinite(val)) {
        setError("Attempted-incorrect points must be a valid number.");
        return;
      }
      parsedIncorrect = val;
    }

    onSave({
      entry: selectedChoices.join("+"),
      primaryPoints: pts,
      rule: {
        ...(parsedAlts.length > 0 ? { alternateAnswers: parsedAlts } : {}),
        ...(parsedIncorrect !== undefined
          ? { incorrectPoints: parsedIncorrect }
          : {}),
        ...(draftTags.length > 0 ? { tags: draftTags } : {}),
      },
    });
  }

  return (
    <Dialog
      open={open}
      title={`Question ${questionNumber ?? ""} · ${activeVersionLabel}`}
      confirmLabel="Apply"
      onConfirm={handleConfirm}
      onClose={onClose}
    >
      <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
        <div className="flex items-center justify-between rounded-[8px] border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-3 py-2 text-[12px]">
          <span className="text-[var(--text-secondary)]">
            Maximum possible credit
          </span>
          <span className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">
            {formatPointsValue(maxPts)} pt{maxPts === 1 ? "" : "s"}
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              Primary Answer
            </span>
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="detail-primary-pts"
                className="text-[12px] text-[var(--text-secondary)]"
              >
                Pts:
              </label>
              <TextInput
                id="detail-primary-pts"
                type="number"
                step="0.25"
                min="0"
                inputSize="sm"
                value={draftPrimaryPts}
                onChange={(e) => setDraftPrimaryPts(e.target.value)}
                className="w-20 font-mono tabular-nums"
              />
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
                  className={`flex h-9 w-9 items-center justify-center rounded-full border text-[13px] font-semibold transition-colors ${
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
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              Alternate / Partial Credit Answers
            </span>
            <Button variant="secondary" size="sm" onClick={addAlternateRow}>
              + Add Answer
            </Button>
          </div>
          {alternates.length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)]">
              No alternate partial-credit choices added.
            </p>
          ) : (
            <div className="space-y-2">
              {alternates.map((alt) => (
                <div key={alt.id} className="flex items-center gap-2">
                  <SelectInput
                    selectSize="sm"
                    value={alt.choice}
                    onChange={(e) =>
                      setAlternates((prev) =>
                        prev.map((row) =>
                          row.id === alt.id
                            ? { ...row, choice: e.target.value }
                            : row,
                        ),
                      )
                    }
                    className="w-24"
                    aria-label="Alternate choice"
                  >
                    {ANSWER_CHOICES.map((ch) => (
                      <option key={ch} value={ch}>
                        {ch}
                      </option>
                    ))}
                  </SelectInput>
                  <TextInput
                    type="number"
                    step="0.25"
                    min="0"
                    inputSize="sm"
                    value={alt.pointsStr}
                    onChange={(e) =>
                      setAlternates((prev) =>
                        prev.map((row) =>
                          row.id === alt.id
                            ? { ...row, pointsStr: e.target.value }
                            : row,
                        ),
                      )
                    }
                    className="w-24 font-mono tabular-nums"
                    aria-label="Alternate points"
                  />
                  <span className="text-[12px] text-[var(--text-muted)]">
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
              onClick={() => setIncorrectEnabled(true)}
            >
              + Attempted, but Incorrect
            </Button>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[var(--border-hairline)] p-2.5">
              <div className="space-y-0.5">
                <p className="text-[12px] font-medium text-[var(--text-primary)]">
                  Attempted, but Incorrect
                </p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Award partial points or penalty when marked wrong (blank stays
                  0).
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <TextInput
                  type="number"
                  step="0.25"
                  inputSize="sm"
                  value={incorrectPtsStr}
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
          <FormField id="detail-question-tags" label="Question Tags">
            <TagInput
              id="detail-question-tags"
              tags={draftTags}
              onChange={setDraftTags}
              suggestions={tagSuggestions}
              placeholder="e.g. Algebra, Standard 4.2"
            />
          </FormField>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Used to group questions inside the Tag report tab.
          </p>
        </div>

        {error && (
          <div className="rounded-[8px] border border-red-300 bg-[var(--danger-bg)] px-3 py-2 text-[13px] text-[var(--danger-text)]">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
