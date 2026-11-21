const ANSWER_CHOICES = ["A", "B", "C", "D", "E"] as const;

export function normalizeAnswerKeyEntry(entry: string): string {
  const parts = entry
    .split("+")
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);

  if (
    parts.length === 0 ||
    parts.some(
      (part) => !ANSWER_CHOICES.includes(part as (typeof ANSWER_CHOICES)[number]),
    )
  ) {
    throw new Error(`Answer choices must be in (${ANSWER_CHOICES.join(", ")}).`);
  }

  const uniqueSorted = Array.from(new Set(parts)).sort(
    (a, b) =>
      ANSWER_CHOICES.indexOf(a as (typeof ANSWER_CHOICES)[number]) -
      ANSWER_CHOICES.indexOf(b as (typeof ANSWER_CHOICES)[number]),
  );
  return uniqueSorted.join("+");
}

export function validateAnswerKeyAndPoints(
  questionCount: number,
  answerKey: string[],
  points?: number[],
): { answerKey: string[]; points: number[] } {
  if (!Number.isInteger(questionCount) || questionCount <= 0) {
    throw new Error("questionCount must be a positive integer.");
  }
  if (answerKey.length !== questionCount) {
    throw new Error(
      `Expected ${questionCount} answers, got ${answerKey.length}.`,
    );
  }

  const normalizedKey = answerKey.map(normalizeAnswerKeyEntry);

  if (points === undefined) {
    return {
      answerKey: normalizedKey,
      points: Array<number>(questionCount).fill(1),
    };
  }

  if (points.length !== questionCount) {
    throw new Error(
      `Expected ${questionCount} point values, got ${points.length}.`,
    );
  }
  if (points.some((p) => typeof p !== "number" || !Number.isFinite(p) || p < 0)) {
    throw new Error("Question point values must be non-negative.");
  }

  return {
    answerKey: normalizedKey,
    points: points.map((p) => Number(p)),
  };
}
