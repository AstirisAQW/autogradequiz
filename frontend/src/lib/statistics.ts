import { rescore } from "./scoring.ts";
import { resolveQuizKeyForVersion } from "./workspace/keyVersion.ts";
import type { Paper, Quiz } from "./workspace/schema.ts";

export interface ScoreBandBucket {
  label: string;
  count: number;
  pctOfClass: number;
}

export interface QuizStatistics {
  count: number;
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
  const graded = papers.filter(
    (p) => p.status === "done" && p.answers.length === quiz.answerKey.length,
  );

  if (graded.length === 0) {
    return {
      count: 0,
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
      buckets: [
        { label: "90–100%", count: 0, pctOfClass: 0 },
        { label: "80–89%", count: 0, pctOfClass: 0 },
        { label: "70–79%", count: 0, pctOfClass: 0 },
        { label: "60–69%", count: 0, pctOfClass: 0 },
        { label: "< 60%", count: 0, pctOfClass: 0 },
      ],
    };
  }

  const ptsList: number[] = [];
  const pctList: number[] = [];
  const bandCounts = [0, 0, 0, 0, 0];

  for (const paper of graded) {
    const keyData = resolveQuizKeyForVersion(quiz, paper.keyVersion);
    const scored = rescore({
      answerKey: keyData.answerKey,
      points: keyData.points,
      questionRules: keyData.questionRules,
      answers: paper.answers,
      flags: paper.flags,
      corrections: paper.corrections,
    });
    ptsList.push(scored.earnedPoints);
    pctList.push(scored.score);

    if (scored.score >= 90) bandCounts[0] += 1;
    else if (scored.score >= 80) bandCounts[1] += 1;
    else if (scored.score >= 70) bandCounts[2] += 1;
    else if (scored.score >= 60) bandCounts[3] += 1;
    else bandCounts[4] += 1;
  }

  const ptsStats = summarizeNumbers(ptsList);
  const pctStats = summarizeNumbers(pctList);
  const labels = ["90–100%", "80–89%", "70–79%", "60–69%", "< 60%"];
  const n = graded.length;

  return {
    count: n,
    minPoints: ptsStats.min,
    maxPoints: ptsStats.max,
    avgPoints: ptsStats.avg,
    medianPoints: ptsStats.median,
    stdDevPoints: ptsStats.stdDev,
    minPct: pctStats.min,
    maxPct: pctStats.max,
    avgPct: pctStats.avg,
    medianPct: pctStats.median,
    stdDevPct: pctStats.stdDev,
    buckets: labels.map((label, idx) => ({
      label,
      count: bandCounts[idx],
      pctOfClass: Math.round((bandCounts[idx] / n) * 1000) / 10,
    })),
  };
}
