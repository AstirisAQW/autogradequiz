"""ZipGrade-style visual graded overlay drawn on an aligned A4 sheet image."""

from __future__ import annotations

import cv2
import numpy as np

from app.answer_sheet_templates.builder import PAGE
from app.answer_sheet_templates.geometry import (
    ANSWER_CHOICES,
    KEY_VERSION_CHOICES,
    PageSize,
    bubble_position_px,
    bubble_radius_px,
    find_column_for_question,
    key_version_bubble_position_px,
    key_version_bubble_radius_px,
    mm_to_px,
    row_position_mm,
)
from app.answer_sheet_templates.layout_spec import TemplateSpec
from app.bubble_grading.classifier import QuestionFill
from app.bubble_grading.scoring import QuestionOutcome, ScoreSummary

GREEN_BGR = (46, 154, 22)
BLUE_BGR = (199, 132, 2)
RED_BGR = (38, 38, 220)
AMBER_BGR = (11, 158, 245)
AMBER_TEXT_BGR = (14, 64, 146)

LABEL_PAD_MM_BY_COUNT = {
    20: 11.5,
    50: 10.0,
    100: 8.5,
}


def _format_points(value: float) -> str:
    rounded = round(value, 2)
    if float(rounded).is_integer():
        return str(int(rounded))
    return f"{rounded:.2f}".rstrip("0").rstrip(".")


def _draw_bubble_ring(
    canvas: np.ndarray,
    template_spec: TemplateSpec,
    question_number: int,
    choice: str,
    ring_radius: int,
    color: tuple[int, int, int],
    thickness: int,
    page: PageSize,
) -> None:
    if choice not in ANSWER_CHOICES:
        return
    choice_idx = ANSWER_CHOICES.index(choice)
    center = bubble_position_px(template_spec, question_number, choice_idx, page)
    cv2.circle(canvas, center, ring_radius, color, thickness, cv2.LINE_AA)


def _draw_flagged_row_box(
    canvas: np.ndarray,
    template_spec: TemplateSpec,
    question_number: int,
    thickness: int,
    page: PageSize,
) -> None:
    column = find_column_for_question(template_spec.columns, question_number)
    row_y_mm = row_position_mm(
        column, question_number - column.question_start, template_spec.row_spacing_mm
    )
    label_pad_mm = LABEL_PAD_MM_BY_COUNT.get(template_spec.question_count, 10.0)
    left_mm = column.origin_x_mm - label_pad_mm
    width_mm = (
        label_pad_mm
        + (len(ANSWER_CHOICES) - 1) * template_spec.choice_spacing_mm
        + template_spec.bubble_radius_mm
        + 2.5
    )
    top_mm = row_y_mm - template_spec.row_spacing_mm / 2.0
    bottom_mm = row_y_mm + template_spec.row_spacing_mm / 2.0

    top_left = mm_to_px(left_mm, top_mm, page)
    bottom_right = mm_to_px(left_mm + width_mm, bottom_mm, page)
    cv2.rectangle(canvas, top_left, bottom_right, AMBER_BGR, thickness, cv2.LINE_AA)


