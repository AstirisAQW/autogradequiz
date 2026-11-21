"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  GradedOverlayLegend,
  GradedSheetOverlay,
} from "@/components/ui/GradedSheetOverlay";
import { shortId } from "@/lib/format";
import type { FlagReason } from "@/lib/scoring";
import type { QuestionRegionBox } from "@/lib/sheetGeometry";
import type { KeyVersionId, QuestionRule } from "@/lib/workspace";

interface ScanPreviewPaneProps {
  scanId: string;
  imageUrl: string | null;
  imageLoading: boolean;
  highlightBox: QuestionRegionBox | null;
  onRetryImage: () => void;
  answerKey?: string[];
  questionRules?: QuestionRule[];
  keyVersion?: KeyVersionId;
  answers?: string[];
  flags?: Record<string, FlagReason>;
  corrections?: Record<number, string>;
}

export function ScanPreviewPane({
  scanId,
  imageUrl,
  imageLoading,
  highlightBox,
  onRetryImage,
  answerKey,
  questionRules,
  keyVersion,
  answers,
  flags,
  corrections,
}: ScanPreviewPaneProps) {
  const [zoomPct, setZoomPct] = useState(100);
  const [overlayMode, setOverlayMode] = useState<"graded" | "clean">("graded");

  const hasOverlayData = Boolean(
    answerKey &&
      answerKey.length > 0 &&
      answers &&
      answers.length === answerKey.length,
  );
  const showOverlay = hasOverlayData && overlayMode === "graded";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-[var(--text-secondary)]">
          Full scan preview
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {hasOverlayData && (
            <div
              role="group"
              aria-label="Scan preview layer"
              className="inline-flex rounded-[8px] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-0.5 text-[11px] font-medium"
            >
              <button
                type="button"
                aria-pressed={overlayMode === "graded"}
                onClick={() => setOverlayMode("graded")}
                className={`rounded-[6px] px-2 py-1 transition-colors ${
                  overlayMode === "graded"
                    ? "bg-[var(--brand)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Graded overlay
              </button>
              <button
                type="button"
                aria-pressed={overlayMode === "clean"}
                onClick={() => setOverlayMode("clean")}
                className={`rounded-[6px] px-2 py-1 transition-colors ${
                  overlayMode === "clean"
                    ? "bg-[var(--brand)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Clean scan
              </button>
            </div>
          )}

          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              aria-label="Zoom out"
              disabled={zoomPct <= 75}
              disabledReason={
                zoomPct <= 75 ? "Minimum zoom reached" : undefined
              }
              onClick={() => setZoomPct((z) => Math.max(75, z - 25))}
            >
              −
            </Button>
            <span className="w-11 text-center font-mono text-[12px] text-[var(--text-secondary)] tabular-nums">
              {zoomPct}%
            </span>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Zoom in"
              disabled={zoomPct >= 200}
              disabledReason={
                zoomPct >= 200 ? "Maximum zoom reached" : undefined
              }
              onClick={() => setZoomPct((z) => Math.min(200, z + 25))}
            >
              +
            </Button>
          </div>
        </div>
      </div>

      {imageLoading ? (
        <div
          role="status"
          aria-label="Loading scan image"
          className="h-[360px] w-full animate-pulse rounded-[8px] border border-[var(--border-hairline)] bg-black/[0.06]"
        />
      ) : imageUrl ? (
        <div className="space-y-2">
          <div className="max-h-[520px] overflow-auto rounded-[8px] border border-[var(--border-hairline)] bg-[var(--bg-subtle)]">
            <div
              className="relative inline-block origin-top-left"
              style={{ width: `${zoomPct}%` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={imageUrl}
                src={imageUrl}
                alt={`Scan ${shortId(scanId)}`}
                className="block h-auto w-full"
              />
              {showOverlay && answerKey && answers && (
                <GradedSheetOverlay
                  answerKey={answerKey}
                  questionRules={questionRules}
                  keyVersion={keyVersion}
                  answers={answers}
                  flags={flags ?? {}}
                  corrections={corrections ?? {}}
                />
              )}
              {highlightBox && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute rounded-[4px] border-2 border-amber-500 bg-amber-400/15 transition-all duration-150"
                  style={{
                    left: `${highlightBox.left}%`,
                    top: `${highlightBox.top}%`,
                    width: `${highlightBox.width}%`,
                    height: `${highlightBox.height}%`,
                  }}
                />
              )}
            </div>
          </div>
          {showOverlay && <GradedOverlayLegend />}
        </div>
      ) : (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-[8px] border border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-6 text-center text-[14px] text-[var(--text-secondary)]">
          <p>Image unavailable</p>
          <Button variant="secondary" size="sm" onClick={onRetryImage}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
