"use client";

import { SlidersIcon } from "@/components/ui/Icons";
import { formatPointsValue } from "@/lib/scoring";
import type { QuestionRule } from "@/lib/workspace";

const CHOICES = ["A", "B", "C", "D", "E"] as const;
const POINT_OPTIONS = [1, 2, 0] as const;

interface AnswerKeyGridProps {
  questionCount: number;
  entries: string[];
  points: number[];
  questionRules?: QuestionRule[];
  onChangeEntries: (nextEntries: string[]) => void;
  onChangePoints: (nextPoints: number[]) => void;
  onOpenDetail?: (questionIndex: number) => void;
  onOpenBulkPoints?: () => void;
}

function columnsForCount(questionCount: number): number[][] {
  const rowsPerCol = questionCount === 20 ? 10 : 20;
  const cols: number[][] = [];
  for (let start = 0; start < questionCount; start += rowsPerCol) {
    const end = Math.min(start + rowsPerCol, questionCount);
    cols.push(Array.from({ length: end - start }, (_, i) => start + i));
  }
  return cols;
}

export function AnswerKeyGrid({
  questionCount,
  entries,
  points,
  questionRules,
  onChangeEntries,
  onChangePoints,
  onOpenDetail,
  onOpenBulkPoints,
}: AnswerKeyGridProps) {
  const columns = columnsForCount(questionCount);

  function toggleChoice(index: number, choice: string) {
    const current = (entries[index] ?? "").split("+").filter(Boolean);
    const has = current.includes(choice);
    const nextChoices = has
      ? current.filter((c) => c !== choice)
      : [...current, choice];
    nextChoices.sort(
      (a, b) =>
        CHOICES.indexOf(a as (typeof CHOICES)[number]) -
        CHOICES.indexOf(b as (typeof CHOICES)[number]),
    );
    const next = Array.from({ length: questionCount }, (_, i) =>
      i === index ? nextChoices.join("+") : (entries[i] ?? ""),
    );
    onChangeEntries(next);
  }

  function cyclePoint(index: number) {
    const curr = points[index] ?? 1;
    const pos = POINT_OPTIONS.indexOf(curr as (typeof POINT_OPTIONS)[number]);
    const nextVal = POINT_OPTIONS[(pos + 1) % POINT_OPTIONS.length];
    const next = Array.from({ length: questionCount }, (_, i) =>
      i === index ? nextVal : (points[i] ?? 1),
    );
    onChangePoints(next);
  }

  return (
    <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-2.5 sm:p-3.5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          Tap bubbles per question (multiple for A+B). Select any point button
          to cycle 1, 2, or 0 pts.
        </span>
        {onOpenBulkPoints && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenBulkPoints}
              className="min-h-8 rounded-md border border-[var(--border-strong)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
            >
              Set all points
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-x-8 gap-y-4">
        {columns.map((indices, colIdx) => (
          <div key={colIdx} className="min-w-0 space-y-1.5">
            {indices.map((qIdx) => {
              const selected = (entries[qIdx] ?? "").split("+").filter(Boolean);
              const pt = points[qIdx] ?? 1;
              const rule = questionRules?.[qIdx];
              const hasRule = Boolean(
                rule &&
                  ((rule.alternateAnswers?.length ?? 0) > 0 ||
                    rule.incorrectPoints !== undefined ||
                    (rule.tags?.length ?? 0) > 0),
              );
              const formattedPt = formatPointsValue(pt);
              return (
                <div
                  key={qIdx}
                  className="group flex items-center justify-between gap-1.5 rounded-lg px-1 py-1 hover:bg-white/80 sm:gap-2 sm:px-1.5"
                >
                  <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                    <span className="w-6 shrink-0 text-right font-mono text-xs font-semibold text-[var(--text-secondary)] tabular-nums sm:w-7">
                      Q{qIdx + 1}
                    </span>
                    <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
                      {CHOICES.map((choice) => {
                        const active = selected.includes(choice);
                        return (
                          <button
                            key={choice}
                            type="button"
                            onClick={() => toggleChoice(qIdx, choice)}
                            aria-label={`Question ${qIdx + 1} choice ${choice}`}
                            aria-pressed={active}
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] sm:h-8 sm:w-8 ${
                              active
                                ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                                : "border-[var(--border-strong)] bg-white text-[var(--text-primary)] hover:border-[var(--brand)]"
                            }`}
                          >
                            {choice}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
                    <button
                      type="button"
                      onClick={() => cyclePoint(qIdx)}
                      aria-label={`Question ${qIdx + 1} point weight: ${formattedPt} point${pt === 1 ? "" : "s"}. Click to cycle.`}
                      title="Click to cycle point value (1, 2, 0)"
                      className={`min-h-8 min-w-9 shrink-0 cursor-pointer rounded-md border px-1.5 py-1 text-center font-mono text-[0.6875rem] font-semibold tabular-nums shadow-[0_1px_0_rgb(0_0_0/0.04)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] sm:min-w-11 sm:px-2 ${
                        pt === 0
                          ? "border-zinc-300 bg-zinc-200 text-zinc-700 hover:border-zinc-400"
                          : pt > 1
                            ? "border-emerald-300 bg-emerald-100 text-emerald-900 hover:border-emerald-400"
                            : pt < 1
                              ? "border-sky-300 bg-sky-100 text-sky-900 hover:border-sky-400"
                              : "border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--brand)] hover:bg-[var(--brand-subtle)]/50"
                      }`}
                    >
                      {formattedPt} pt
                    </button>
                    {onOpenDetail && (
                      <button
                        type="button"
                        onClick={() => onOpenDetail(qIdx)}
                        aria-label={`Question ${qIdx + 1} details, alternate answers, and tags`}
                        title="Question details, alternate answers, and tags"
                        className={`relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] sm:h-8 sm:w-8 ${
                          hasRule
                            ? "border-[var(--brand)] bg-[var(--brand-subtle)] text-[var(--brand-text)] opacity-100"
                            : "border-[var(--border-hairline)] bg-white text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        <SlidersIcon />
                        {hasRule && (
                          <span
                            aria-hidden="true"
                            className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--brand)]"
                          />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
