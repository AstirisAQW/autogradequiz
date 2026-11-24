import assert from "node:assert/strict";
import test from "node:test";
import { computeQuizStatistics } from "../src/lib/quizStatistics.ts";
import type { Paper, Quiz } from "../src/lib/workspace/schema.ts";

const quiz: Quiz = {
  id: "q1",
  name: "Stats Quiz",
  templateId: "20q_a4",
  answerKey: ["A", "B", "C", "D"],
  points: [2, 2, 2, 2],
  keyVersions: {
    B: {
      answerKey: ["D", "C", "B", "A"],
      points: [2, 2, 2, 2],
    },
  },
  createdAt: "2026-11-18T00:00:00.000Z",
};

function makePaper(id: string, answers: string[], keyVersion?: "A" | "B"): Paper {
  return {
    id,
    quizId: "q1",
    status: "done",
    answers,
    flags: {},
    confidence: [0.9, 0.9, 0.9, 0.9],
    keyVersion,
    nameText: "",
    dateText: "",
    classText: "",
    studentId: null,
    corrections: {},
    score: 0,
    needsReview: false,
    createdAt: "2026-11-18T00:00:00.000Z",
  };
}

test("computeQuizStatistics returns nulls when no done papers exist", () => {
  const stats = computeQuizStatistics(quiz, []);
  assert.equal(stats.count, 0);
  assert.equal(stats.minPct, null);
  assert.equal(stats.avgPoints, null);
});

test("computeQuizStatistics computes min, max, avg, median, stddev, and 10 equal buckets across key versions", () => {
  const stats = computeQuizStatistics(quiz, [
    makePaper("p1", ["A", "B", "C", "D"], "A"),
    makePaper("p2", ["D", "C", "B", "D"], "B"),
    makePaper("p3", ["A", "A", "A", "A"]),
  ]);

  assert.equal(stats.count, 3);
  assert.equal(stats.minPoints, 2);
  assert.equal(stats.maxPoints, 8);
  assert.equal(stats.medianPoints, 6);
  assert.ok(Math.abs((stats.avgPoints ?? 0) - 16 / 3) < 1e-9);
  assert.equal(stats.minPct, 25);
  assert.equal(stats.maxPct, 100);
  assert.equal(stats.medianPct, 75);
  assert.ok((stats.stdDevPct ?? 0) > 30);
  assert.equal(stats.buckets.length, 10);
  assert.equal(stats.buckets[0].count, 1);
  assert.equal(stats.buckets[2].count, 1);
  assert.equal(stats.buckets[7].count, 1);
});

test("computeQuizStatistics does not inherit Key A questionRules onto Key B", () => {
  const versionQuiz: Quiz = {
    id: "q-rules",
    name: "Rules Quiz",
    templateId: "20q_a4",
    answerKey: ["A", "A"],
    points: [2, 2],
    questionRules: [{ alternateAnswers: [{ choice: "B", points: 1 }] }, {}],
    keyVersions: {
      B: { answerKey: ["C", "C"], points: [2, 2] },
    },
    createdAt: "2026-11-18T00:00:00.000Z",
  };
  const stats = computeQuizStatistics(versionQuiz, [
    makePaper("pa", ["B", "A"], "A"),
    makePaper("pb", ["B", "C"], "B"),
  ]);
  assert.equal(stats.minPoints, 2);
  assert.equal(stats.maxPoints, 3);
});
