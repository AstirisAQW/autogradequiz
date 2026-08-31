import cv2
import pytest

from app.answer_sheet_templates.catalog import TWENTY_QUESTIONS
from app.bubble_grading.classifier import classify_sheet
from app.db import repositories
from app.db.connection import init_db
from app.db.records import NewBatch, NewScanJob, NewTest
from app.grading_pipeline.exceptions import ScanImageUnreadableError
from app.grading_pipeline.grade_scan_job import grade_scan_job, scan_job_needs_review
from app.synthetic_sheets.generator import generate_synthetic_sheet


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

    with pytest.raises(ScanImageUnreadableError):
        grade_scan_job(scan_job.id)
