import assert from "node:assert/strict";
import test from "node:test";
import { computeTagReport } from "../src/lib/tagReport.ts";
import type { Paper, Quiz } from "../src/lib/workspace/schema.ts";

const taggedQuiz: Quiz = {
  id: "q1",
  name: "Bio",
  templateId: "20q_a4",
  answerKey: ["A", "B", "C", "D"],
  points: [1, 1, 2, 1],
  questionRules: [
    { tags: ["Cells"] },
    { tags: ["Cells", "Lab"] },
    { tags: ["Genetics"], alternateAnswers: [{ choice: "A", points: 1 }] },
    {},
  ],
  createdAt: "2026-11-18T00:00:00.000Z",
};

function makePaper(id: string, answers: string[]): Paper {
  return {
    id,
    quizId: "q1",
    status: "done",
    answers,
    flags: {},
    confidence: [0.9, 0.9, 0.9, 0.9],
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

test("computeTagReport aggregates per-tag earned/possible points and proficiency", () => {
  const report = computeTagReport(taggedQuiz, [
    makePaper("p1", ["A", "B", "C", "D"]),
    makePaper("p2", ["A", "D", "A", "D"]),
  ]);

  assert.equal(report.gradedPaperCount, 2);
  assert.equal(report.tags.length, 3);

  const cells = report.tags.find((t) => t.tag === "Cells")!;
  assert.deepEqual(cells.questionNumbers, [1, 2]);
  assert.equal(cells.earnedPoints, 3);
  assert.equal(cells.possiblePoints, 4);
  assert.equal(cells.avgPct, 75);
  assert.equal(cells.proficientCount, 1);

  const genetics = report.tags.find((t) => t.tag === "Genetics")!;
  assert.deepEqual(genetics.questionNumbers, [3]);
  assert.equal(genetics.earnedPoints, 3);
  assert.equal(genetics.possiblePoints, 4);
  assert.equal(genetics.avgPct, 75);
});

test("computeTagReport keeps Key A and Key B rules/tags isolated per paper", () => {
  const verQuiz: Quiz = {
    id: "q-ver",
    name: "Bio",
    templateId: "20q_a4",
    answerKey: ["A"],
    points: [2],
    questionRules: [
      { tags: ["TopicA"], alternateAnswers: [{ choice: "B", points: 1 }] },
    ],
    keyVersions: {
      B: {
        answerKey: ["C"],
        points: [2],
        questionRules: [{ tags: ["TopicA"] }],
      },
    },
    createdAt: "2026-11-18T00:00:00.000Z",
  };
  const report = computeTagReport(verQuiz, [
    { ...makePaper("pA", ["B"]), keyVersion: "A" },
    { ...makePaper("pB", ["B"]), keyVersion: "B" },
  ]);
  assert.equal(report.tags[0].earnedPoints, 1);
  assert.equal(report.tags[0].possiblePoints, 4);
  assert.equal(report.tags[0].avgPct, 25);
});
