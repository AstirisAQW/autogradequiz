import cv2
import numpy as np
import pytest

from app.answer_sheet_templates.builder import DEFAULT_TEXT_FIELDS, PAGE
from app.answer_sheet_templates.catalog import (
    FIFTY_QUESTIONS,
    HUNDRED_QUESTIONS,
    TWENTY_QUESTIONS,
)
from app.answer_sheet_templates.geometry import (
    bubble_radius_px,
    mm_to_px,
)
from app.bubble_grading.classifier import classify_sheet
from app.bubble_grading.scoring import QuestionRule, score_sheet
from app.grading_pipeline.exceptions import InvalidAnswerKeyError
from app.grading_pipeline.pipeline import (
    ResolvedKeySpec,
    grade_image_with_versions,
    normalize_answer_key_entry,
    read_text_fields,
    scan_job_needs_review,
    validate_answer_key_and_points,
)
from app.scan_alignment.aligner import ScanAlignmentError
from app.sheet_rendering.renderer import blank_canvas, render_sheet
from tests.synthetic_sheets.generator import generate_synthetic_sheet
from tests.synthetic_sheets.mark_drawing import draw_marks_for_plan
from tests.synthetic_sheets.question_plan import (
    generate_answer_key,
    generate_question_plans,
)
from tests.synthetic_sheets.scan_artifacts import (
    apply_gaussian_blur,
    apply_rotation_and_perspective,
)


def _aligned_image_against_key(template_spec, seed, answer_key):
    rng = np.random.default_rng(seed)
    canvas = render_sheet(template_spec, page=PAGE)
    radius_px = bubble_radius_px(template_spec, PAGE)
    question_plans = generate_question_plans(
        template_spec, rng, answer_key=answer_key
    )
    for plan in question_plans:
        draw_marks_for_plan(canvas, template_spec, plan, radius_px, PAGE, rng)
    return canvas


def _grade_single_key(image, template_spec, answer_key):
    primary = ResolvedKeySpec(
        version="A",
        answer_key=answer_key,
        points=[1.0] * len(answer_key),
        question_rules=[QuestionRule()] * len(answer_key),
    )
    aligned, fills, score, text_fields, *_ = grade_image_with_versions(
        image, template_spec, primary_key=primary
    )
    return aligned, fills, score, text_fields


def test_normalize_and_validate_answer_key_and_points():
    assert normalize_answer_key_entry(" b+a ") == "A+B"
    with pytest.raises(InvalidAnswerKeyError):
        normalize_answer_key_entry("Z")
    with pytest.raises(InvalidAnswerKeyError):
        validate_answer_key_and_points(20, ["A"] * 5)
    with pytest.raises(InvalidAnswerKeyError):
        validate_answer_key_and_points(2, ["A", "B"], [1.0, -1.0])


def test_grade_image_array_scores_and_aligns_distorted_sheet():
    key_rng = np.random.default_rng(19)
    answer_key = generate_answer_key(TWENTY_QUESTIONS.question_count, key_rng)
    baseline_image = _aligned_image_against_key(
        TWENTY_QUESTIONS, seed=7, answer_key=answer_key
    )

    artifact_rng = np.random.default_rng(23)
    distorted = apply_rotation_and_perspective(baseline_image, artifact_rng)
    distorted = apply_gaussian_blur(distorted, artifact_rng)

    _, base_fills, base_score, _ = _grade_single_key(
        baseline_image, TWENTY_QUESTIONS, answer_key
    )
    _, dist_fills, dist_score, _ = _grade_single_key(
        distorted, TWENTY_QUESTIONS, answer_key
    )

    assert [f.marked_choices for f in dist_fills.values()] == [
        f.marked_choices for f in base_fills.values()
    ]
    assert dist_score.score_fraction == base_score.score_fraction


def test_grade_image_with_versions_fails_when_fiducials_are_missing():
    with pytest.raises(ScanAlignmentError):
        _grade_single_key(
            blank_canvas(PAGE), TWENTY_QUESTIONS, ["A"] * 20
        )


def test_scan_job_needs_review_flags_blank_sheets():
    blank = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    _, fills, _, _ = _grade_single_key(blank, TWENTY_QUESTIONS, ["A"] * 20)
    assert scan_job_needs_review(fills) is True


def test_read_text_fields_with_ocr_and_empty_box_skip(monkeypatch):
    import pytesseract

    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)
    canvas = _aligned_image_against_key(
        TWENTY_QUESTIONS, seed=3, answer_key=sheet.answer_key
    )

    def _should_not_be_called(*_args, **_kwargs):
        raise AssertionError("OCR should not run on empty text boxes")

    monkeypatch.setattr(pytesseract, "image_to_string", _should_not_be_called)
    assert read_text_fields(canvas) == {
        "name": "",
        "date": "",
        "class": "",
        "student_id": "",
    }

    name_field = next(f for f in DEFAULT_TEXT_FIELDS if f.id == "name")
    x0, _ = mm_to_px(name_field.x_mm, name_field.y_mm, PAGE)
    _, y1 = mm_to_px(
        name_field.x_mm + name_field.width_mm,
        name_field.y_mm + name_field.height_mm,
        PAGE,
    )
    cv2.putText(
        canvas,
        "Ana Cruz",
        (x0 + 20, y1 - 25),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.2,
        (0, 0, 0),
        3,
    )

    calls = 0

    def _fake_ocr(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return "Ana Cruz"

    monkeypatch.setattr(pytesseract, "image_to_string", _fake_ocr)
    fields = read_text_fields(canvas)
    assert calls == 1
    assert fields == {
        "name": "Ana Cruz",
        "date": "",
        "class": "",
        "student_id": "",
    }

    monkeypatch.setattr(pytesseract, "image_to_string", lambda *_a, **_kw: " x ")
    assert read_text_fields(canvas)["name"] == ""

    class_field = next(f for f in DEFAULT_TEXT_FIELDS if f.id == "class")
    cx0, _ = mm_to_px(class_field.x_mm, class_field.y_mm, PAGE)
    _, cy1 = mm_to_px(
        class_field.x_mm + class_field.width_mm,
        class_field.y_mm + class_field.height_mm,
        PAGE,
    )
    cv2.putText(
        canvas,
        "10-Rizal",
        (cx0 + 20, cy1 - 25),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.2,
        (0, 0, 0),
        3,
    )
    multi_calls = 0

    def _fake_multi_ocr(*_args, **_kwargs):
        nonlocal multi_calls
        multi_calls += 1
        return "FieldVal"

    monkeypatch.setattr(pytesseract, "image_to_string", _fake_multi_ocr)
    multi_fields = read_text_fields(canvas)
    assert multi_calls == 2
    assert multi_fields["name"] == "FieldVal"
    assert multi_fields["class"] == "FieldVal"


@pytest.mark.parametrize(
    "template_spec",
    [TWENTY_QUESTIONS, FIFTY_QUESTIONS, HUNDRED_QUESTIONS],
    ids=lambda spec: spec.template_id,
)
def test_grade_image_with_versions_matches_direct_pipeline(template_spec):
    sheet = generate_synthetic_sheet(template_spec, seed=0)
    key = ["A"] * template_spec.question_count
    aligned, fills, summary, _ = _grade_single_key(
        sheet.image, template_spec, key
    )
    expected_fills = classify_sheet(aligned, template_spec)
    expected_summary = score_sheet(expected_fills, key)
    assert summary.score_fraction == pytest.approx(
        expected_summary.score_fraction
    )
