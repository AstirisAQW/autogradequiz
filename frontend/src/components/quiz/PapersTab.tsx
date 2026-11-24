"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PaperInspectionDrawer } from "@/components/quiz/PaperInspectionDrawer";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { Dropzone } from "@/components/ui/Dropzone";
import { EmptyState } from "@/components/ui/EmptyState";
import { DocumentIcon } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";
import { getErrorMessage } from "@/lib/api";
import { formatPointsValue } from "@/lib/scoring";
import {
  computePaperPoints,
  deletePaper,
  gradeQuizPaper,
  notifyWorkspaceChanged,
  type Paper,
  type Quiz,
} from "@/lib/workspace";

interface UploadProgressRow {
  localId: string;
  file: File;
  paperId?: string;
  phase: "grading" | "done" | "failed";
  progressPct: number;
  statusText: string;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function getPaperDisplayName(paper: Pick<Paper, "nameText">): string {
  return paper.nameText || "Unnamed paper";
}

function formatPaperSubline(
  paper: Pick<Paper, "studentIdText" | "keyVersion">,
): string {
  return [
    paper.studentIdText ? `ID ${paper.studentIdText}` : "Unlinked",
    `key ${paper.keyVersion ?? "A"}`,
  ].join(", ");
}

export interface PapersTabProps {
  quiz: Quiz;
  papers: Paper[];
  keyUnset?: boolean;
  onGoToAnswerKey?: () => void;
  onReload: () => Promise<void>;
}

export function PapersTab({
  quiz,
  papers,
  keyUnset = false,
  onGoToAnswerKey,
  onReload,
}: PapersTabProps) {
  const router = useRouter();
  const { push: pushToast } = useToast();
  const [uploads, setUploads] = useState<UploadProgressRow[]>([]);
  const [uploading, setUploading] = useState(false);

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const regradeInputRef = useRef<HTMLInputElement | null>(null);
  const [regradeTarget, setRegradeTarget] = useState<Paper | null>(null);
  const [regradeConfirmTarget, setRegradeConfirmTarget] =
    useState<Paper | null>(null);
  const [regradingId, setRegradingId] = useState<string | null>(null);

  const [deletePaperTarget, setDeletePaperTarget] = useState<Paper | null>(
    null,
  );
  const [deletingPaper, setDeletingPaper] = useState(false);

  const [inspectedPaperId, setInspectedPaperId] = useState<string | null>(null);
  const [imageCacheKey, setImageCacheKey] = useState(0);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const paperParam = new URLSearchParams(window.location.search).get(
          "paper_id",
        );
        if (paperParam && papers.some((p) => p.id === paperParam)) {
          setInspectedPaperId(paperParam);
        }
      } catch {
      }
    });
  }, [papers]);

  const sortedPapers = useMemo(
    () =>
      [...papers].sort(
        (a, b) => Number(Boolean(b.needsReview)) - Number(Boolean(a.needsReview)),
      ),
    [papers],
  );

  const paperById = useMemo(
    () => new Map(papers.map((p) => [p.id, p])),
    [papers],
  );

  const pointsByPaperId = useMemo(
    () => new Map(papers.map((p) => [p.id, computePaperPoints(quiz, p)])),
    [quiz, papers],
  );

  async function gradeOneUploadRow(
    localId: string,
    file: File,
    notify = true,
  ): Promise<boolean> {
    try {
      const saved = await gradeQuizPaper(quiz.id, file, undefined, { notify });
      setUploads((prev) =>
        prev.map((r) =>
          r.localId === localId
            ? {
                ...r,
                paperId: saved.id,
                phase: "done",
                progressPct: 100,
                statusText: "Done",
              }
            : r,
        ),
      );
      return true;
    } catch (err) {
      const message = getErrorMessage(err, "Grading failed.");
      setUploads((prev) =>
        prev.map((r) =>
          r.localId === localId
            ? {
                ...r,
                phase: "failed",
                progressPct: 100,
                statusText: message,
              }
            : r,
        ),
      );
      return false;
    }
  }

  async function handleFilesSelected(files: File[]) {
    if (uploading || keyUnset) return;
    const validFiles: File[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        pushToast(`${file.name} exceeds the 10 MB limit.`, "error");
      } else {
        validFiles.push(file);
      }
    }
    if (validFiles.length === 0) return;

    const initialRows: UploadProgressRow[] = validFiles.map((file, idx) => ({
      localId: `${Date.now()}-${idx}-${file.name}`,
      file,
      phase: "grading",
      progressPct: 45,
      statusText: "Grading...",
    }));
    setUploads((prev) => [...initialRows, ...prev]);
    setUploading(true);

    let anySucceeded = false;
    let nextIdx = 0;
    const workerCount = Math.min(2, validFiles.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIdx < validFiles.length) {
          const i = nextIdx;
          nextIdx += 1;
          if (
            await gradeOneUploadRow(initialRows[i].localId, validFiles[i], false)
          ) {
            anySucceeded = true;
          }
        }
      }),
    );

    setUploading(false);
    setImageCacheKey((k) => k + 1);
    if (anySucceeded) {
      notifyWorkspaceChanged();
    }
    await onReload();
  }

  async function handleRetryUpload(row: UploadProgressRow) {
    if (uploading) return;
    setUploading(true);
    setUploads((prev) =>
      prev.map((r) =>
        r.localId === row.localId
          ? {
              ...r,
              phase: "grading",
              progressPct: 45,
              statusText: "Retrying...",
            }
          : r,
      ),
    );
    await gradeOneUploadRow(row.localId, row.file);
    setUploading(false);
    setImageCacheKey((k) => k + 1);
    await onReload();
  }

  function requestRescan(paper: Paper) {
    if (regradingId !== null) return;
    if (Object.keys(paper.corrections).length > 0) {
      setRegradeConfirmTarget(paper);
      return;
    }
    setRegradeTarget(paper);
    regradeInputRef.current?.click();
  }

  async function handleRegradeFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = e.target.files?.[0];
    if (regradeInputRef.current) regradeInputRef.current.value = "";
    const target = regradeTarget;
    setRegradeTarget(null);
    if (!file || !target || regradingId !== null) return;

    setRegradingId(target.id);
    try {
      await gradeQuizPaper(quiz.id, file, target.id);
      setImageCacheKey((k) => k + 1);
      await onReload();
      pushToast(`Re-scanned ${getPaperDisplayName(target)}.`, "success");
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not grade scan."), "error");
    } finally {
      setRegradingId(null);
    }
  }

  async function handleDeletePaperConfirm() {
    if (!deletePaperTarget || deletingPaper) return;
    setDeletingPaper(true);
    try {
      const target = deletePaperTarget;
      await deletePaper(quiz.id, target.id);
      setDeletePaperTarget(null);
      if (inspectedPaperId === target.id) setInspectedPaperId(null);
      await onReload();
      pushToast(`Deleted paper for ${getPaperDisplayName(target)}.`, "success");
    } catch (err) {
      pushToast(getErrorMessage(err, "Could not delete paper."), "error");
    } finally {
      setDeletingPaper(false);
    }
  }

  function handleSelectPaperRow(paper: Paper) {
    if (paper.needsReview) {
      router.push(`/review?quiz_id=${quiz.id}&paper_id=${paper.id}`);
    } else {
      setInspectedPaperId(paper.id);
    }
  }

  const columns: DataTableColumn<Paper>[] = [
    {
      key: "student",
      header: "Student",
      render: (row) => (
        <div>
          <div className="font-semibold text-[var(--text-primary)]">
            {getPaperDisplayName(row)}
          </div>
          <div className="text-xs text-[var(--text-secondary)] tabular-nums">
            {formatPaperSubline(row)}
          </div>
        </div>
      ),
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      render: (row) => {
        const pts = pointsByPaperId.get(row.id) ?? computePaperPoints(quiz, row);
        return (
          <span className="inline-flex flex-wrap items-baseline justify-end gap-1.5 tabular-nums">
            <span className="font-bold text-[var(--text-primary)]">
              {formatPointsValue(pts.earnedPoints)} /{" "}
              {formatPointsValue(pts.totalPoints)} pts
            </span>
            <span className="text-[0.8125rem] text-[var(--text-secondary)]">
              ({row.score.toFixed(1)}%)
            </span>
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) =>
        row.needsReview ? (
          <span className="text-[0.8125rem] font-medium text-[var(--warning-text)]">
            Needs review
          </span>
        ) : (
          <span className="text-[0.8125rem] font-medium text-[var(--success-text)]">
            Confirmed
          </span>
        ),
    },
  ];

  function renderPaperActions(row: Paper) {
    return (
      <>
        {row.needsReview && (
          <Link
            href={`/review?quiz_id=${quiz.id}&paper_id=${row.id}`}
            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 py-2 text-[0.8125rem] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)] [@media(pointer:coarse)]:min-h-12"
          >
            Review
          </Link>
        )}
        <ActionMenu
          label={`Actions for ${row.nameText || "paper"}`}
          items={[
            row.needsReview
              ? {
                  id: "review",
                  label: "Review flagged",
                  href: `/review?quiz_id=${quiz.id}&paper_id=${row.id}`,
                }
              : {
                  id: "view",
                  label: "View scan",
                  onClick: () => setInspectedPaperId(row.id),
                },
            {
              id: "rescan",
              label: "Re-scan sheet",
              onClick: () => requestRescan(row),
            },
            { kind: "divider", id: "div-1" },
            {
              id: "delete",
              label: "Delete paper",
              variant: "danger",
              onClick: () => setDeletePaperTarget(row),
            },
          ]}
        />
      </>
    );
  }

  const inspectedPaper = inspectedPaperId
    ? (paperById.get(inspectedPaperId) ?? null)
    : null;

  return (
    <div
      className="space-y-4"
      onDragOver={(e) => {
        if (!keyUnset && papers.length > 0) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!keyUnset && papers.length > 0 && e.dataTransfer.files?.length) {
          e.preventDefault();
          void handleFilesSelected(Array.from(e.dataTransfer.files));
        }
      }}
    >
      <input
        id="papers-upload-input"
        ref={uploadInputRef}
        type="file"
        accept="image/png,image/jpeg"
        multiple
        disabled={uploading}
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          if (uploadInputRef.current) uploadInputRef.current.value = "";
          if (files.length > 0) void handleFilesSelected(files);
        }}
        className="sr-only"
      />
      <input
        ref={regradeInputRef}
        type="file"
        accept="image/png,image/jpeg"
        onChange={(e) => void handleRegradeFileChange(e)}
        className="sr-only"
      />

      {uploads.length > 0 && (
        <Card
          padded={false}
          className="divide-y divide-[var(--border-hairline)]"
        >
          {uploads.map((row) => {
            const savedPaper = row.paperId
              ? paperById.get(row.paperId)
              : undefined;
            const effectivePhase =
              savedPaper && row.phase !== "grading" ? "done" : row.phase;
            const effectiveStatusText =
              savedPaper && row.phase !== "grading" ? "Done" : row.statusText;
            const effectivePct =
              effectivePhase === "done" || effectivePhase === "failed"
                ? 100
                : row.progressPct;
            return (
              <div
                key={row.localId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-[var(--text-primary)]">
                      {row.file.name}
                    </span>
                    <span
                      className={
                        effectivePhase === "failed"
                          ? "text-[var(--danger)]"
                          : effectivePhase === "done"
                            ? "text-[var(--success)]"
                            : "text-[var(--text-secondary)]"
                      }
                    >
                      {effectiveStatusText}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                    <div
                      className={`h-full transition-all duration-300 ${
                        effectivePhase === "failed"
                          ? "bg-[var(--danger)]"
                          : "bg-[var(--brand)]"
                      }`}
                      style={{ width: `${effectivePct}%` }}
                    />
                  </div>
                </div>
                {effectivePhase === "failed" && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={uploading}
                    onClick={() => void handleRetryUpload(row)}
                  >
                    Retry
                  </Button>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {papers.length === 0 ? (
        keyUnset ? (
          <EmptyState
            icon={<DocumentIcon />}
            title="Set the answer key first"
            description="Papers cannot be graded until this quiz has a saved answer key."
            action={
              onGoToAnswerKey ? (
                <Button variant="primary" onClick={onGoToAnswerKey}>
                  Open answer key
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Dropzone
            accept="image/png,image/jpeg"
            multiple
            disabled={uploading}
            disabledReason={
              uploading ? "Wait for current uploads to finish" : undefined
            }
            label="Drop PNG or JPEG papers here to grade"
            hint="Or select Upload papers above, up to 10 MB each"
            onFiles={(files) => void handleFilesSelected(files)}
          />
        )
      ) : (
        <>
          <ul className="divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] sm:hidden">
            {sortedPapers.map((row) => {
              const pts =
                pointsByPaperId.get(row.id) ?? computePaperPoints(quiz, row);
              return (
                <li
                  key={row.id}
                  onClick={(e) => {
                    const target = e.target as HTMLElement | null;
                    if (
                      target?.closest(
                        'button, a, input, select, [data-stop-row="true"]',
                      )
                    ) {
                      return;
                    }
                    handleSelectPaperRow(row);
                  }}
                  className="cursor-pointer space-y-2.5 px-4 py-3.5 transition-colors hover:bg-black/[0.02]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-[var(--text-primary)]">
                        {getPaperDisplayName(row)}
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] tabular-nums">
                        {formatPaperSubline(row)}
                      </div>
                    </div>
                    {row.needsReview ? (
                      <span className="shrink-0 text-[0.8125rem] font-medium text-[var(--warning-text)]">
                        Needs review
                      </span>
                    ) : (
                      <span className="shrink-0 text-[0.8125rem] font-medium text-[var(--success-text)]">
                        Confirmed
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm tabular-nums">
                      <span className="font-bold text-[var(--text-primary)]">
                        {formatPointsValue(pts.earnedPoints)} /{" "}
                        {formatPointsValue(pts.totalPoints)} pts
                      </span>{" "}
                      <span className="text-[0.8125rem] text-[var(--text-secondary)]">
                        ({row.score.toFixed(1)}%)
                      </span>
                    </span>
                    <div
                      data-stop-row="true"
                      className="inline-flex shrink-0 items-center justify-end gap-2"
                    >
                      {renderPaperActions(row)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden sm:block">
            <DataTable
              rows={sortedPapers}
              columns={columns}
              rowKey={(row) => row.id}
              tableClassName="table-fixed min-w-[680px]"
              actionsHeaderSrOnly
              colgroup={
                <colgroup>
                  <col />
                  <col style={{ width: "170px" }} />
                  <col style={{ width: "130px" }} />
                  <col style={{ width: "176px" }} />
                </colgroup>
              }
              onRowClick={handleSelectPaperRow}
              renderActions={renderPaperActions}
            />
          </div>
        </>
      )}

      <Dialog
        open={deletePaperTarget !== null}
        title="Delete graded paper?"
        description={
          deletePaperTarget
            ? `This permanently deletes ${getPaperDisplayName(deletePaperTarget)} and its scan images from this folder.`
            : "This permanently deletes the paper and its scan images from this folder."
        }
        confirmLabel="Delete paper"
        confirmVariant="danger"
        busy={deletingPaper}
        onConfirm={() => void handleDeletePaperConfirm()}
        onClose={() => setDeletePaperTarget(null)}
      />

      <PaperInspectionDrawer
        key={inspectedPaper?.id ?? "closed"}
        quiz={quiz}
        paper={inspectedPaper}
        points={
          inspectedPaper ? pointsByPaperId.get(inspectedPaper.id) : undefined
        }
        imageCacheKey={imageCacheKey}
        regradingId={regradingId}
        guardClosing={regradeConfirmTarget !== null}
        onRequestRescan={requestRescan}
        onReload={onReload}
        onClose={() => setInspectedPaperId(null)}
      />

      <Dialog
        open={regradeConfirmTarget !== null}
        title="Re-scan and clear manual fixes?"
        description={(() => {
          const count = regradeConfirmTarget
            ? Object.keys(regradeConfirmTarget.corrections).length
            : 0;
          return `Re-scanning ${regradeConfirmTarget?.nameText || "this paper"} will clear ${count} manual review ${count === 1 ? "correction" : "corrections"}.`;
        })()}
        confirmLabel="Choose scan"
        confirmVariant="danger"
        onConfirm={() => {
          const target = regradeConfirmTarget;
          setRegradeConfirmTarget(null);
          if (!target) return;
          setRegradeTarget(target);
          regradeInputRef.current?.click();
        }}
        onClose={() => setRegradeConfirmTarget(null)}
      />
    </div>
  );
}
