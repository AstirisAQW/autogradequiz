import cv2
import numpy as np
import pytest

from app.answer_sheet_templates.builder import PAGE
from app.answer_sheet_templates.catalog import FIFTY_QUESTIONS, TWENTY_QUESTIONS
from app.answer_sheet_templates.geometry import (
    ANSWER_CHOICES,
    bubble_position_px,
    bubble_radius_px,
)
from app.bubble_grading.classifier import classify_sheet
from app.bubble_grading.scoring import score_sheet
from app.scan_alignment.align_scan import ScanAlignmentError, align_scan
from app.sheet_rendering.renderer import (
    blank_canvas,
    render_sheet,
)
from app.synthetic_sheets.generator import generate_synthetic_sheet
from app.synthetic_sheets.mark_drawing import draw_marks_for_plan, draw_perfect_mark
from app.synthetic_sheets.question_plan import generate_answer_key, generate_question_plans
from app.synthetic_sheets.scan_artifacts import (
    apply_gaussian_blur,
    apply_rotation_and_perspective,
)


def _marked_sheet(seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    canvas = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    radius_px = bubble_radius_px(TWENTY_QUESTIONS, PAGE)
    answer_key = generate_answer_key(TWENTY_QUESTIONS.question_count, rng)
    for plan in generate_question_plans(TWENTY_QUESTIONS, rng, answer_key=answer_key):
        draw_marks_for_plan(canvas, TWENTY_QUESTIONS, plan, radius_px, PAGE, rng)
    return canvas


def test_align_scan_recovers_classification_after_rotation_perspective_and_blur():
    baseline_image = _marked_sheet(seed=7)
    baseline_fills = classify_sheet(baseline_image, TWENTY_QUESTIONS)

    rng = np.random.default_rng(12)
    distorted = apply_rotation_and_perspective(baseline_image, rng)
    distorted = apply_gaussian_blur(distorted, rng)

    aligned = align_scan(distorted, TWENTY_QUESTIONS)
    aligned_fills = classify_sheet(aligned, TWENTY_QUESTIONS)

    assert {q: (f.result, f.marked_choices) for q, f in aligned_fills.items()} == {
        q: (f.result, f.marked_choices) for q, f in baseline_fills.items()
    }


def test_align_scan_resolves_180_degree_rotation_via_mid_markers():
    baseline_image = _marked_sheet(seed=7)
    baseline_fills = classify_sheet(baseline_image, TWENTY_QUESTIONS)

    upside_down = cv2.rotate(baseline_image, cv2.ROTATE_180)
    aligned = align_scan(upside_down, TWENTY_QUESTIONS)
    aligned_fills = classify_sheet(aligned, TWENTY_QUESTIONS)

    assert {q: (f.result, f.marked_choices) for q, f in aligned_fills.items()} == {
        q: (f.result, f.marked_choices) for q, f in baseline_fills.items()
    }


def test_align_scan_raises_when_fewer_than_four_fiducials():
    with pytest.raises(ScanAlignmentError):
        align_scan(blank_canvas(PAGE), TWENTY_QUESTIONS)


def _fully_marked_sheet_for_key(answer_key: list[str]) -> np.ndarray:
    canvas = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    radius_px = bubble_radius_px(TWENTY_QUESTIONS, PAGE)
    for q_num, choice in enumerate(answer_key, start=1):
        center = bubble_position_px(
            TWENTY_QUESTIONS, q_num, ANSWER_CHOICES.index(choice), PAGE
        )
        draw_perfect_mark(canvas, center, radius_px)
    return canvas


def test_align_scan_grades_100_under_45_percent_horizontal_brightness_gradient():
    rng = np.random.default_rng(31)
    answer_key = generate_answer_key(TWENTY_QUESTIONS.question_count, rng)
    sheet = _fully_marked_sheet_for_key(answer_key)

    gradient = np.linspace(1.0, 0.55, sheet.shape[1], dtype=np.float32)[None, :, None]
    shaded = np.clip(sheet.astype(np.float32) * gradient, 0, 255).astype(np.uint8)

    aligned = align_scan(shaded, TWENTY_QUESTIONS)
    summary = score_sheet(classify_sheet(aligned, TWENTY_QUESTIONS), answer_key)

    assert summary.score_fraction * 100 == 100.0


def test_align_scan_grades_100_on_90_degree_rotated_sheet():
    rng = np.random.default_rng(37)
    answer_key = generate_answer_key(TWENTY_QUESTIONS.question_count, rng)
    sheet = _fully_marked_sheet_for_key(answer_key)

    rotated_90 = cv2.rotate(sheet, cv2.ROTATE_90_CLOCKWISE)
    aligned = align_scan(rotated_90, TWENTY_QUESTIONS)
    summary = score_sheet(classify_sheet(aligned, TWENTY_QUESTIONS), answer_key)

    assert summary.score_fraction * 100 == 100.0


def test_align_scan_aligns_sheet_at_5_degrees_rotation():
    rng = np.random.default_rng(41)
    answer_key = generate_answer_key(TWENTY_QUESTIONS.question_count, rng)
    sheet = _fully_marked_sheet_for_key(answer_key)
    height, width = sheet.shape[:2]

    rot_matrix = cv2.getRotationMatrix2D((width / 2, height / 2), 5.0, 1.0)
    rotated_5 = cv2.warpAffine(
        sheet,
        rot_matrix,
        (width, height),
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(255, 255, 255),
    )

    aligned = align_scan(rotated_5, TWENTY_QUESTIONS)
    summary = score_sheet(classify_sheet(aligned, TWENTY_QUESTIONS), answer_key)

    assert summary.score_fraction * 100 == 100.0


@pytest.mark.parametrize(
    ("template", "seed"),
    [
        (TWENTY_QUESTIONS, 21),
        (TWENTY_QUESTIONS, 26),
        (FIFTY_QUESTIONS, 2),
        (FIFTY_QUESTIONS, 12),
        (FIFTY_QUESTIONS, 34),
    ],
)
def test_align_scan_aligns_border_clipped_synthetic_seeds(template, seed):
    sheet = generate_synthetic_sheet(template, seed=seed)
    aligned = align_scan(sheet.image, template)

    assert aligned.shape == sheet.image.shape



