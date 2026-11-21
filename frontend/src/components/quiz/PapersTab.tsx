"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { Drawer } from "@/components/ui/Drawer";
import { Dropzone } from "@/components/ui/Dropzone";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectInput } from "@/components/ui/Field";
import {
  GradedOverlayLegend,
  GradedSheetOverlay,
} from "@/components/ui/GradedSheetOverlay";
import { CloudUploadIcon } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";
import { ApiError, base64JpegToBlob, gradeSheet } from "@/lib/api";
import { shortId } from "@/lib/format";
import { formatPointsValue } from "@/lib/scoring";
import {
  addFailedPaper,
  addPaper,
  computePaperPoints,
  deletePaper,
  exportBatchCsv,
  getAvailableKeyVersions,
  getPaperImageUrl,
  getPaperSnapshot,
  replacePaperResult,
  resolveQuizKeyForVersion,
  restorePaperSnapshot,
  saveBatch,
  submitReview,
  type Batch,
  type KeyVersionId,
  type Paper,
  type Quiz,
} from "@/lib/workspace";

interface UploadProgressRow {
  localId: string;
  paperId?: string;
  fileName: string;
  phase: "grading" | "done" | "failed";
  progressPct: number;
  statusText: string;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface PapersTabProps {
  quiz: Quiz;
  activeBatch: Batch | null;
  sectionFilterId: string;
  papers: Paper[];
  dropzoneRef: React.RefObject<HTMLDivElement | null>;
  onBatchCreated: (batchId: string) => void;
  onReload: (preferredBatchId?: string | null) => Promise<void>;
}

export function PapersTab({
  quiz,
  activeBatch,
  sectionFilterId,
  papers,
  dropzoneRef,
  onBatchCreated,
  onReload,
}: PapersTabProps) {
  const { push: pushToast } = useToast();
  const [uploads, setUploads] = useState<UploadProgressRow[]>([]);
  const [uploading, setUploading] = useState(false);

  const regradeInputRef = useRef<HTMLInputElement | null>(null);
  const [regradeTarget, setRegradeTarget] = useState<Paper | null>(null);
  const [regradingId, setRegradingId] = useState<string | null>(null);

  const [deletePaperTarget, setDeletePaperTarget] = useState<Paper | null>(
    null,
  );
  const [deletingPaper, setDeletingPaper] = useState(false);

  const [viewScan, setViewScan] = useState<Paper | null>(null);
  const [viewImageUrl, setViewImageUrl] = useState<string | null>(null);
  const [viewOverlayMode, setViewOverlayMode] = useState<"graded" | "clean">(
    "graded",
  );
  const [updatingVersionId, setUpdatingVersionId] = useState<string | null>(
    null,
  );

  const availableKeyVersions = useMemo(
    () => getAvailableKeyVersions(quiz),
    [quiz],
  );
  const viewScanId = viewScan?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;
    if (!viewScanId) {
      queueMicrotask(() => {
        if (!cancelled) setViewImageUrl(null);
      });
      return;
    }
    getPaperImageUrl(viewScanId)
      .then((url) => {
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        currentUrl = url;
        setViewImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) setViewImageUrl(null);
      });
    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [viewScanId]);

  async function handleFilesSelected(files: File[]) {
    if (uploading) return;
    let targetBatchId = activeBatch?.id ?? null;

    if (targetBatchId === null) {
      try {
        const created = await saveBatch({
          quizId: quiz.id,
          sectionId: sectionFilterId || null,
        });
        targetBatchId = created.id;
        onBatchCreated(created.id);
      } catch (err) {
        pushToast(
          err instanceof Error ? err.message : "Could not create batch.",
          "error",
        );
        return;
      }
    }

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
      fileName: file.name,
      phase: "grading",
      progressPct: 45,
      statusText: "Grading…",
    }));
    setUploads((prev) => [...initialRows, ...prev]);
    setUploading(true);

    for (let i = 0; i < validFiles.length; i += 1) {
      const file = validFiles[i];
      const localId = initialRows[i].localId;
      const paperId = crypto.randomUUID();
      try {
        const graded = await gradeSheet({
          file,
          templateId: quiz.templateId,
          answerKey: quiz.answerKey,
          points: quiz.points,
          questionRules: quiz.questionRules,
          keyVersions: quiz.keyVersions,
          saveToWorkspace: true,
          quizId: quiz.id,
          quizName: quiz.name,
          paperId,
        });
        const blob = base64JpegToBlob(graded.aligned_image_jpeg_base64);
        const savedPaper = await addPaper(targetBatchId, graded, blob, {
          id: paperId,
        });
        setUploads((prev) =>
          prev.map((r) =>
            r.localId === localId
              ? {
                  ...r,
                  paperId: savedPaper.id,
                  phase: "done",
                  progressPct: 100,
                  statusText: "Done",
                }
              : r,
          ),
        );
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.detail
            : err instanceof Error
              ? err.message
              : "Grading failed.";
        const failedPaper = await addFailedPaper(targetBatchId, message).catch(
          () => null,
        );
        setUploads((prev) =>
          prev.map((r) =>
            r.localId === localId
              ? {
                  ...r,
                  paperId: failedPaper?.id,
                  phase: "failed",
                  progressPct: 100,
                  statusText: message,
                }
              : r,
          ),
        );
      }
    }

    setUploading(false);
    await onReload(targetBatchId);
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
      const graded = await gradeSheet({
        file,
        templateId: quiz.templateId,
        answerKey: quiz.answerKey,
        points: quiz.points,
        questionRules: quiz.questionRules,
        keyVersions: quiz.keyVersions,
        saveToWorkspace: true,
        quizId: quiz.id,
        quizName: quiz.name,
        paperId: target.id,
      });
      const blob = base64JpegToBlob(graded.aligned_image_jpeg_base64);
      await replacePaperResult(target.id, graded, blob);
      await onReload(activeBatch?.id ?? null);
      pushToast(`Graded paper #${shortId(target.id)}.`, "success");
    } catch (err) {
      pushToast(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Could not grade scan.",
        "error",
      );
    } finally {
      setRegradingId(null);
    }
  }

  async function handleDeletePaperConfirm() {
    if (!deletePaperTarget || deletingPaper) return;
    setDeletingPaper(true);
    try {
      const target = deletePaperTarget;
      const snapshot = await getPaperSnapshot(target.id);
      await deletePaper(target.id);
      setDeletePaperTarget(null);
      await onReload(activeBatch?.id ?? null);
      const label = target.nameText || `Scan #${shortId(target.id)}`;
      pushToast(
        `Deleted paper for ${label}.`,
        "info",
        snapshot
          ? {
              actionLabel: "Undo",
              onAction: async () => {
                try {
                  await restorePaperSnapshot(snapshot);
                  await onReload(activeBatch?.id ?? null);
                  pushToast(`Restored paper for ${label}.`, "success");
                } catch (err) {
                  pushToast(
                    err instanceof Error
                      ? err.message
                      : "Could not restore paper.",
                    "error",
                  );
                }
              },
            }
          : undefined,
      );
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not delete paper.",
        "error",
      );
    } finally {
      setDeletingPaper(false);
    }
  }

  async function handleExportBatchCsv() {
    if (!activeBatch) return;
    try {
      const blob = await exportBatchCsv(activeBatch.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${quiz.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "quiz"}-batch-${shortId(activeBatch.id)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not export CSV.",
        "error",
      );
    }
  }

  const paperById = useMemo(
    () => new Map(papers.map((p) => [p.id, p])),
    [papers],
  );

  async function handleChangeViewKeyVersion(
    paperId: string,
    nextVersion: KeyVersionId,
  ) {
    if (updatingVersionId !== null) return;
    setUpdatingVersionId(paperId);
    try {
      await submitReview(paperId, { keyVersion: nextVersion });
      await onReload(activeBatch?.id ?? null);
      pushToast("Key version updated and paper rescored.", "success");
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not update key version.",
        "error",
      );
    } finally {
      setUpdatingVersionId(null);
    }
  }

  const showKeyColumn =
    availableKeyVersions.length > 1 ||
    papers.some((p) => p.keyVersion !== undefined);

  const columns: DataTableColumn<Paper>[] = [
    {
      key: "student",
      header: "Student",
      render: (row) =>
        row.nameText ? (
          <span className="font-medium text-[var(--text-primary)]">
            {row.nameText}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">Unnamed</span>
        ),
    },
    {
      key: "studentId",
      header: "Student ID",
      render: (row) =>
        row.studentIdText ? (
          <span className="font-mono text-[12px] text-[var(--text-secondary)] tabular-nums">
            {row.studentIdText}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        ),
    },
    ...(showKeyColumn
      ? [
          {
            key: "keyVersion",
            header: "Key",
            render: (row: Paper) => {
              const kv = row.keyVersion ?? "A";
              const mismatch =
                row.detectedKeyVersion && row.detectedKeyVersion !== kv;
              return (
                <span
                  title={
                    mismatch
                      ? `Detected Key ${row.detectedKeyVersion} bubble; scored with Key ${kv}`
                      : undefined
                  }
                  className="inline-flex items-center gap-1 rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[12px] font-medium text-[var(--text-primary)]"
                >
                  {kv}
                </span>
              );
            },
          } satisfies DataTableColumn<Paper>,
        ]
      : []),
    {
      key: "score",
      header: "Score",
      align: "right",
      render: (row) => {
        if (row.status !== "done") {
          return <span className="text-[var(--text-muted)]">—</span>;
        }
        const pts = computePaperPoints(quiz, row);
        return (
          <span className="inline-flex flex-wrap items-center justify-end gap-1.5 font-mono tabular-nums">
            <span className="font-medium text-[var(--text-primary)]">
              {formatPointsValue(pts.earnedPoints)} /{" "}
              {formatPointsValue(pts.totalPoints)} pts
            </span>
            <span className="text-[12px] text-[var(--text-secondary)]">
              ({row.score.toFixed(1)}%)
            </span>
            {row.needsReview && (
              <span
                title="Provisional score until all flagged questions are resolved"
                className="rounded bg-[var(--warning-bg)] px-1.5 py-0.5 font-sans text-[11px] font-medium text-[var(--warning-text)]"
              >
                Provisional
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        if (row.status === "failed") {
          return (
            <span title={row.error || undefined}>
              <Badge variant="neutral">Failed</Badge>
            </span>
          );
        }
        return row.needsReview ? (
          <Badge variant="warning">Needs review</Badge>
        ) : (
          <Badge variant="success">Graded</Badge>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <input
        ref={regradeInputRef}
        type="file"
        accept="image/png,image/jpeg"
        onChange={(e) => void handleRegradeFileChange(e)}
        className="sr-only"
      />

      <div ref={dropzoneRef} className="space-y-3">
        <Dropzone
          accept="image/png,image/jpeg"
          multiple
          disabled={uploading}
          disabledReason={
            uploading ? "Wait for current uploads to finish" : undefined
          }
          label="Drop papers here or browse"
          hint="PNG or JPEG, up to 10 MB each"
          onFiles={(files) => void handleFilesSelected(files)}
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
                savedPaper && row.phase !== "grading"
                  ? savedPaper.status
                  : row.phase;
              const effectiveStatusText =
                savedPaper && row.phase !== "grading"
                  ? savedPaper.status === "done"
                    ? "Done"
                    : savedPaper.error || "Failed"
                  : row.statusText;
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
                    <div className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="truncate font-medium text-[var(--text-primary)]">
                        {row.fileName}
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
                </div>
              );
            })}
          </Card>
        )}
      </div>

      {papers.length === 0 ? (
        <EmptyState
          icon={<CloudUploadIcon />}
          title="No papers graded in this batch"
          description="Drop scanned PNG or JPEG answer sheets above to start grading."
        />
      ) : (
        <div className="space-y-3">
          <DataTable
            rows={papers}
            columns={columns}
            rowKey={(row) => row.id}
            renderActions={(row) => {
              if (row.status === "failed") {
                return (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={regradingId === row.id}
                      onClick={() => {
                        setRegradeTarget(row);
                        regradeInputRef.current?.click();
                      }}
                    >
                      {regradingId === row.id ? "Grading…" : "Grade now"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeletePaperTarget(row)}
                      className="text-[var(--danger)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
                    >
                      Delete
                    </Button>
                  </>
                );
              }
              if (row.needsReview) {
                return (
                  <>
                    <Link
                      href={`/review?paper_id=${row.id}`}
                      className="text-[12px] font-medium text-[var(--brand-text)] hover:underline"
                    >
                      Review →
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeletePaperTarget(row)}
                      className="text-[var(--danger)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
                    >
                      Delete
                    </Button>
                  </>
                );
              }
              return (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setViewScan(row)}
                  >
                    View
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeletePaperTarget(row)}
                    className="text-[var(--danger)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
                  >
                    Delete
                  </Button>
                </>
              );
            }}
          />

          <div className="flex justify-end">
            <Button
              variant="secondary"
              disabled={!activeBatch || papers.length === 0}
              disabledReason={
                !activeBatch || papers.length === 0
                  ? "Grade at least one paper to export CSV"
                  : undefined
              }
              onClick={() => void handleExportBatchCsv()}
            >
              Export CSV
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={deletePaperTarget !== null}
        title={`Delete paper for "${deletePaperTarget?.nameText || "Unnamed"}"?`}
        description={
          deletePaperTarget
            ? `This permanently removes Scan #${shortId(deletePaperTarget.id)} (student: ${deletePaperTarget.nameText || "Unnamed"}${deletePaperTarget.studentIdText ? `, ID: ${deletePaperTarget.studentIdText}` : ""}, score: ${deletePaperTarget.score.toFixed(1)}%) and its aligned scan image. You can undo immediately after deletion.`
            : "This permanently removes the aligned scan image and its graded score."
        }
        confirmLabel="Delete paper"
        confirmVariant="danger"
        busy={deletingPaper}
        onConfirm={() => void handleDeletePaperConfirm()}
        onClose={() => setDeletePaperTarget(null)}
      />

      {(() => {
        const currentViewScan = viewScan
          ? (paperById.get(viewScan.id) ?? viewScan)
          : null;
        const resolvedViewKey = currentViewScan
          ? resolveQuizKeyForVersion(quiz, currentViewScan.keyVersion)
          : null;

        return (
          <Drawer
            open={currentViewScan !== null}
            title={currentViewScan?.nameText || "Unnamed"}
            subtitle={
              currentViewScan
                ? (() => {
                    const pts = computePaperPoints(quiz, currentViewScan);
                    return `Score: ${formatPointsValue(pts.earnedPoints)} / ${formatPointsValue(pts.totalPoints)} pts (${currentViewScan.score.toFixed(1)}%)${currentViewScan.needsReview ? " · Provisional" : ""} · Scan #${shortId(currentViewScan.id)}`;
                  })()
                : undefined
            }
            onClose={() => setViewScan(null)}
          >
            {currentViewScan && resolvedViewKey && (
              <div className="space-y-3">
                {currentViewScan.answers.length === quiz.answerKey.length && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div
                        role="group"
                        aria-label="Paper image layer"
                        className="inline-flex rounded-[8px] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-0.5 text-[12px] font-medium"
                      >
                        <button
                          type="button"
                          aria-pressed={viewOverlayMode === "graded"}
                          onClick={() => setViewOverlayMode("graded")}
                          className={`rounded-[6px] px-2.5 py-1 transition-colors ${
                            viewOverlayMode === "graded"
                              ? "bg-[var(--brand)] text-white"
                              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          }`}
                        >
                          Graded overlay
                        </button>
                        <button
                          type="button"
                          aria-pressed={viewOverlayMode === "clean"}
                          onClick={() => setViewOverlayMode("clean")}
                          className={`rounded-[6px] px-2.5 py-1 transition-colors ${
                            viewOverlayMode === "clean"
                              ? "bg-[var(--brand)] text-white"
                              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          }`}
                        >
                          Clean scan
                        </button>
                      </div>

                      {availableKeyVersions.length > 1 && (
                        <div className="flex items-center gap-1.5">
                          <label
                            htmlFor="drawer-key-version"
                            className="text-[12px] font-medium text-[var(--text-secondary)]"
                          >
                            Key
                          </label>
                          <SelectInput
                            id="drawer-key-version"
                            selectSize="sm"
                            value={currentViewScan.keyVersion ?? "A"}
                            disabled={updatingVersionId === currentViewScan.id}
                            onChange={(e) =>
                              void handleChangeViewKeyVersion(
                                currentViewScan.id,
                                e.target.value as KeyVersionId,
                              )
                            }
                            className="!w-auto"
                          >
                            {availableKeyVersions.map((ver) => (
                              <option key={ver} value={ver}>
                                Key {ver}
                              </option>
                            ))}
                          </SelectInput>
                        </div>
                      )}
                    </div>
                    {viewOverlayMode === "graded" && <GradedOverlayLegend />}
                  </div>
                )}

                {viewImageUrl ? (
                  <div className="flex justify-center overflow-hidden rounded-[8px] border border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-2">
                    <div className="relative inline-block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={viewImageUrl}
                        alt={`Scan ${shortId(currentViewScan.id)}`}
                        className="block max-h-[560px] w-auto max-w-full"
                      />
                      {viewOverlayMode === "graded" &&
                        currentViewScan.answers.length ===
                          quiz.answerKey.length && (
                          <GradedSheetOverlay
                            answerKey={resolvedViewKey.answerKey}
                            points={resolvedViewKey.points}
                            questionRules={resolvedViewKey.questionRules}
                            keyVersion={
                              currentViewScan.keyVersion ??
                              resolvedViewKey.version
                            }
                            answers={currentViewScan.answers}
                            flags={currentViewScan.flags}
                            corrections={currentViewScan.corrections}
                          />
                        )}
                    </div>
                  </div>
                ) : (
                  <p className="text-[14px] text-[var(--text-muted)]">
                    Aligned scan image unavailable.
                  </p>
                )}
              </div>
            )}
          </Drawer>
        );
      })()}
    </div>
  );
}
