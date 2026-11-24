import {
  evaluateQuestionScore,
  rescore,
  resolveEffectiveChoice,
} from "./scoring.ts";
import { ANSWER_CHOICES } from "./types.ts";
import {
  getAvailableKeyVersions,
  resolveQuizKeyForVersion,
} from "./workspace/keyVersion.ts";
import type { KeyVersionId, Paper, Quiz } from "./workspace/schema.ts";

export interface ChoiceDistribution {
  A: number;
  B: number;
  C: number;
  D: number;
  E: number;
  Blank: number;
  Multiple: number;
}

export interface QuestionItemAnalysis {
  questionNumber: number;
  correctKey: string;
  pointsWeight: number;
  correctCount: number;
  correctPct: number;
  flaggedCount: number;
  discriminationIndex: number | null;
  choiceCounts: ChoiceDistribution;
  wrongChoiceCounts?: ChoiceDistribution;
}

export interface QuizItemAnalysis {
  gradedPaperCount: number;
  questions: QuestionItemAnalysis[];
  hardestQuestion: QuestionItemAnalysis | null;
  easiestQuestion: QuestionItemAnalysis | null;
}

function emptyDistribution(): ChoiceDistribution {
  return { A: 0, B: 0, C: 0, D: 0, E: 0, Blank: 0, Multiple: 0 };
}

function recordChoiceBucket(counts: ChoiceDistribution, rawValue: string): void {
  if (rawValue === "") {
    counts.Blank += 1;
  } else if (rawValue.includes("+")) {
    counts.Multiple += 1;
  } else if (
    ANSWER_CHOICES.includes(rawValue as (typeof ANSWER_CHOICES)[number])
  ) {
    counts[rawValue as (typeof ANSWER_CHOICES)[number]] += 1;
  } else {
    counts.Blank += 1;
  }
}

export function computeItemAnalysis(
  quiz: Quiz,
  papers: Paper[],
  options?: { keyVersion?: KeyVersionId },
): QuizItemAnalysis {
  const versionData = options?.keyVersion
    ? resolveQuizKeyForVersion(quiz, options.keyVersion)
    : undefined;
  const availableVersions = getAvailableKeyVersions(quiz);
  const multiKeyAll = !options?.keyVersion && availableVersions.length > 1;

  const questionCount = quiz.answerKey.length;
  const gradedPapers = papers.filter((p) => {
    if (p.answers.length !== questionCount) {
      return false;
    }
    if (options?.keyVersion) {
      return resolveQuizKeyForVersion(quiz, p.keyVersion).version === options.keyVersion;
    }
    return true;
  });
  const gradedPaperCount = gradedPapers.length;
  const k =
    gradedPaperCount >= 4
      ? Math.min(
          Math.floor(gradedPaperCount / 2),
          Math.max(2, Math.floor(gradedPaperCount * 0.27)),
        )
      : 0;
  const rankedPapers =
    k > 0
      ? gradedPapers
          .map((paper, idx) => {
            const resolved =
              versionData ?? resolveQuizKeyForVersion(quiz, paper.keyVersion);
            const totalScore = rescore({
              answerKey: resolved.answerKey,
              points: resolved.points,
              questionRules: resolved.questionRules,
              answers: paper.answers,
              flags: paper.flags,
              corrections: paper.corrections,
            }).score;
            return { idx, totalScore };
          })
          .sort((a, b) => b.totalScore - a.totalScore)
      : [];
  const topGroup = k > 0 ? rankedPapers.slice(0, k) : [];
  const bottomGroup = k > 0 ? rankedPapers.slice(-k) : [];

  const questions: QuestionItemAnalysis[] = [];

  for (let qNum = 1; qNum <= questionCount; qNum += 1) {
    let correctKey: string;
    if (versionData) {
      correctKey = versionData.answerKey[qNum - 1] ?? "";
    } else if (multiKeyAll) {
      const distinct = new Set(
        availableVersions.map(
          (ver) => resolveQuizKeyForVersion(quiz, ver).answerKey[qNum - 1] ?? "",
        ),
      );
      correctKey = distinct.size === 1 ? Array.from(distinct)[0] : "Per key";
    } else {
      correctKey = quiz.answerKey[qNum - 1] ?? "";
    }
    const basePoints = versionData?.points ?? quiz.points;
    const pointsWeight = basePoints ? Number(basePoints[qNum - 1] ?? 1) : 1;
    const choiceCounts = emptyDistribution();
    const wrongChoiceCounts = emptyDistribution();
    let correctCount = 0;
    let creditRatioSum = 0;
    let flaggedCount = 0;
    const correctIndices = new Set<number>();

    for (let pIdx = 0; pIdx < gradedPapers.length; pIdx += 1) {
      const paper = gradedPapers[pIdx];
      const resolved =
        versionData ?? resolveQuizKeyForVersion(quiz, paper.keyVersion);
      const { choice: effectiveChoice, isUnresolvedFlag } =
        resolveEffectiveChoice(
          qNum,
          paper.answers,
          paper.flags,
          paper.corrections,
        );

      if (isUnresolvedFlag) {
        flaggedCount += 1;
        const flaggedRaw = paper.answers[qNum - 1] ?? "";
        recordChoiceBucket(choiceCounts, flaggedRaw);
        recordChoiceBucket(wrongChoiceCounts, flaggedRaw);
        continue;
      }

      recordChoiceBucket(choiceCounts, effectiveChoice);
      const evalRes = evaluateQuestionScore({
        questionNumber: qNum,
        answerKey: resolved.answerKey,
        points: resolved.points,
        questionRules: resolved.questionRules,
        answers: paper.answers,
        flags: paper.flags,
        corrections: paper.corrections,
      });
      if (evalRes.status === "correct") {
        correctCount += 1;
        creditRatioSum += 1;
        correctIndices.add(pIdx);
      } else {
        recordChoiceBucket(wrongChoiceCounts, effectiveChoice);
        if (evalRes.status === "partial" && evalRes.max > 0) {
          creditRatioSum += Math.max(0, evalRes.earned / evalRes.max);
        }
      }
    }

    const correctPct =
      gradedPaperCount > 0
        ? Math.round((creditRatioSum / gradedPaperCount) * 1000) / 10
        : 0;

    let discriminationIndex: number | null = null;
    if (k > 0) {
      const topCorrect = topGroup.filter((e) =>
        correctIndices.has(e.idx),
      ).length;
      const bottomCorrect = bottomGroup.filter((e) =>
        correctIndices.has(e.idx),
      ).length;
      discriminationIndex = Number(
        ((topCorrect - bottomCorrect) / k).toFixed(2),
      );
    }

    questions.push({
      questionNumber: qNum,
      correctKey,
      pointsWeight,
      correctCount,
      correctPct,
      flaggedCount,
      discriminationIndex,
      choiceCounts,
      wrongChoiceCounts,
    });
  }

  let hardestQuestion: QuestionItemAnalysis | null = null;
  let easiestQuestion: QuestionItemAnalysis | null = null;
  if (gradedPaperCount > 0 && questions.length > 0) {
    hardestQuestion = questions[0];
    easiestQuestion = questions[0];
    for (const item of questions.slice(1)) {
      if (item.correctPct < hardestQuestion.correctPct) {
        hardestQuestion = item;
      }
      if (item.correctPct > easiestQuestion.correctPct) {
        easiestQuestion = item;
      }
    }
  }

  return {
    gradedPaperCount,
    questions,
    hardestQuestion,
    easiestQuestion,
  };
}

