import cv2
import numpy as np
import pytest

from app.answer_sheet_templates.builder import PAGE
from app.answer_sheet_templates.catalog import TWENTY_QUESTIONS
from app.answer_sheet_templates.geometry import ANSWER_CHOICES
from app.bubble_grading.classifier import classify_sheet
from app.db import repositories
from app.db.connection import init_db
from app.db.records import NewBatch, NewScanJob, NewTest
from app.grading_pipeline.exceptions import ScanImageSizeMismatchError, ScanImageUnreadableError
from app.grading_pipeline.grade_scan_job import grade_scan_job, scan_job_needs_review
from app.sheet_rendering.renderer import bubble_radius_px, render_sheet
from app.synthetic_sheets.generator import generate_synthetic_sheet
from app.synthetic_sheets.mark_drawing import draw_marks_for_plan
from app.synthetic_sheets.question_plan import generate_answer_key, generate_question_plans


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


def test_grade_scan_job_fails_for_half_size_image(tmp_path):
    sheet = generate_synthetic_sheet(TWENTY_QUESTIONS, seed=1)
    half_image = cv2.resize(sheet.image, (sheet.image.shape[1] // 2, sheet.image.shape[0] // 2))
    image_path = tmp_path / "half.png"
    cv2.imwrite(str(image_path), half_image)
    scan_job = _create_scan_job(tmp_path, sheet, image_path=image_path)

    with pytest.raises(ScanImageSizeMismatchError):
        grade_scan_job(scan_job.id)

    assert repositories.get_scan_job(scan_job.id).status == "failed"


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