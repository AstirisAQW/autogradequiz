from __future__ import annotations

import numpy as np

from app.answer_sheet_templates.builder import PAGE
from app.answer_sheet_templates.catalog import (
    FIFTY_QUESTIONS,
    HUNDRED_QUESTIONS,
    TWENTY_QUESTIONS,
)
from app.answer_sheet_templates.geometry import (
    ANSWER_CHOICES,
    bubble_position_px,
    bubble_radius_px,
)
from app.bubble_grading.classifier import BubbleResult, QuestionFill
from app.bubble_grading.overlay import (
    AMBER_BGR,
    BLUE_BGR,
    GREEN_BGR,
    RED_BGR,
    render_graded_overlay,
)
from app.bubble_grading.scoring import QuestionRule, score_sheet
from app.sheet_rendering.renderer import render_sheet


def _has_color_near(
    image: np.ndarray,
    center_px: tuple[int, int],
    radius_px: int,
    target_bgr: tuple[int, int, int],
) -> bool:
    cx, cy = center_px
    r = int(round(radius_px * 1.45)) + 6
    patch = image[max(0, cy - r) : cy + r + 1, max(0, cx - r) : cx + r + 1]
    diff = np.abs(patch.astype(np.int16) - np.array(target_bgr, dtype=np.int16))
    return bool(np.any(np.all(diff <= 15, axis=2)))


def test_render_graded_overlay_draws_correct_wrong_and_flagged_without_mutating():
    canvas = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    snapshot = canvas.copy()
    answer_key = ["A"] * 20

    fills: dict[int, QuestionFill] = {
        1: QuestionFill(result=BubbleResult.FILLED, marked_choices=("A",), bubble_fills=()),
        2: QuestionFill(result=BubbleResult.FILLED, marked_choices=("C",), bubble_fills=()),
        3: QuestionFill(result=BubbleResult.AMBIGUOUS, marked_choices=("B",), bubble_fills=()),
        4: QuestionFill(result=BubbleResult.MULTIPLE, marked_choices=("A", "D"), bubble_fills=()),
        5: QuestionFill(result=BubbleResult.BLANK, marked_choices=(), bubble_fills=()),
    }
    for q in range(6, 21):
        fills[q] = QuestionFill(result=BubbleResult.FILLED, marked_choices=("A",), bubble_fills=())

    summary = score_sheet(fills, answer_key)
    overlay = render_graded_overlay(canvas, TWENTY_QUESTIONS, fills, answer_key, summary, page=PAGE)

    assert overlay is not canvas
    assert overlay.shape == canvas.shape
    assert np.array_equal(canvas, snapshot)

    r_px = bubble_radius_px(TWENTY_QUESTIONS, PAGE)
    # Q1: correct choice A -> green ring
    assert _has_color_near(
        overlay,
        bubble_position_px(TWENTY_QUESTIONS, 1, ANSWER_CHOICES.index("A"), PAGE),
        r_px,
        GREEN_BGR,
    )
    # Q2: wrong mark C -> red ring on C, green ring on A
    assert _has_color_near(
        overlay,
        bubble_position_px(TWENTY_QUESTIONS, 2, ANSWER_CHOICES.index("C"), PAGE),
        r_px,
        RED_BGR,
    )
    assert _has_color_near(
        overlay,
        bubble_position_px(TWENTY_QUESTIONS, 2, ANSWER_CHOICES.index("A"), PAGE),
        r_px,
        GREEN_BGR,
    )
    # Q3 & Q4: flagged ambiguous / multiple -> amber ring/box
    assert _has_color_near(
        overlay,
        bubble_position_px(TWENTY_QUESTIONS, 3, ANSWER_CHOICES.index("B"), PAGE),
        r_px,
        AMBER_BGR,
    )
    assert _has_color_near(
        overlay,
        bubble_position_px(TWENTY_QUESTIONS, 4, ANSWER_CHOICES.index("D"), PAGE),
        r_px,
        AMBER_BGR,
    )
    # Q5: blank -> green ring on expected A
    assert _has_color_near(
        overlay,
        bubble_position_px(TWENTY_QUESTIONS, 5, ANSWER_CHOICES.index("A"), PAGE),
        r_px,
        GREEN_BGR,
    )


def test_render_graded_overlay_draws_blue_ring_for_partial_credit():
    canvas = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    answer_key = ["A"] * 20
    rules = [
        QuestionRule(alternate_answers=(("B", 0.5),)) if q == 1 else QuestionRule()
        for q in range(1, 21)
    ]
    fills = {
        q: QuestionFill(
            result=BubbleResult.FILLED,
            marked_choices=("B",) if q == 1 else ("A",),
            bubble_fills=(),
        )
        for q in range(1, 21)
    }
    summary = score_sheet(fills, answer_key, question_rules=rules)
    overlay = render_graded_overlay(canvas, TWENTY_QUESTIONS, fills, answer_key, summary, page=PAGE)
    r_px = bubble_radius_px(TWENTY_QUESTIONS, PAGE)
    assert _has_color_near(
        overlay,
        bubble_position_px(TWENTY_QUESTIONS, 1, ANSWER_CHOICES.index("B"), PAGE),
        r_px,
        BLUE_BGR,
    )
    assert _has_color_near(
        overlay,
        bubble_position_px(TWENTY_QUESTIONS, 1, ANSWER_CHOICES.index("A"), PAGE),
        r_px,
        GREEN_BGR,
    )


def test_render_graded_overlay_supports_50_and_100_question_templates():
    for spec in (FIFTY_QUESTIONS, HUNDRED_QUESTIONS):
        canvas = render_sheet(spec, page=PAGE)
        fills = {
            q: QuestionFill(result=BubbleResult.FILLED, marked_choices=("A",), bubble_fills=())
            for q in range(1, spec.question_count + 1)
        }
        fills[spec.question_count] = QuestionFill(
            result=BubbleResult.AMBIGUOUS, marked_choices=("E",), bubble_fills=()
        )
        answer_key = ["A"] * spec.question_count
        summary = score_sheet(fills, answer_key)
        overlay = render_graded_overlay(canvas, spec, fills, answer_key, summary, page=PAGE)
        r_px = bubble_radius_px(spec, PAGE)
        assert _has_color_near(
            overlay,
            bubble_position_px(spec, spec.question_count, ANSWER_CHOICES.index("E"), PAGE),
            r_px,
            AMBER_BGR,
        )
