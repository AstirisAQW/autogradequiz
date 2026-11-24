"use client";

import {
  evaluateQuestionScore,
  type FlagReason,
} from "@/lib/scoring";
import {
  bubbleCenterMm,
  bubbleRadiusMm,
  KEY_VERSION_BUBBLE_RADIUS_MM,
  KEY_VERSION_CHOICES,
  keyVersionBubbleCenterMm,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  questionRowBoxMm,
} from "@/lib/sheetGeometry";
import { ANSWER_CHOICES } from "@/lib/types";
import type { KeyVersionId, QuestionRule } from "@/lib/workspace";

export interface GradedSheetOverlayProps {
  answerKey: string[];
  points?: number[];
  questionRules?: QuestionRule[];
  keyVersion?: KeyVersionId;
  showKeyVersion?: boolean;
  answers: string[];
  flags: Record<string, FlagReason>;
  corrections: Record<number, string>;
}

export function GradedSheetOverlay({
  answerKey,
  points,
  questionRules,
  keyVersion,
  showKeyVersion = false,
  answers,
  flags,
  corrections,
}: GradedSheetOverlayProps) {
  const totalQuestions = answerKey.length;
  if (totalQuestions === 0) return null;

  const baseRadius = bubbleRadiusMm(totalQuestions);
  const ringRadius = baseRadius * 1.32;
  const strokeWidth = Math.max(0.65, baseRadius * 0.28);

  const keyVersionIdx =
    showKeyVersion && keyVersion
      ? KEY_VERSION_CHOICES.indexOf(
          keyVersion as (typeof KEY_VERSION_CHOICES)[number],
        )
      : -1;
  const keyVersionCenter =
    keyVersionIdx !== -1 ? keyVersionBubbleCenterMm(keyVersionIdx) : null;

  return (
    <svg
      viewBox={`0 0 ${PAGE_WIDTH_MM} ${PAGE_HEIGHT_MM}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {keyVersionCenter && (
        <circle
          cx={keyVersionCenter.x}
          cy={keyVersionCenter.y}
          r={KEY_VERSION_BUBBLE_RADIUS_MM * 1.35}
          fill="rgba(22, 163, 74, 0.12)"
          stroke="#16a34a"
          strokeWidth={0.75}
        />
      )}
      {answerKey.map((keyEntry, idx) => {
        const qNum = idx + 1;
        const accepted = keyEntry.split("+").filter(Boolean);
        const evalRes = evaluateQuestionScore({
          questionNumber: qNum,
          answerKey,
          points,
          questionRules,
          answers,
          flags,
          corrections,
        });
        const effectiveChoice = evalRes.effectiveChoice;

        if (evalRes.status === "flagged") {
          const rowBox = questionRowBoxMm(qNum, totalQuestions);
          const rawChoices = (answers[idx] ?? "").split("+").filter(Boolean);
          return (
            <g key={qNum}>
              <rect
                x={rowBox.x}
                y={rowBox.y}
                width={rowBox.width}
                height={rowBox.height}
                rx={0.8}
                fill="rgba(245, 158, 11, 0.14)"
                stroke="#d97706"
                strokeWidth={0.55}
              />
              {rawChoices.map((ch) => {
                const choiceIdx = ANSWER_CHOICES.indexOf(
                  ch as (typeof ANSWER_CHOICES)[number],
                );
                if (choiceIdx === -1) return null;
                const center = bubbleCenterMm(qNum, choiceIdx, totalQuestions);
                return (
                  <circle
                    key={`raw-${ch}`}
                    cx={center.x}
                    cy={center.y}
                    r={ringRadius}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={strokeWidth}
                  />
                );
              })}
              {accepted.map((expected) => {
                const choiceIdx = ANSWER_CHOICES.indexOf(
                  expected as (typeof ANSWER_CHOICES)[number],
                );
                if (choiceIdx === -1) return null;
                const center = bubbleCenterMm(qNum, choiceIdx, totalQuestions);
                return (
                  <circle
                    key={`exp-${expected}`}
                    cx={center.x}
                    cy={center.y}
                    r={ringRadius}
                    fill="none"
                    stroke="#16a34a"
                    strokeWidth={strokeWidth * 0.8}
                    strokeDasharray="1.2 0.8"
                  />
                );
              })}
            </g>
          );
        }

        if (evalRes.status === "correct" && effectiveChoice !== "") {
          const choiceIdx = ANSWER_CHOICES.indexOf(
            effectiveChoice as (typeof ANSWER_CHOICES)[number],
          );
          if (choiceIdx === -1) return null;
          const center = bubbleCenterMm(qNum, choiceIdx, totalQuestions);
          return (
            <circle
              key={qNum}
              cx={center.x}
              cy={center.y}
              r={ringRadius}
              fill="rgba(22, 163, 74, 0.12)"
              stroke="#16a34a"
              strokeWidth={strokeWidth}
            />
          );
        }

        const chosenIdx =
          effectiveChoice !== ""
            ? ANSWER_CHOICES.indexOf(
                effectiveChoice as (typeof ANSWER_CHOICES)[number],
              )
            : -1;
        const chosenCenter =
          chosenIdx !== -1
            ? bubbleCenterMm(qNum, chosenIdx, totalQuestions)
            : null;
        const isPartial = evalRes.status === "partial";

        return (
          <g key={qNum}>
            {chosenCenter && (
              <circle
                cx={chosenCenter.x}
                cy={chosenCenter.y}
                r={ringRadius}
                fill={
                  isPartial
                    ? "rgba(2, 132, 199, 0.14)"
                    : "rgba(220, 38, 38, 0.12)"
                }
                stroke={isPartial ? "#0284c7" : "#dc2626"}
                strokeWidth={strokeWidth}
              />
            )}
            {accepted.map((expected) => {
              const choiceIdx = ANSWER_CHOICES.indexOf(
                expected as (typeof ANSWER_CHOICES)[number],
              );
              if (choiceIdx === -1) return null;
              const center = bubbleCenterMm(qNum, choiceIdx, totalQuestions);
              return (
                <circle
                  key={`exp-${expected}`}
                  cx={center.x}
                  cy={center.y}
                  r={ringRadius}
                  fill="none"
                  stroke="#16a34a"
                  strokeWidth={strokeWidth * 0.9}
                  strokeDasharray={chosenCenter ? undefined : "1.2 0.8"}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

export function GradedOverlayLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem] text-[var(--text-secondary)]">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[#16a34a] bg-[#16a34a]/15" />
        Correct
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[#0284c7] bg-[#0284c7]/15" />
        Partial
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[#dc2626] bg-[#dc2626]/15" />
        Wrong
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-dashed border-[#16a34a]" />
        Answer key
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-[2px] border-2 border-[#d97706] bg-[#f59e0b]/20" />
        Flagged
      </span>
    </div>
  );
}
