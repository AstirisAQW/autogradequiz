import assert from "node:assert/strict";
import test from "node:test";
import {
  bubbleCenterMm,
  bubbleRadiusMm,
  KEY_VERSION_BUBBLE_RADIUS_MM,
  keyVersionBubbleCenterMm,
  questionRegionPercent,
  questionRowBoxMm,
} from "./sheetGeometry.ts";

test("bubbleCenterMm computes coordinates for 20q, 50q, and 100q templates with row group gap", () => {
  assert.deepEqual(bubbleCenterMm(1, 0, 20), { x: 40, y: 60 });
  assert.deepEqual(bubbleCenterMm(11, 4, 20), { x: 156, y: 60 });
  assert.equal(bubbleRadiusMm(20), 3.0);

  // Q11 in 50q starts the second group of 10 in column 1, adding +5mm gap
  assert.deepEqual(bubbleCenterMm(10, 0, 50), { x: 25, y: 132 });
  assert.deepEqual(bubbleCenterMm(11, 0, 50), { x: 25, y: 145 });
  assert.equal(bubbleRadiusMm(50), 2.4);

  // Q21 in 100q moves to column 2
  assert.deepEqual(bubbleCenterMm(21, 1, 100), { x: 66.5, y: 60 });
  assert.equal(bubbleRadiusMm(100), 1.6);
});

test("questionRowBoxMm matches questionRegionPercent scaled by A4 size", () => {
  const boxMm = questionRowBoxMm(5, 20);
  const pct = questionRegionPercent(5, 20);
  assert.ok(Math.abs((boxMm.x / 210) * 100 - pct.left) < 1e-9);
  assert.ok(Math.abs((boxMm.y / 297) * 100 - pct.top) < 1e-9);
  assert.ok(Math.abs((boxMm.width / 210) * 100 - pct.width) < 1e-9);
  assert.ok(Math.abs((boxMm.height / 297) * 100 - pct.height) < 1e-9);
});

test("keyVersionBubbleCenterMm matches printed strip coordinates", () => {
  assert.deepEqual(keyVersionBubbleCenterMm(0), { x: 56, y: 47 });
  assert.deepEqual(keyVersionBubbleCenterMm(1), { x: 74, y: 47 });
  assert.deepEqual(keyVersionBubbleCenterMm(3), { x: 110, y: 47 });
  assert.equal(KEY_VERSION_BUBBLE_RADIUS_MM, 2.4);
});
