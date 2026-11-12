from __future__ import annotations

import pytest

from app.answer_sheet_templates.catalog import (
    FIFTY_QUESTIONS,
    HUNDRED_QUESTIONS,
    TWENTY_QUESTIONS,
)
from app.bubble_grading.classifier import BubbleResult, QuestionFill, classify_sheet
from app.scan_alignment.align_scan import align_scan
from app.synthetic_sheets.generator import generate_synthetic_sheet
from app.synthetic_sheets.question_plan import QuestionMarkKind, QuestionPlan

TEMPLATES = (TWENTY_QUESTIONS, FIFTY_QUESTIONS, HUNDRED_QUESTIONS)
EXTRA_CASES = (
    (TWENTY_QUESTIONS, 21),
    (TWENTY_QUESTIONS, 26),
    (FIFTY_QUESTIONS, 2),
    (FIFTY_QUESTIONS, 12),
    (FIFTY_QUESTIONS, 34),
)
SHEET_CASES = [
    *((template, seed) for template in TEMPLATES for seed in range(5)),
    *EXTRA_CASES,
]


def _expected_description(plan: QuestionPlan) -> str:
    choices = ",".join(plan.marked_choices)
    if plan.mark_kind == QuestionMarkKind.PERFECT:
        return f"filled({choices})"
    if plan.mark_kind == QuestionMarkKind.BLANK:
        return "blank()"
    if plan.mark_kind == QuestionMarkKind.DOUBLE:
        return f"multiple({choices})"
    if plan.mark_kind in (
        QuestionMarkKind.INCOMPLETE,
        QuestionMarkKind.OFF_CENTER,
        QuestionMarkKind.NON_CIRCULAR,
    ):
        return f"filled|ambiguous({choices})"
    return f"any_or_filled({choices})"


def _matches_plan(plan: QuestionPlan, fill: QuestionFill) -> bool:
    if fill.result == BubbleResult.FILLED and fill.marked_choices != plan.marked_choices:
        return False
    if plan.mark_kind == QuestionMarkKind.PERFECT:
        return fill.result == BubbleResult.FILLED and fill.marked_choices == plan.marked_choices
    if plan.mark_kind == QuestionMarkKind.BLANK:
        return fill.result == BubbleResult.BLANK
    if plan.mark_kind == QuestionMarkKind.DOUBLE:
        return fill.result == BubbleResult.MULTIPLE
    if plan.mark_kind in (
        QuestionMarkKind.INCOMPLETE,
        QuestionMarkKind.OFF_CENTER,
        QuestionMarkKind.NON_CIRCULAR,
    ):
        return fill.result in (BubbleResult.FILLED, BubbleResult.AMBIGUOUS)
    return True


@pytest.mark.parametrize(
    ("template", "seed"),
    SHEET_CASES,
    ids=[f"{t.template_id}_seed_{s}" for t, s in SHEET_CASES],
)
def test_graded_answers_match_synthetic_ground_truth(template, seed):
    sheet = generate_synthetic_sheet(template, seed=seed)
    aligned = align_scan(sheet.image, template)
    fills = classify_sheet(aligned, template)

    for plan in sheet.question_plans:
        fill = fills[plan.question_number]
        actual = f"{fill.result.value}({','.join(fill.marked_choices)})"
        assert _matches_plan(plan, fill), (
            f"sheet={template.template_id}/seed={seed} "
            f"question={plan.question_number}({plan.mark_kind.value}) "
            f"expected={_expected_description(plan)} actual={actual}"
        )
