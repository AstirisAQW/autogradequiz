from __future__ import annotations

from functools import lru_cache

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
SHARE_LIMIT_SEEDS = range(10)
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


@lru_cache(maxsize=64)
def _grade_synthetic_sheet(template_id: str, seed: int):
    template = next(t for t in TEMPLATES if t.template_id == template_id)
    sheet = generate_synthetic_sheet(template, seed=seed)
    aligned = align_scan(sheet.image, template)
    fills = classify_sheet(aligned, template)
    return sheet.question_plans, fills


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
    return f"filled({choices})|ambiguous({choices})|blank()"


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
    if plan.mark_kind == QuestionMarkKind.LIGHT:
        if fill.result == BubbleResult.BLANK:
            return True
        return (
            fill.result in (BubbleResult.FILLED, BubbleResult.AMBIGUOUS)
            and fill.marked_choices == plan.marked_choices
        )
    return False


@pytest.mark.parametrize(
    ("template", "seed"),
    SHEET_CASES,
    ids=[f"{t.template_id}_seed_{s}" for t, s in SHEET_CASES],
)
def test_graded_answers_match_synthetic_ground_truth(template, seed):
    question_plans, fills = _grade_synthetic_sheet(template.template_id, seed)

    for plan in question_plans:
        fill = fills[plan.question_number]
        actual = f"{fill.result.value}({','.join(fill.marked_choices)})"
        assert _matches_plan(plan, fill), (
            f"sheet={template.template_id}/seed={seed} "
            f"question={plan.question_number}({plan.mark_kind.value}) "
            f"expected={_expected_description(plan)} actual={actual}"
        )


@pytest.mark.parametrize(
    "template",
    TEMPLATES,
    ids=[t.template_id for t in TEMPLATES],
)
def test_blank_and_light_share_limits_per_template(template):
    blank_total = 0
    blank_read_blank = 0
    light_total = 0
    light_read_blank = 0

    for seed in SHARE_LIMIT_SEEDS:
        question_plans, fills = _grade_synthetic_sheet(template.template_id, seed)
        for plan in question_plans:
            fill = fills[plan.question_number]
            if plan.mark_kind == QuestionMarkKind.BLANK:
                blank_total += 1
                if fill.result == BubbleResult.BLANK:
                    blank_read_blank += 1
            elif plan.mark_kind == QuestionMarkKind.LIGHT:
                light_total += 1
                assert not (
                    fill.result == BubbleResult.FILLED
                    and fill.marked_choices != plan.marked_choices
                )
                if fill.result == BubbleResult.BLANK:
                    light_read_blank += 1

    assert blank_read_blank / blank_total >= 0.995
    assert light_read_blank / light_total < 0.20
