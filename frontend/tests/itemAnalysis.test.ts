import assert from "node:assert/strict";
import test from "node:test";
import {
  computeItemAnalysis,
  summarizeQuestionResponse,
} from "../src/lib/itemAnalysis.ts";
import type { Paper, Quiz } from "../src/lib/workspace/schema.ts";

const sampleQuiz: Quiz = {
  id: "q1",
  name: "Bio Quiz",
  templateId: "20q_a4",
  answerKey: ["A", "B+C", "D"],
  points: [1, 2, 1],
  createdAt: "2026-11-18T00:00:00.000Z",
};

function makePaper(overrides: Partial<Paper>): Paper {
  return {
    id: "p",
    quizId: "q1",
    status: "done",
    answers: ["A", "B", "D"],
    flags: {},
    confidence: [0.9, 0.9, 0.9],
    nameText: "",
    dateText: "",
    classText: "",
    studentId: null,
    corrections: {},
    score: 100,
    needsReview: false,
    createdAt: "2026-11-18T00:00:00.000Z",
    ...overrides,
  };
}

test("computeItemAnalysis returns zeroed metrics when no graded papers match", () => {
  const analysis = computeItemAnalysis(sampleQuiz, [
    makePaper({ answers: [] }),
  ]);
  assert.equal(analysis.gradedPaperCount, 0);
  assert.equal(analysis.hardestQuestion, null);
  assert.equal(analysis.easiestQuestion, null);
  assert.equal(analysis.questions.length, 3);
  assert.equal(analysis.questions[0].correctPct, 0);
  assert.equal(analysis.questions[1].pointsWeight, 2);
});

test("computeItemAnalysis handles multi-choice keys, corrections, unresolved flags, blanks, and multiple marks", () => {
  const papers: Paper[] = [
    makePaper({ id: "p1", answers: ["A", "C", "A"] }),
    makePaper({
      id: "p2",
      answers: ["B", "B", "A+E"],
      flags: { "2": "ambiguous", "3": "multiple" },
      corrections: { 3: "D" },
    }),
    makePaper({
      id: "p3",
      answers: ["", "E", "A+D"],
      flags: { "3": "multiple" },
    }),
  ];

  const analysis = computeItemAnalysis(sampleQuiz, papers);
  assert.equal(analysis.gradedPaperCount, 3);
  assert.equal(analysis.questions[0].correctCount, 1);
  assert.equal(analysis.questions[0].correctPct, 33.3);
  assert.deepEqual(analysis.questions[0].choiceCounts, {
    A: 1,
    B: 1,
    C: 0,
    D: 0,
    E: 0,
    Blank: 1,
    Multiple: 0,
  });

  assert.equal(analysis.questions[1].correctCount, 1);
  assert.equal(analysis.questions[1].flaggedCount, 1);
  assert.equal(analysis.questions[2].correctCount, 1);
  assert.equal(analysis.questions[2].flaggedCount, 1);
  assert.equal(analysis.questions[2].choiceCounts.D, 1);
  assert.equal(analysis.questions[2].choiceCounts.Multiple, 1);
});

test("computeItemAnalysis picks hardest and easiest questions accurately", () => {
  const papers: Paper[] = [
    makePaper({ id: "p1", answers: ["A", "A", "D"] }),
    makePaper({ id: "p2", answers: ["A", "A", "A"] }),
  ];
  const analysis = computeItemAnalysis(sampleQuiz, papers);
  assert.equal(analysis.easiestQuestion?.questionNumber, 1);
  assert.equal(analysis.easiestQuestion?.correctPct, 100);
  assert.equal(analysis.hardestQuestion?.questionNumber, 2);
  assert.equal(analysis.hardestQuestion?.correctPct, 0);
});

test("computeItemAnalysis filters by keyVersion when provided", () => {
  const versionedQuiz: Quiz = {
    ...sampleQuiz,
    keyVersions: {
      B: { answerKey: ["E", "E", "E"] },
    },
  };
  const papers: Paper[] = [
    makePaper({ id: "p1", keyVersion: "A", answers: ["A", "B", "D"] }),
    makePaper({ id: "p2", keyVersion: "B", answers: ["E", "E", "A"] }),
  ];
  const analysisB = computeItemAnalysis(versionedQuiz, papers, {
    keyVersion: "B",
  });
  assert.equal(analysisB.gradedPaperCount, 1);
  assert.equal(analysisB.questions[0].correctKey, "E");
  assert.equal(analysisB.questions[0].correctPct, 100);
  assert.equal(analysisB.questions[2].correctPct, 0);

  const analysisAll = computeItemAnalysis(versionedQuiz, [
    makePaper({ id: "p1", keyVersion: "A", answers: ["A", "B", "D"] }),
    makePaper({ id: "p2", keyVersion: "B", answers: ["E", "E", "E"] }),
  ]);
  assert.equal(analysisAll.gradedPaperCount, 2);
  assert.equal(analysisAll.questions[0].correctKey, "Per key");
  assert.equal(analysisAll.questions[0].correctPct, 100);
  assert.equal(analysisAll.questions[2].correctPct, 100);
});

test("summarizeQuestionResponse does not treat right Key A answers as distractors under Per key", () => {
  const versionedQuiz: Quiz = {
    ...sampleQuiz,
    keyVersions: {
      B: { answerKey: ["E", "B+C", "D"] },
    },
  };
  const analysis = computeItemAnalysis(versionedQuiz, [
    makePaper({ id: "p1", keyVersion: "A", answers: ["A", "B", "D"] }),
    makePaper({ id: "p2", keyVersion: "B", answers: ["E", "B", "D"] }),
  ]);
  const summary = summarizeQuestionResponse(analysis.questions[0], 2);
  assert.match(summary, /All correct/);
});
