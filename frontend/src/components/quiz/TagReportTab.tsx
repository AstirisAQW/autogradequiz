"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { DocumentIcon } from "@/components/ui/Icons";
import { formatPointsValue } from "@/lib/scoring";
import { computeTagReport, type TagPerformanceRow } from "@/lib/tagReport";
import type { Paper, Quiz } from "@/lib/workspace";

interface TagReportTabProps {
  quiz: Quiz;
  batchPapers: Paper[];
  allPapers: Paper[];
  hasMultipleBatches: boolean;
  onGoToAnswerKey?: () => void;
}

export function TagReportTab({
  quiz,
  batchPapers,
  allPapers,
  hasMultipleBatches,
  onGoToAnswerKey,
}: TagReportTabProps) {
  const [scope, setScope] = useState<"batch" | "all">("all");
  const effectiveScope = hasMultipleBatches ? scope : "all";
  const activePapers = effectiveScope === "all" ? allPapers : batchPapers;

  const report = useMemo(
    () => computeTagReport(quiz, activePapers),
    [quiz, activePapers],
  );

  const columns: DataTableColumn<TagPerformanceRow>[] = [
    {
      key: "tag",
      header: "Tag",
      render: (row) => (
        <span className="inline-flex rounded-full bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--text-primary)]">
          #{row.tag}
        </span>
      ),
    },
    {
      key: "questions",
      header: "Questions",
      render: (row) => (
        <span className="text-[13px] text-[var(--text-secondary)]">
          {row.questionNumbers.map((n) => `Q${n}`).join(", ")}{" "}
          <span className="text-[11px] text-[var(--text-muted)]">
            ({row.questionCount})
          </span>
        </span>
      ),
    },
    {
      key: "points",
      header: "Points Earned / Possible",
      align: "right",
      render: (row) =>
        row.gradedPaperCount > 0 ? (
          <span className="font-mono text-[13px] tabular-nums">
            {formatPointsValue(row.earnedPoints)} /{" "}
            {formatPointsValue(row.possiblePoints)}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        ),
    },
    {
      key: "avgPct",
      header: "Class Average",
      align: "right",
      render: (row) =>
        row.gradedPaperCount > 0 ? (
          <span
            className={`font-mono font-medium tabular-nums ${
              row.avgPct >= 70
                ? "text-[var(--success-text)]"
                : row.avgPct < 55
                  ? "text-[var(--danger-text)]"
                  : "text-[var(--warning-text)]"
            }`}
          >
            {row.avgPct.toFixed(1)}%
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        ),
    },
    {
      key: "proficient",
      header: "Proficient (≥70%)",
      align: "right",
      render: (row) =>
        row.gradedPaperCount > 0 ? (
          <span className="font-mono text-[13px] tabular-nums">
            {row.proficientCount} / {row.gradedPaperCount}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[14px] font-medium text-[var(--text-primary)]">
            Topic & Question Tag Report ({report.tags.length} tag
            {report.tags.length === 1 ? "" : "s"})
          </p>
          <p className="text-[12px] text-[var(--text-muted)]">
            Performance aggregated across questions sharing each tag (based on{" "}
            {report.gradedPaperCount} graded paper
            {report.gradedPaperCount === 1 ? "" : "s"}).
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

      {report.tags.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon />}
          title="No question tags configured"
          description="Open Answer key and click the (i) info button next to any question to assign topic or standard tags."
          action={
            onGoToAnswerKey ? (
              <Button variant="primary" onClick={onGoToAnswerKey}>
                Edit Answer key
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          rows={report.tags}
          columns={columns}
          rowKey={(row) => row.tag}
        />
      )}
    </div>
  );
}
