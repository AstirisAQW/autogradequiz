import cv2
import numpy as np
import pytest

from app.answer_sheet_templates.builder import DEFAULT_TEXT_FIELDS, PAGE
from app.answer_sheet_templates.catalog import (
    FIFTY_QUESTIONS,
    HUNDRED_QUESTIONS,
    TWENTY_QUESTIONS,
)
from app.answer_sheet_templates.geometry import ANSWER_CHOICES
from app.bubble_grading.classifier import classify_sheet
from app.bubble_grading.scoring import score_sheet
from app.db import repositories
from app.db.connection import init_db
from app.db.records import NewBatch, NewScanJob, NewTest
from app.grading_pipeline.exceptions import ScanImageUnreadableError, ScanJobAlreadyGradedError
from app.grading_pipeline.grade_scan_job import grade_scan_job, scan_job_needs_review
from app.scan_alignment.align_scan import ScanAlignmentError, align_scan
from app.sheet_rendering.renderer import blank_canvas, bubble_radius_px, mm_to_px, render_sheet
from app.synthetic_sheets.generator import generate_synthetic_sheet
from app.synthetic_sheets.mark_drawing import draw_marks_for_plan
from app.synthetic_sheets.question_plan import generate_answer_key, generate_question_plans
from app.synthetic_sheets.scan_artifacts import (
    apply_gaussian_blur,
    apply_rotation_and_perspective,
)


def _aligned_image_against_key(template_spec, seed, answer_key):
    """An aligned (no scan-artifact) sheet image marked independently of the seed but
    graded against answer_key -- the way a real student sheet is graded against a
    test's pre-set answer key. Used where a test needs classification to reliably track
    the marks, unlike generate_synthetic_sheet's rotation/blur/noise simulation.
    """
    rng = np.random.default_rng(seed)
    canvas = render_sheet(template_spec, page=PAGE)
    radius_px = bubble_radius_px(template_spec, PAGE)

    question_plans = generate_question_plans(template_spec, rng, answer_key=answer_key)
    for plan in question_plans:
        draw_marks_for_plan(canvas, template_spec, plan, radius_px, PAGE, rng)

    return canvas


@pytest.fixture(autouse=True)
def isolated_database(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("AUTOGRADE_DB_PATH", str(db_path))
    monkeypatch.setenv("AUTOGRADE_DATA_DIR", str(tmp_path))
    init_db()


def _create_scan_job(tmp_path, sheet, image_path=None):
    test_record = repositories.create_test(
        NewTest(
            name="Chapter 4 Quiz",
            template_id=TWENTY_QUESTIONS.template_id,
            answer_key=sheet.answer_key,
        )
    )
    batch = repositories.create_batch(NewBatch(test_id=test_record.id))
    if image_path is None:
        image_path = tmp_path / "scan.png"
        cv2.imwrite(str(image_path), sheet.image)
    return repositories.create_scan_job(
        NewScanJob(batch_id=batch.id, raw_image_path=str(image_path))
    )


def test_grade_scan_job_stores_a_score_in_range_and_marks_the_job_done(tmp_path):
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)
    scan_job = _create_scan_job(tmp_path, sheet)

    result = grade_scan_job(scan_job.id)

    assert result.scan_job_id == scan_job.id
    assert 0.0 <= result.score <= 100.0
    assert repositories.get_scan_job(scan_job.id).status == "done"


def test_grade_scan_job_records_one_answer_per_question(tmp_path):
    import json

    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)
    scan_job = _create_scan_job(tmp_path, sheet)

    result = grade_scan_job(scan_job.id)

    answers = json.loads(result.answers_json)
    assert len(answers) == TWENTY_QUESTIONS.question_count


def test_grade_scan_job_needs_review_matches_the_classifier_output(tmp_path):
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)
    scan_job = _create_scan_job(tmp_path, sheet)

    result = grade_scan_job(scan_job.id)

    question_fills = classify_sheet(sheet.image, TWENTY_QUESTIONS)
    assert result.needs_review == scan_job_needs_review(question_fills)


