"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectInput } from "@/components/ui/Field";
import { DocumentIcon } from "@/components/ui/Icons";
import { StatCard } from "@/components/ui/StatCard";
import { computeItemAnalysis } from "@/lib/itemAnalysis";
import { ANSWER_CHOICES } from "@/lib/types";
import {
  getAvailableKeyVersions,
  type KeyVersionId,
  type Paper,
  type Quiz,
} from "@/lib/workspace";

type SortMode = "question" | "hardest" | "easiest";

export interface ItemAnalysisTabProps {
  quiz: Quiz;
  batchPapers: Paper[];
  allPapers: Paper[];
  hasMultipleBatches: boolean;
}

export function ItemAnalysisTab({
  quiz,
  batchPapers,
  allPapers,
  hasMultipleBatches,
}: ItemAnalysisTabProps) {
  const [scope, setScope] = useState<"batch" | "all">("batch");
  const [sortBy, setSortBy] = useState<SortMode>("question");
  const [keyVersionFilter, setKeyVersionFilter] = useState<string>("all");

  const availableVersions = useMemo(
    () => getAvailableKeyVersions(quiz),
    [quiz],
  );
  const effectiveKeyFilter =
    keyVersionFilter !== "all" &&
    availableVersions.includes(keyVersionFilter as KeyVersionId)
      ? (keyVersionFilter as KeyVersionId)
      : undefined;

  const activePapers =
    hasMultipleBatches && scope === "all" ? allPapers : batchPapers;

  const analysis = useMemo(
    () =>
      computeItemAnalysis(
        quiz,
        activePapers,
        effectiveKeyFilter ? { keyVersion: effectiveKeyFilter } : undefined,
      ),
    [quiz, activePapers, effectiveKeyFilter],
  );

  const sortedQuestions = useMemo(() => {
    const items = [...analysis.questions];
    if (sortBy === "hardest") {
      items.sort(
        (a, b) =>
          a.correctPct - b.correctPct || a.questionNumber - b.questionNumber,
      );
    } else if (sortBy === "easiest") {
      items.sort(
        (a, b) =>
          b.correctPct - a.correctPct || a.questionNumber - b.questionNumber,
      );
    }
    return items;
  }, [analysis.questions, sortBy]);

  const hasMultiMarks = analysis.questions.some(
    (q) => q.choiceCounts.Multiple > 0,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {hasMultipleBatches && (
            <div
              role="group"
              aria-label="Analysis scope"
              className="inline-flex rounded-[8px] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-0.5 text-[12px] font-medium"
            >
              <button
                type="button"
                aria-pressed={scope === "batch"}
                onClick={() => setScope("batch")}
                className={`rounded-[6px] px-3 py-1 transition-colors ${
                  scope === "batch"
                    ? "bg-[var(--brand)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Current batch
              </button>
              <button
                type="button"
                aria-pressed={scope === "all"}
                onClick={() => setScope("all")}
                className={`rounded-[6px] px-3 py-1 transition-colors ${
                  scope === "all"
                    ? "bg-[var(--brand)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                All batches
              </button>
            </div>
          )}
          <span className="text-[12px] text-[var(--text-muted)]">
            {analysis.gradedPaperCount} graded paper
            {analysis.gradedPaperCount === 1 ? "" : "s"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {availableVersions.length > 1 && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="item-analysis-key-version"
                className="text-[12px] font-medium text-[var(--text-secondary)]"
              >
                Key
              </label>
              <SelectInput
                id="item-analysis-key-version"
                selectSize="sm"
                value={keyVersionFilter}
                onChange={(e) => setKeyVersionFilter(e.target.value)}
                className="!w-auto"
              >
                <option value="all">All versions</option>
                {availableVersions.map((ver) => (
                  <option key={ver} value={ver}>
                    Key {ver}
                  </option>
                ))}
              </SelectInput>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label
              htmlFor="item-analysis-sort"
              className="text-[12px] font-medium text-[var(--text-secondary)]"
            >
              Sort
            </label>
            <SelectInput
              id="item-analysis-sort"
              selectSize="sm"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortMode)}
              className="!w-auto"
            >
              <option value="question">Question #</option>
              <option value="hardest">Hardest first</option>
              <option value="easiest">Easiest first</option>
            </SelectInput>
          </div>
        </div>
      </div>

      {analysis.gradedPaperCount === 0 ? (
        <EmptyState
          icon={<DocumentIcon />}
          title="No graded papers yet"
          description="Grade at least one paper to view per-question accuracy and choice distributions."
        />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Graded papers" value={analysis.gradedPaperCount} />
            <StatCard
              label="Hardest question"
              value={
                analysis.hardestQuestion
                  ? `Q${analysis.hardestQuestion.questionNumber}`
                  : "—"
              }
              hint={
                analysis.hardestQuestion
                  ? `${analysis.hardestQuestion.correctPct.toFixed(1)}% correct`
                  : undefined
              }
            />
            <StatCard
              label="Easiest question"
              value={
                analysis.easiestQuestion
                  ? `Q${analysis.easiestQuestion.questionNumber}`
                  : "—"
              }
              hint={
                analysis.easiestQuestion
                  ? `${analysis.easiestQuestion.correctPct.toFixed(1)}% correct`
                  : undefined
              }
            />
          </div>

          <Card padded={false} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)]/60 text-[12px] font-medium text-[var(--text-secondary)]">
                    <th className="px-4 py-2.5">Q#</th>
                    <th className="px-3 py-2.5">Key</th>
                    <th className="min-w-[160px] px-3 py-2.5">% Correct</th>
                    {ANSWER_CHOICES.map((ch) => (
                      <th key={ch} className="px-3 py-2.5 text-right">
                        {ch}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right">Blank</th>
                    {hasMultiMarks && (
                      <th className="px-3 py-2.5 text-right">Multi</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-hairline)]">
                  {sortedQuestions.map((item) => {
                    const accepted = item.correctKey
                      .split("+")
                      .filter(Boolean);
                    const barColor =
                      item.correctPct >= 75
                        ? "bg-[var(--brand)]"
                        : item.correctPct >= 50
                          ? "bg-amber-500"
                          : "bg-[var(--danger)]";
                    return (
                      <tr
                        key={item.questionNumber}
                        className="hover:bg-[var(--bg-subtle)]/40"
                      >
                        <td className="px-4 py-2.5 font-mono font-medium text-[var(--text-primary)] tabular-nums">
                          <span>Q{item.questionNumber}</span>
                          {item.flaggedCount > 0 && (
                            <span
                              title={`${item.flaggedCount} unresolved flagged mark${item.flaggedCount === 1 ? "" : "s"}`}
                              className="ml-1.5 rounded bg-[var(--warning-bg)] px-1 py-0.5 font-sans text-[10px] font-medium text-[var(--warning-text)]"
                            >
                              {item.flaggedCount} flagged
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono font-semibold text-[var(--brand-text)]">
                          {item.correctKey === "Per key" ? (
                            <span className="font-sans text-[11px] font-medium text-[var(--text-muted)]">
                              Per key
                            </span>
                          ) : (
                            item.correctKey
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                              <div
                                className={`h-full rounded-full ${barColor}`}
                                style={{ width: `${item.correctPct}%` }}
                              />
                            </div>
                            <span className="w-12 text-right font-mono text-[12px] text-[var(--text-primary)] tabular-nums">
                              {item.correctPct.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        {ANSWER_CHOICES.map((ch) => {
                          const isKeyChoice = accepted.includes(ch);
                          const count = item.choiceCounts[ch];
                          return (
                            <td
                              key={ch}
                              className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                                isKeyChoice
                                  ? "bg-[var(--brand)]/10 font-semibold text-[var(--brand-text)]"
                                  : "text-[var(--text-secondary)]"
                              }`}
                            >
                              {count}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5 text-right font-mono text-[var(--text-secondary)] tabular-nums">
                          {item.choiceCounts.Blank}
                        </td>
                        {hasMultiMarks && (
                          <td className="px-3 py-2.5 text-right font-mono text-[var(--text-secondary)] tabular-nums">
                            {item.choiceCounts.Multiple}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
