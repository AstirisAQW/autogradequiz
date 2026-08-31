import json
import sqlite3

from app.db.connection import get_connection
from app.db.exceptions import (
    BatchNotFoundError,
    ScanJobNotFoundError,
    ScanResultNotFoundError,
    TestNotFoundError,
)
from app.db.records import (
    BatchRecord,
    NewBatch,
    NewScanJob,
    NewScanResult,
    NewTest,
    ScanJobRecord,
    ScanResultRecord,
    TestRecord,
)


def _test_from_row(row: sqlite3.Row) -> TestRecord:
    return TestRecord(
        id=row["id"],
        name=row["name"],
        template_id=row["template_id"],
        answer_key=json.loads(row["answer_key_json"]),
        question_count=row["question_count"],
        created_at=row["created_at"],
    )


def create_test(new_test: NewTest) -> TestRecord:
    """Insert a test and its answer key, then return the stored record."""
    answer_key_json = json.dumps(new_test.answer_key)
    with get_connection() as connection:
        cursor = connection.execute(
            "INSERT INTO tests (name, template_id, answer_key_json, question_count) "
            "VALUES (?, ?, ?, ?)",
            (new_test.name, new_test.template_id, answer_key_json, len(new_test.answer_key)),
        )
        connection.commit()
        return get_test(cursor.lastrowid)


def get_test(test_id: int) -> TestRecord:
    """Return one test by id, or raise TestNotFoundError."""
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM tests WHERE id = ?", (test_id,)).fetchone()
    if row is None:
        raise TestNotFoundError(test_id)
    return _test_from_row(row)


def list_tests() -> list[TestRecord]:
    """Return every test, most recently created first."""
    with get_connection() as connection:
        rows = connection.execute("SELECT * FROM tests ORDER BY created_at DESC").fetchall()
    return [_test_from_row(row) for row in rows]


def _batch_from_row(row: sqlite3.Row) -> BatchRecord:
    return BatchRecord(
        id=row["id"],
        test_id=row["test_id"],
        status=row["status"],
        created_at=row["created_at"],
    )


def create_batch(new_batch: NewBatch) -> BatchRecord:
    """Insert a batch tied to an existing test, then return the stored record."""
    get_test(new_batch.test_id)
    with get_connection() as connection:
        cursor = connection.execute(
            "INSERT INTO batches (test_id) VALUES (?)",
            (new_batch.test_id,),
        )
        connection.commit()
        return get_batch(cursor.lastrowid)


def get_batch(batch_id: int) -> BatchRecord:
    """Return one batch by id, or raise BatchNotFoundError."""
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)).fetchone()
    if row is None:
        raise BatchNotFoundError(batch_id)
    return _batch_from_row(row)


def list_batches_for_test(test_id: int) -> list[BatchRecord]:
    """Return every batch belonging to a test, most recently created first."""
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM batches WHERE test_id = ? ORDER BY created_at DESC",
            (test_id,),
        ).fetchall()
    return [_batch_from_row(row) for row in rows]


def _scan_job_from_row(row: sqlite3.Row) -> ScanJobRecord:
    return ScanJobRecord(
        id=row["id"],
        batch_id=row["batch_id"],
        raw_image_path=row["raw_image_path"],
        status=row["status"],
        created_at=row["created_at"],
    )


def create_scan_job(new_scan_job: NewScanJob) -> ScanJobRecord:
    """Insert a scan job for an already-written image, then return the stored record."""
    get_batch(new_scan_job.batch_id)
    with get_connection() as connection:
        cursor = connection.execute(
            "INSERT INTO scan_jobs (batch_id, raw_image_path) VALUES (?, ?)",
            (new_scan_job.batch_id, new_scan_job.raw_image_path),
        )
        connection.commit()
        return get_scan_job(cursor.lastrowid)


def get_scan_job(scan_job_id: int) -> ScanJobRecord:
    """Return one scan job by id, or raise ScanJobNotFoundError."""
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM scan_jobs WHERE id = ?", (scan_job_id,)).fetchone()
    if row is None:
        raise ScanJobNotFoundError(scan_job_id)
    return _scan_job_from_row(row)


def list_scan_jobs_for_batch(batch_id: int) -> list[ScanJobRecord]:
    """Return every scan job belonging to a batch, oldest first."""
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM scan_jobs WHERE batch_id = ? ORDER BY created_at ASC",
            (batch_id,),
        ).fetchall()
    return [_scan_job_from_row(row) for row in rows]


def list_pending_scan_jobs() -> list[ScanJobRecord]:
    """Return every scan job still waiting to be graded, oldest first."""
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM scan_jobs WHERE status = 'pending' ORDER BY created_at ASC"
        ).fetchall()
    return [_scan_job_from_row(row) for row in rows]


def update_scan_job_status(scan_job_id: int, status: str) -> ScanJobRecord:
    """Set a scan job's status, then return the updated record."""
    get_scan_job(scan_job_id)
    with get_connection() as connection:
        connection.execute(
            "UPDATE scan_jobs SET status = ? WHERE id = ?",
            (status, scan_job_id),
        )
        connection.commit()
    return get_scan_job(scan_job_id)


def _scan_result_from_row(row: sqlite3.Row) -> ScanResultRecord:
    return ScanResultRecord(
        id=row["id"],
        scan_job_id=row["scan_job_id"],
        name_text=row["name_text"],
        date_text=row["date_text"],
        section_text=row["section_text"],
        score=row["score"],
        answers_json=row["answers_json"],
        flags_json=row["flags_json"],
        needs_review=bool(row["needs_review"]),
        processed_image_path=row["processed_image_path"],
        error_message=row["error_message"],
        created_at=row["created_at"],
    )


def save_scan_result(new_scan_result: NewScanResult) -> ScanResultRecord:
    """Insert or replace the result for a scan job, then return the stored record."""
    get_scan_job(new_scan_result.scan_job_id)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO scan_results (
                scan_job_id, name_text, date_text, section_text, score,
                answers_json, flags_json, needs_review, processed_image_path
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scan_job_id) DO UPDATE SET
                name_text = excluded.name_text,
                date_text = excluded.date_text,
                section_text = excluded.section_text,
                score = excluded.score,
                answers_json = excluded.answers_json,
                flags_json = excluded.flags_json,
                needs_review = excluded.needs_review,
                processed_image_path = excluded.processed_image_path
            """,
            (
                new_scan_result.scan_job_id,
                new_scan_result.name_text,
                new_scan_result.date_text,
                new_scan_result.section_text,
                new_scan_result.score,
                new_scan_result.answers_json,
                new_scan_result.flags_json,
                int(new_scan_result.needs_review),
                new_scan_result.processed_image_path,
            ),
        )
        connection.commit()
    return get_scan_result(new_scan_result.scan_job_id)


def get_scan_result(scan_job_id: int) -> ScanResultRecord:
    """Return the result for one scan job, or raise ScanResultNotFoundError."""
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM scan_results WHERE scan_job_id = ?", (scan_job_id,)
        ).fetchone()
    if row is None:
        raise ScanResultNotFoundError(scan_job_id)
    return _scan_result_from_row(row)


def list_scan_results_needing_review() -> list[ScanResultRecord]:
    """Return every scan result flagged for manual review, oldest first."""
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM scan_results WHERE needs_review = 1 ORDER BY created_at ASC"
        ).fetchall()
    return [_scan_result_from_row(row) for row in rows]


