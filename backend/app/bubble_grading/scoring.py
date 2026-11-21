"""Scoring classified bubble answers against an answer key."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from enum import Enum

from app.bubble_grading.classifier import BubbleResult, QuestionFill


class QuestionOutcome(Enum):
    """A graded answer compared against the answer key."""

    CORRECT = "correct"
    PARTIAL = "partial"
    WRONG = "wrong"
    BLANK = "blank"
    AMBIGUOUS = "ambiguous"
    MULTIPLE = "multiple"


@dataclass(frozen=True)
class QuestionRule:
    """Optional partial-credit alternate answers and attempted-incorrect score."""

    alternate_answers: tuple[tuple[str, float], ...] = ()
    incorrect_points: float = 0.0


@dataclass(frozen=True)
class ScoreSummary:
    correct_count: int
    wrong_count: int
    blank_count: int
    ambiguous_count: int
    multiple_count: int
    question_outcomes: dict[int, QuestionOutcome]
    earned_points: float = 0.0
    total_points: float = 0.0
    partial_count: int = 0

    @property
    def graded_question_count(self) -> int:
        return len(self.question_outcomes)

    @property
    def score_fraction(self) -> float:
        if self.total_points > 0:
            return self.earned_points / self.total_points
        return 0.0


def _alt_choice_map(rule: QuestionRule) -> dict[str, float]:
    mapping: dict[str, float] = {}
    for choice_expr, pts in rule.alternate_answers:
        for ch in choice_expr.split("+"):
            cleaned = ch.strip()
            if cleaned:
                mapping[cleaned] = max(mapping.get(cleaned, pts), pts)
    return mapping


def score_sheet(
    question_fills: dict[int, QuestionFill],
    answer_key: list[str],
    points: list[float] | None = None,
    question_rules: list[QuestionRule] | None = None,
) -> ScoreSummary:
    """Grade classified answers against an answer key and optional partial/attempt rules."""
    outcomes: dict[int, QuestionOutcome] = {}
    earned_points = 0.0
    total_points = 0.0

    for question_number, fill in sorted(question_fills.items()):
        weight = float(points[question_number - 1]) if points else 1.0
        rule = (
            question_rules[question_number - 1]
            if question_rules and question_number - 1 < len(question_rules)
            else QuestionRule()
        )
        alt_map = _alt_choice_map(rule)
        max_pts = max([weight, *alt_map.values(), 0.0])
        total_points += max_pts

        if fill.result == BubbleResult.BLANK:
            outcomes[question_number] = QuestionOutcome.BLANK
        elif fill.result == BubbleResult.MULTIPLE:
            outcomes[question_number] = QuestionOutcome.MULTIPLE
        elif fill.result == BubbleResult.AMBIGUOUS:
            outcomes[question_number] = QuestionOutcome.AMBIGUOUS
        else:
            accepted_choices = answer_key[question_number - 1].split("+")
            marked_choice = fill.marked_choices[0]
            if marked_choice in accepted_choices:
                outcomes[question_number] = QuestionOutcome.CORRECT
                earned_points += weight
            elif marked_choice in alt_map:
                outcomes[question_number] = QuestionOutcome.PARTIAL
                earned_points += alt_map[marked_choice]
            else:
                outcomes[question_number] = QuestionOutcome.WRONG
                earned_points += rule.incorrect_points

    counts = Counter(outcomes.values())
    return ScoreSummary(
        correct_count=counts[QuestionOutcome.CORRECT],
        wrong_count=counts[QuestionOutcome.WRONG],
        blank_count=counts[QuestionOutcome.BLANK],
        ambiguous_count=counts[QuestionOutcome.AMBIGUOUS],
        multiple_count=counts[QuestionOutcome.MULTIPLE],
        question_outcomes=outcomes,
        earned_points=earned_points,
        total_points=total_points,
        partial_count=counts[QuestionOutcome.PARTIAL],
    )
