"use client";

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

  function fillCycle() {
    onChangeEntries(
      Array.from(
        { length: questionCount },
        (_, idx) => CHOICES[idx % CHOICES.length],
      ),
    );
  }

  return (
    <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          Tap one or more bubbles per question (e.g. A+B); click pt to adjust
          weight
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChangePoints(Array(questionCount).fill(1))}
            className="min-h-[32px] rounded-[6px] border border-[var(--border-strong)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
          >
            All 1pt
          </button>
          <button
            type="button"
            onClick={() => onChangePoints(Array(questionCount).fill(2))}
            className="min-h-[32px] rounded-[6px] border border-[var(--border-strong)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
          >
            All 2pt
          </button>
          {onOpenBulkPoints && (
            <button
              type="button"
              onClick={onOpenBulkPoints}
              className="min-h-[32px] rounded-[6px] border border-[var(--border-strong)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
            >
              Set all points…
            </button>
          )}
          <button
            type="button"
            onClick={fillCycle}
            className="min-h-[32px] rounded-[6px] border border-[var(--border-strong)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
          >
            Fill A–E
          </button>
          <button
            type="button"
            onClick={() => onChangeEntries(Array(questionCount).fill(""))}
            className="min-h-[32px] rounded-[6px] border border-[var(--border-strong)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(295px,335px))] gap-x-8 gap-y-4">
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
                  className="flex items-center justify-start gap-2 rounded px-1.5 py-0.5 hover:bg-zinc-100"
                >
                  <span className="w-7 shrink-0 text-right font-mono text-xs font-medium text-[var(--text-secondary)] tabular-nums">
                    {qIdx + 1}.
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {CHOICES.map((choice) => {
                      const active = selected.includes(choice);
                      return (
                        <button
                          key={choice}
                          type="button"
                          onClick={() => toggleChoice(qIdx, choice)}
                          aria-label={`Question ${qIdx + 1} choice ${choice}`}
                          aria-pressed={active}
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
                            active
                              ? "border-emerald-800 bg-emerald-800 text-white"
                              : "border-zinc-300 bg-white text-zinc-800 hover:border-emerald-700"
                          }`}
                        >
                          {choice}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => cyclePoint(qIdx)}
                      aria-label={`Question ${qIdx + 1} point weight: ${formattedPt} point${pt === 1 ? "" : "s"}. Click to cycle.`}
                      title="Click to cycle point value (1, 2, 0)"
                      className={`ml-0.5 min-h-[32px] min-w-[38px] shrink-0 rounded px-1.5 py-1 text-center font-mono text-[11px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
                        pt === 0
                          ? "bg-zinc-200 text-zinc-600"
                          : pt > 1
                            ? "bg-emerald-100 text-emerald-900"
                            : pt < 1
                              ? "bg-sky-100 text-sky-900"
                              : "text-zinc-600 hover:bg-zinc-200"
                      }`}
                    >
                      {formattedPt}pt
                    </button>
                    {onOpenDetail && (
                      <button
                        type="button"
                        onClick={() => onOpenDetail(qIdx)}
                        aria-label={`Question ${qIdx + 1} details, alternate answers, and tags`}
                        title="Edit partial credit, penalty, and tags"
                        className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
                          hasRule
                            ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                            : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
                        }`}
                      >
                        i
                        {hasRule && (
                          <span
                            aria-hidden="true"
                            className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-600"
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
