import { scorePaper } from "./scoring.ts";
import { resolveQuizKeyForVersion } from "./workspace/keyVersion.ts";
import type { Paper, Quiz } from "./workspace/schema.ts";

export interface ScoreBandBucket {
  label: string;
  count: number;
  pctOfClass: number;
}

export interface QuizStatistics {
  count: number;
  totalPossiblePoints: number | null;
  minPoints: number | null;
  maxPoints: number | null;
  avgPoints: number | null;
  medianPoints: number | null;
  stdDevPoints: number | null;
  minPct: number | null;
  maxPct: number | null;
  avgPct: number | null;
  medianPct: number | null;
  stdDevPct: number | null;
  buckets: ScoreBandBucket[];
}

const BAND_LABELS = [
  "90 to 100%",
  "80 to 89%",
  "70 to 79%",
  "60 to 69%",
  "50 to 59%",
  "40 to 49%",
  "30 to 39%",
  "20 to 29%",
  "10 to 19%",
  "0 to 9%",
] as const;

function summarizeNumbers(values: number[]): {
  min: number;
  max: number;
  avg: number;
  median: number;
  stdDev: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0];
  const max = sorted[n - 1];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = sum / n;
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const variance =
    sorted.reduce((acc, v) => acc + (v - avg) * (v - avg), 0) / n;
  const stdDev = Math.sqrt(variance);
  return { min, max, avg, median, stdDev };
}

export function computeQuizStatistics(
  quiz: Quiz,
  papers: Paper[],
): QuizStatistics {
  const baseKey = resolveQuizKeyForVersion(quiz, "A");
  const baseTotal = scorePaper({
    answerKey: baseKey.answerKey,
    points: baseKey.points,
    questionRules: baseKey.questionRules,
    answers: Array<string>(baseKey.answerKey.length).fill(""),
    flags: {},
    corrections: {},
  }).totalPoints;

  const graded = papers.filter(
    (p) => p.answers.length === quiz.answerKey.length,
  );

  if (graded.length === 0) {
    return {
      count: 0,
      totalPossiblePoints: baseTotal,
      minPoints: null,
      maxPoints: null,
      avgPoints: null,
      medianPoints: null,
      stdDevPoints: null,
      minPct: null,
      maxPct: null,
      avgPct: null,
      medianPct: null,
      stdDevPct: null,
      buckets: BAND_LABELS.map((label) => ({
        label,
        count: 0,
        pctOfClass: 0,
      })),
    };
  }

  const ptsList: number[] = [];
  const pctList: number[] = [];
  const totalList: number[] = [];
  const bandCounts = Array<number>(BAND_LABELS.length).fill(0);

  for (const paper of graded) {
    const keyData = resolveQuizKeyForVersion(quiz, paper.keyVersion);
    const scored = scorePaper({
      answerKey: keyData.answerKey,
      points: keyData.points,
      questionRules: keyData.questionRules,
      answers: paper.answers,
      flags: paper.flags,
      corrections: paper.corrections,
    });
    ptsList.push(scored.earnedPoints);
    pctList.push(scored.score);
    totalList.push(scored.totalPoints);

    const bandIdx =
      scored.score >= 90
        ? 0
        : Math.min(9, Math.max(0, 9 - Math.floor(scored.score / 10)));
    bandCounts[bandIdx] += 1;
  }

  const ptsStats = summarizeNumbers(ptsList);
  const pctStats = summarizeNumbers(pctList);
  const n = graded.length;
  const hasMixedTotals = new Set(totalList).size > 1;

  return {
    count: n,
    totalPossiblePoints: hasMixedTotals ? null : (totalList[0] ?? baseTotal),
    minPoints: hasMixedTotals ? null : ptsStats.min,
    maxPoints: hasMixedTotals ? null : ptsStats.max,
    avgPoints: hasMixedTotals ? null : ptsStats.avg,
    medianPoints: hasMixedTotals ? null : ptsStats.median,
    stdDevPoints: hasMixedTotals ? null : ptsStats.stdDev,
    minPct: pctStats.min,
    maxPct: pctStats.max,
    avgPct: pctStats.avg,
    medianPct: pctStats.median,
    stdDevPct: pctStats.stdDev,
    buckets: BAND_LABELS.map((label, idx) => ({
      label,
      count: bandCounts[idx],
      pctOfClass: Math.round((bandCounts[idx] / n) * 1000) / 10,
    })),
  };
}
