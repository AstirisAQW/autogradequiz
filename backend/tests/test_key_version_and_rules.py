from __future__ import annotations

import pytest

from app.answer_sheet_templates.builder import PAGE
from app.answer_sheet_templates.catalog import TWENTY_QUESTIONS
from app.bubble_grading.classifier import (
    BubbleResult,
    QuestionFill,
    classify_key_version,
)
from app.bubble_grading.scoring import QuestionOutcome, QuestionRule, score_sheet
from app.scan_alignment.aligner import align_scan
from app.sheet_rendering.renderer import render_sheet
from tests.synthetic_sheets.generator import generate_synthetic_sheet


@pytest.mark.parametrize("expected_kv", ["A", "B", "C", "D"])
def test_classify_key_version_detects_distorted_synthetic_strip(expected_kv: str):
    sheet = generate_synthetic_sheet(
        TWENTY_QUESTIONS, seed=4, page=PAGE, key_version=expected_kv
    )
    aligned = align_scan(sheet.image, TWENTY_QUESTIONS)
    kv_fill = classify_key_version(aligned, PAGE)
    assert kv_fill.result == BubbleResult.FILLED
    assert kv_fill.marked_choices == (expected_kv,)


def test_classify_key_version_reads_blank_when_unmarked():
    blank_sheet = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    kv_fill = classify_key_version(blank_sheet, PAGE)
    assert kv_fill.result == BubbleResult.BLANK
    assert kv_fill.marked_choices == ()


def test_score_sheet_supports_partial_credit_and_attempted_incorrect_points():
    answer_key = ["A", "A", "A", "A"]
    points = [2.0, 2.0, 2.0, 2.0]
    rules = [
        QuestionRule(alternate_answers=(("B", 1.0),), incorrect_points=-0.5),
        QuestionRule(alternate_answers=(("B", 1.0),), incorrect_points=-0.5),
        QuestionRule(alternate_answers=(("B", 1.0),), incorrect_points=-0.5),
        QuestionRule(alternate_answers=(("B", 3.0),), incorrect_points=0.25),
    ]
    fills = {
        1: QuestionFill(result=BubbleResult.FILLED, marked_choices=("B",), bubble_fills=()),
        2: QuestionFill(result=BubbleResult.FILLED, marked_choices=("C",), bubble_fills=()),
        3: QuestionFill(result=BubbleResult.BLANK, marked_choices=(), bubble_fills=()),
        4: QuestionFill(result=BubbleResult.FILLED, marked_choices=("D",), bubble_fills=()),
    }

    summary = score_sheet(fills, answer_key, points=points, question_rules=rules)
    assert summary.question_outcomes[1] == QuestionOutcome.PARTIAL
    assert summary.question_outcomes[2] == QuestionOutcome.WRONG
    assert summary.question_outcomes[3] == QuestionOutcome.BLANK
    assert summary.question_outcomes[4] == QuestionOutcome.WRONG
    assert summary.partial_count == 1
    assert summary.earned_points == pytest.approx(0.75)
    assert summary.total_points == pytest.approx(9.0)


def test_score_sheet_zero_total_points_returns_zero_fraction():
    fills = {
        1: QuestionFill(result=BubbleResult.FILLED, marked_choices=("A",), bubble_fills=()),
        2: QuestionFill(result=BubbleResult.FILLED, marked_choices=("B",), bubble_fills=()),
    }
    summary = score_sheet(fills, ["A", "A"], points=[0.0, 0.0])
    assert summary.correct_count == 1
    assert summary.total_points == 0.0
    assert summary.score_fraction == 0.0
