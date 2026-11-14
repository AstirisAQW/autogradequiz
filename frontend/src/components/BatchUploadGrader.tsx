"use client";

import { useRef, useState } from "react";
import { ApiError, gradeScan, uploadScan } from "@/lib/api";

type RowStatus =
  | "waiting"
  | "uploading"
  | "uploaded"
  | "grading"
  | "done"
  | "failed";

interface ScanRow {
  localId: string;
  file: File;
  status: RowStatus;
  scanJobId: number | null;
  score: number | null;
  error: string | null;
  note: string | null;
  failedPhase: "upload" | "grade" | null;
}

interface BatchUploadGraderProps {
  batchId: number;
  onRunFinished?: () => void;
}

export function BatchUploadGrader({
  batchId,
  onRunFinished,
}: BatchUploadGraderProps) {
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function updateRow(localId: string, patch: Partial<ScanRow>) {
    setRows((prev) =>
      prev.map((row) => (row.localId === localId ? { ...row, ...patch } : row)),
    );
  }

  function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    const newRows: ScanRow[] = files.map((file, index) => ({
      localId: `${Date.now()}-${index}-${file.name}`,
      file,
      status: "waiting",
      scanJobId: null,
      score: null,
      error: null,
      note: null,
      failedPhase: null,
    }));
    setRows((prev) => [...prev, ...newRows]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function processOneRow(row: ScanRow) {
    let scanJobId = row.scanJobId;
    if (scanJobId === null) {
      updateRow(row.localId, {
        status: "uploading",
        error: null,
        note: null,
        failedPhase: null,
      });
      try {
        const job = await uploadScan(batchId, row.file);
        scanJobId = job.id;
        updateRow(row.localId, { status: "uploaded", scanJobId });
      } catch (err) {
        const detail =
          err instanceof ApiError ? err.detail : "Could not upload scan.";
        updateRow(row.localId, {
          status: "failed",
          error: detail,
          failedPhase: "upload",
        });
        return;
      }
    }

    updateRow(row.localId, {
      status: "grading",
      error: null,
      note: null,
      failedPhase: null,
    });
    try {
      const result = await gradeScan(scanJobId, false);
      updateRow(row.localId, {
        status: "done",
        score: result.score,
        error: null,
        failedPhase: null,
      });
    } catch (err) {
      const isConflict = err instanceof ApiError && err.status === 409;
      const detail = isConflict
        ? "Already graded"
        : err instanceof ApiError
          ? err.detail
          : "Could not grade scan.";
      updateRow(row.localId, {
        status: "failed",
        error: detail,
        failedPhase: "grade",
      });
    }
  }

  async function handleUploadAndGrade() {
    if (isRunning) return;
    const pending = rows.filter(
      (row) => row.status === "waiting" || row.status === "uploaded",
    );
    if (pending.length === 0) return;

    setIsRunning(true);
    try {
      for (const row of pending) {
        await processOneRow(row);
      }
    } finally {
      setIsRunning(false);
      onRunFinished?.();
    }
  }

  async function handleRetryUpload(row: ScanRow) {
    if (isRunning) return;
    setIsRunning(true);
    try {
      await processOneRow({ ...row, scanJobId: null });
    } finally {
      setIsRunning(false);
      onRunFinished?.();
    }
  }

  async function handleRegrade(row: ScanRow) {
    if (isRunning || row.scanJobId === null) return;
    setIsRunning(true);
    updateRow(row.localId, {
      status: "grading",
      error: null,
      note: "Regrade keeps your corrections.",
      failedPhase: null,
    });
    try {
      const result = await gradeScan(row.scanJobId, true);
      updateRow(row.localId, {
        status: "done",
        score: result.score,
        error: null,
        note: "Regrade keeps your corrections.",
        failedPhase: null,
      });
    } catch (err) {
      const detail =
        err instanceof ApiError ? err.detail : "Could not regrade scan.";
      updateRow(row.localId, {
        status: "failed",
        error: detail,
        note: "Regrade keeps your corrections.",
        failedPhase: "grade",
      });
    } finally {
      setIsRunning(false);
      onRunFinished?.();
    }
  }

  const doneCount = rows.filter((r) => r.status === "done").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;
  const waitingCount = rows.filter(
    (r) =>
      r.status === "waiting" ||
      r.status === "uploading" ||
      r.status === "uploaded" ||
      r.status === "grading",
  ).length;
  const hasWaiting = rows.some(
    (r) => r.status === "waiting" || r.status === "uploaded",
  );

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-base font-semibold">3. Upload and grade scans</h2>
        {rows.length > 0 && (
          <p className="text-sm text-zinc-600">
            {doneCount} done, {failedCount} failed, {waitingCount} waiting
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg"
          disabled={isRunning}
          onChange={handleFilesSelected}
          className="text-sm text-zinc-700 file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-zinc-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-800 hover:file:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
        />

        <button
          type="button"
          disabled={isRunning || !hasWaiting}
          onClick={handleUploadAndGrade}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
        >
          {isRunning ? "Grading..." : "Upload and grade"}
        </button>
      </div>

      {rows.length > 0 && (
        <ul className="mt-4 divide-y divide-zinc-200 rounded-md border border-zinc-200">
          {rows.map((row) => (
            <li
              key={row.localId}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-zinc-900">
                    {row.file.name}
                  </span>
                  {row.scanJobId !== null && (
                    <span className="font-mono text-xs text-zinc-500">
                      #{row.scanJobId}
                    </span>
                  )}
                </div>
                {row.error && (
                  <p className="text-xs text-red-600">{row.error}</p>
                )}
                {row.note && (
                  <p className="text-xs text-zinc-600">{row.note}</p>
                )}
              </div>

              <div className="flex items-center gap-3">
                {row.status === "done" && row.score !== null ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                    done — {row.score.toFixed(1)}%
                  </span>
                ) : row.status === "failed" ? (
                  <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                    failed
                  </span>
                ) : (
                  <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700">
                    {row.status}
                  </span>
                )}

                {row.scanJobId !== null &&
                  (row.status === "done" || row.status === "failed") && (
                    <button
                      type="button"
                      disabled={isRunning}
                      onClick={() => handleRegrade(row)}
                      className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Regrade
                    </button>
                  )}

                {row.status === "failed" && row.failedPhase === "upload" && (
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => handleRetryUpload(row)}
                    className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Retry
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
