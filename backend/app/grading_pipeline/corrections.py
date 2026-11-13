"""Teacher scan correction policy: validate, persist, and rescore."""

from __future__ import annotations

import json

from app.answer_sheet_templates.geometry import ANSWER_CHOICES
from app.db.exceptions import InvalidCorrectionError
from app.db.records import NewScanResult, ScanResultRecord
from app.db.repositories import (
    get_batch,
    get_scan_corrections,
    get_scan_job,
    get_scan_result,
    get_test,
    save_scan_corrections,
    save_scan_result,
)


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

    save_scan_corrections(scan_job_id, corrections)

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
