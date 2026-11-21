import {
  KEY_VERSION_IDS,
  type KeyVersionId,
  type QuestionRule,
  type Quiz,
} from "./schema.ts";

export function getAvailableKeyVersions(quiz: Quiz): KeyVersionId[] {
  const out: KeyVersionId[] = ["A"];
  for (const ver of ["B", "C", "D"] as const) {
    if (quiz.keyVersions?.[ver] !== undefined) {
      out.push(ver);
    }
  }
  return out;
}

export function resolveQuizKeyForVersion(
  quiz: Quiz,
  version?: string,
): {
  version: KeyVersionId;
  answerKey: string[];
  points: number[] | undefined;
  questionRules: QuestionRule[] | undefined;
} {
  const normalized = (version ?? "A").trim().toUpperCase() as KeyVersionId;
  if (
    normalized !== "A" &&
    KEY_VERSION_IDS.includes(normalized) &&
    quiz.keyVersions?.[normalized]
  ) {
    const verData = quiz.keyVersions[normalized]!;
    return {
      version: normalized,
      answerKey: verData.answerKey,
      points: verData.points ?? quiz.points,
      questionRules: verData.questionRules,
    };
  }
  return {
    version: "A",
    answerKey: quiz.answerKey,
    points: quiz.points,
    questionRules: quiz.questionRules,
  };
}
