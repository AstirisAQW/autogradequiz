import json

import numpy as np

from app.grading.sheet_renderer import mm_to_px
from app.grading.synthetic_sheets import (
    STRAY_MARK_MAX_COUNT,
    STRAY_MARK_MIN_COUNT,
    QuestionMarkKind,
    generate_question_plans,
    generate_synthetic_sheet,
    save_ground_truth,
    synthetic_sheet_ground_truth_to_dict,
)
from app.grading.template_builder import PAGE
from app.grading.template_catalog import TWENTY_QUESTIONS


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