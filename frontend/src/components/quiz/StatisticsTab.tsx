"use client";

import { useMemo, type ReactNode } from "react";
import { ConfirmationGate } from "@/components/quiz/ConfirmationGate";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { downloadTableCsv, slugifyFilename } from "@/lib/csvExport";
import { computeQuizStatistics } from "@/lib/quizStatistics";
import { formatPointsValue } from "@/lib/scoring";
import type { Paper, Quiz } from "@/lib/workspace";

const MIN_CONFIRMED_FOR_STATS = 2;

interface StatisticsTabProps {
  quiz: Quiz;
  papers: Paper[];
  provisionalBanner?: ReactNode;
  onGoToPapers?: () => void;
  onUploadPapers?: () => void;
}

function fmtEarnedTotal(val: number | null, total: number | null): string {
  if (val === null || total === null) return "—";
  return `${formatPointsValue(val)} / ${formatPointsValue(total)} pts`;
}

function fmtPts(val: number | null): string {
  if (val === null) return "—";
  return `${formatPointsValue(val)} pts`;
}

function fmtPct(val: number | null): string {
  if (val === null) return "—";
  return `${val.toFixed(1)}%`;
}

export function StatisticsTab({
  quiz,
  papers,
  provisionalBanner,
  onGoToPapers,
  onUploadPapers,
}: StatisticsTabProps) {
  const matchingPapers = useMemo(
    () =>
      papers.filter((p) => p.answers.length === quiz.answerKey.length),
    [papers, quiz.answerKey.length],
  );
  const confirmedCount = useMemo(
    () => matchingPapers.filter((p) => !p.needsReview).length,
    [matchingPapers],
  );
  const unconfirmedCount = matchingPapers.length - confirmedCount;

  const stats = useMemo(
    () => computeQuizStatistics(quiz, papers),
    [quiz, papers],
  );

  const metricRows = [
    {
      label: "Minimum score",
      points: fmtEarnedTotal(stats.minPoints, stats.totalPossiblePoints),
      pct: fmtPct(stats.minPct),
    },
    {
      label: "Maximum score",
      points: fmtEarnedTotal(stats.maxPoints, stats.totalPossiblePoints),
      pct: fmtPct(stats.maxPct),
    },
    {
      label: "Average score",
      points: fmtEarnedTotal(stats.avgPoints, stats.totalPossiblePoints),
      pct: fmtPct(stats.avgPct),
    },
    {
      label: "Median score",
      points: fmtEarnedTotal(stats.medianPoints, stats.totalPossiblePoints),
      pct: fmtPct(stats.medianPct),
    },
    {
      label: "Standard deviation",
      points: fmtPts(stats.stdDevPoints),
      pct: fmtPct(stats.stdDevPct),
    },
  ];

  function handleExportTable() {
    if (stats.count === 0) return;
    const slug = slugifyFilename(quiz.name);
    downloadTableCsv(
      `${slug}-statistics.csv`,
      ["Metric", "Points", "Percent"],
      metricRows.map((r) => [r.label, r.points, r.pct]),
    );
  }

  if (confirmedCount < MIN_CONFIRMED_FOR_STATS) {
    const statusDescription =
      matchingPapers.length === 0
        ? "No papers scanned yet. Upload answer sheets to start building quiz statistics."
        : unconfirmedCount > 0
          ? `${confirmedCount} of ${matchingPapers.length} ${matchingPapers.length === 1 ? "paper is" : "papers are"} confirmed and ${unconfirmedCount} ${unconfirmedCount === 1 ? "needs" : "need"} review. Statistics appear once ${MIN_CONFIRMED_FOR_STATS} papers are confirmed.`
          : "1 confirmed paper scanned. Upload 1 more paper to compute averages, spread, and score bands.";

    return (
      <ConfirmationGate
        title={`Statistics need at least ${MIN_CONFIRMED_FOR_STATS} confirmed papers`}
        description={statusDescription}
        confirmed={confirmedCount}
        needed={MIN_CONFIRMED_FOR_STATS}
        unconfirmedCount={unconfirmedCount}
        quizId={quiz.id}
        onUploadPapers={onUploadPapers}
        onGoToPapers={onGoToPapers}
      />
    );
  }

  return (
    <div className="space-y-4">
      {unconfirmedCount > 0 && provisionalBanner}

      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={handleExportTable}>
          Export this table
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card padded={false} className="overflow-hidden">
            <table className="w-full border-collapse text-sm">
              <thead className="border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)] text-xs font-semibold text-[var(--text-secondary)]">
                <tr>
                  <th className="px-4 py-2.5 text-left">Metric</th>
                  <th className="px-4 py-2.5 text-right">Points</th>
                  <th className="px-4 py-2.5 text-right">Percent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-hairline)]">
                {metricRows.map((row) => (
                  <tr key={row.label}>
                    <td className="px-4 py-3 text-[var(--text-primary)]">
                      {row.label}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-primary)]">
                      {row.points}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--text-primary)]">
                      {row.pct}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <h2>Score distribution (10-point bands)</h2>
            <div className="mt-3 space-y-2.5">
              {stats.buckets.map((bucket) => (
                <div key={bucket.label} className="space-y-1">
                  <div className="flex items-center justify-between text-[0.8125rem]">
                    <span className="text-[var(--text-primary)] tabular-nums">
                      {bucket.label}
                    </span>
                    <span className="text-[var(--text-secondary)] tabular-nums">
                      {bucket.count} {bucket.count === 1 ? "paper" : "papers"} (
                      {bucket.pctOfClass.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                    <div
                      className="h-full rounded-full bg-[var(--brand)] transition-[width]"
                      style={{
                        width: `${bucket.count > 0 ? Math.max(bucket.pctOfClass, 4) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
    </div>
  );
}
