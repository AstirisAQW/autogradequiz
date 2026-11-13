"""Draws one question's mark onto a rendered sheet, in whatever shape its QuestionPlan
calls for.
"""

from __future__ import annotations

import cv2
import numpy as np

from app.answer_sheet_templates.geometry import ANSWER_CHOICES, PageSize, bubble_position_px
from app.answer_sheet_templates.layout_spec import TemplateSpec
from app.sheet_rendering.renderer import BLACK
from app.synthetic_sheets.question_plan import QuestionMarkKind, QuestionPlan


def draw_perfect_mark(canvas: np.ndarray, center_px: tuple[int, int], radius_px: int) -> None:
    """Solid filled circle matching the bubble exactly."""
    cv2.circle(canvas, center_px, radius_px, BLACK, -1)


def draw_incomplete_mark(
    canvas: np.ndarray, center_px: tuple[int, int], radius_px: int, rng: np.random.Generator
) -> None:
    """A filled circle at 60-80% of the bubble radius, or a filled partial arc."""
    if rng.random() < 0.5:
        shrunk_radius = int(round(radius_px * rng.uniform(0.6, 0.8)))
        cv2.circle(canvas, center_px, max(shrunk_radius, 1), BLACK, -1)
    else:
        start_angle = float(rng.uniform(0, 360))
        arc_span = float(rng.uniform(120, 180))
        cv2.ellipse(
            canvas,
            center_px,
            (radius_px, radius_px),
            0,
            start_angle,
            start_angle + arc_span,
            BLACK,
            -1,
        )


def draw_light_mark(
    canvas: np.ndarray, center_px: tuple[int, int], radius_px: int, rng: np.random.Generator
) -> None:
    """A fully-shaped fill, but in gray instead of black."""
    gray_value = int(rng.integers(130, 190))
    color = (gray_value, gray_value, gray_value)
    cv2.circle(canvas, center_px, radius_px, color, -1)


def draw_off_center_mark(
    canvas: np.ndarray, center_px: tuple[int, int], radius_px: int, rng: np.random.Generator
) -> None:
    """A solid fill shifted a few pixels away from the true bubble center."""
    shift_magnitude = int(rng.integers(2, 6))
    angle = float(rng.uniform(0, 2 * np.pi))
    dx = int(round(shift_magnitude * np.cos(angle)))
    dy = int(round(shift_magnitude * np.sin(angle)))
    shifted_center = (center_px[0] + dx, center_px[1] + dy)
    cv2.circle(canvas, shifted_center, radius_px, BLACK, -1)


def _scribble_points(
    center_px: tuple[int, int], radius_px: int, rng: np.random.Generator
) -> np.ndarray:
    point_count = int(rng.integers(4, 7))
    offsets = rng.uniform(-radius_px * 0.8, radius_px * 0.8, size=(point_count, 2))
    points = offsets + np.array(center_px)
    return points.astype(np.int32)


def draw_non_circular_mark(
    canvas: np.ndarray, center_px: tuple[int, int], radius_px: int, rng: np.random.Generator
) -> None:
    """An X, a checkmark, or a scribble instead of a filled circle.

    style is drawn uniformly from {0, 1, 2}: 0 draws an X, 1 draws a checkmark, 2 draws a
    scribble (see _scribble_points).
    """
    thickness = max(2, radius_px // 3)
    style = rng.integers(0, 3)
    cx, cy = center_px
    reach = int(round(radius_px * 0.75))

    if style == 0:
        cv2.line(canvas, (cx - reach, cy - reach), (cx + reach, cy + reach), BLACK, thickness)
        cv2.line(canvas, (cx - reach, cy + reach), (cx + reach, cy - reach), BLACK, thickness)
    elif style == 1:
        p1 = (cx - reach, cy)
        p2 = (cx - reach // 3, cy + reach)
        p3 = (cx + reach, cy - reach)
        cv2.polylines(canvas, [np.array([p1, p2, p3], dtype=np.int32)], False, BLACK, thickness)
    else:
        points = _scribble_points(center_px, radius_px, rng)
        cv2.polylines(canvas, [points], False, BLACK, thickness)


def draw_marks_for_plan(
    canvas: np.ndarray,
    template_spec: TemplateSpec,
    plan: QuestionPlan,
    radius_px: int,
    page: PageSize,
    rng: np.random.Generator,
) -> None:
    if plan.mark_kind == QuestionMarkKind.BLANK:
        return

    if plan.mark_kind == QuestionMarkKind.DOUBLE:
        for choice in plan.marked_choices:
            center = bubble_position_px(
                template_spec, plan.question_number, ANSWER_CHOICES.index(choice), page
            )
            draw_perfect_mark(canvas, center, radius_px)
        return

    choice = plan.marked_choices[0]
    center = bubble_position_px(
        template_spec, plan.question_number, ANSWER_CHOICES.index(choice), page
    )

    if plan.mark_kind == QuestionMarkKind.PERFECT:
        draw_perfect_mark(canvas, center, radius_px)
    elif plan.mark_kind == QuestionMarkKind.INCOMPLETE:
        draw_incomplete_mark(canvas, center, radius_px, rng)
    elif plan.mark_kind == QuestionMarkKind.LIGHT:
        draw_light_mark(canvas, center, radius_px, rng)
    elif plan.mark_kind == QuestionMarkKind.OFF_CENTER:
        draw_off_center_mark(canvas, center, radius_px, rng)
    elif plan.mark_kind == QuestionMarkKind.NON_CIRCULAR:
        draw_non_circular_mark(canvas, center, radius_px, rng)
