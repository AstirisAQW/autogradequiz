"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  GradedOverlayLegend,
  GradedSheetOverlay,
} from "@/components/ui/GradedSheetOverlay";
import { shortId } from "@/lib/format";
import type { FlagReason } from "@/lib/scoring";
import { type QuestionRegionBox } from "@/lib/sheetGeometry";
import type { KeyVersionId, QuestionRule } from "@/lib/workspace";

interface ScanPreviewPaneProps {
  scanId: string;
  imageUrl: string | null;
  imageLoading: boolean;
  highlightBox: QuestionRegionBox | null;
  onRetryImage: () => void;
  answerKey?: string[];
  points?: number[];
  questionRules?: QuestionRule[];
  keyVersion?: KeyVersionId;
  showKeyVersion?: boolean;
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
  points,
  questionRules,
  keyVersion,
  showKeyVersion = false,
  answers,
  flags,
  corrections,
}: ScanPreviewPaneProps) {
  const [fitWidth, setFitWidth] = useState(true);
  const [zoomPct, setZoomPct] = useState(100);
  const [overlayMode, setOverlayMode] = useState<"graded" | "clean">("graded");

  const effectiveZoom = fitWidth ? 100 : zoomPct;
  const allowHorizontalScroll = !fitWidth && zoomPct > 100;

  const hasOverlayData = Boolean(
    answerKey &&
      answerKey.length > 0 &&
      answers &&
      answers.length === answerKey.length,
  );
  const showOverlay = hasOverlayData && overlayMode === "graded";

  const sheetLayer = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={imageUrl}
        src={imageUrl ?? undefined}
        alt={`Scan ${shortId(scanId)}`}
        className="block h-auto w-full max-w-none"
      />
      {showOverlay && answerKey && answers && (
        <GradedSheetOverlay
          answerKey={answerKey}
          points={points}
          questionRules={questionRules}
          keyVersion={keyVersion}
          showKeyVersion={showKeyVersion}
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
    </>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          Scan preview
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {hasOverlayData && (
            <div
              role="group"
              aria-label="Scan preview layer"
              className="inline-flex rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-0.5 text-[0.6875rem] font-medium"
            >
              <button
                type="button"
                aria-pressed={overlayMode === "graded"}
                onClick={() => setOverlayMode("graded")}
                className={`rounded-md px-2 py-1 transition-colors ${
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
                className={`rounded-md px-2 py-1 transition-colors ${
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
            <button
              type="button"
              aria-pressed={fitWidth}
              onClick={() => {
                setFitWidth(true);
                setZoomPct(100);
              }}
              className={`min-h-8 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
                fitWidth
                  ? "border-[var(--brand)] bg-[var(--brand-subtle)] text-[var(--brand-text)]"
                  : "border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]"
              }`}
            >
              Fit width
            </button>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Zoom out"
              inlineReason={false}
              disabled={!fitWidth && zoomPct <= 75}
              onClick={() => {
                setFitWidth(false);
                setZoomPct((z) => Math.max(75, (fitWidth ? 100 : z) - 25));
              }}
            >
              −
            </Button>
            <span className="w-11 text-center font-mono text-xs text-[var(--text-secondary)] tabular-nums">
              {fitWidth ? "Fit" : `${zoomPct}%`}
            </span>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Zoom in"
              inlineReason={false}
              disabled={!fitWidth && zoomPct >= 200}
              onClick={() => {
                setFitWidth(false);
                setZoomPct((z) => Math.min(200, (fitWidth ? 100 : z) + 25));
              }}
            >
              +
            </Button>
            {!fitWidth && (zoomPct <= 75 || zoomPct >= 200) && (
              <span className="ml-1 text-xs text-[var(--text-muted)]">
                {zoomPct <= 75 ? "Min" : "Max"}
              </span>
            )}
          </div>
        </div>
      </div>

      {imageLoading ? (
        <div
          role="status"
          aria-label="Loading scan image"
          className="h-[45vh] w-full animate-pulse rounded-lg border border-[var(--border-hairline)] bg-black/[0.06]"
        />
      ) : imageUrl ? (
        <div className="space-y-2">
          <div
            className={`max-h-[70vh] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-subtle)] ${
              allowHorizontalScroll
                ? "overflow-auto"
                : "overflow-y-auto overflow-x-hidden"
            }`}
          >
            <div
              className="relative block origin-top-left"
              style={{ width: fitWidth ? "100%" : `${effectiveZoom}%` }}
            >
              {sheetLayer}
            </div>
          </div>
          {showOverlay && <GradedOverlayLegend />}
        </div>
      ) : (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-6 text-center text-sm text-[var(--text-secondary)]">
          <p>Image unavailable</p>
          <Button variant="secondary" size="sm" onClick={onRetryImage}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
