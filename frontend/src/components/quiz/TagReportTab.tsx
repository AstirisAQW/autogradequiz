"use client";

import { useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { DocumentIcon } from "@/components/ui/Icons";
import { downloadTableCsv, slugifyFilename } from "@/lib/csvExport";
import { formatPointsValue } from "@/lib/scoring";
import { computeTagReport, type TagPerformanceRow } from "@/lib/tagReport";
import type { Paper, Quiz } from "@/lib/workspace";

interface TagReportTabProps {
  quiz: Quiz;
  papers: Paper[];
  provisionalBanner?: ReactNode;
  onGoToAnswerKey?: () => void;
}

export function TagReportTab({
  quiz,
  papers,
  provisionalBanner,
  onGoToAnswerKey,
}: TagReportTabProps) {
  const report = useMemo(() => computeTagReport(quiz, papers), [quiz, papers]);
  const unconfirmedCount = useMemo(
    () =>
      papers.filter(
        (p) =>
          p.answers.length === quiz.answerKey.length &&
          p.needsReview,
      ).length,
    [papers, quiz.answerKey.length],
  );

  function handleExportTable() {
    if (report.tags.length === 0 || report.gradedPaperCount === 0) return;
    const slug = slugifyFilename(quiz.name);
    downloadTableCsv(
      `${slug}-tags.csv`,
      [
        "Tag",
        "Questions",
        "Points earned, all papers",
        "Class average",
        "Proficient (70%+)",
      ],
      report.tags.map((r) => [
        `#${r.tag}`,
        r.questionNumbers.map((n) => `Q${n}`).join(", "),
        `${formatPointsValue(r.earnedPoints)} / ${formatPointsValue(r.possiblePoints)} pts`,
        `${r.avgPct.toFixed(1)}%`,
        `${r.proficientCount} / ${r.gradedPaperCount}`,
      ]),
    );
  }

  const columns: DataTableColumn<TagPerformanceRow>[] = [
    {
      key: "tag",
      header: "Tag",
      render: (row) => (
        <span className="font-semibold text-[var(--text-primary)]">
          #{row.tag}
        </span>
      ),
    },
    {
      key: "questions",
      header: "Questions",
      render: (row) => (
        <span className="text-[var(--text-secondary)] tabular-nums">
          {row.questionNumbers.map((n) => `Q${n}`).join(", ")}
        </span>
      ),
    },
    {
      key: "points",
      header: "Points earned, all papers",
      align: "right",
      render: (row) =>
        row.gradedPaperCount > 0 ? (
          <span className="tabular-nums">
            {formatPointsValue(row.earnedPoints)} /{" "}
            {formatPointsValue(row.possiblePoints)} pts
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        ),
    },
    {
      key: "avgPct",
      header: "Class average",
      align: "right",
      render: (row) =>
        row.gradedPaperCount > 0 ? (
          <span className="font-semibold tabular-nums">
            {row.avgPct.toFixed(1)}%
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        ),
    },
    {
      key: "proficient",
      header: "Proficient (70%+)",
      align: "right",
      render: (row) =>
        row.gradedPaperCount > 0 ? (
          <span className="tabular-nums">
            {row.proficientCount} / {row.gradedPaperCount}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        ),
    },
  ];

  const exportDisabled =
    report.tags.length === 0 || report.gradedPaperCount === 0;

  return (
    <div className="space-y-4">
      {report.tags.length > 0 && unconfirmedCount > 0 && provisionalBanner}

      {!exportDisabled && (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={handleExportTable}>
            Export this table
          </Button>
        </div>
      )}

      {report.tags.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon />}
          title="No question tags configured"
          description="Assign topic tags in the Answer key tab to track mastery by topic."
          nextStep="Open Answer key and select a question's settings icon to add tags."
          action={
            onGoToAnswerKey ? (
              <Button variant="primary" onClick={onGoToAnswerKey}>
                Open answer key
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
