import type { QuestionRule } from "./workspace/schema.ts";

export type FlagReason = "ambiguous" | "multiple";

export interface RescoreInput {
  answerKey: string[];
  points?: number[];
  questionRules?: QuestionRule[];
  keyVersionFlagged?: boolean;
  answers: string[];
  flags: Record<string, FlagReason>;
  corrections: Record<number, string>;
}

export interface RescoreResult {
  score: number;
  needsReview: boolean;
  earnedPoints: number;
  totalPoints: number;
}

export type QuestionEvalStatus =
  | "correct"
  | "partial"
  | "wrong"
  | "blank"
  | "flagged";

export interface QuestionEvalResult {
  status: QuestionEvalStatus;
  earned: number;
  max: number;
  effectiveChoice: string;
}

export function formatPointsValue(pts: number): string {
  const rounded = Math.round(pts * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function resolveEffectiveChoice(
  questionNumber: number,
  answers: string[],
  flags: Record<string, FlagReason>,
  corrections: Record<number, string>,
): { choice: string; isUnresolvedFlag: boolean; isCorrected: boolean } {
  if (corrections[questionNumber] !== undefined) {
    return {
      choice: corrections[questionNumber],
      isUnresolvedFlag: false,
      isCorrected: true,
    };
  }
  if (flags[String(questionNumber)] !== undefined) {
    return {
      choice: "",
      isUnresolvedFlag: true,
      isCorrected: false,
    };
  }
  return {
    choice: answers[questionNumber - 1] ?? "",
    isUnresolvedFlag: false,
    isCorrected: false,
  };
}

function buildAlternateMap(
  rule: QuestionRule | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const alt of rule?.alternateAnswers ?? []) {
    const pts = Number(alt.points);
    if (!Number.isFinite(pts)) continue;
    for (const ch of alt.choice.split("+")) {
      const cleaned = ch.trim();
      if (!cleaned) continue;
      map.set(cleaned, Math.max(map.get(cleaned) ?? pts, pts));
    }
  }
  return map;
}

export function evaluateQuestionScore(params: {
  questionNumber: number;
  answerKey: string[];
  points?: number[];
  questionRules?: QuestionRule[];
  answers: string[];
  flags: Record<string, FlagReason>;
  corrections: Record<number, string>;
}): QuestionEvalResult {
  const {
    questionNumber,
    answerKey,
    points,
    questionRules,
    answers,
    flags,
    corrections,
  } = params;
  const idx = questionNumber - 1;
  const weight = points ? Number(points[idx] ?? 1) : 1;
  const rule = questionRules?.[idx];
  const altMap = buildAlternateMap(rule);
  const max = Math.max(weight, ...altMap.values(), 0);

  const { choice, isUnresolvedFlag } = resolveEffectiveChoice(
    questionNumber,
    answers,
    flags,
    corrections,
  );
  if (isUnresolvedFlag) {
    return { status: "flagged", earned: 0, max, effectiveChoice: "" };
  }
  if (choice === "") {
    return { status: "blank", earned: 0, max, effectiveChoice: "" };
  }

  const accepted = (answerKey[idx] ?? "").split("+").filter(Boolean);
  if (accepted.includes(choice)) {
    return { status: "correct", earned: weight, max, effectiveChoice: choice };
  }

  if (altMap.has(choice)) {
    return {
      status: "partial",
      earned: altMap.get(choice) ?? 0,
      max,
      effectiveChoice: choice,
    };
  }

  const incorrectPts = Number(rule?.incorrectPoints ?? 0);
  return {
    status: "wrong",
    earned: Number.isFinite(incorrectPts) ? incorrectPts : 0,
    max,
    effectiveChoice: choice,
  };
}


export function scorePaper({
  answerKey,
  points,
  questionRules,
  keyVersionFlagged,
  answers,
  flags,
  corrections,
}: RescoreInput): RescoreResult {
  const questionCount = answerKey.length;
  if (points !== undefined && points.length !== questionCount) {
    throw new Error(
      `Expected ${questionCount} point values, got ${points.length}.`,
    );
  }

  let earnedPoints = 0;
  let totalPoints = 0;
  let hasUnresolvedFlag = false;

  for (let qNum = 1; qNum <= questionCount; qNum += 1) {
    const evalRes = evaluateQuestionScore({
      questionNumber: qNum,
      answerKey,
      points,
      questionRules,
      answers,
      flags,
      corrections,
    });
    totalPoints += evalRes.max;
    earnedPoints += evalRes.earned;
    if (evalRes.status === "flagged") {
      hasUnresolvedFlag = true;
    }
  }

  let allBlank = questionCount > 0;
  for (let qNum = 1; qNum <= questionCount; qNum += 1) {
    const effective =
      corrections[qNum] !== undefined
        ? corrections[qNum]
        : (answers[qNum - 1] ?? "");
    if (effective !== "") {
      allBlank = false;
      break;
    }
  }

  const hasAnyCorrection = Object.keys(corrections).length > 0;
  const needsReview =
    hasUnresolvedFlag ||
    Boolean(keyVersionFlagged) ||
    (allBlank && !hasAnyCorrection);
  const score = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;

  return { score, needsReview, earnedPoints, totalPoints };
}

export const rescore = scorePaper;
