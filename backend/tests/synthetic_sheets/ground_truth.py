from __future__ import annotations

import json
from pathlib import Path

from tests.synthetic_sheets.generator import SyntheticSheet
from tests.synthetic_sheets.question_plan import QuestionPlan


def question_plan_to_dict(plan: QuestionPlan) -> dict:
    return {
        "question_number": plan.question_number,
        "correct_choice": plan.correct_choice,
        "marked_choices": list(plan.marked_choices),
        "mark_kind": plan.mark_kind.value,
    }


def synthetic_sheet_ground_truth_to_dict(sheet: SyntheticSheet) -> dict:
    return {
        "seed": sheet.seed,
        "template_id": sheet.template_id,
        "stray_mark_count": sheet.stray_mark_count,
        "questions": [question_plan_to_dict(plan) for plan in sheet.question_plans],
    }


def save_ground_truth(sheet: SyntheticSheet, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(synthetic_sheet_ground_truth_to_dict(sheet), indent=2), encoding="utf-8"
    )
