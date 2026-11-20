export interface TemplateColumnSpec {
  originX: number;
  originY: number;
  start: number;
  end: number;
}

export interface TemplateLayoutSpec {
  bubbleRadiusMm: number;
  choiceSpacingMm: number;
  rowSpacingMm: number;
  labelPadMm: number;
  columns: readonly TemplateColumnSpec[];
}

export const PAGE_WIDTH_MM = 210.0;
export const PAGE_HEIGHT_MM = 297.0;
export const ROW_GROUP_SIZE = 10;
export const ROW_GROUP_GAP_MM = 5.0;

export const KEY_VERSION_CHOICES = ["A", "B", "C", "D"] as const;
export const KEY_VERSION_ORIGIN_X_MM = 56.0;
export const KEY_VERSION_ORIGIN_Y_MM = 47.0;
export const KEY_VERSION_SPACING_MM = 18.0;
export const KEY_VERSION_BUBBLE_RADIUS_MM = 2.4;

export function keyVersionBubbleCenterMm(versionIndex: number): {
  x: number;
  y: number;
} {
  return {
    x: KEY_VERSION_ORIGIN_X_MM + versionIndex * KEY_VERSION_SPACING_MM,
    y: KEY_VERSION_ORIGIN_Y_MM,
  };
}

export const TEMPLATE_LAYOUT_BY_COUNT: Record<number, TemplateLayoutSpec> = {
  20: {
    bubbleRadiusMm: 3.0,
    choiceSpacingMm: 9.0,
    rowSpacingMm: 10.0,
    labelPadMm: 11.5,
    columns: [
      { originX: 40, originY: 60.0, start: 1, end: 10 },
      { originX: 120, originY: 60.0, start: 11, end: 20 },
    ],
  },
  50: {
    bubbleRadiusMm: 2.4,
    choiceSpacingMm: 7.0,
    rowSpacingMm: 8.0,
    labelPadMm: 10.0,
    columns: [
      { originX: 25, originY: 60.0, start: 1, end: 20 },
      { originX: 85, originY: 60.0, start: 21, end: 40 },
      { originX: 145, originY: 60.0, start: 41, end: 50 },
    ],
  },
  100: {
    bubbleRadiusMm: 1.6,
    choiceSpacingMm: 5.5,
    rowSpacingMm: 6.5,
    labelPadMm: 8.5,
    columns: [
      { originX: 26, originY: 60.0, start: 1, end: 20 },
      { originX: 61, originY: 60.0, start: 21, end: 40 },
      { originX: 96, originY: 60.0, start: 41, end: 60 },
      { originX: 131, originY: 60.0, start: 61, end: 80 },
      { originX: 166, originY: 60.0, start: 81, end: 100 },
    ],
  },
};

export interface QuestionRegionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function getTemplateLayoutSpec(totalQuestions: number): TemplateLayoutSpec {
  return (
    TEMPLATE_LAYOUT_BY_COUNT[totalQuestions] ??
    (totalQuestions <= 20
      ? TEMPLATE_LAYOUT_BY_COUNT[20]
      : totalQuestions <= 50
        ? TEMPLATE_LAYOUT_BY_COUNT[50]
        : TEMPLATE_LAYOUT_BY_COUNT[100])
  );
}

function findColumnSpec(
  spec: TemplateLayoutSpec,
  questionNumber: number,
): TemplateColumnSpec {
  return (
    spec.columns.find(
      (c) => questionNumber >= c.start && questionNumber <= c.end,
    ) ?? spec.columns[spec.columns.length - 1]
  );
}

function questionCenterYMm(
  spec: TemplateLayoutSpec,
  col: TemplateColumnSpec,
  questionNumber: number,
): number {
  const rowIndex = Math.max(0, questionNumber - col.start);
  const rowGroupOffsetMm =
    Math.floor(rowIndex / ROW_GROUP_SIZE) * ROW_GROUP_GAP_MM;
  return col.originY + rowIndex * spec.rowSpacingMm + rowGroupOffsetMm;
}

export function bubbleCenterMm(
  questionNumber: number,
  choiceIndex: number,
  totalQuestions: number,
): { x: number; y: number } {
  const spec = getTemplateLayoutSpec(totalQuestions);
  const col = findColumnSpec(spec, questionNumber);
  return {
    x: col.originX + choiceIndex * spec.choiceSpacingMm,
    y: questionCenterYMm(spec, col, questionNumber),
  };
}

export function bubbleRadiusMm(totalQuestions: number): number {
  return getTemplateLayoutSpec(totalQuestions).bubbleRadiusMm;
}

export function questionRowBoxMm(
  questionNumber: number,
  totalQuestions: number,
): { x: number; y: number; width: number; height: number } {
  const spec = getTemplateLayoutSpec(totalQuestions);
  const col = findColumnSpec(spec, questionNumber);
  const centerY = questionCenterYMm(spec, col, questionNumber);
  return {
    x: col.originX - spec.labelPadMm,
    y: centerY - spec.rowSpacingMm / 2,
    width:
      spec.labelPadMm + 4 * spec.choiceSpacingMm + spec.bubbleRadiusMm + 2.5,
    height: spec.rowSpacingMm,
  };
}

export function questionRegionPercent(
  questionNumber: number,
  totalQuestions: number,
): QuestionRegionBox {
  const box = questionRowBoxMm(questionNumber, totalQuestions);
  return {
    left: (box.x / PAGE_WIDTH_MM) * 100,
    top: (box.y / PAGE_HEIGHT_MM) * 100,
    width: (box.width / PAGE_WIDTH_MM) * 100,
    height: (box.height / PAGE_HEIGHT_MM) * 100,
  };
}

export function rowCropAspect(box: { width: number; height: number }): number {
  return (box.width * PAGE_WIDTH_MM) / (box.height * PAGE_HEIGHT_MM);
}
