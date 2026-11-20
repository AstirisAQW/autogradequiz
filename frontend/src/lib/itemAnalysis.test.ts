import assert from "node:assert/strict";
import test from "node:test";
import { computeItemAnalysis } from "./itemAnalysis.ts";
import type { Paper, Quiz } from "./workspace/schema.ts";

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
    batchId: "b1",
    status: "done",
    answers: ["A", "B", "D"],
    flags: {},
    confidence: [0.9, 0.9, 0.9],
    nameText: "",
    dateText: "",
    sectionText: "",
    studentId: null,
    corrections: {},
    score: 100,
    needsReview: false,
    createdAt: "2026-11-18T00:00:00.000Z",
    ...overrides,
  };
}

test("computeItemAnalysis returns zeroed metrics when no done papers exist", () => {
  const analysis = computeItemAnalysis(sampleQuiz, [
    makePaper({ status: "failed", answers: [] }),
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
    // P1: Q1 correct (A), Q2 correct (C in B+C), Q3 wrong (A)
    makePaper({ id: "p1", answers: ["A", "C", "A"] }),
    // P2: Q1 wrong (B), Q2 flagged ambiguous read as B -> unresolved (not correct, flaggedCount=1), Q3 multiple A+E -> corrected to D (correct)
    makePaper({
      id: "p2",
      answers: ["B", "B", "A+E"],
      flags: { "2": "ambiguous", "3": "multiple" },
      corrections: { 3: "D" },
    }),
    // P3: Q1 blank, Q2 wrong (E), Q3 wrong (A+D unresolved multiple)
    makePaper({
      id: "p3",
      answers: ["", "E", "A+D"],
      flags: { "3": "multiple" },
    }),
  ];

  const analysis = computeItemAnalysis(sampleQuiz, papers);
  assert.equal(analysis.gradedPaperCount, 3);

  // Q1: P1 A (correct), P2 B, P3 Blank => 1/3 = 33.3%
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

  // Q2: P1 C (correct), P2 B unresolved (flaggedCount=1), P3 E => 1/3 = 33.3%
  assert.equal(analysis.questions[1].correctCount, 1);
  assert.equal(analysis.questions[1].flaggedCount, 1);
  assert.equal(analysis.questions[1].choiceCounts.C, 1);
  assert.equal(analysis.questions[1].choiceCounts.B, 1);
  assert.equal(analysis.questions[1].choiceCounts.E, 1);

  // Q3: P1 A, P2 corrected D (correct), P3 A+D unresolved (flaggedCount=1, Multiple=1)
  assert.equal(analysis.questions[2].correctCount, 1);
  assert.equal(analysis.questions[2].flaggedCount, 1);
  assert.equal(analysis.questions[2].choiceCounts.D, 1);
  assert.equal(analysis.questions[2].choiceCounts.Multiple, 1);
});

test("computeItemAnalysis picks hardest and easiest questions accurately", () => {
  const papers: Paper[] = [
    makePaper({ id: "p1", answers: ["A", "A", "D"] }), // Q1 correct, Q2 wrong, Q3 correct
    makePaper({ id: "p2", answers: ["A", "A", "A"] }), // Q1 correct, Q2 wrong, Q3 wrong
  ];
  const analysis = computeItemAnalysis(sampleQuiz, papers);
  // Q1 = 100%, Q2 = 0%, Q3 = 50%
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

  // "All versions" evaluates each paper against its own key and labels disagreeing keys "Per key"
  const analysisAll = computeItemAnalysis(versionedQuiz, [
    makePaper({ id: "p1", keyVersion: "A", answers: ["A", "B", "D"] }),
    makePaper({ id: "p2", keyVersion: "B", answers: ["E", "E", "E"] }),
  ]);
  assert.equal(analysisAll.gradedPaperCount, 2);
  assert.equal(analysisAll.questions[0].correctKey, "Per key");
  assert.equal(analysisAll.questions[0].correctPct, 100);
  assert.equal(analysisAll.questions[2].correctPct, 100);
});
