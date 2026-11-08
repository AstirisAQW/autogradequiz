import cv2
import numpy as np
import pytest

from app.answer_sheet_templates.builder import PAGE
from app.answer_sheet_templates.catalog import TWENTY_QUESTIONS
from app.bubble_grading.classifier import classify_sheet
from app.scan_alignment.align_scan import ScanAlignmentError, align_scan
from app.sheet_rendering.renderer import blank_canvas, bubble_radius_px, render_sheet
from app.synthetic_sheets.mark_drawing import draw_marks_for_plan
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

