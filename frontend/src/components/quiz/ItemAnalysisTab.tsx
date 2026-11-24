"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ConfirmationGate } from "@/components/quiz/ConfirmationGate";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SelectInput } from "@/components/ui/Field";
import { ChevronDownIcon } from "@/components/ui/Icons";
import { downloadTableCsv, slugifyFilename } from "@/lib/csvExport";
import {
  computeItemAnalysis,
  summarizeQuestionResponse,
  type ChoiceDistribution,
} from "@/lib/itemAnalysis";
import { ANSWER_CHOICES } from "@/lib/types";
import {
  getAvailableKeyVersions,
  resolveQuizKeyForVersion,
  type KeyVersionId,
  type Paper,
  type Quiz,
} from "@/lib/workspace";

type SortMode = "hardest" | "easiest" | "question";

const MIN_CONFIRMED_FOR_ANALYSIS = 5;

export interface ItemAnalysisTabProps {
  quiz: Quiz;
  papers: Paper[];
  provisionalBanner?: ReactNode;
  onUploadPapers?: () => void;
}

export function ItemAnalysisTab({
  quiz,
  papers,
  provisionalBanner,
  onUploadPapers,
}: ItemAnalysisTabProps) {
  const [sortBy, setSortBy] = useState<SortMode>("hardest");
  const [keyVersionFilter, setKeyVersionFilter] = useState<string>("all");
  const [showAll, setShowAll] = useState(false);
  const [expandedQuestions, setExpandedQuestions] = useState<
    Record<number, boolean>
  >({});

  const availableVersions = useMemo(
    () => getAvailableKeyVersions(quiz),
    [quiz],
  );
  const effectiveKeyFilter =
    keyVersionFilter !== "all" &&
    availableVersions.includes(keyVersionFilter as KeyVersionId)
      ? (keyVersionFilter as KeyVersionId)
      : undefined;

  const matchingPapers = useMemo(
    () =>
      papers.filter((p) => {
        if (p.answers.length !== quiz.answerKey.length) {
          return false;
        }
        if (effectiveKeyFilter) {
          return (
            resolveQuizKeyForVersion(quiz, p.keyVersion).version ===
            effectiveKeyFilter
          );
        }
        return true;
      }),
    [papers, quiz, effectiveKeyFilter],
  );

  const confirmedCount = useMemo(
    () => matchingPapers.filter((p) => !p.needsReview).length,
    [matchingPapers],
  );
  const unconfirmedCount = matchingPapers.length - confirmedCount;

  const analysis = useMemo(
    () =>
      computeItemAnalysis(
        quiz,
        papers,
        effectiveKeyFilter ? { keyVersion: effectiveKeyFilter } : undefined,
      ),
    [quiz, papers, effectiveKeyFilter],
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

  const effectiveShowAll = showAll || sortBy !== "hardest";
  const visibleQuestions = effectiveShowAll
    ? sortedQuestions
    : sortedQuestions.slice(0, 5);

  const hasMultiMarks = analysis.questions.some(
    (q) => q.choiceCounts.Multiple > 0,
  );

  function toggleQuestion(questionNumber: number) {
    setExpandedQuestions((prev) => ({
      ...prev,
      [questionNumber]: !prev[questionNumber],
    }));
  }

  function handleExportTable() {
    if (analysis.gradedPaperCount === 0) return;
    const slug = slugifyFilename(quiz.name);
    const headers = [
      "Question",
      "Key",
      "Correct",
      ...(analysis.gradedPaperCount >= 4 ? ["Discrimination"] : []),
      ...ANSWER_CHOICES,
      "Blank",
      ...(hasMultiMarks ? ["Multi"] : []),
    ];
    const rows = sortedQuestions.map((item) => [
      `Q${item.questionNumber}`,
      item.correctKey,
      `${item.correctCount} of ${analysis.gradedPaperCount} (${item.correctPct.toFixed(0)}%)`,
      ...(analysis.gradedPaperCount >= 4
        ? [
            item.discriminationIndex !== null
              ? item.discriminationIndex.toFixed(2)
              : "",
          ]
        : []),
      ...ANSWER_CHOICES.map((ch) => item.choiceCounts[ch]),
      item.choiceCounts.Blank,
      ...(hasMultiMarks ? [item.choiceCounts.Multiple] : []),
    ]);
    downloadTableCsv(`${slug}-item-analysis.csv`, headers, rows);
  }

  if (confirmedCount < MIN_CONFIRMED_FOR_ANALYSIS) {
    const remainingToUnlock = MIN_CONFIRMED_FOR_ANALYSIS - confirmedCount;
    const statusDescription =
      matchingPapers.length === 0
        ? "No papers scanned yet. Upload answer sheets to start building question analysis."
        : unconfirmedCount > 0
          ? `${confirmedCount} of ${matchingPapers.length} ${matchingPapers.length === 1 ? "paper is" : "papers are"} confirmed and ${unconfirmedCount} ${unconfirmedCount === 1 ? "needs" : "need"} review. Item breakdown appears once ${MIN_CONFIRMED_FOR_ANALYSIS} papers are confirmed.`
          : `${confirmedCount} confirmed ${confirmedCount === 1 ? "paper" : "papers"} scanned. Upload ${remainingToUnlock} more to reveal reliable question patterns.`;

    return (
      <div className="space-y-4">
        {availableVersions.length > 1 && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="item-analysis-key-version"
              className="text-xs font-medium text-[var(--text-secondary)]"
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

        <ConfirmationGate
          title={`Item analysis needs at least ${MIN_CONFIRMED_FOR_ANALYSIS} confirmed papers`}
          description={statusDescription}
          confirmed={confirmedCount}
          needed={MIN_CONFIRMED_FOR_ANALYSIS}
          unconfirmedCount={unconfirmedCount}
          quizId={quiz.id}
          onUploadPapers={onUploadPapers}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {unconfirmedCount > 0 && provisionalBanner}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {availableVersions.length > 1 && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="item-analysis-key-version"
                className="text-xs font-medium text-[var(--text-secondary)]"
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
              className="text-xs font-medium text-[var(--text-secondary)]"
            >
              Sort by
            </label>
            <SelectInput
              id="item-analysis-sort"
              selectSize="sm"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortMode)}
              className="!w-auto"
            >
              <option value="hardest">Hardest first</option>
              <option value="easiest">Easiest first</option>
              <option value="question">Question number</option>
            </SelectInput>
          </div>

          <span className="text-xs text-[var(--text-secondary)] tabular-nums">
            {effectiveShowAll || sortedQuestions.length <= 5
              ? `Showing all ${sortedQuestions.length} questions`
              : `Showing 5 hardest of ${sortedQuestions.length}`}
          </span>
        </div>

        <Button variant="secondary" size="sm" onClick={handleExportTable}>
          Export this table
        </Button>
      </div>

      <Card padded={false} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)] text-xs font-semibold text-[var(--text-secondary)]">
                <th className="px-4 py-2.5 whitespace-nowrap">Question</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Key</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">
                  Correct
                </th>
                <th className="px-4 py-2.5 whitespace-nowrap">
                  Response pattern
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-hairline)]">
              {visibleQuestions.map((item) => {
                const accepted =
                  item.correctKey === "Per key"
                    ? []
                    : item.correctKey.split("+").filter(Boolean);
                const isLow = item.correctPct < 50;
                const isExpanded = Boolean(
                  expandedQuestions[item.questionNumber],
                );
                const summary = summarizeQuestionResponse(
                  item,
                  analysis.gradedPaperCount,
                );
                const detailBuckets: Array<{
                  key: keyof ChoiceDistribution;
                  label: string;
                  isKeyChoice: boolean;
                }> = [
                  ...ANSWER_CHOICES.map((ch) => ({
                    key: ch as keyof ChoiceDistribution,
                    label: ch,
                    isKeyChoice: accepted.includes(ch),
                  })),
                  { key: "Blank", label: "Blank", isKeyChoice: false },
                  ...(item.choiceCounts.Multiple > 0
                    ? [
                        {
                          key: "Multiple" as const,
                          label: "Multi",
                          isKeyChoice: false,
                        },
                      ]
                    : []),
                ];

                return (
                  <Fragment key={item.questionNumber}>
                    <tr
                      onClick={(e) => {
                        if ((e.target as HTMLElement)?.closest("button, a")) {
                          return;
                        }
                        toggleQuestion(item.questionNumber);
                      }}
                      className="cursor-pointer transition-colors hover:bg-black/[0.02]"
                    >
                      <td className="px-4 py-3 font-semibold text-[var(--text-primary)] tabular-nums">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => toggleQuestion(item.questionNumber)}
                          className="inline-flex items-center gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
                        >
                          <span
                            className={`inline-flex shrink-0 text-[var(--text-muted)] transition-transform ${
                              isExpanded ? "rotate-0" : "-rotate-90"
                            }`}
                          >
                            <ChevronDownIcon />
                          </span>
                          <span>Q{item.questionNumber}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3 font-bold text-[var(--text-primary)]">
                        {item.correctKey === "Per key" ? (
                          <span className="text-xs font-medium text-[var(--text-muted)]">
                            Per key
                          </span>
                        ) : (
                          item.correctKey
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                        <span className="font-semibold text-[var(--text-primary)]">
                          {item.correctPct.toFixed(0)}%
                        </span>
                        {isLow && (
                          <span className="ml-1.5 inline-block rounded-md bg-[var(--warning-bg)] px-1.5 py-0.5 text-[0.6875rem] font-semibold text-[var(--warning-text)]">
                            Low
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)] tabular-nums">
                        {summary}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-[var(--bg-subtle)]/50">
                        <td colSpan={4} className="px-4 py-3.5">
                          <div className="space-y-3">
                            <p className="text-xs font-medium text-[var(--text-secondary)] tabular-nums">
                              Correct: {item.correctCount} of{" "}
                              {analysis.gradedPaperCount} papers (
                              {item.correctPct.toFixed(0)}%)
                              {item.discriminationIndex !== null && (
                                <>
                                  {" "}
                                  | Discrimination:{" "}
                                  {item.discriminationIndex > 0 ? "+" : ""}
                                  {item.discriminationIndex.toFixed(2)} (
                                  {item.discriminationIndex >= 0.3
                                    ? "Strong"
                                    : item.discriminationIndex >= 0.15
                                      ? "Moderate"
                                      : item.discriminationIndex >= 0
                                        ? "Weak"
                                        : "Negative"}
                                  )
                                </>
                              )}
                            </p>
                            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-7">
                              {detailBuckets.map((bucket) => {
                                const count = item.choiceCounts[bucket.key];
                                const widthPct =
                                  analysis.gradedPaperCount > 0 && count > 0
                                    ? Math.max(
                                        (count / analysis.gradedPaperCount) *
                                          100,
                                        6,
                                      )
                                    : 0;
                                return (
                                  <div
                                    key={bucket.key}
                                    className={`rounded-lg border px-2.5 py-2 ${
                                      bucket.isKeyChoice
                                        ? "border-[var(--brand)] bg-[var(--brand-subtle)]"
                                        : "border-[var(--border-hairline)] bg-[var(--bg-surface)]"
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-1 text-xs">
                                      <span
                                        className={
                                          bucket.isKeyChoice
                                            ? "font-bold text-[var(--brand-text)]"
                                            : "font-medium text-[var(--text-secondary)]"
                                        }
                                      >
                                        {bucket.label}
                                      </span>
                                      <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                                        {count}
                                      </span>
                                    </div>
                                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/[0.08]">
                                      <div
                                        className={`h-full rounded-full ${
                                          bucket.isKeyChoice
                                            ? "bg-[var(--brand)]"
                                            : "bg-zinc-500"
                                        }`}
                                        style={{ width: `${widthPct}%` }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {sortedQuestions.length > 5 && sortBy === "hardest" && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll
              ? "Show hardest 5 only"
              : `Show all ${sortedQuestions.length} questions`}
          </Button>
        </div>
      )}
    </div>
  );
}
