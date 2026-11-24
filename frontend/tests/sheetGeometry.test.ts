import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bubbleCenterMm,
  bubbleRadiusMm,
  KEY_VERSION_BUBBLE_RADIUS_MM,
  keyVersionBubbleCenterMm,
  questionRegionPercent,
  questionRowBoxMm,
} from "../src/lib/sheetGeometry.ts";

test("bubbleCenterMm computes coordinates for 20q, 50q, and 100q templates with row group gap", () => {
  assert.deepEqual(bubbleCenterMm(1, 0, 20), { x: 40, y: 60 });
  assert.deepEqual(bubbleCenterMm(11, 4, 20), { x: 156, y: 60 });
  assert.equal(bubbleRadiusMm(20), 3.0);

  assert.deepEqual(bubbleCenterMm(10, 0, 50), { x: 25, y: 132 });
  assert.deepEqual(bubbleCenterMm(11, 0, 50), { x: 25, y: 145 });
  assert.equal(bubbleRadiusMm(50), 2.4);

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

test("sheetGeometry matches backend template JSON exports for 20q, 50q, and 100q", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const templatesDir = path.resolve(here, "../../backend/data/templates");
  const files = [
    "20q_a4/autograde20Questions_template.json",
    "50q_a4/autograde50Questions_template.json",
    "100q_a4/autograde100Questions_template.json",
  ];

  for (const rel of files) {
    const spec = JSON.parse(
      fs.readFileSync(path.join(templatesDir, rel), "utf8"),
    ) as {
      page: { width_mm: number; height_mm: number };
      text_fields: Array<{ id: string; label: string }>;
      answer_grid: {
        question_count: number;
        row_spacing: number;
        choice_spacing: number;
        bubble_radius: number;
        columns: Array<{
          origin_x: number;
          origin_y: number;
          question_start: number;
          question_end: number;
        }>;
      };
      key_version_strip: {
        choices: string[];
        origin_x: number;
        origin_y: number;
        choice_spacing: number;
        bubble_radius: number;
      };
    };

    assert.deepEqual(
      spec.text_fields.map((f) => f.id),
      ["name", "date", "class", "student_id"],
      `${rel} text_fields IDs mismatch`,
    );

    const { width_mm: wMm, height_mm: hMm } = spec.page;
    const grid = spec.answer_grid;
    const totalQ = grid.question_count;
    assert.ok(
      Math.abs(bubbleRadiusMm(totalQ) - grid.bubble_radius * wMm) < 0.01,
      `${rel} bubble radius mismatch`,
    );

    const rowSpacingMm = grid.row_spacing * hMm;
    const choiceSpacingMm = grid.choice_spacing * wMm;
    for (const col of grid.columns) {
      const originXMm = col.origin_x * wMm;
      const originYMm = col.origin_y * hMm;
      for (const qNum of [col.question_start, col.question_end]) {
        const rowIdx = qNum - col.question_start;
        const expectedY =
          originYMm + rowIdx * rowSpacingMm + Math.floor(rowIdx / 10) * 5.0;
        for (const choiceIdx of [0, 4]) {
          const expectedX = originXMm + choiceIdx * choiceSpacingMm;
          const got = bubbleCenterMm(qNum, choiceIdx, totalQ);
          assert.ok(
            Math.abs(got.x - expectedX) < 0.01 &&
              Math.abs(got.y - expectedY) < 0.01,
            `${rel} Q${qNum} choice ${choiceIdx}: got (${got.x}, ${got.y}) vs (${expectedX}, ${expectedY})`,
          );
        }
      }
    }

    const kv = spec.key_version_strip;
    assert.ok(
      Math.abs(KEY_VERSION_BUBBLE_RADIUS_MM - kv.bubble_radius * wMm) < 0.01,
      `${rel} key version radius mismatch`,
    );
    kv.choices.forEach((_, idx) => {
      const expectedX = (kv.origin_x + idx * kv.choice_spacing) * wMm;
      const expectedY = kv.origin_y * hMm;
      const got = keyVersionBubbleCenterMm(idx);
      assert.ok(
        Math.abs(got.x - expectedX) < 0.01 &&
          Math.abs(got.y - expectedY) < 0.01,
        `${rel} key version ${idx}: got (${got.x}, ${got.y}) vs (${expectedX}, ${expectedY})`,
      );
    });
  }
});
