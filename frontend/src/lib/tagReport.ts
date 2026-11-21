import { evaluateQuestionScore } from "./scoring.ts";
import { resolveQuizKeyForVersion } from "./workspace/keyVersion.ts";
import type { Paper, Quiz } from "./workspace/schema.ts";

export interface TagPerformanceRow {
  tag: string;
  questionNumbers: number[];
  questionCount: number;
  gradedPaperCount: number;
  earnedPoints: number;
  possiblePoints: number;
  avgPct: number;
  proficientCount: number;
}

export interface QuizTagReport {
  gradedPaperCount: number;
  tags: TagPerformanceRow[];
}

export function collectAllQuizTags(quiz: Quiz): string[] {
  const set = new Set<string>(quiz.tags ?? []);
  for (const rule of quiz.questionRules ?? []) {
    for (const tag of rule.tags ?? []) {
      const cleaned = tag.trim();
      if (cleaned) set.add(cleaned);
    }
  }
  for (const ver of Object.values(quiz.keyVersions ?? {})) {
    for (const rule of ver?.questionRules ?? []) {
      for (const tag of rule.tags ?? []) {
        const cleaned = tag.trim();
        if (cleaned) set.add(cleaned);
      }
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function computeTagReport(quiz: Quiz, papers: Paper[]): QuizTagReport {
  const graded = papers.filter(
    (p) => p.status === "done" && p.answers.length === quiz.answerKey.length,
  );

  // Discover all question-level tags defined on primary (and alternates if any)
  const questionNumsByTag = new Map<string, Set<number>>();
  const registerTags = (rules: Quiz["questionRules"]) => {
    rules?.forEach((rule, idx) => {
      for (const rawTag of rule.tags ?? []) {
        const tag = rawTag.trim();
        if (!tag) continue;
        if (!questionNumsByTag.has(tag)) {
          questionNumsByTag.set(tag, new Set());
        }
        questionNumsByTag.get(tag)!.add(idx + 1);
      }
    });
  };
  registerTags(quiz.questionRules);
  for (const ver of Object.values(quiz.keyVersions ?? {})) {
    registerTags(ver?.questionRules);
  }

  const rows: TagPerformanceRow[] = [];
  for (const [tag, qSet] of questionNumsByTag.entries()) {
    const questionNumbers = Array.from(qSet).sort((a, b) => a - b);
    let totalEarned = 0;
    let totalPossible = 0;
    let proficientCount = 0;

    for (const paper of graded) {
      const resolved = resolveQuizKeyForVersion(quiz, paper.keyVersion);
      const answerKey = resolved.answerKey;
      const points = resolved.points;
      const questionRules = resolved.questionRules;

      let paperEarned = 0;
      let paperPossible = 0;
      for (let idx = 0; idx < answerKey.length; idx += 1) {
        const qNum = idx + 1;
        const qTags = questionRules?.[idx]?.tags ?? [];
        if (!qTags.some((t) => t.trim() === tag)) continue;
        const res = evaluateQuestionScore({
          questionNumber: qNum,
          answerKey,
          points,
          questionRules,
          answers: paper.answers,
          flags: paper.flags,
          corrections: paper.corrections,
        });
        paperEarned += res.earned;
        paperPossible += res.max;
      }

      totalEarned += paperEarned;
      totalPossible += paperPossible;
      if (paperPossible > 0 && paperEarned / paperPossible >= 0.7) {
        proficientCount += 1;
      }
    }

    const avgPct =
      totalPossible > 0
        ? Math.round((totalEarned / totalPossible) * 1000) / 10
        : 0;

    rows.push({
      tag,
      questionNumbers,
      questionCount: questionNumbers.length,
      gradedPaperCount: graded.length,
      earnedPoints: Math.round(totalEarned * 100) / 100,
      possiblePoints: Math.round(totalPossible * 100) / 100,
      avgPct,
      proficientCount,
    });
  }

  rows.sort((a, b) => a.tag.localeCompare(b.tag));
  return { gradedPaperCount: graded.length, tags: rows };
}
