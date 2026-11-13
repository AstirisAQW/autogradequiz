import cv2
import numpy as np

from app.answer_sheet_templates.builder import PAGE
from app.answer_sheet_templates.catalog import FIFTY_QUESTIONS, HUNDRED_QUESTIONS, TWENTY_QUESTIONS
from app.answer_sheet_templates.geometry import bubble_position_px, bubble_radius_px
from app.bubble_grading.classifier import (
    DEFAULT_THRESHOLDS,
    BubbleResult,
    classify_sheet,
)
from app.bubble_grading.scoring import QuestionOutcome, score_sheet
from app.sheet_rendering.renderer import render_sheet
from app.synthetic_sheets.mark_drawing import draw_marks_for_plan
from app.synthetic_sheets.question_plan import QuestionMarkKind, generate_question_plans

SEED_WITH_EVERY_MARK_KIND = 0
"""Chosen because generate_question_plans(HUNDRED_QUESTIONS, ...) with this seed produces
at least one question of every QuestionMarkKind, so a single sheet exercises every branch
below."""


def _classified_ground_truth():
    """An aligned synthetic sheet (marks drawn, but no rotation/blur/noise/JPEG
    simulation) plus its classification.

    classify_sheet documents that it expects an already-aligned image; generate_synthetic
    _sheet's scan-artifact simulation intentionally violates that, so comparing its output
    against ground truth would be testing scan robustness, not classification, and the two
    have different, separately-testable failure modes.
    """
    rng = np.random.default_rng(SEED_WITH_EVERY_MARK_KIND)
    canvas = render_sheet(HUNDRED_QUESTIONS, page=PAGE)
    radius_px = bubble_radius_px(HUNDRED_QUESTIONS, PAGE)

    question_plans = generate_question_plans(HUNDRED_QUESTIONS, rng)
    for plan in question_plans:
        draw_marks_for_plan(canvas, HUNDRED_QUESTIONS, plan, radius_px, PAGE, rng)

    question_fills = classify_sheet(canvas, HUNDRED_QUESTIONS, PAGE)
    return question_plans, question_fills


def test_perfect_marks_classify_as_filled_with_the_marked_choice():
    question_plans, question_fills = _classified_ground_truth()

    for plan in question_plans:
        if plan.mark_kind == QuestionMarkKind.PERFECT:
            fill = question_fills[plan.question_number]
            assert fill.result == BubbleResult.FILLED
            assert fill.marked_choices == plan.marked_choices


def test_blank_marks_classify_as_blank():
    question_plans, question_fills = _classified_ground_truth()

    for plan in question_plans:
        if plan.mark_kind == QuestionMarkKind.BLANK:
            assert question_fills[plan.question_number].result == BubbleResult.BLANK


def test_double_marks_classify_as_multiple():
    question_plans, question_fills = _classified_ground_truth()

    for plan in question_plans:
        if plan.mark_kind == QuestionMarkKind.DOUBLE:
            assert question_fills[plan.question_number].result == BubbleResult.MULTIPLE


def test_incomplete_off_center_and_non_circular_marks_classify_as_filled_or_ambiguous():
    """These defect kinds are drawn to be borderline by design, so the classifier is
    allowed to call them either FILLED or AMBIGUOUS -- what it must never do is call a
    non-blank, single mark BLANK or MULTIPLE."""
    question_plans, question_fills = _classified_ground_truth()
    borderline_kinds = {
        QuestionMarkKind.INCOMPLETE,
        QuestionMarkKind.OFF_CENTER,
        QuestionMarkKind.NON_CIRCULAR,
    }

    for plan in question_plans:
        if plan.mark_kind in borderline_kinds:
            result = question_fills[plan.question_number].result
            assert result in (BubbleResult.FILLED, BubbleResult.AMBIGUOUS)


