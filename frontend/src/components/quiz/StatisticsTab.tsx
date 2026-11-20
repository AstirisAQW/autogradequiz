"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { DocumentIcon } from "@/components/ui/Icons";
import { formatPointsValue } from "@/lib/scoring";
import { computeQuizStatistics } from "@/lib/statistics";
import type { Paper, Quiz } from "@/lib/workspace";

interface StatisticsTabProps {
  quiz: Quiz;
  batchPapers: Paper[];
  allPapers: Paper[];
  hasMultipleBatches: boolean;
  onGoToPapers?: () => void;
}

function fmtPoints(val: number | null): string {
  if (val === null) return "—";
  return formatPointsValue(val);
}

function fmtPct(val: number | null): string {
  if (val === null) return "—";
  return `${val.toFixed(1)}%`;
}

export function StatisticsTab({
  quiz,
  batchPapers,
  allPapers,
  hasMultipleBatches,
  onGoToPapers,
}: StatisticsTabProps) {
  const [scope, setScope] = useState<"batch" | "all">("all");
  const effectiveScope = hasMultipleBatches ? scope : "all";
  const activePapers = effectiveScope === "all" ? allPapers : batchPapers;

  const stats = useMemo(
    () => computeQuizStatistics(quiz, activePapers),
    [quiz, activePapers],
  );

  const metricRows = [
    {
      label: "Minimum Score",
      points: fmtPoints(stats.minPoints),
      pct: fmtPct(stats.minPct),
    },
    {
      label: "Maximum Score",
      points: fmtPoints(stats.maxPoints),
      pct: fmtPct(stats.maxPct),
    },
    {
      label: "Average Score",
      points: fmtPoints(stats.avgPoints),
      pct: fmtPct(stats.avgPct),
    },
    {
      label: "Median Score",
      points: fmtPoints(stats.medianPoints),
      pct: fmtPct(stats.medianPct),
    },
    {
      label: "Standard Deviation",
      points: fmtPoints(stats.stdDevPoints),
      pct: fmtPct(stats.stdDevPct),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[14px] font-medium text-[var(--text-primary)]">
            Quiz Statistics ({stats.count} graded paper
            {stats.count === 1 ? "" : "s"})
          </p>
          <p className="text-[12px] text-[var(--text-muted)]">
            Includes resolved reviews, custom question weights, partial credit,
            and active key versions.
          </p>
        </div>

        {hasMultipleBatches && (
          <div className="inline-flex rounded-[8px] border border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-0.5 text-[12px]">
            <button
              type="button"
              onClick={() => setScope("batch")}
              className={`rounded-[6px] px-2.5 py-1 font-medium transition-colors ${
                effectiveScope === "batch"
                  ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Current batch
            </button>
            <button
              type="button"
              onClick={() => setScope("all")}
              className={`rounded-[6px] px-2.5 py-1 font-medium transition-colors ${
                effectiveScope === "all"
                  ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              All batches
            </button>
          </div>
        )}
      </div>

      {stats.count === 0 ? (
        <EmptyState
          icon={<DocumentIcon />}
          title="No graded papers yet"
          description="Upload and grade answer sheets in the Papers tab to compute class statistics."
          action={
            onGoToPapers ? (
              <Button variant="primary" onClick={onGoToPapers}>
                Go to Papers
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card padded={false} className="overflow-hidden">
            <div className="border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-4 py-2.5">
              <h2 className="text-[13px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                Score Summary
              </h2>
            </div>
            <table className="w-full border-collapse text-[14px]">
              <thead className="border-b border-[var(--border-hairline)] text-[12px] uppercase tracking-wide text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Metric</th>
                  <th className="px-4 py-2 text-right font-medium">Points</th>
                  <th className="px-4 py-2 text-right font-medium">Percent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-hairline)]">
                {metricRows.map((row) => (
                  <tr key={row.label}>
                    <td className="px-4 py-2.5 text-[var(--text-primary)]">
                      {row.label}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-primary)]">
                      {row.points}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-medium tabular-nums text-[var(--brand-text)]">
                      {row.pct}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <h2 className="text-[14px] font-medium text-[var(--text-primary)]">
              Score Distribution
            </h2>
            <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
              Share of graded papers by percentage band
            </p>
            <div className="mt-4 space-y-3">
              {stats.buckets.map((bucket) => (
                <div key={bucket.label} className="space-y-1">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-medium text-[var(--text-primary)] tabular-nums">
                      {bucket.label}
                    </span>
                    <span className="font-mono text-[12px] text-[var(--text-secondary)] tabular-nums">
                      {bucket.count} paper{bucket.count === 1 ? "" : "s"} (
                      {bucket.pctOfClass.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                    <div
                      className="h-full rounded-full bg-[var(--brand)] transition-[width]"
                      style={{
                        width: `${Math.max(bucket.pctOfClass, bucket.count > 0 ? 4 : 0)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
