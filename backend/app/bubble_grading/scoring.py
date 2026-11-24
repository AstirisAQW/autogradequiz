from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from enum import Enum

from app.bubble_grading.classifier import BubbleResult, QuestionFill


class QuestionOutcome(Enum):

    CORRECT = "correct"
    PARTIAL = "partial"
    WRONG = "wrong"
    BLANK = "blank"
    AMBIGUOUS = "ambiguous"
    MULTIPLE = "multiple"


@dataclass(frozen=True)
class QuestionRule:

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


def score_single_answer(
    choice: str,
    accepted_expr: str,
    weight: float,
    rule: QuestionRule | None = None,
) -> tuple[QuestionOutcome, float, float]:
    active_rule = rule or QuestionRule()
    alt_map = _alt_choice_map(active_rule)
    max_pts = max([weight, *alt_map.values(), 0.0])
    if choice == "":
        return QuestionOutcome.BLANK, 0.0, max_pts
    accepted = [c for c in accepted_expr.split("+") if c]
    if choice in accepted:
        return QuestionOutcome.CORRECT, weight, max_pts
    if choice in alt_map:
        return QuestionOutcome.PARTIAL, alt_map[choice], max_pts
    return QuestionOutcome.WRONG, active_rule.incorrect_points, max_pts


def score_sheet(
    question_fills: dict[int, QuestionFill],
    answer_key: list[str],
    points: list[float] | None = None,
    question_rules: list[QuestionRule] | None = None,
) -> ScoreSummary:
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
            outcome, earned, _ = score_single_answer(
                fill.marked_choices[0], answer_key[question_number - 1], weight, rule
            )
            outcomes[question_number] = outcome
            earned_points += earned

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
