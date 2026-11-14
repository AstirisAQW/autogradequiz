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


_MESSY_KINDS = frozenset(
    {
        QuestionMarkKind.DOUBLE,
        QuestionMarkKind.INCOMPLETE,
        QuestionMarkKind.OFF_CENTER,
        QuestionMarkKind.NON_CIRCULAR,
        QuestionMarkKind.LIGHT,
    }
)
_BLANK_DEFAULT_WEIGHT = dict(QUESTION_MARK_WEIGHTS)[QuestionMarkKind.BLANK]
_MESSY_DEFAULT_TOTAL = sum(
    weight for kind, weight in QUESTION_MARK_WEIGHTS if kind in _MESSY_KINDS
)


def _mark_weights(messy: float | None) -> tuple[list[QuestionMarkKind], list[float]]:
    if messy is None:
        return (
            [kind for kind, _ in QUESTION_MARK_WEIGHTS],
            [weight for _, weight in QUESTION_MARK_WEIGHTS],
        )
    if not 0.0 <= messy <= 1.0:
        raise ValueError(f"messy must be between 0.0 and 1.0, got {messy}.")

    blank_weight = min(_BLANK_DEFAULT_WEIGHT, 1.0 - messy)
    perfect_weight = max(0.0, 1.0 - messy - blank_weight)
    kinds: list[QuestionMarkKind] = []
    weights: list[float] = []
    for kind, default_weight in QUESTION_MARK_WEIGHTS:
        kinds.append(kind)
        if kind == QuestionMarkKind.PERFECT:
            weights.append(perfect_weight)
        elif kind == QuestionMarkKind.BLANK:
            weights.append(blank_weight)
        else:
            weights.append((default_weight / _MESSY_DEFAULT_TOTAL) * messy)
    return kinds, weights


def generate_question_plans(
    template_spec: TemplateSpec,
    rng: np.random.Generator,
    answer_key: list[str] | None = None,
    accuracy: float | None = None,
    messy: float | None = None,
) -> tuple[QuestionPlan, ...]:
    """Ground truth for every question on one sheet.

    answer_key, when given, fixes each question's correct_choice instead of drawing it
    from rng -- so the same key can be graded against many independently-generated
    sheets, the way one real test's answer key is graded against a batch of scans.
    """
    if accuracy is not None and not 0.0 <= accuracy <= 1.0:
        raise ValueError(f"accuracy must be between 0.0 and 1.0, got {accuracy}.")

    kinds, weights = _mark_weights(messy)

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
        elif accuracy is not None:
            if rng.random() < accuracy:
                marked_choices = (correct_choice,)
            else:
                wrong_choices = [c for c in ANSWER_CHOICES if c != correct_choice]
                marked_choices = (str(rng.choice(wrong_choices)),)
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