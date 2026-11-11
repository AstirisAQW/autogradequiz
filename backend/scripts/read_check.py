from __future__ import annotations

from app.answer_sheet_templates.catalog import (
    FIFTY_QUESTIONS,
    HUNDRED_QUESTIONS,
    TWENTY_QUESTIONS,
)
from app.bubble_grading.classifier import BubbleResult, QuestionFill, classify_sheet
from app.scan_alignment.align_scan import ScanAlignmentError, align_scan
from app.synthetic_sheets.generator import generate_synthetic_sheet
from app.synthetic_sheets.question_plan import QuestionMarkKind, QuestionPlan

TEMPLATES = (TWENTY_QUESTIONS, FIFTY_QUESTIONS, HUNDRED_QUESTIONS)
SEEDS = range(10)


def expected_description(plan: QuestionPlan) -> str:
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
    return f"any({choices})"


def matches_plan(plan: QuestionPlan, fill: QuestionFill) -> bool:
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


def main() -> None:
    for template in TEMPLATES:
        total_questions = 0
        mismatches = 0
        failed_sheets = 0

        for seed in SEEDS:
            sheet = generate_synthetic_sheet(template, seed=seed)
            try:
                aligned = align_scan(sheet.image, template)
            except ScanAlignmentError as exc:
                failed_sheets += 1
                print(f"FAILED template={template.template_id} seed={seed} error={exc}")
                continue

            fills = classify_sheet(aligned, template)
            for plan in sheet.question_plans:
                total_questions += 1
                fill = fills[plan.question_number]
                if not matches_plan(plan, fill):
                    mismatches += 1
                    actual = f"{fill.result.value}({','.join(fill.marked_choices)})"
                    print(
                        f"MISMATCH template={template.template_id} seed={seed} "
                        f"q={plan.question_number} kind={plan.mark_kind.value} "
                        f"expected={expected_description(plan)} actual={actual}"
                    )

        print(
            f"SUMMARY template={template.template_id} sheets={len(SEEDS)} "
            f"failed_sheets={failed_sheets} questions={total_questions} mismatches={mismatches}"
        )


if __name__ == "__main__":
    main()

