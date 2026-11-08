"""Grades one pending scan job end to end: load its image, classify it against its
test's template, score it against the answer key, and persist the result.

This assumes scan_job.raw_image_path already points to an image aligned to its
template's page dimensions. Detecting and correcting a scan's rotation or perspective
from its fiducial markers -- so an arbitrary phone photo can be used as input here -- is
a separate step this module does not perform yet.

name_text, date_text, and section_text are left blank: reading them from the scan is the
OCR phase config.tesseract_cmd is reserved for, which hasn't been built yet either.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from app.answer_sheet_templates.catalog import get_template_spec
from app.bubble_grading.classifier import BubbleResult, QuestionFill, classify_sheet, score_sheet
from app.config import get_settings
from app.db.records import NewScanResult, ScanResultRecord
from app.db.repositories import (
    get_batch,
    get_scan_job,
    get_test,
    save_scan_result,
    update_scan_job_status,
)
from app.grading_pipeline.exceptions import ScanImageUnreadableError
from app.scan_alignment.align_scan import align_scan


def load_scan_image(raw_image_path: str) -> np.ndarray:
    image = cv2.imread(raw_image_path)
    if image is None:
        raise ScanImageUnreadableError(raw_image_path)
    return image


def question_fills_to_answers_json(question_fills: dict[int, QuestionFill]) -> str:
    """One entry per question, in question-number order: its marked choice(s) joined
    with "+", or "" if the question was left blank."""
    ordered_numbers = sorted(question_fills)
    answers = ["+".join(question_fills[number].marked_choices) for number in ordered_numbers]
    return json.dumps(answers)


def question_fills_to_flags_json(question_fills: dict[int, QuestionFill]) -> str:
    """Question numbers that need a human's attention, grouped by why."""
    ordered_items = sorted(question_fills.items())
    flags = {
        "ambiguous": [
            number for number, fill in ordered_items if fill.result == BubbleResult.AMBIGUOUS
        ],
        "multiple": [
            number for number, fill in ordered_items if fill.result == BubbleResult.MULTIPLE
        ],
    }
    return json.dumps(flags)


def scan_job_needs_review(question_fills: dict[int, QuestionFill]) -> bool:
    return any(
        fill.result in (BubbleResult.AMBIGUOUS, BubbleResult.MULTIPLE)
        for fill in question_fills.values()
    ) or all(fill.result == BubbleResult.BLANK for fill in question_fills.values())


def grade_scan_job(scan_job_id: int) -> ScanResultRecord:
    """Run one scan job through classification and scoring, store the result, and mark
    the scan job done."""
    scan_job = get_scan_job(scan_job_id)
    try:
        batch = get_batch(scan_job.batch_id)
        test = get_test(batch.test_id)
        template_spec = get_template_spec(test.template_id)

        image = load_scan_image(scan_job.raw_image_path)
        aligned_image = align_scan(image, template_spec)
        processed_dir = Path(get_settings().autograde_data_dir) / "processed"
        processed_dir.mkdir(parents=True, exist_ok=True)
        processed_image_path = str(processed_dir / f"scan_{scan_job.id}.png")
        cv2.imwrite(processed_image_path, aligned_image)

        question_fills = classify_sheet(aligned_image, template_spec)
        score_summary = score_sheet(question_fills, test.answer_key)

        scan_result = save_scan_result(
            NewScanResult(
                scan_job_id=scan_job.id,
                name_text="",
                date_text="",
                section_text="",
                score=score_summary.score_fraction * 100,
                answers_json=question_fills_to_answers_json(question_fills),
                flags_json=question_fills_to_flags_json(question_fills),
                needs_review=scan_job_needs_review(question_fills),
                processed_image_path=processed_image_path,
            )
        )
        update_scan_job_status(scan_job.id, "done")
        return scan_result
    except Exception as exc:
        save_scan_result(NewScanResult(scan_job_id=scan_job.id, error_message=str(exc)))
        update_scan_job_status(scan_job.id, "failed")
        raise