def test_grade_scan_job_raises_for_an_unreadable_image(tmp_path):
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)
    scan_job = _create_scan_job(tmp_path, sheet, image_path=tmp_path / "missing.png")

    with pytest.raises(ScanImageUnreadableError) as exc_info:
        grade_scan_job(scan_job.id)

    assert repositories.get_scan_job(scan_job.id).status == "failed"
    assert repositories.list_pending_scan_jobs() == []
    assert repositories.get_scan_result(scan_job.id).error_message == str(exc_info.value)


def test_grade_scan_job_fails_when_fiducials_are_missing(tmp_path):
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)
    image_path = tmp_path / "no_fiducials.png"
    cv2.imwrite(str(image_path), blank_canvas(PAGE))
    scan_job = _create_scan_job(tmp_path, sheet, image_path=image_path)

    with pytest.raises(ScanAlignmentError):
        grade_scan_job(scan_job.id)

    assert repositories.get_scan_job(scan_job.id).status == "failed"


def test_grade_scan_job_aligns_distorted_sheet_and_saves_processed_image(tmp_path):
    from pathlib import Path

    key_rng = np.random.default_rng(19)
    answer_key = generate_answer_key(TWENTY_QUESTIONS.question_count, key_rng)
    baseline_image = _aligned_image_against_key(TWENTY_QUESTIONS, seed=7, answer_key=answer_key)

    artifact_rng = np.random.default_rng(23)
    distorted = apply_rotation_and_perspective(baseline_image, artifact_rng)
    distorted = apply_gaussian_blur(distorted, artifact_rng)

    test_record = repositories.create_test(
        NewTest(name="Quiz", template_id=TWENTY_QUESTIONS.template_id, answer_key=answer_key)
    )
    batch = repositories.create_batch(NewBatch(test_id=test_record.id))

    baseline_path = tmp_path / "baseline.png"
    cv2.imwrite(str(baseline_path), baseline_image)
    baseline_job = repositories.create_scan_job(
        NewScanJob(batch_id=batch.id, raw_image_path=str(baseline_path))
    )

    distorted_path = tmp_path / "distorted.png"
    cv2.imwrite(str(distorted_path), distorted)
    distorted_job = repositories.create_scan_job(
        NewScanJob(batch_id=batch.id, raw_image_path=str(distorted_path))
    )

    baseline_result = grade_scan_job(baseline_job.id)
    distorted_result = grade_scan_job(distorted_job.id)

    assert distorted_result.answers_json == baseline_result.answers_json
    assert distorted_result.score == baseline_result.score
    assert distorted_result.processed_image_path != str(distorted_path)
    assert Path(distorted_result.processed_image_path).exists()


def test_grade_scan_job_flags_blank_and_180_rotated_sheets_for_review(tmp_path):
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)

    blank_path = tmp_path / "blank.png"
    cv2.imwrite(str(blank_path), render_sheet(TWENTY_QUESTIONS, page=PAGE))
    blank_job = _create_scan_job(tmp_path, sheet, image_path=blank_path)

    rotated_path = tmp_path / "rotated.png"
    cv2.imwrite(str(rotated_path), cv2.rotate(sheet.image, cv2.ROTATE_180))
    rotated_job = _create_scan_job(tmp_path, sheet, image_path=rotated_path)

    assert grade_scan_job(blank_job.id).needs_review is True
    assert grade_scan_job(rotated_job.id).needs_review is True


def test_grade_scan_job_grades_a_batch_of_sheets_against_one_shared_key(tmp_path):
    """The real-world shape this exists for: one test has one answer key, generated
    once and graded against many different students' sheets, not one key per sheet."""
    key_rng = np.random.default_rng(11)
    answer_key = generate_answer_key(TWENTY_QUESTIONS.question_count, key_rng)

    test_record = repositories.create_test(
        NewTest(name="Batch quiz", template_id=TWENTY_QUESTIONS.template_id, answer_key=answer_key)
    )
    batch = repositories.create_batch(NewBatch(test_id=test_record.id))

    scan_job_ids = []
    for seed in range(3):
        sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=seed, answer_key=answer_key)
        image_path = tmp_path / f"scan_{seed}.png"
        cv2.imwrite(str(image_path), sheet.image)
        scan_job = repositories.create_scan_job(
            NewScanJob(batch_id=batch.id, raw_image_path=str(image_path))
        )
        scan_job_ids.append(scan_job.id)

    results = [grade_scan_job(scan_job_id) for scan_job_id in scan_job_ids]

    assert len(results) == 3
    assert all(0.0 <= result.score <= 100.0 for result in results)
    assert all(repositories.get_scan_job(job_id).status == "done" for job_id in scan_job_ids)


