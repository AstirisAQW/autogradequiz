import json
import sqlite3

from app.answer_sheet_templates.catalog import get_template_spec
from app.answer_sheet_templates.exceptions import UnknownTemplateError
from app.answer_sheet_templates.geometry import ANSWER_CHOICES
from app.db.connection import get_connection
from app.db.exceptions import (
    BatchNotFoundError,
    InvalidCorrectionError,
    InvalidTestError,
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
    try:
        template = get_template_spec(new_test.template_id)
    except UnknownTemplateError as exc:
        raise InvalidTestError(str(exc)) from exc
    if len(new_test.answer_key) != template.question_count:
        raise InvalidTestError(
            f"Expected {template.question_count} answers for {new_test.template_id}, "
            f"got {len(new_test.answer_key)}."
        )
    if any(choice not in ANSWER_CHOICES for choice in new_test.answer_key):
        raise InvalidTestError(f"Answer choices must be in {ANSWER_CHOICES}.")

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
        id=row["id"] or 0,
        scan_job_id=row["scan_job_id"],
        name_text=row["name_text"] or "",
        date_text=row["date_text"] or "",
        section_text=row["section_text"] or "",
        score=row["score"] or 0.0,
        answers_json=row["answers_json"] or "[]",
        flags_json=row["flags_json"] or "{}",
        needs_review=bool(row["needs_review"]),
        processed_image_path=row["processed_image_path"] or "",
        error_message=row["error_message"] or "",
        created_at=row["created_at"] or "",
        status=row["status"],
    )


def save_scan_result(new_scan_result: NewScanResult) -> ScanResultRecord:
    """Insert or replace the result for a scan job, then return the stored record."""
    get_scan_job(new_scan_result.scan_job_id)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO scan_results (
                scan_job_id, name_text, date_text, section_text, score,
                answers_json, flags_json, needs_review, processed_image_path, error_message
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scan_job_id) DO UPDATE SET
                name_text = excluded.name_text,
                date_text = excluded.date_text,
                section_text = excluded.section_text,
                score = excluded.score,
                answers_json = excluded.answers_json,
                flags_json = excluded.flags_json,
                needs_review = excluded.needs_review,
                processed_image_path = excluded.processed_image_path,
                error_message = excluded.error_message
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
                new_scan_result.error_message,
            ),
        )
        connection.commit()
    return get_scan_result(new_scan_result.scan_job_id)


def record_scan_error(scan_job_id: int, error_message: str) -> ScanResultRecord:
    """Store an error message on scan_results without overwriting existing graded fields."""
    get_scan_job(scan_job_id)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO scan_results (scan_job_id, error_message)
            VALUES (?, ?)
            ON CONFLICT(scan_job_id) DO UPDATE SET
                error_message = excluded.error_message
            """,
            (scan_job_id, error_message),
        )
        connection.commit()
    return get_scan_result(scan_job_id)


def get_scan_result(scan_job_id: int) -> ScanResultRecord:
    """Return the result for one scan job, or raise ScanResultNotFoundError."""
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT scan_results.*, scan_jobs.status AS status FROM scan_results
            JOIN scan_jobs ON scan_jobs.id = scan_results.scan_job_id
            WHERE scan_results.scan_job_id = ?
            """,
            (scan_job_id,),
        ).fetchone()
    if row is None:
        raise ScanResultNotFoundError(scan_job_id)
    return _scan_result_from_row(row)


def list_scan_results_for_batch(batch_id: int) -> list[ScanResultRecord]:
    """Return one result entry per scan job in a batch, oldest first."""
    get_batch(batch_id)
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT COALESCE(scan_results.scan_job_id, scan_jobs.id) AS scan_job_id,
                   scan_results.*, scan_jobs.status AS status
            FROM scan_jobs
            LEFT JOIN scan_results ON scan_results.scan_job_id = scan_jobs.id
            WHERE scan_jobs.batch_id = ?
            ORDER BY scan_jobs.created_at ASC, scan_jobs.id ASC
            """,
            (batch_id,),
        ).fetchall()
    return [_scan_result_from_row(row) for row in rows]


def list_scan_results_needing_review() -> list[ScanResultRecord]:
    """Return every scan result flagged for manual review, oldest first."""
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT scan_results.*, scan_jobs.status AS status FROM scan_results
            JOIN scan_jobs ON scan_jobs.id = scan_results.scan_job_id
            WHERE scan_results.needs_review = 1
            ORDER BY scan_results.created_at ASC
            """
        ).fetchall()
    return [_scan_result_from_row(row) for row in rows]


