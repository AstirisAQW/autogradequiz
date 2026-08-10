import pytest

from app.db import repositories
from app.db.connection import init_db
from app.db.exceptions import (
    BatchNotFoundError,
    ScanResultNotFoundError,
    TestNotFoundError,
)
from app.db.records import NewBatch, NewScanJob, NewScanResult, NewTest


@pytest.fixture(autouse=True)
def isolated_database(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("AUTOGRADE_DB_PATH", str(db_path))
    monkeypatch.setenv("AUTOGRADE_DATA_DIR", str(tmp_path))
    init_db()


def _create_sample_test():
    return repositories.create_test(
        NewTest(name="Chapter 4 Quiz", template_id="20q_a4", answer_key=["A", "B", "C"])
    )


def test_create_test_stores_question_count_from_answer_key():
    test_record = _create_sample_test()

    assert test_record.question_count == 3
    assert test_record.answer_key == ["A", "B", "C"]


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


def test_get_scan_result_raises_for_unknown_scan_job():
    with pytest.raises(ScanResultNotFoundError):
        repositories.get_scan_result(999)
