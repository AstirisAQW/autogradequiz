"""Scoring classified bubble answers against an answer key."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from enum import Enum

from app.bubble_grading.classifier import BubbleResult, QuestionFill


class QuestionOutcome(Enum):
    """A graded answer compared against the answer key."""

    CORRECT = "correct"
    WRONG = "wrong"
    BLANK = "blank"
    AMBIGUOUS = "ambiguous"
    MULTIPLE = "multiple"


@dataclass(frozen=True)
class ScoreSummary:
    correct_count: int
    wrong_count: int
    blank_count: int
    ambiguous_count: int
    multiple_count: int
    question_outcomes: dict[int, QuestionOutcome]

    @property
    def graded_question_count(self) -> int:
        return len(self.question_outcomes)

    @property
    def score_fraction(self) -> float:
        if self.graded_question_count == 0:
            return 0.0
        return self.correct_count / self.graded_question_count


def score_sheet(question_fills: dict[int, QuestionFill], answer_key: list[str]) -> ScoreSummary:
    """Grade classified answers against an answer key.

    Blank and wrong are tracked separately (rather than folded into one "not correct"
    bucket) so a teacher can tell a student who skipped questions from one who answered
    and missed them.
    """
    outcomes: dict[int, QuestionOutcome] = {}

    for question_number, fill in sorted(question_fills.items()):
        if fill.result == BubbleResult.BLANK:
            outcomes[question_number] = QuestionOutcome.BLANK
        elif fill.result == BubbleResult.MULTIPLE:
            outcomes[question_number] = QuestionOutcome.MULTIPLE
        elif fill.result == BubbleResult.AMBIGUOUS:
            outcomes[question_number] = QuestionOutcome.AMBIGUOUS
        else:
            correct_choice = answer_key[question_number - 1]
            marked_choice = fill.marked_choices[0]
            if marked_choice == correct_choice:
                outcomes[question_number] = QuestionOutcome.CORRECT
            else:
                outcomes[question_number] = QuestionOutcome.WRONG

    counts = Counter(outcomes.values())
    return ScoreSummary(
        correct_count=counts[QuestionOutcome.CORRECT],
        wrong_count=counts[QuestionOutcome.WRONG],
        blank_count=counts[QuestionOutcome.BLANK],
        ambiguous_count=counts[QuestionOutcome.AMBIGUOUS],
        multiple_count=counts[QuestionOutcome.MULTIPLE],
        question_outcomes=outcomes,
    )
