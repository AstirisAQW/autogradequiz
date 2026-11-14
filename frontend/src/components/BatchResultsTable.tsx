"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, batchExportCsvUrl, listBatchResults } from "@/lib/api";
import type { ScanResultRecord } from "@/lib/types";

interface BatchResultsTableProps {
  batchId: number;
  refreshTrigger: number;
}

export function BatchResultsTable({
  batchId,
  refreshTrigger,
}: BatchResultsTableProps) {
  const [results, setResults] = useState<ScanResultRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await listBatchResults(batchId);
      setResults([...data].sort((a, b) => a.scan_job_id - b.scan_job_id));
    } catch (err) {
      setResults(null);
      setError(
        err instanceof ApiError ? err.detail : "Could not load batch results.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
    });
    listBatchResults(batchId)
      .then((data) => {
        if (cancelled) return;
        setResults([...data].sort((a, b) => a.scan_job_id - b.scan_job_id));
      })
      .catch((err) => {
        if (cancelled) return;
        setResults(null);
        setError(
          err instanceof ApiError
            ? err.detail
            : "Could not load batch results.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [batchId, refreshTrigger]);

  const rows = results ?? [];
  const totalCount = rows.length;
  const needsReviewCount = rows.filter(
    (row) => row.status === "done" && row.needs_review,
  ).length;
  const failedCount = rows.filter((row) => row.status === "failed").length;
  const canExport = !loading && !error && totalCount > 0;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-zinc-900">
          4. Batch results
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={loading}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>

          {canExport ? (
            <a
              href={batchExportCsvUrl(batchId)}
              download
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Export CSV
            </a>
          ) : (
            <button
              type="button"
              disabled
              title="No scans in this batch to export"
              className="cursor-not-allowed rounded-md bg-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-500"
            >
              Export CSV
            </button>
          )}

          {needsReviewCount > 0 && (
            <Link
              href="/review"
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
            >
              Review these
            </Link>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {!error && loading && results === null && (
        <p className="mt-4 text-sm text-zinc-600">Loading results...</p>
      )}

      {!error && !loading && totalCount === 0 && (
        <p className="mt-4 text-sm text-zinc-600">
          No scans in this batch yet.
        </p>
      )}

      {!error && totalCount > 0 && (
        <>
          <div className="mt-4 overflow-x-auto rounded-md border border-zinc-200">
            <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
              <thead className="bg-zinc-50 text-xs font-medium uppercase text-zinc-600">
                <tr>
                  <th className="px-4 py-2.5">Scan ID</th>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Section</th>
                  <th className="px-4 py-2.5">Score</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 bg-white text-zinc-900">
                {rows.map((row) => (
                  <tr key={row.scan_job_id}>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-zinc-700">
                      #{row.scan_job_id}
                    </td>
                    <td className="px-4 py-2.5">{row.name_text || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {row.date_text || "—"}
                    </td>
                    <td className="px-4 py-2.5">{row.section_text || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono">
                      {row.status === "done"
                        ? `${row.score.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="space-y-0.5">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            row.status === "done"
                              ? "bg-emerald-100 text-emerald-800"
                              : row.status === "failed"
                                ? "bg-red-100 text-red-800"
                                : "bg-zinc-100 text-zinc-700"
                          }`}
                        >
                          {row.status}
                        </span>
                        {row.status === "failed" && row.error_message && (
                          <p
                            title={row.error_message}
                            className="max-w-xs truncate text-xs text-red-600"
                          >
                            {row.error_message}
                          </p>
                        )}
                        {row.status === "pending" && (
                          <p className="text-xs text-zinc-500">
                            Not graded yet
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {row.status === "done" ? (
                        row.needs_review ? (
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
                            Needs review
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                            OK
                          </span>
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-sm text-zinc-600">
            {totalCount} total, {needsReviewCount} need review, {failedCount}{" "}
            failed
          </p>
        </>
      )}
    </section>
  );
}
