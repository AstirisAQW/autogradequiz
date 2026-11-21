import assert from "node:assert/strict";
import test from "node:test";
import { computeQuizStatistics } from "./statistics.ts";
import type { Paper, Quiz } from "./workspace/schema.ts";

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
    batchId: "b1",
    status: "done",
    answers,
    flags: {},
    confidence: [0.9, 0.9, 0.9, 0.9],
    keyVersion,
    nameText: "",
    dateText: "",
    sectionText: "",
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

test("computeQuizStatistics computes min, max, avg, median, stddev, and buckets across key versions", () => {
  // Paper 1 (Key A): 4/4 = 8 pts (100%)
  // Paper 2 (Key B): 3/4 = 6 pts (75%)
  // Paper 3 (Key A): 1/4 = 2 pts (25%)
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
  assert.equal(stats.buckets[0].count, 1); // 90-100
  assert.equal(stats.buckets[2].count, 1); // 70-79
  assert.equal(stats.buckets[4].count, 1); // < 60
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
    makePaper("pa", ["B", "A"], "A"), // 1 + 2 = 3 pts (75%)
    makePaper("pb", ["B", "C"], "B"), // 0 + 2 = 2 pts (50%, NOT 3 pts)
  ]);
  assert.equal(stats.minPoints, 2);
  assert.equal(stats.maxPoints, 3);
});
