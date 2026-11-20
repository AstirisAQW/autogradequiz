import { evaluateQuestionScore, resolveEffectiveChoice } from "./scoring.ts";
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
  choiceCounts: ChoiceDistribution;
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
    if (p.status !== "done" || p.answers.length !== questionCount) {
      return false;
    }
    if (options?.keyVersion) {
      return resolveQuizKeyForVersion(quiz, p.keyVersion).version === options.keyVersion;
    }
    return true;
  });
  const gradedPaperCount = gradedPapers.length;

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
    let correctCount = 0;
    let creditRatioSum = 0;
    let flaggedCount = 0;

    for (const paper of gradedPapers) {
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
        recordChoiceBucket(choiceCounts, paper.answers[qNum - 1] ?? "");
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
      } else if (evalRes.status === "partial" && evalRes.max > 0) {
        creditRatioSum += Math.max(0, evalRes.earned / evalRes.max);
      }
    }

    const correctPct =
      gradedPaperCount > 0
        ? Math.round((creditRatioSum / gradedPaperCount) * 1000) / 10
        : 0;

    questions.push({
      questionNumber: qNum,
      correctKey,
      pointsWeight,
      correctCount,
      correctPct,
      flaggedCount,
      choiceCounts,
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