def get_scan_corrections(scan_job_id: int) -> dict[int, str]:
    """Return stored teacher corrections {question_number: choice} for a scan job."""
    get_scan_job(scan_job_id)
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT question_number, choice FROM scan_corrections "
            "WHERE scan_job_id = ? ORDER BY question_number ASC",
            (scan_job_id,),
        ).fetchall()
    return {row["question_number"]: row["choice"] for row in rows}


def apply_scan_corrections(scan_job_id: int, corrections: dict[int, str]) -> ScanResultRecord:
    """Persist teacher choice corrections per question without modifying answers_json,
    recompute the score, and clear needs_review once all flagged questions are resolved."""
    scan_job = get_scan_job(scan_job_id)
    result = get_scan_result(scan_job_id)
    raw_answers: list[str] = json.loads(result.answers_json)
    if not raw_answers:
        raise InvalidCorrectionError(f"Scan job {scan_job_id} has no graded answers to correct.")
    batch = get_batch(scan_job.batch_id)
    test = get_test(batch.test_id)

    for question_number, choice in corrections.items():
        if not (1 <= question_number <= test.question_count):
            raise InvalidCorrectionError(f"Question number {question_number} out of range.")
        if choice not in ANSWER_CHOICES and choice != "":
            raise InvalidCorrectionError(f"Invalid correction choice {choice!r}.")

    with get_connection() as connection:
        for question_number, choice in corrections.items():
            connection.execute(
                """
                INSERT INTO scan_corrections (scan_job_id, question_number, choice)
                VALUES (?, ?, ?)
                ON CONFLICT(scan_job_id, question_number) DO UPDATE SET
                    choice = excluded.choice
                """,
                (scan_job_id, question_number, choice),
            )
        connection.commit()

    all_corrections = get_scan_corrections(scan_job_id)
    flags: dict[str, list[int]] = json.loads(result.flags_json)
    flagged = set(flags.get("ambiguous", [])) | set(flags.get("multiple", []))

    correct_count = 0
    for q_num in range(1, test.question_count + 1):
        if q_num in all_corrections:
            effective_choice = all_corrections[q_num]
        elif q_num in flagged:
            effective_choice = ""
        else:
            effective_choice = raw_answers[q_num - 1]
        if effective_choice == test.answer_key[q_num - 1]:
            correct_count += 1

    unresolved = flagged - set(all_corrections.keys())
    all_blank = all(
        all_corrections.get(q_num, raw_answers[q_num - 1]) == ""
        for q_num in range(1, test.question_count + 1)
    )
    needs_review = bool(unresolved) or (all_blank and not all_corrections)
    new_score = (correct_count / test.question_count) * 100.0 if test.question_count else 0.0

    return save_scan_result(
        NewScanResult(
            scan_job_id=result.scan_job_id,
            name_text=result.name_text,
            date_text=result.date_text,
            section_text=result.section_text,
            score=new_score,
            answers_json=result.answers_json,
            flags_json=result.flags_json,
            needs_review=needs_review,
            processed_image_path=result.processed_image_path,
            error_message=result.error_message,
        )
    )


def update_scan_identity(
    scan_job_id: int,
    name_text: str | None = None,
    date_text: str | None = None,
    section_text: str | None = None,
) -> ScanResultRecord:
    """Set name_text, date_text, and/or section_text on an existing scan result."""
    result = get_scan_result(scan_job_id)
    return save_scan_result(
        NewScanResult(
            scan_job_id=result.scan_job_id,
            name_text=result.name_text if name_text is None else name_text,
            date_text=result.date_text if date_text is None else date_text,
            section_text=result.section_text if section_text is None else section_text,
            score=result.score,
            answers_json=result.answers_json,
            flags_json=result.flags_json,
            needs_review=result.needs_review,
            processed_image_path=result.processed_image_path,
            error_message=result.error_message,
        )
    )




