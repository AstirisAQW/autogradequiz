"""Ground truth for what a hand-grader would write down for each question: the correct
choice, and which choice(s) (if any) got marked, and how cleanly.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import numpy as np

from app.answer_sheet_templates.geometry import ANSWER_CHOICES
from app.answer_sheet_templates.layout_spec import TemplateSpec


class QuestionMarkKind(Enum):
    """The per-question defect types from the sample-sheet spec.

    STRAY marks are handled separately at the page level since they aren't tied to any
    one bubble; see stray_marks.py.
    """

    PERFECT = "perfect"
    INCOMPLETE = "incomplete"
    LIGHT = "light"
    OFF_CENTER = "off_center"
    NON_CIRCULAR = "non_circular"
    BLANK = "blank"
    DOUBLE = "double"


QUESTION_MARK_WEIGHTS: tuple[tuple[QuestionMarkKind, float], ...] = (
    (QuestionMarkKind.PERFECT, 0.50),
    (QuestionMarkKind.INCOMPLETE, 0.12),
    (QuestionMarkKind.LIGHT, 0.10),
    (QuestionMarkKind.OFF_CENTER, 0.10),
    (QuestionMarkKind.NON_CIRCULAR, 0.08),
    (QuestionMarkKind.BLANK, 0.06),
    (QuestionMarkKind.DOUBLE, 0.04),
)
"""Roughly realistic mix for one sheet: mostly clean fills, a long tail of messier ones."""


@dataclass(frozen=True)
class QuestionPlan:
    """Ground truth for one question: what a hand-grader would write down."""

    question_number: int
    correct_choice: str
    marked_choices: tuple[str, ...]
    mark_kind: QuestionMarkKind


def generate_answer_key(question_count: int, rng: np.random.Generator) -> list[str]:
    """An answer key independent of any one sheet's marks: as in real usage, where a
    test's answer key is set once and graded against many different student sheets, not
    invented fresh per sheet.
    """
    return [str(choice) for choice in rng.choice(ANSWER_CHOICES, size=question_count)]


def generate_question_plans(
    template_spec: TemplateSpec,
    rng: np.random.Generator,
    answer_key: list[str] | None = None,
) -> tuple[QuestionPlan, ...]:
    """Ground truth for every question on one sheet.

    answer_key, when given, fixes each question's correct_choice instead of drawing it
    from rng -- so the same key can be graded against many independently-generated
    sheets, the way one real test's answer key is graded against a batch of scans.
    """
    kinds = [kind for kind, _ in QUESTION_MARK_WEIGHTS]
    weights = [weight for _, weight in QUESTION_MARK_WEIGHTS]

    plans = []
    for question_number in range(1, template_spec.question_count + 1):
        if answer_key is not None:
            correct_choice = answer_key[question_number - 1]
        else:
            correct_choice = str(rng.choice(ANSWER_CHOICES))
        mark_kind = rng.choice(kinds, p=weights)

        if mark_kind == QuestionMarkKind.BLANK:
            marked_choices: tuple[str, ...] = ()
        elif mark_kind == QuestionMarkKind.DOUBLE:
            chosen = rng.choice(ANSWER_CHOICES, size=2, replace=False)
            marked_choices = tuple(str(choice) for choice in chosen)
        else:
            marked_choices = (str(rng.choice(ANSWER_CHOICES)),)

        plans.append(
            QuestionPlan(
                question_number=question_number,
                correct_choice=correct_choice,
                marked_choices=marked_choices,
                mark_kind=mark_kind,
            )
        )
    return tuple(plans)