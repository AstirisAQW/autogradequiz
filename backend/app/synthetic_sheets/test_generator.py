import json

import numpy as np

from app.answer_sheet_templates.builder import PAGE
from app.answer_sheet_templates.catalog import TWENTY_QUESTIONS
from app.answer_sheet_templates.geometry import mm_to_px
from app.synthetic_sheets.generator import generate_synthetic_sheet
from app.synthetic_sheets.ground_truth import (
    save_ground_truth,
    synthetic_sheet_ground_truth_to_dict,
)
from app.synthetic_sheets.question_plan import (
    QuestionMarkKind,
    generate_answer_key,
    generate_question_plans,
)
from app.synthetic_sheets.stray_marks import STRAY_MARK_MAX_COUNT, STRAY_MARK_MIN_COUNT


def test_same_seed_is_byte_for_byte_reproducible():
    sheet_one = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=123)
    sheet_two = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=123)

    assert np.array_equal(sheet_one.image, sheet_two.image)
    assert sheet_one.question_plans == sheet_two.question_plans
    assert sheet_one.stray_mark_count == sheet_two.stray_mark_count


def test_different_seeds_produce_different_sheets():
    sheet_one = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)
    sheet_two = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=2)

    assert not np.array_equal(sheet_one.image, sheet_two.image)


def test_generated_image_matches_page_dimensions():
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)
    width_px, height_px = mm_to_px(PAGE.width_mm, PAGE.height_mm, PAGE)

    assert sheet.image.shape == (height_px, width_px, 3)


def test_one_plan_per_question():
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)

    question_numbers = [plan.question_number for plan in sheet.question_plans]
    assert question_numbers == list(range(1, TWENTY_QUESTIONS.question_count + 1))


def test_stray_mark_count_within_configured_bounds():
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)

    assert STRAY_MARK_MIN_COUNT <= sheet.stray_mark_count < STRAY_MARK_MAX_COUNT


def test_blank_plan_has_no_marked_choices():
    rng = np.random.default_rng(1)
    plans = generate_question_plans(TWENTY_QUESTIONS, rng)

    for plan in plans:
        if plan.mark_kind == QuestionMarkKind.BLANK:
            assert plan.marked_choices == ()
        elif plan.mark_kind == QuestionMarkKind.DOUBLE:
            assert len(plan.marked_choices) == 2
            assert len(set(plan.marked_choices)) == 2
        else:
            assert len(plan.marked_choices) == 1


def test_answer_key_has_one_entry_per_question():
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)

    assert len(sheet.answer_key) == TWENTY_QUESTIONS.question_count
    assert all(choice in ("A", "B", "C", "D", "E") for choice in sheet.answer_key)


def test_generate_synthetic_sheet_grades_against_a_supplied_answer_key():
    rng = np.random.default_rng(500)
    answer_key = generate_answer_key(TWENTY_QUESTIONS.question_count, rng)

    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1, answer_key=answer_key)

    assert sheet.answer_key == answer_key


def test_one_answer_key_can_be_shared_across_a_batch_of_sheets():
    """The real-world shape this exists for: one test has one answer key, graded
    against many different students' sheets."""
    rng = np.random.default_rng(500)
    answer_key = generate_answer_key(TWENTY_QUESTIONS.question_count, rng)

    sheets = [
        generate_synthetic_sheet(TWENTY_QUESTIONS, seed=seed, answer_key=answer_key)
        for seed in range(4)
    ]

    for sheet in sheets:
        assert sheet.answer_key == answer_key
    marked_choices_by_sheet = [
        [plan.marked_choices for plan in sheet.question_plans] for sheet in sheets
    ]
    assert len({tuple(choices) for choices in marked_choices_by_sheet}) > 1


def test_save_ground_truth_writes_seed_and_answers_not_pixels(tmp_path):
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=42)
    out_path = tmp_path / "sheet_042.json"

    save_ground_truth(sheet, out_path)

    saved = json.loads(out_path.read_text(encoding="utf-8"))
    assert saved["seed"] == 42
    assert saved["template_id"] == TWENTY_QUESTIONS.template_id
    assert len(saved["questions"]) == TWENTY_QUESTIONS.question_count
    assert "image" not in saved


def test_ground_truth_round_trip_reproduces_the_same_sheet(tmp_path):
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=7)
    out_path = tmp_path / "sheet_007.json"
    save_ground_truth(sheet, out_path)

    saved = json.loads(out_path.read_text(encoding="utf-8"))
    regenerated = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=saved["seed"])

    assert np.array_equal(regenerated.image, sheet.image)
    assert synthetic_sheet_ground_truth_to_dict(regenerated) == saved