def test_grade_scan_job_scores_against_the_tests_key_not_the_sheets_own(tmp_path):
    """Same scanned image, two tests with different answer keys: the score has to
    follow whichever test the scan job belongs to, not something baked into the image.
    """
    key_rng = np.random.default_rng(42)
    answer_key = generate_answer_key(TWENTY_QUESTIONS.question_count, key_rng)
    image = _aligned_image_against_key(TWENTY_QUESTIONS, seed=3, answer_key=answer_key)
    image_path = tmp_path / "scan.png"
    cv2.imwrite(str(image_path), image)

    def _grade_against(key):
        test_record = repositories.create_test(
            NewTest(name="Quiz", template_id=TWENTY_QUESTIONS.template_id, answer_key=key)
        )
        batch = repositories.create_batch(NewBatch(test_id=test_record.id))
        scan_job = repositories.create_scan_job(
            NewScanJob(batch_id=batch.id, raw_image_path=str(image_path))
        )
        return grade_scan_job(scan_job.id)

    matching_result = _grade_against(answer_key)
    disagreeing_key = [
        next(choice for choice in ANSWER_CHOICES if choice != correct) for correct in answer_key
    ]
    disagreeing_result = _grade_against(disagreeing_key)

    assert matching_result.score != disagreeing_result.score


def test_grade_scan_job_reads_text_fields_with_ocr(tmp_path):
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)
    canvas = _aligned_image_against_key(TWENTY_QUESTIONS, seed=3, answer_key=sheet.answer_key)
    expected = {"name": "JORDAN LEE", "date": "2026-11-08", "section": "SEC 3B"}
    for field in DEFAULT_TEXT_FIELDS:
        x0, y0 = mm_to_px(field.x_mm, field.y_mm, PAGE)
        _, y1 = mm_to_px(field.x_mm + field.width_mm, field.y_mm + field.height_mm, PAGE)
        cv2.putText(
            canvas,
            expected[field.id],
            (x0 + 20, y1 - 25),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.2,
            (0, 0, 0),
            3,
        )

    image_path = tmp_path / "ocr.png"
    cv2.imwrite(str(image_path), canvas)
    scan_job = _create_scan_job(tmp_path, sheet, image_path=image_path)

    result = grade_scan_job(scan_job.id)

    assert result.name_text == "JORDAN LEE"
    assert result.date_text == "2026-11-08"
    assert result.section_text == "SEC 3B"


def test_grade_scan_job_succeeds_when_ocr_raises(tmp_path, monkeypatch):
    import pytesseract

    def _boom(*_args, **_kwargs):
        raise RuntimeError("Tesseract missing")

    monkeypatch.setattr(pytesseract, "image_to_string", _boom)
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)
    scan_job = _create_scan_job(tmp_path, sheet)

    result = grade_scan_job(scan_job.id)

    assert repositories.get_scan_job(scan_job.id).status == "done"
    assert (result.name_text, result.date_text, result.section_text) == ("", "", "")


def test_grade_scan_job_correct_then_forced_regrade_keeps_100(tmp_path):
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)
    scan_job = _create_scan_job(tmp_path, sheet)

    grade_scan_job(scan_job.id)
    with pytest.raises(ScanJobAlreadyGradedError):
        grade_scan_job(scan_job.id)

    corrections = {i + 1: choice for i, choice in enumerate(sheet.answer_key)}
    corrected = repositories.apply_scan_corrections(scan_job.id, corrections)
    assert corrected.score == 100.0

    regraded = grade_scan_job(scan_job.id, force=True)
    assert regraded.score == 100.0
    assert regraded.needs_review is False


def test_grade_scan_job_failed_regrade_leaves_good_result_intact(tmp_path):
    from pathlib import Path

    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)
    scan_job = _create_scan_job(tmp_path, sheet)
    good_result = grade_scan_job(scan_job.id)

    Path(scan_job.raw_image_path).unlink()
    with pytest.raises(ScanImageUnreadableError) as exc_info:
        grade_scan_job(scan_job.id, force=True)

    after = repositories.get_scan_result(scan_job.id)
    assert after.score == good_result.score
    assert after.answers_json == good_result.answers_json
    assert after.flags_json == good_result.flags_json
    assert after.needs_review == good_result.needs_review
    assert after.processed_image_path == good_result.processed_image_path
    assert after.error_message == str(exc_info.value)


