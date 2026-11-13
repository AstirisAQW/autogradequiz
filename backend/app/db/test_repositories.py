import pytest

from app.db import repositories
from app.db.connection import init_db
from app.db.exceptions import (
    BatchNotFoundError,
    InvalidTestError,
    ScanResultNotFoundError,
    TestNotFoundError,
)
from app.db.records import NewBatch, NewScanJob, NewScanResult, NewTest
from app.grading_pipeline.corrections import apply_scan_corrections

SAMPLE_ANSWER_KEY = ["A", "B", "C", "D"] * 5


@pytest.fixture(autouse=True)
def isolated_database(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("AUTOGRADE_DB_PATH", str(db_path))
    monkeypatch.setenv("AUTOGRADE_DATA_DIR", str(tmp_path))
    init_db()


def _create_sample_test():
    return repositories.create_test(
        NewTest(name="Chapter 4 Quiz", template_id="20q_a4", answer_key=SAMPLE_ANSWER_KEY)
    )


def test_create_test_stores_question_count_from_answer_key():
    test_record = _create_sample_test()

    assert test_record.question_count == 20
    assert test_record.answer_key == SAMPLE_ANSWER_KEY


def test_create_test_rejects_unknown_template():
    with pytest.raises(InvalidTestError):
        repositories.create_test(
            NewTest(name="Quiz", template_id="unknown_a4", answer_key=SAMPLE_ANSWER_KEY)
        )


def test_create_test_rejects_wrong_answer_key_length():
    with pytest.raises(InvalidTestError):
        repositories.create_test(
            NewTest(name="Quiz", template_id="20q_a4", answer_key=["A", "B", "C"])
        )


def test_create_test_rejects_invalid_answer_choice():
    with pytest.raises(InvalidTestError):
        repositories.create_test(
            NewTest(name="Quiz", template_id="20q_a4", answer_key=["Z"] + SAMPLE_ANSWER_KEY[1:])
        )


def test_get_test_returns_stored_test():
    created = _create_sample_test()

    fetched = repositories.get_test(created.id)

    assert fetched == created


def test_get_test_raises_for_unknown_id():
    with pytest.raises(TestNotFoundError):
        repositories.get_test(999)


def test_list_tests_returns_all_created_tests():
    _create_sample_test()
    _create_sample_test()

    tests = repositories.list_tests()

    assert len(tests) == 2


def test_create_batch_links_to_its_test():
    test_record = _create_sample_test()

    batch = repositories.create_batch(NewBatch(test_id=test_record.id))

    assert batch.test_id == test_record.id
    assert batch.status == "pending"


def test_create_batch_raises_for_unknown_test():
    with pytest.raises(TestNotFoundError):
        repositories.create_batch(NewBatch(test_id=999))


def test_get_batch_raises_for_unknown_id():
    with pytest.raises(BatchNotFoundError):
        repositories.get_batch(999)


def test_list_batches_for_test_returns_only_matching_batches():
    test_a = _create_sample_test()
    test_b = _create_sample_test()
    repositories.create_batch(NewBatch(test_id=test_a.id))
    repositories.create_batch(NewBatch(test_id=test_b.id))

    batches_for_a = repositories.list_batches_for_test(test_a.id)

    assert len(batches_for_a) == 1
    assert batches_for_a[0].test_id == test_a.id


def test_scan_job_lifecycle_moves_from_pending_to_done():
    test_record = _create_sample_test()
    batch = repositories.create_batch(NewBatch(test_id=test_record.id))
    scan_job = repositories.create_scan_job(
        NewScanJob(batch_id=batch.id, raw_image_path="/data/raw/scan_1.jpg")
    )

    assert scan_job.status == "pending"
    assert repositories.list_pending_scan_jobs() == [scan_job]

    updated = repositories.update_scan_job_status(scan_job.id, "done")

    assert updated.status == "done"
    assert repositories.list_pending_scan_jobs() == []


def test_save_scan_result_round_trips_and_flags_for_review():
    test_record = _create_sample_test()
    batch = repositories.create_batch(NewBatch(test_id=test_record.id))
    scan_job = repositories.create_scan_job(
        NewScanJob(batch_id=batch.id, raw_image_path="/data/raw/scan_1.jpg")
    )

    saved = repositories.save_scan_result(
        NewScanResult(
            scan_job_id=scan_job.id,
            name_text="Jordan Lee",
            date_text="2026-08-10",
            section_text="3B",
            score=86.7,
            answers_json="[]",
            flags_json="{}",
            needs_review=True,
            processed_image_path="/data/processed/scan_1.jpg",
        )
    )

    fetched = repositories.get_scan_result(scan_job.id)

    assert fetched == saved
    assert fetched.needs_review is True
    assert repositories.list_scan_results_needing_review() == [fetched]


def test_list_scan_results_for_batch_includes_ungraded_scan_with_its_job_id():
    batch = repositories.create_batch(NewBatch(test_id=_create_sample_test().id))
    scan_job = repositories.create_scan_job(
        NewScanJob(batch_id=batch.id, raw_image_path="/data/raw/scan_1.jpg")
    )

    [result] = repositories.list_scan_results_for_batch(batch.id)

    assert result.scan_job_id == scan_job.id
    assert result.status == "pending"
    assert result.answers_json == "[]"


def test_get_scan_result_raises_for_unknown_scan_job():
    with pytest.raises(ScanResultNotFoundError):
        repositories.get_scan_result(999)


def _create_flagged_scan_result(flagged_questions: list[int]) -> tuple[int, str]:
    import json

    test_record = _create_sample_test()
    batch = repositories.create_batch(NewBatch(test_id=test_record.id))
    scan_job = repositories.create_scan_job(
        NewScanJob(batch_id=batch.id, raw_image_path="/data/raw/scan_1.jpg")
    )
    answers = list(SAMPLE_ANSWER_KEY)
    for q_num in flagged_questions:
        answers[q_num - 1] = "A+B"
    answers_json = json.dumps(answers)
    flags_json = json.dumps({"ambiguous": [], "multiple": flagged_questions})
    initial_correct = 20 - len(flagged_questions)
    repositories.save_scan_result(
        NewScanResult(
            scan_job_id=scan_job.id,
            score=(initial_correct / 20) * 100.0,
            answers_json=answers_json,
            flags_json=flags_json,
            needs_review=True,
        )
    )
    return scan_job.id, answers_json


def test_apply_scan_corrections_correct_choice_rescores_and_clears_needs_review():
    scan_job_id, original_answers_json = _create_flagged_scan_result([1])

    updated = apply_scan_corrections(scan_job_id, {1: SAMPLE_ANSWER_KEY[0]})

    assert updated.answers_json == original_answers_json
    assert updated.score == 100.0
    assert updated.needs_review is False
    assert repositories.get_scan_corrections(scan_job_id) == {1: SAMPLE_ANSWER_KEY[0]}


def test_apply_scan_corrections_wrong_choice_clears_needs_review_without_adding_score():
    scan_job_id, original_answers_json = _create_flagged_scan_result([1])

    updated = apply_scan_corrections(scan_job_id, {1: "E"})

    assert updated.answers_json == original_answers_json
    assert updated.score == 95.0
    assert updated.needs_review is False


def test_apply_scan_corrections_partial_resolution_keeps_needs_review():
    scan_job_id, original_answers_json = _create_flagged_scan_result([1, 2])

    partial = apply_scan_corrections(scan_job_id, {1: SAMPLE_ANSWER_KEY[0]})

    assert partial.answers_json == original_answers_json
    assert partial.score == 95.0
    assert partial.needs_review is True

    resolved = apply_scan_corrections(scan_job_id, {2: "E"})

    assert resolved.answers_json == original_answers_json
    assert resolved.score == 95.0
    assert resolved.needs_review is False



