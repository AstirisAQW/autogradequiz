"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  applyScanCorrections,
  listReviewQueue,
  scanImageUrl,
  updateScanIdentity,
} from "@/lib/api";
import {
  ANSWER_CHOICES,
  parseScanResult,
  type CorrectionValue,
  type ScanResultRecord,
} from "@/lib/types";

interface FlaggedQuestion {
  number: number;
  reason: string;
  readValue: string;
}

function getFlaggedQuestions(scan: ScanResultRecord): FlaggedQuestion[] {
  const { answers, flags } = parseScanResult(scan);
  const items = new Map<number, FlaggedQuestion>();

  for (const num of flags.ambiguous) {
    const raw = answers[num - 1] ?? "";
    items.set(num, {
      number: num,
      reason: "Unclear mark",
      readValue: raw || "blank",
    });
  }

  for (const num of flags.multiple) {
    const raw = answers[num - 1] ?? "";
    items.set(num, {
      number: num,
      reason: `Two marks: ${raw || "?"}`,
      readValue: raw || "blank",
    });
  }

  return Array.from(items.values()).sort((a, b) => a.number - b.number);
}

export default function ReviewPage() {
  const [queue, setQueue] = useState<ScanResultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [draftCorrections, setDraftCorrections] = useState<
    Record<number, CorrectionValue>
  >({});
  const [nameText, setNameText] = useState("");
  const [dateText, setDateText] = useState("");
  const [sectionText, setSectionText] = useState("");

  const [savingCorrections, setSavingCorrections] = useState(false);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [saveCount, setSaveCount] = useState(0);

  function selectScan(scan: ScanResultRecord | null) {
    setSelectedId(scan?.scan_job_id ?? null);
    setDraftCorrections({});
    setNameText(scan?.name_text ?? "");
    setDateText(scan?.date_text ?? "");
    setSectionText(scan?.section_text ?? "");
    setActionError(null);
    setActionNote(null);
  }

  async function refreshQueue(preferredId: number | null = selectedId) {
    setLoading(true);
    setQueueError(null);
    try {
      const data = await listReviewQueue();
      setQueue(data);
      const next =
        data.find((item) => item.scan_job_id === preferredId) ??
        data[0] ??
        null;
      selectScan(next);
    } catch (err) {
      setQueue([]);
      selectScan(null);
      setQueueError(
        err instanceof ApiError ? err.detail : "Could not load review queue.",
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
        setQueueError(null);
      }
    });
    listReviewQueue()
      .then((data) => {
        if (cancelled) return;
        setQueue(data);
        const first = data[0] ?? null;
        setSelectedId(first?.scan_job_id ?? null);
        setDraftCorrections({});
        setNameText(first?.name_text ?? "");
        setDateText(first?.date_text ?? "");
        setSectionText(first?.section_text ?? "");
      })
      .catch((err) => {
        if (cancelled) return;
        setQueue([]);
        setSelectedId(null);
        setQueueError(
          err instanceof ApiError
            ? err.detail
            : "Could not load review queue.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedScan =
    queue.find((item) => item.scan_job_id === selectedId) ?? null;

  const parsed = selectedScan ? parseScanResult(selectedScan) : null;
  const hasGradedAnswers = parsed ? parsed.answers.length > 0 : false;
  const flaggedQuestions = selectedScan
    ? getFlaggedQuestions(selectedScan)
    : [];
  const allFlaggedChosen =
    flaggedQuestions.length > 0 &&
    flaggedQuestions.every((q) => draftCorrections[q.number] !== undefined);

  const identityChanged = selectedScan
    ? nameText !== selectedScan.name_text ||
      dateText !== selectedScan.date_text ||
      sectionText !== selectedScan.section_text
    : false;

  async function handleSaveIdentity(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedScan || !identityChanged || savingIdentity) return;

    const payload: {
      name_text?: string;
      date_text?: string;
      section_text?: string;
    } = {};
    if (nameText !== selectedScan.name_text) payload.name_text = nameText;
    if (dateText !== selectedScan.date_text) payload.date_text = dateText;
    if (sectionText !== selectedScan.section_text) {
      payload.section_text = sectionText;
    }

    setSavingIdentity(true);
    setActionError(null);
    setActionNote(null);
    try {
      const updated = await updateScanIdentity(
        selectedScan.scan_job_id,
        payload,
      );
      setQueue((prev) =>
        prev.map((item) =>
          item.scan_job_id === updated.scan_job_id ? updated : item,
        ),
      );
      setNameText(updated.name_text);
      setDateText(updated.date_text);
      setSectionText(updated.section_text);
      setSaveCount((c) => c + 1);
      setActionNote("Identity saved.");
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.detail : "Could not save identity.",
      );
    } finally {
      setSavingIdentity(false);
    }
  }

  async function handleSaveCorrections() {
    if (!selectedScan || !allFlaggedChosen || savingCorrections) return;
    setSavingCorrections(true);
    setActionError(null);
    setActionNote(null);
    try {
      const updated = await applyScanCorrections(
        selectedScan.scan_job_id,
        draftCorrections,
      );
      setSaveCount((c) => c + 1);
      await refreshQueue(
        updated.needs_review ? updated.scan_job_id : null,
      );
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.detail : "Could not save corrections.",
      );
    } finally {
      setSavingCorrections(false);
    }
  }

  const imageUrl = selectedScan
    ? scanImageUrl(
        selectedScan.scan_job_id,
        `${selectedScan.created_at}-${saveCount}`,
      )
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Review queue</h1>
          <p className="text-xs text-zinc-500">
            Only flagged questions can be corrected here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshQueue()}
          disabled={loading}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {queueError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {queueError}
        </p>
      )}

      {!queueError && !loading && queue.length === 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
          Nothing needs review.
        </div>
      )}

      {!queueError && queue.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-12">
          <aside className="space-y-2 lg:col-span-4">
            <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white">
              {queue.map((item) => {
                const count = getFlaggedQuestions(item).length;
                const isSelected = item.scan_job_id === selectedId;
                return (
                  <li key={item.scan_job_id}>
                    <button
                      type="button"
                      onClick={() => selectScan(item)}
                      className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                        isSelected
                          ? "bg-zinc-900 text-white"
                          : "bg-white text-zinc-900 hover:bg-zinc-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold">
                          #{item.scan_job_id}
                        </span>
                        <span className="font-mono text-xs">
                          {item.score.toFixed(1)}%
                        </span>
                      </div>
                      <p className="mt-0.5 truncate font-medium">
                        {item.name_text || "Unnamed"}
                      </p>
                      <p
                        className={`mt-0.5 text-xs ${
                          isSelected ? "text-zinc-300" : "text-zinc-500"
                        }`}
                      >
                        {count} flagged
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {selectedScan && (
            <section className="space-y-6 rounded-lg border border-zinc-200 bg-white p-6 lg:col-span-8">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 pb-4">
                <h2 className="text-base font-semibold text-zinc-900">
                  Scan #{selectedScan.scan_job_id}
                </h2>
                <span className="font-mono text-sm font-medium text-zinc-700">
                  Score: {selectedScan.score.toFixed(1)}%
                </span>
              </div>

              {actionError && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {actionError}
                </p>
              )}
              {actionNote && (
                <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  {actionNote}
                </p>
              )}

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-zinc-900">
                    Scan image
                  </h3>
                  {imageUrl && (
                    <a
                      href={imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open full image in a new tab"
                      className="block overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl}
                        alt={`Scan ${selectedScan.scan_job_id}`}
                        className="max-h-[480px] w-full object-contain"
                      />
                    </a>
                  )}
                  <p className="text-xs text-zinc-500">
                    Click the image to open full size in a new tab.
                  </p>
                </div>

                <div className="space-y-6">
                  <form onSubmit={handleSaveIdentity} className="space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900">
                        Identity
                      </h3>
                      <p className="text-xs text-zinc-500">
                        Text read from the sheet can be wrong. Fix it here.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <label
                          htmlFor="review-name"
                          className="block text-xs font-medium text-zinc-700"
                        >
                          Name
                        </label>
                        <input
                          id="review-name"
                          type="text"
                          value={nameText}
                          onChange={(e) => setNameText(e.target.value)}
                          className="mt-0.5 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="review-date"
                          className="block text-xs font-medium text-zinc-700"
                        >
                          Date
                        </label>
                        <input
                          id="review-date"
                          type="text"
                          value={dateText}
                          onChange={(e) => setDateText(e.target.value)}
                          className="mt-0.5 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="review-section"
                          className="block text-xs font-medium text-zinc-700"
                        >
                          Section
                        </label>
                        <input
                          id="review-section"
                          type="text"
                          value={sectionText}
                          onChange={(e) => setSectionText(e.target.value)}
                          className="mt-0.5 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={!identityChanged || savingIdentity}
                      className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                    >
                      {savingIdentity ? "Saving..." : "Save identity"}
                    </button>
                  </form>

                  <div className="space-y-3 border-t border-zinc-200 pt-4">
                    <h3 className="text-sm font-semibold text-zinc-900">
                      Flagged questions
                    </h3>

                    {!hasGradedAnswers ? (
                      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        This scan has no graded answers. Regrade it on the Grade
                        a batch page.
                      </p>
                    ) : flaggedQuestions.length === 0 ? (
                      <p className="text-sm text-zinc-600">
                        No flagged questions on this scan.
                      </p>
                    ) : (
                      <>
                        <ul className="space-y-3">
                          {flaggedQuestions.map((q) => {
                            const chosen = draftCorrections[q.number];
                            return (
                              <li
                                key={q.number}
                                className="rounded-md border border-zinc-200 p-3 text-sm"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-semibold text-zinc-900">
                                    Q{q.number}
                                  </span>
                                  <span className="text-xs font-medium text-amber-800">
                                    {q.reason}
                                  </span>
                                </div>
                                <p className="mt-0.5 text-xs text-zinc-500">
                                  Read: {q.readValue}
                                </p>

                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {ANSWER_CHOICES.map((choice) => {
                                    const active = chosen === choice;
                                    return (
                                      <button
                                        key={choice}
                                        type="button"
                                        onClick={() =>
                                          setDraftCorrections((prev) => ({
                                            ...prev,
                                            [q.number]: choice,
                                          }))
                                        }
                                        className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                                          active
                                            ? "border-zinc-900 bg-zinc-900 text-white"
                                            : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100"
                                        }`}
                                      >
                                        {choice}
                                      </button>
                                    );
                                  })}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDraftCorrections((prev) => ({
                                        ...prev,
                                        [q.number]: "",
                                      }))
                                    }
                                    className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                                      chosen === ""
                                        ? "border-zinc-900 bg-zinc-900 text-white"
                                        : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100"
                                    }`}
                                  >
                                    Blank
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>

                        {!allFlaggedChosen && (
                          <p className="text-xs text-zinc-600">
                            Choose an answer for all {flaggedQuestions.length}{" "}
                            flagged questions.
                          </p>
                        )}

                        <button
                          type="button"
                          disabled={!allFlaggedChosen || savingCorrections}
                          onClick={() => void handleSaveCorrections()}
                          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
                        >
                          {savingCorrections
                            ? "Saving..."
                            : "Save corrections"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