@pytest.mark.parametrize(
    "template_spec",
    [TWENTY_QUESTIONS, FIFTY_QUESTIONS, HUNDRED_QUESTIONS],
    ids=lambda spec: spec.template_id,
)
def test_apply_scan_corrections_empty_matches_score_sheet_and_needs_review(tmp_path, template_spec):
    test_record = repositories.create_test(
        NewTest(
            name=f"Guard {template_spec.template_id}",
            template_id=template_spec.template_id,
            answer_key=["A"] * template_spec.question_count,
        )
    )
    batch = repositories.create_batch(NewBatch(test_id=test_record.id))

    for seed in range(10):
        sheet = generate_synthetic_sheet(template_spec, seed=seed)
        image_path = tmp_path / f"{template_spec.template_id}_{seed}.png"
        cv2.imwrite(str(image_path), sheet.image)
        scan_job = repositories.create_scan_job(
            NewScanJob(batch_id=batch.id, raw_image_path=str(image_path))
        )

        grade_scan_job(scan_job.id)
        corrected = repositories.apply_scan_corrections(scan_job.id, {})

        aligned = align_scan(sheet.image, template_spec)
        question_fills = classify_sheet(aligned, template_spec)
        expected_summary = score_sheet(question_fills, test_record.answer_key)
        expected_needs_review = scan_job_needs_review(question_fills)

        assert corrected.score == pytest.approx(expected_summary.score_fraction * 100)
        assert corrected.needs_review == expected_needs_review


def test_apply_scan_corrections_flagged_question_matches_manual_recalculation(tmp_path):
    import json

    from app.sheet_rendering.renderer import bubble_position_px
    from app.synthetic_sheets.mark_drawing import draw_perfect_mark

    answer_key = generate_answer_key(TWENTY_QUESTIONS.question_count, np.random.default_rng(7))
    canvas = render_sheet(TWENTY_QUESTIONS, page=PAGE)
    radius_px = bubble_radius_px(TWENTY_QUESTIONS, PAGE)

    # Mark Q1 with two choices so it is flagged MULTIPLE, and Q2..Q20 with the answer key.
    draw_perfect_mark(canvas, bubble_position_px(TWENTY_QUESTIONS, 1, 0, PAGE), radius_px)
    draw_perfect_mark(canvas, bubble_position_px(TWENTY_QUESTIONS, 1, 1, PAGE), radius_px)
    for question_number in range(2, TWENTY_QUESTIONS.question_count + 1):
        choice_index = ANSWER_CHOICES.index(answer_key[question_number - 1])
        draw_perfect_mark(
            canvas,
            bubble_position_px(TWENTY_QUESTIONS, question_number, choice_index, PAGE),
            radius_px,
        )

    test_record = repositories.create_test(
        NewTest(
            name="Manual Recalc",
            template_id=TWENTY_QUESTIONS.template_id,
            answer_key=answer_key,
        )
    )
    batch = repositories.create_batch(NewBatch(test_id=test_record.id))
    image_path = tmp_path / "flagged.png"
    cv2.imwrite(str(image_path), canvas)
    scan_job = repositories.create_scan_job(
        NewScanJob(batch_id=batch.id, raw_image_path=str(image_path))
    )

    initial = grade_scan_job(scan_job.id)
    assert initial.needs_review is True
    flags = json.loads(initial.flags_json)
    assert 1 in flags["multiple"]

    corrections = {1: answer_key[0]}
    corrected = repositories.apply_scan_corrections(scan_job.id, corrections)
    answers = json.loads(corrected.answers_json)
    effective_answers = [corrections.get(i + 1, ans) for i, ans in enumerate(answers)]
    expected_correct = sum(
        1 for actual, expected in zip(effective_answers, answer_key) if actual == expected
    )
    expected_score = (expected_correct / len(answer_key)) * 100

    assert corrected.score == pytest.approx(expected_score)
    assert corrected.score == pytest.approx(100.0)
    assert corrected.needs_review is False


