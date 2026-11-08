import numpy as np

from app.answer_sheet_templates.builder import PAGE
from app.answer_sheet_templates.catalog import TWENTY_QUESTIONS
from app.answer_sheet_templates.geometry import ANSWER_CHOICES
from app.bubble_grading.classifier import BubbleResult, QuestionOutcome, classify_sheet, score_sheet
from app.sheet_rendering.renderer import bubble_radius_px, render_sheet
from app.synthetic_sheets.mark_drawing import draw_marks_for_plan
from app.synthetic_sheets.question_plan import generate_answer_key, generate_question_plans


def _aligned_sheet_against_key(template_spec, seed, answer_key):
    """An aligned (no scan-artifact) synthetic sheet, marked independently of seed but
    graded against answer_key -- the way a real student sheet is graded against a test's
    pre-set answer key, rather than against something derived from its own marks.
    """
    rng = np.random.default_rng(seed)
    canvas = render_sheet(template_spec, page=PAGE)
    radius_px = bubble_radius_px(template_spec, PAGE)

    question_plans = generate_question_plans(template_spec, rng, answer_key=answer_key)
    for plan in question_plans:
        draw_marks_for_plan(canvas, template_spec, plan, radius_px, PAGE, rng)

    question_fills = classify_sheet(canvas, template_spec, PAGE)
    return question_plans, question_fills


def test_generate_answer_key_returns_one_choice_per_question():
    rng = np.random.default_rng(0)
    answer_key = generate_answer_key(TWENTY_QUESTIONS.question_count, rng)

    assert len(answer_key) == TWENTY_QUESTIONS.question_count
    assert all(choice in ANSWER_CHOICES for choice in answer_key)


def test_one_generated_key_scores_a_batch_of_independently_seeded_sheets():
    """One answer key, several independently-seeded sheets: the batch-grading scenario
    a real test run looks like, rather than each sheet grading against its own answers.
    """
    key_rng = np.random.default_rng(99)
    answer_key = generate_answer_key(TWENTY_QUESTIONS.question_count, key_rng)

    for seed in range(5):
        question_plans, question_fills = _aligned_sheet_against_key(
            TWENTY_QUESTIONS, seed, answer_key
        )
        summary = score_sheet(question_fills, answer_key)

        assert summary.graded_question_count == TWENTY_QUESTIONS.question_count
        for plan in question_plans:
            fill = question_fills[plan.question_number]
            if fill.result != BubbleResult.FILLED:
                continue
            expected_correct = fill.marked_choices[0] == answer_key[plan.question_number - 1]
            outcome = summary.question_outcomes[plan.question_number]
            if expected_correct:
                assert outcome == QuestionOutcome.CORRECT
            else:
                assert outcome == QuestionOutcome.WRONG


def test_the_same_marks_score_differently_against_a_disagreeing_key():
    """Proves score_sheet actually grades against whatever key it's given, not something
    baked into the classified marks: any question correct against one key must not still
    be correct against a key built to disagree with it everywhere.
    """
    marks_rng = np.random.default_rng(1)
    answer_key = generate_answer_key(TWENTY_QUESTIONS.question_count, marks_rng)
    _, question_fills = _aligned_sheet_against_key(TWENTY_QUESTIONS, seed=7, answer_key=answer_key)

    matching_summary = score_sheet(question_fills, answer_key)
    assert matching_summary.correct_count > 0

    disagreeing_key = [
        next(choice for choice in ANSWER_CHOICES if choice != correct) for correct in answer_key
    ]
    disagreeing_summary = score_sheet(question_fills, disagreeing_key)

    for question_number, outcome in matching_summary.question_outcomes.items():
        if outcome == QuestionOutcome.CORRECT:
            assert disagreeing_summary.question_outcomes[question_number] != QuestionOutcome.CORRECT