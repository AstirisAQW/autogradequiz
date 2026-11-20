"""Stateless grading pipeline: align a scanned answer sheet using its fiducial
markers, classify bubbles against the template spec, score against the answer
key, and read name/date/section text boxes with Tesseract OCR.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import pytesseract

from app.answer_sheet_templates.builder import DEFAULT_TEXT_FIELDS, PAGE
from app.answer_sheet_templates.geometry import (
    ANSWER_CHOICES,
    KEY_VERSION_CHOICES,
    PageSize,
    mm_to_px,
)
from app.answer_sheet_templates.layout_spec import TemplateSpec
from app.bubble_grading.classifier import (
    BubbleResult,
    QuestionFill,
    calibrate_sheet_ink,
    classify_key_version,
    classify_sheet,
    to_grayscale,
)
from app.bubble_grading.scoring import QuestionRule, ScoreSummary, score_sheet
from app.config import get_settings
from app.grading_pipeline.exceptions import InvalidAnswerKeyError
from app.scan_alignment.align_scan import align_scan


@dataclass(frozen=True)
class ResolvedKeySpec:
    version: str
    answer_key: list[str]
    points: list[float]
    question_rules: list[QuestionRule]


def normalize_answer_key_entry(entry: str) -> str:
    parts = [p.strip().upper() for p in entry.split("+") if p.strip()]
    if not parts or any(part not in ANSWER_CHOICES for part in parts):
        raise InvalidAnswerKeyError(f"Answer choices must be in {ANSWER_CHOICES}.")
    unique_sorted = sorted(set(parts), key=ANSWER_CHOICES.index)
    return "+".join(unique_sorted)


def validate_answer_key_and_points(
    question_count: int,
    answer_key: list[str],
    points: list[float] | None = None,
) -> tuple[list[str], list[float]]:
    if len(answer_key) != question_count:
        raise InvalidAnswerKeyError(
            f"Expected {question_count} answers, got {len(answer_key)}."
        )
    normalized_key = [normalize_answer_key_entry(entry) for entry in answer_key]
    if points is None:
        normalized_points = [1.0] * question_count
    else:
        if len(points) != question_count:
            raise InvalidAnswerKeyError(
                f"Expected {question_count} point values, got {len(points)}."
            )
        normalized_points = [_validate_float(p, "point value") for p in points]
        if any(p < 0 for p in normalized_points):
            raise InvalidAnswerKeyError("Question point values must be non-negative.")
    return normalized_key, normalized_points


def _validate_float(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidAnswerKeyError(f"{label} must be a number.")
    num = float(value)
    if not math.isfinite(num):
        raise InvalidAnswerKeyError(f"{label} must be finite.")
    return num


def normalize_question_rules(
    question_count: int, raw_rules: Any
) -> list[QuestionRule]:
    if raw_rules is None:
        return [QuestionRule()] * question_count
    if not isinstance(raw_rules, list) or len(raw_rules) != question_count:
        raise InvalidAnswerKeyError(
            f"Expected {question_count} question_rules entries."
        )
    normalized: list[QuestionRule] = []
    for entry in raw_rules:
        if not isinstance(entry, dict):
            raise InvalidAnswerKeyError("Each question_rule entry must be an object.")
        alt_raw = entry.get("alternate_answers", entry.get("alternateAnswers", []))
        if not isinstance(alt_raw, list):
            raise InvalidAnswerKeyError("alternate_answers must be a list.")
        alts: list[tuple[str, float]] = []
        for alt in alt_raw:
            if not isinstance(alt, dict) or not isinstance(alt.get("choice"), str):
                raise InvalidAnswerKeyError(
                    "Each alternate answer must include choice and points."
                )
            norm_choice = normalize_answer_key_entry(alt["choice"])
            alt_pts = _validate_float(alt.get("points"), "alternate answer points")
            if alt_pts < 0:
                raise InvalidAnswerKeyError(
                    "Alternate answer points must be non-negative."
                )
            alts.append((norm_choice, alt_pts))
        inc_raw = entry.get("incorrect_points", entry.get("incorrectPoints", 0.0))
        incorrect_pts = _validate_float(inc_raw, "incorrect_points")
        normalized.append(
            QuestionRule(alternate_answers=tuple(alts), incorrect_points=incorrect_pts)
        )
    return normalized


def scan_job_needs_review(question_fills: dict[int, QuestionFill]) -> bool:
    return any(
        fill.result in (BubbleResult.AMBIGUOUS, BubbleResult.MULTIPLE)
        for fill in question_fills.values()
    ) or all(fill.result == BubbleResult.BLANK for fill in question_fills.values())


TEXT_BOX_OCR_INSET_PX = 8
TEXT_BOX_INK_INSET_PX = 16
TEXT_BOX_INK_DARK_OFFSET = 50
TEXT_BOX_MIN_INK_SHARE = 0.01


def _box_has_ink(image: np.ndarray, x0: int, y0: int, x1: int, y1: int) -> bool:
    interior = image[
        y0 + TEXT_BOX_INK_INSET_PX : y1 - TEXT_BOX_INK_INSET_PX,
        x0 + TEXT_BOX_INK_INSET_PX : x1 - TEXT_BOX_INK_INSET_PX,
    ]
    if interior.size == 0:
        return False
    gray = to_grayscale(interior)
    dark_share = float(np.mean(gray < float(np.median(gray)) - TEXT_BOX_INK_DARK_OFFSET))
    return dark_share >= TEXT_BOX_MIN_INK_SHARE


def read_text_fields(image: np.ndarray, page: PageSize = PAGE) -> dict[str, str]:
    settings = get_settings()
    if settings.tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd
    values: dict[str, str] = {}
    for field in DEFAULT_TEXT_FIELDS:
        x0, y0 = mm_to_px(field.x_mm, field.y_mm, page)
        x1, y1 = mm_to_px(field.x_mm + field.width_mm, field.y_mm + field.height_mm, page)
        if not _box_has_ink(image, x0, y0, x1, y1):
            values[field.id] = ""
            continue
        crop = image[
            y0 + TEXT_BOX_OCR_INSET_PX : y1 - TEXT_BOX_OCR_INSET_PX,
            x0 + TEXT_BOX_OCR_INSET_PX : x1 - TEXT_BOX_OCR_INSET_PX,
        ]
        try:
            text = pytesseract.image_to_string(crop, config="--psm 7").strip()
            values[field.id] = text if sum(1 for ch in text if ch.isalnum()) >= 2 else ""
        except Exception:
            values[field.id] = ""
    return values


def grade_image_array(
    image: np.ndarray,
    template_spec: TemplateSpec,
    answer_key: list[str],
    points: list[float] | None = None,
    question_rules: list[QuestionRule] | None = None,
) -> tuple[np.ndarray, dict[int, QuestionFill], ScoreSummary, dict[str, str]]:
    """Run alignment, bubble classification, scoring, and OCR on an in-memory image."""
    aligned_image = align_scan(image, template_spec)
    question_fills = classify_sheet(aligned_image, template_spec)
    score_summary = score_sheet(
        question_fills, answer_key, points=points, question_rules=question_rules
    )
    text_fields = read_text_fields(aligned_image)
    return aligned_image, question_fills, score_summary, text_fields


def grade_image_with_versions(
    image: np.ndarray,
    template_spec: TemplateSpec,
    *,
    primary_key: ResolvedKeySpec,
    key_versions: dict[str, ResolvedKeySpec] | None = None,
) -> tuple[
    np.ndarray,
    dict[int, QuestionFill],
    ScoreSummary,
    dict[str, str],
    str,
    bool,
    ResolvedKeySpec,
]:
    """Align, detect printed Key Version A-D, select matching key, score, and OCR."""
    aligned_image = align_scan(image, template_spec)
    ink_map = calibrate_sheet_ink(to_grayscale(aligned_image), PAGE)
    kv_fill = classify_key_version(aligned_image, PAGE, ink_map=ink_map)
    detected_version = (
        kv_fill.marked_choices[0]
        if kv_fill.result == BubbleResult.FILLED
        and kv_fill.marked_choices[0] in KEY_VERSION_CHOICES
        else ""
    )
    version_map = {"A": primary_key, **(key_versions or {})}
    version_flagged = kv_fill.result in (
        BubbleResult.AMBIGUOUS,
        BubbleResult.MULTIPLE,
    ) or (
        len(version_map) > 1
        and bool(detected_version)
        and detected_version not in version_map
    )

    active_key = version_map.get(detected_version, primary_key)

    question_fills = classify_sheet(aligned_image, template_spec, ink_map=ink_map)
    score_summary = score_sheet(
        question_fills,
        active_key.answer_key,
        points=active_key.points,
        question_rules=active_key.question_rules,
    )
    text_fields = read_text_fields(aligned_image)
    return (
        aligned_image,
        question_fills,
        score_summary,
        text_fields,
        detected_version,
        version_flagged,
        active_key,
    )