def _draw_score_stamp(
    canvas: np.ndarray,
    template_spec: TemplateSpec,
    score_summary: ScoreSummary,
    page: PageSize,
) -> None:
    earned = _format_points(score_summary.earned_points)
    total = _format_points(score_summary.total_points)
    pct = score_summary.score_fraction * 100.0
    is_provisional = (
        score_summary.ambiguous_count + score_summary.multiple_count > 0
        or score_summary.blank_count == template_spec.question_count
    )

    stamp_tl = mm_to_px(130.0, 6.5, page)
    stamp_br = mm_to_px(189.0, 14.5, page)
    border_color = AMBER_BGR if is_provisional else GREEN_BGR
    text_color = AMBER_TEXT_BGR if is_provisional else GREEN_BGR

    cv2.rectangle(canvas, stamp_tl, stamp_br, (255, 255, 255), -1)
    cv2.rectangle(canvas, stamp_tl, stamp_br, border_color, 3, cv2.LINE_AA)

    label = f"{earned}/{total} ({pct:.1f}%)"
    if is_provisional:
        label = f"{label} PROVISIONAL"

    font = cv2.FONT_HERSHEY_SIMPLEX
    scale = 0.72 if is_provisional else 0.9
    thickness = 2
    box_w = stamp_br[0] - stamp_tl[0] - 16
    text_size, _ = cv2.getTextSize(label, font, scale, thickness)
    if text_size[0] > box_w and text_size[0] > 0:
        scale *= box_w / text_size[0]
        text_size, _ = cv2.getTextSize(label, font, scale, thickness)

    text_x = stamp_tl[0] + max(8, (stamp_br[0] - stamp_tl[0] - text_size[0]) // 2)
    text_y = stamp_tl[1] + (stamp_br[1] - stamp_tl[1] + text_size[1]) // 2
    cv2.putText(canvas, label, (text_x, text_y), font, scale, text_color, thickness, cv2.LINE_AA)


def render_graded_overlay(
    aligned_image: np.ndarray,
    template_spec: TemplateSpec,
    question_fills: dict[int, QuestionFill],
    answer_key: list[str],
    score_summary: ScoreSummary,
    page: PageSize = PAGE,
    *,
    key_version: str = "",
) -> np.ndarray:
    """Return a copy of aligned_image annotated with ZipGrade-style bubble rings and score."""
    if aligned_image.ndim == 2:
        canvas = cv2.cvtColor(aligned_image, cv2.COLOR_GRAY2BGR)
    else:
        canvas = aligned_image.copy()

    radius_px = bubble_radius_px(template_spec, page)
    ring_radius = max(radius_px + 2, int(round(radius_px * 1.3)))
    ring_thickness = max(4, radius_px // 4)
    thin_thickness = max(2, ring_thickness // 2)
    box_thickness = max(3, radius_px // 5)

    normalized_kv = key_version.strip().upper()
    if normalized_kv in KEY_VERSION_CHOICES:
        kv_center = key_version_bubble_position_px(
            KEY_VERSION_CHOICES.index(normalized_kv), page
        )
        kv_radius = max(
            key_version_bubble_radius_px(page) + 2,
            int(round(key_version_bubble_radius_px(page) * 1.3)),
        )
        cv2.circle(canvas, kv_center, kv_radius, GREEN_BGR, max(3, ring_thickness - 1), cv2.LINE_AA)

    for q_num in range(1, template_spec.question_count + 1):
        fill = question_fills.get(q_num)
        outcome = score_summary.question_outcomes.get(q_num)
        if fill is None or outcome is None:
            continue

        accepted = answer_key[q_num - 1].split("+")
        if outcome == QuestionOutcome.CORRECT:
            for choice in fill.marked_choices:
                _draw_bubble_ring(
                    canvas,
                    template_spec,
                    q_num,
                    choice,
                    ring_radius,
                    GREEN_BGR,
                    ring_thickness,
                    page,
                )
        elif outcome == QuestionOutcome.PARTIAL:
            for choice in fill.marked_choices:
                _draw_bubble_ring(
                    canvas,
                    template_spec,
                    q_num,
                    choice,
                    ring_radius,
                    BLUE_BGR,
                    ring_thickness,
                    page,
                )
            for expected in accepted:
                _draw_bubble_ring(
                    canvas,
                    template_spec,
                    q_num,
                    expected,
                    ring_radius,
                    GREEN_BGR,
                    max(2, ring_thickness - 1),
                    page,
                )
        elif outcome == QuestionOutcome.WRONG:
            for choice in fill.marked_choices:
                _draw_bubble_ring(
                    canvas,
                    template_spec,
                    q_num,
                    choice,
                    ring_radius,
                    RED_BGR,
                    ring_thickness,
                    page,
                )
            for expected in accepted:
                _draw_bubble_ring(
                    canvas,
                    template_spec,
                    q_num,
                    expected,
                    ring_radius,
                    GREEN_BGR,
                    max(2, ring_thickness - 1),
                    page,
                )
        elif outcome == QuestionOutcome.BLANK:
            for expected in accepted:
                _draw_bubble_ring(
                    canvas,
                    template_spec,
                    q_num,
                    expected,
                    ring_radius,
                    GREEN_BGR,
                    max(2, ring_thickness - 1),
                    page,
                )
        else:
            _draw_flagged_row_box(canvas, template_spec, q_num, box_thickness, page)
            for choice in fill.marked_choices:
                _draw_bubble_ring(
                    canvas,
                    template_spec,
                    q_num,
                    choice,
                    ring_radius,
                    AMBER_BGR,
                    ring_thickness,
                    page,
                )
            for expected in accepted:
                _draw_bubble_ring(
                    canvas,
                    template_spec,
                    q_num,
                    expected,
                    ring_radius,
                    GREEN_BGR,
                    thin_thickness,
                    page,
                )

    _draw_score_stamp(canvas, template_spec, score_summary, page)
    return canvas
