"""Serializes a SyntheticSheet's ground truth (the seed and per-question answers) to
JSON. This is meant to be committed to the repo. The generated image is not -- it's
fully reproducible from the seed plus the template, so there's nothing to gain from
storing it and every reason not to (binary diffs, repo bloat).
"""

from __future__ import annotations

import json
from pathlib import Path

from app.synthetic_sheets.generator import SyntheticSheet
from app.synthetic_sheets.question_plan import QuestionPlan


def question_plan_to_dict(plan: QuestionPlan) -> dict:
    return {
        "question_number": plan.question_number,
        "correct_choice": plan.correct_choice,
        "marked_choices": list(plan.marked_choices),
        "mark_kind": plan.mark_kind.value,
    }


def expected_score_after_review(sheet: SyntheticSheet) -> float:
    """Percentage of questions whose marked_choices equals [correct_choice]."""
    if not sheet.question_plans:
        return 0.0
    correct_count = sum(
        1
        for plan in sheet.question_plans
        if plan.marked_choices == (plan.correct_choice,)
    )
    return (correct_count / len(sheet.question_plans)) * 100.0


def synthetic_sheet_ground_truth_to_dict(sheet: SyntheticSheet) -> dict:
    return {
        "seed": sheet.seed,
        "template_id": sheet.template_id,
        "stray_mark_count": sheet.stray_mark_count,
        "expected_score_after_review": expected_score_after_review(sheet),
        "questions": [question_plan_to_dict(plan) for plan in sheet.question_plans],
    }


def save_ground_truth(sheet: SyntheticSheet, path: Path) -> None:
    """Write the seed and answers for one sheet to disk as JSON. Never writes the image."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(synthetic_sheet_ground_truth_to_dict(sheet), indent=2), encoding="utf-8"
    )
