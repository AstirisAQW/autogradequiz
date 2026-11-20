import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAnswerKeyEntry,
  validateAnswerKeyAndPoints,
} from "./answerKey.ts";

test("normalizeAnswerKeyEntry normalizes case, sorts B+A to A+B, and deduplicates", () => {
  assert.equal(normalizeAnswerKeyEntry(" a "), "A");
  assert.equal(normalizeAnswerKeyEntry("B+A"), "A+B");
  assert.equal(normalizeAnswerKeyEntry("e+b+b+a"), "A+B+E");
});

test("normalizeAnswerKeyEntry rejects empty or out-of-range letters", () => {
  for (const invalid of ["", "   ", "+", "F", "A+F", "AB", "1"]) {
    assert.throws(
      () => normalizeAnswerKeyEntry(invalid),
      /Answer choices must be in/,
    );
  }
});

test("validateAnswerKeyAndPoints enforces questionCount, normalizes entries, and validates points", () => {
  const res = validateAnswerKeyAndPoints(3, ["b+a", "c", "E+A"]);
  assert.deepEqual(res.answerKey, ["A+B", "C", "A+E"]);
  assert.deepEqual(res.points, [1, 1, 1]);

  const withPoints = validateAnswerKeyAndPoints(
    2,
    ["A", "B"],
    [2.5, 0],
  );
  assert.deepEqual(withPoints.points, [2.5, 0]);

  assert.throws(
    () => validateAnswerKeyAndPoints(3, ["A", "B"]),
    /Expected 3 answers, got 2\./,
  );
  assert.throws(
    () => validateAnswerKeyAndPoints(2, ["A", "B"], [1]),
    /Expected 2 point values, got 1\./,
  );
  assert.throws(
    () => validateAnswerKeyAndPoints(2, ["A", "B"], [1, -0.5]),
    /Question point values must be non-negative\./,
  );
  assert.throws(
    () => validateAnswerKeyAndPoints(2, ["A", "B"], [1, Number.POSITIVE_INFINITY]),
    /Question point values must be non-negative\./,
  );
  assert.throws(
    () => validateAnswerKeyAndPoints(2, ["A", "B"], [1, Number.NaN]),
    /Question point values must be non-negative\./,
  );
});