export function summarizeQuestionResponse(
  item: QuestionItemAnalysis,
  totalPapers: number,
): string {
  if (totalPapers <= 0) return "—";
  if (item.correctCount >= totalPapers && item.correctPct >= 100) {
    return "All correct";
  }
  if (!item.wrongChoiceCounts && item.correctKey === "Per key") {
    return "Select a key version to see patterns";
  }

  const allBuckets: Array<{
    key: keyof ChoiceDistribution;
    count: number;
  }> = [
    { key: "A", count: item.choiceCounts.A },
    { key: "B", count: item.choiceCounts.B },
    { key: "C", count: item.choiceCounts.C },
    { key: "D", count: item.choiceCounts.D },
    { key: "E", count: item.choiceCounts.E },
    { key: "Blank", count: item.choiceCounts.Blank },
    { key: "Multiple", count: item.choiceCounts.Multiple },
  ];

  let topCount = 0;
  for (const b of allBuckets) {
    if (b.count > topCount) topCount = b.count;
  }

  const wrongSource = item.wrongChoiceCounts ?? item.choiceCounts;
  const wrongBuckets: Array<{
    key: keyof ChoiceDistribution;
    count: number;
  }> = [
    { key: "A", count: wrongSource.A },
    { key: "B", count: wrongSource.B },
    { key: "C", count: wrongSource.C },
    { key: "D", count: wrongSource.D },
    { key: "E", count: wrongSource.E },
    { key: "Blank", count: wrongSource.Blank },
    { key: "Multiple", count: wrongSource.Multiple },
  ];

  const accepted =
    item.wrongChoiceCounts || item.correctKey === "Per key"
      ? []
      : item.correctKey.split("+").filter(Boolean);

  let wrongKey: keyof ChoiceDistribution | null = null;
  let wrongCount = 0;
  for (const b of wrongBuckets) {
    if (b.count <= 0) continue;
    if (accepted.includes(b.key)) continue;
    if (b.count > wrongCount) {
      wrongKey = b.key;
      wrongCount = b.count;
    }
  }

  if (!wrongKey || wrongCount === 0) {
    return "All correct";
  }
  if (wrongKey === "Blank") {
    return `Left blank (${wrongCount} of ${totalPapers})`;
  }
  if (wrongKey === "Multiple") {
    return `Multiple marks (${wrongCount} of ${totalPapers})`;
  }
  if (wrongCount >= topCount) {
    return `Most chose ${wrongKey} (${wrongCount} of ${totalPapers})`;
  }
  return `Common miss: ${wrongKey} (${wrongCount} of ${totalPapers})`;
}
