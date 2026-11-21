import assert from "node:assert/strict";
import test from "node:test";
import { rescore } from "./scoring.ts";

test("trace-ambiguous case: 5.0% before correction, 10.0% after correction", () => {
  const answerKey = Array(20).fill("A");
  const answers = ["A", "A", ...Array(18).fill("")];
  const flags = { "2": "ambiguous" as const };

  const before = rescore({
    answerKey,
    answers,
    flags,
    corrections: {},
  });
  assert.equal(before.score, 5.0);
  assert.equal(before.needsReview, true);

  const after = rescore({
    answerKey,
    answers,
    flags,
    corrections: { 2: "A" },
  });
  assert.equal(after.score, 10.0);
  assert.equal(after.needsReview, false);
});

test("weighted points compute exact percentage", () => {
  const result = rescore({
    answerKey: ["A", "B", "C", "D"],
    points: [2, 1, 3, 0],
    answers: ["A", "C", "C", "A"],
    flags: {},
    corrections: {},
  });
  // Earned 2 + 3 = 5 out of 2 + 1 + 3 + 0 = 6
  assert.ok(Math.abs(result.score - (5 / 6) * 100) < 1e-9);
  assert.equal(result.needsReview, false);
});

test("multi-choice key A+B and multiple-mark flag behavior", () => {
  const answerKey = ["A+B", "A+B", "A+B"];
  // Q1="A" (valid), Q2="B" (valid), Q3="A+B" (flagged multiple -> 0 until corrected)
  const before = rescore({
    answerKey,
    answers: ["A", "B", "A+B"],
    flags: { "3": "multiple" },
    corrections: {},
  });
  assert.ok(Math.abs(before.score - (2 / 3) * 100) < 1e-9);
  assert.equal(before.needsReview, true);

  const afterMatch = rescore({
    answerKey,
    answers: ["A", "B", "A+B"],
    flags: { "3": "multiple" },
    corrections: { 3: "B" },
  });
  assert.equal(afterMatch.score, 100);
  assert.equal(afterMatch.needsReview, false);
});

test("blank answers require review until explicitly corrected", () => {
  const answerKey = ["A", "B", "C", "D"];
  const allBlank = rescore({
    answerKey,
    answers: ["", "", "", ""],
    flags: {},
    corrections: {},
  });
  assert.equal(allBlank.score, 0);
  assert.equal(allBlank.needsReview, true);

  const confirmedBlank = rescore({
    answerKey,
    answers: ["", "", "", ""],
    flags: {},
    corrections: { 1: "" },
  });
  assert.equal(confirmedBlank.score, 0);
  assert.equal(confirmedBlank.needsReview, false);
});

test("corrections that match and do not match the key both clear flags", () => {
  const answerKey = ["A", "B", "C", "D"];
  const answers = ["A", "B", "A+C", "E"];
  const flags = { "3": "multiple" as const, "4": "ambiguous" as const };

  // Correct only Q3 -> still needsReview because Q4 is uncorrected
  const partial = rescore({
    answerKey,
    answers,
    flags,
    corrections: { 3: "C" },
  });
  assert.equal(partial.score, 75);
  assert.equal(partial.needsReview, true);

  // Correct Q4 to a wrong choice "E" -> clears flag, does not add points
  const full = rescore({
    answerKey,
    answers,
    flags,
    corrections: { 3: "C", 4: "E" },
  });
  assert.equal(full.score, 75);
  assert.equal(full.needsReview, false);
});

test("backend parity (a): key [B]+[C]*19, all answers A, correction {1: B} -> 5.0", () => {
  const result = rescore({
    answerKey: ["B", ...Array(19).fill("C")],
    answers: Array(20).fill("A"),
    flags: {},
    corrections: { 1: "B" },
  });
  assert.equal(result.score, 5.0);
  assert.equal(result.needsReview, false);
});

test("backend parity (b): key [A+B]+[C]*19, points [2]+[0]*19, answers [A]+['']*19 -> 100.0", () => {
  const result = rescore({
    answerKey: ["A+B", ...Array(19).fill("C")],
    points: [2, ...Array(19).fill(0)],
    answers: ["A", ...Array(19).fill("")],
    flags: {},
    corrections: {},
  });
  assert.equal(result.score, 100.0);
  assert.equal(result.needsReview, false);
});

test("throws an Error when points length does not match answerKey length", () => {
  assert.throws(
    () =>
      rescore({
        answerKey: ["A", "B", "C"],
        points: [1, 2],
        answers: ["A", "B", "C"],
        flags: {},
        corrections: {},
      }),
    /Expected 3 point values, got 2\./,
  );
});

test("supports partial-credit alternate answers and attempted-incorrect points", () => {
  const result = rescore({
    answerKey: ["A", "A", "A", "A"],
    points: [2, 2, 2, 2],
    questionRules: [
      { alternateAnswers: [{ choice: "B", points: 1 }], incorrectPoints: -0.5 },
      { alternateAnswers: [{ choice: "B", points: 1 }], incorrectPoints: -0.5 },
      { alternateAnswers: [{ choice: "B", points: 1 }], incorrectPoints: -0.5 },
      { alternateAnswers: [{ choice: "B", points: 3 }], incorrectPoints: 0.25 },
    ],
    answers: ["B", "C", "", "D"],
    flags: {},
    corrections: {},
  });
  // Q1=1, Q2=-0.5, Q3=0 (blank), Q4=0.25 => 0.75 / (2+2+2+3=9)
  assert.equal(result.earnedPoints, 0.75);
  assert.equal(result.totalPoints, 9);
  assert.ok(Math.abs(result.score - (0.75 / 9) * 100) < 1e-9);
});