def test_light_marks_can_read_as_blank_on_small_bubble_radii():
    """A LIGHT mark's gray fill (130-190) sometimes never clears the classifier's
    dark_offset against a small bubble radius like HUNDRED_QUESTIONS uses, and this
    sheet's seed reliably produces some fill_ratio == 0.0 LIGHT marks -- so BLANK is a
    real, allowed outcome here, not just FILLED or AMBIGUOUS. This documents that
    behavior rather than asserting a stricter guarantee the classifier doesn't make."""
    question_plans, question_fills = _classified_ground_truth()

    for plan in question_plans:
        if plan.mark_kind == QuestionMarkKind.LIGHT:
            result = question_fills[plan.question_number].result
            assert result in (BubbleResult.FILLED, BubbleResult.AMBIGUOUS, BubbleResult.BLANK)


def test_score_sheet_outcomes_cover_every_question_exactly_once():
    question_plans, question_fills = _classified_ground_truth()

    answer_key = [plan.correct_choice for plan in question_plans]
    summary = score_sheet(question_fills, answer_key)

    assert summary.graded_question_count == HUNDRED_QUESTIONS.question_count
    assert (
        summary.correct_count
        + summary.wrong_count
        + summary.blank_count
        + summary.ambiguous_count
        + summary.multiple_count
        == HUNDRED_QUESTIONS.question_count
    )


def test_score_sheet_marks_correct_and_wrong_only_for_filled_questions():
    question_plans, question_fills = _classified_ground_truth()

    answer_key = [plan.correct_choice for plan in question_plans]
    summary = score_sheet(question_fills, answer_key)

    for question_number, outcome in summary.question_outcomes.items():
        if outcome in (QuestionOutcome.CORRECT, QuestionOutcome.WRONG):
            assert question_fills[question_number].result == BubbleResult.FILLED


def test_clean_unmarked_template_has_trace_ratio_at_or_below_0_002():
    for template in (TWENTY_QUESTIONS, FIFTY_QUESTIONS, HUNDRED_QUESTIONS):
        canvas = render_sheet(template, page=PAGE)
        fills = classify_sheet(canvas, template, PAGE)
        for fill in fills.values():
            for _, bubble_fill in fill.bubble_fills:
                assert bubble_fill.trace_ratio <= 0.002


def test_printed_outline_alone_never_counts_as_trace():
    for template in (TWENTY_QUESTIONS, FIFTY_QUESTIONS, HUNDRED_QUESTIONS):
        canvas = render_sheet(template, page=PAGE)
        fills = classify_sheet(canvas, template, PAGE)
        for fill in fills.values():
            assert fill.result == BubbleResult.BLANK
            assert fill.marked_choices == ()
            for _, bubble_fill in fill.bubble_fills:
                assert bubble_fill.trace_ratio < DEFAULT_THRESHOLDS.trace_min_ratio


def test_ink_between_old_and_new_cutoffs_reads_ambiguous_and_clean_blank_reads_blank():
    canvas = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    radius_px = bubble_radius_px(TWENTY_QUESTIONS, PAGE)
    center_b = bubble_position_px(TWENTY_QUESTIONS, 1, 1, PAGE)
    # Gray 180 is between 255 - dark_offset (165) and 255 - trace_dark_offset (205).
    cv2.circle(canvas, center_b, radius_px, (180, 180, 180), -1)

    fills = classify_sheet(canvas, TWENTY_QUESTIONS, PAGE)

    q1 = fills[1]
    assert q1.result == BubbleResult.AMBIGUOUS
    assert q1.marked_choices == ("B",)
    q1_b = dict(q1.bubble_fills)["B"]
    assert q1_b.fill_ratio <= DEFAULT_THRESHOLDS.blank_max_ratio
    assert q1_b.trace_ratio >= DEFAULT_THRESHOLDS.trace_min_ratio

    q2 = fills[2]
    assert q2.result == BubbleResult.BLANK
    assert q2.marked_choices == ()
